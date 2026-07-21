// _dispatch.js — helper compartido por confirm.js y retry.js para armar los
// argumentos de cada dispatch* de api/_lib/pipeline/dispatch.js a partir del
// run persistido. Prefijo `_`: no es una ruta, mismo criterio que api/pitch/_lib.
import {
  dispatchStems,
  dispatchTranscribe,
  dispatchAlign,
  dispatchPitch,
  dispatchClips,
} from '../../../_lib/pipeline/dispatch.js';
import {
  pipelineStemKey,
  createSongAudioSignedPutUrl,
  signSongAudioDownload,
} from '../../../_lib/storage.js';
import { projectCanonicalLines } from '../../../_lib/align.js';
import sql from '../../../_lib/db.js';

// Pistas que produce la fase 'stems' agrupadas por sección Modal (mismo shape
// {seccion: {pista: url}} que arma api/stems/jobs/[id]/start.js).
// leadBacking incluye 'vocals': la sección re-extrae el stem vocal intermedio
// (extract_vocals_stem) antes de separar lead/backing y ahora lo sube también
// (ver modal/sections/lead_backing.py) — es la única fuente de `tracks.vocals`
// en el pipeline unificado (voiceInstrumental no sube nada en este modo).
const STEM_KINDS = { leadBacking: ['lead', 'backing', 'vocals'], gender: ['male', 'female'] };

function webhookUrl() {
  return `${process.env.PUBLIC_BASE_URL}/api/pipeline/webhook`;
}

/**
 * Líneas de texto de la letra actual en DB (`songs.sections`), en el mismo
 * orden/regla que `projectCanonicalLines` (align.js) — mismo criterio que
 * usa `dispatchAlign` para armar `lines`.
 * @param {string} songId
 * @returns {Promise<string[]>}
 */
async function dbLinesFor(songId) {
  const [song] = await sql`SELECT sections FROM songs WHERE id = ${songId}`;
  return projectCanonicalLines(song?.sections).map((l) => l.text);
}

/**
 * Líneas de texto de la letra canónica ingerida (fuente externa, tabla
 * `song_lyrics_canonical`), si existe. Shape del ingest:
 * `{ secciones: [ { lineas: [ { texto } ] } ] }` — se aplana a un solo array.
 * @param {string} songId
 * @returns {Promise<string[]|undefined>}
 */
async function canonicalLinesFor(songId) {
  const [row] = await sql`SELECT content FROM song_lyrics_canonical WHERE song_id = ${songId}`;
  if (!row?.content) return undefined;
  const secciones = row.content.secciones || [];
  const lines = secciones.flatMap((s) => (s.lineas || []).map((l) => l.texto));
  return lines.length ? lines : undefined;
}

async function stemsUploads(songId) {
  const entries = await Promise.all(
    Object.entries(STEM_KINDS).map(async ([section, kinds]) => [
      section,
      Object.fromEntries(
        await Promise.all(
          kinds.map(async (k) => [k, await createSongAudioSignedPutUrl(pipelineStemKey(songId, k))]),
        ),
      ),
    ]),
  );
  return Object.fromEntries(entries);
}

/**
 * Despacha la fase `phase` de un run ya persistido (el llamador hizo el CAS
 * de estado antes de invocar, igual criterio que dispatch.js). `transcription`
 * y `clips` dependen de apps Modal que aún no existen (Task B5/B6, ver
 * comentarios en dispatch.js) — fallan igual con un 500 claro, sin guard especial.
 * @param {'stems'|'transcription'|'sync'|'pitch'|'clips'} phase
 * @param {{id:string, songId:string, inputPath:string, phases:object}} run
 * @returns {Promise<{id:string}>}
 */
export async function dispatchPhase(phase, run) {
  const webhook = webhookUrl();
  if (phase === 'stems') {
    const inputGetUrl = await signSongAudioDownload(run.inputPath);
    const uploads = await stemsUploads(run.songId);
    return dispatchStems({
      run: { id: run.id, songId: run.songId, inputGetUrl },
      uploads,
      webhookUrl: webhook,
    });
  }
  if (phase === 'transcription') {
    const vocalsKey = run.phases.stems?.tracks?.vocals;
    if (!vocalsKey) {
      const e = new Error("Fase 'stems' sin pista vocals: no se puede transcribir");
      e.status = 409;
      throw e;
    }
    const [vocalsGetUrl, dbLines, canonicalLines] = await Promise.all([
      signSongAudioDownload(vocalsKey),
      dbLinesFor(run.songId),
      canonicalLinesFor(run.songId),
    ]);
    // `run.lyricsReview` NO viaja hoy en el objeto `run` que reciben
    // confirm.js/retry.js (su SELECT no trae `lyrics_review`) — en la fase
    // transcription normalmente no hay snapshot aprobado todavía, así que
    // queda undefined salvo que el llamador ya lo incluya.
    return dispatchTranscribe({
      run: { id: run.id, songId: run.songId },
      vocalsGetUrl,
      dbLines,
      canonicalLines,
      snapshotHash: run.lyricsReview?.approvedHash,
      webhookUrl: webhook,
    });
  }
  if (phase === 'sync') {
    return dispatchAlign(run.songId);
  }
  if (phase === 'pitch') {
    const leadKey = run.phases.stems?.tracks?.lead;
    const backingKey = run.phases.stems?.tracks?.backing;
    if (!leadKey || !backingKey) {
      const e = new Error("Fase 'stems' sin lead/backing: no se puede analizar el pitch");
      e.status = 409;
      throw e;
    }
    const [leadGetUrl, backingGetUrl] = await Promise.all([
      signSongAudioDownload(leadKey),
      signSongAudioDownload(backingKey),
    ]);
    return dispatchPitch({
      run: { id: run.id, songId: run.songId },
      leadGetUrl,
      backingGetUrl,
      // ver nota de transcription arriba: run.lyricsReview aún no viaja desde
      // confirm.js/retry.js, undefined por ahora si no hay aprobación.
      snapshotHash: run.lyricsReview?.approvedHash,
      webhookUrl: webhook,
    });
  }
  // clips (Task B6): stems/lines ya tienen fuente real (song_stems vía
  // run.phases.stems.tracks, song_line_timings). lineSections/totalMs
  // dependen del snapshot de letra aprobado (plan C, aún no existe) — se
  // dejan vacíos/0 con el shape correcto para que plan C solo tenga que
  // llenarlos, sin tocar dispatch.js otra vez.
  const tracks = run.phases.stems?.tracks || {};
  const [song, stems, lineTimingsRow] = await Promise.all([
    sql`SELECT sections FROM songs WHERE id = ${run.songId}`,
    Promise.all(
      Object.entries(tracks).map(async ([kind, key]) => ({ kind, getUrl: await signSongAudioDownload(key) })),
    ),
    sql`SELECT lines FROM song_line_timings WHERE song_id = ${run.songId}`,
  ]);
  const lines = lineTimingsRow[0]?.lines || [];
  // TODO(plan C): lineSections/totalMs deben derivarse del snapshot de letra
  // aprobado (mapeo linea->sección + duración total); se dejan vacíos/0 hasta
  // que plan C los aporte.
  const lineSections = [];
  const totalMs = 0;
  // Rango de secciones conocido hoy sin plan C: `song.sections` (letra
  // actual en DB). Las signed PUT URLs se generan por (kind, sectionIndex)
  // con ese rango — cuando plan C aporte lineSections real, el mismo shape
  // ya alcanza.
  const sectionCount = song[0]?.sections?.length || 0;
  const uploads = {};
  const uploadKeys = {};
  for (const kind of Object.keys(tracks)) {
    uploads[kind] = {};
    uploadKeys[kind] = {};
    for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
      const key = `${run.songId}/clips/${kind}/section-${sectionIndex}.mp3`;
      // Volumen bajo (secciones de una canción): claridad > paralelismo aquí.
      uploads[kind][String(sectionIndex)] = await createSongAudioSignedPutUrl(key);
      uploadKeys[kind][String(sectionIndex)] = key;
    }
  }
  return dispatchClips({
    run: { id: run.id, songId: run.songId },
    stems,
    lines,
    lineSections,
    totalMs,
    uploads,
    uploadKeys,
    snapshotHash: run.lyricsReview?.approvedHash,
    webhookUrl: webhook,
  });
}
