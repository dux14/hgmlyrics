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
import { projectCanonicalLines, projectLineSections } from '../../../_lib/align.js';
import { getPipelineLyrics, pipelineLinesFor } from '../../../_lib/pipeline/lyricsStore.js';
import sql from '../../../_lib/db.js';
import { STEM_KINDS, SECTION_KEYS } from '../../../stems/_sections.js';

// Pistas que produce la fase 'stems' agrupadas por sección Modal (mismo shape
// {seccion: {pista: url}} que arma api/stems/jobs/[id]/start.js). STEM_KINDS
// (kinds que cada sección PUBLICA en song_stems) vive en api/stems/_sections.js
// — único hogar compartido con api/_lib/pipeline/stemsAdapter.js, que filtra
// por ese mapa antes de publicar (fix review Task 6: la vocals de S1 llegaba
// a publicarse igual, protegida solo por el orden temporal S1→S3 del DAG).

// UPLOAD_SLOTS = archivos que SUBE cada sección Modal. Antes de Task 9
// (paralelización total) voiceInstrumental (S1) tenía un slot extra `vocals`
// que STEM_KINDS no publica (S1 la sube como copia de trabajo/scratch, sin
// consumidor aguas abajo) — pero apuntaba a la MISMA storage key física que
// leadBacking (S3): pipelineStemKey(songId,'vocals'). Con S1 y S3 en
// paralelo (ya no hay orden S1→S3 que evite la carrera), dos escritores a la
// misma key es no-determinista. Fix: S1 ya no recibe slot de upload para
// `vocals` (sections/extract.py salta la subida si el slot no está en
// `uploads`, ver `if not put_url: continue`) — la fuente canónica de
// `vocals` queda exclusivamente en leadBacking (S3), como ya documenta
// STEM_KINDS. UPLOAD_SLOTS == STEM_KINDS 1:1 ahora.
export const UPLOAD_SLOTS = STEM_KINDS;

// Las 5 secciones del DAG Modal (modal/stems_app.py run_pipeline), mismo orden
// que SECTION_KEYS. S1 (voiceInstrumental) corre siempre sin importar
// enabledSections; S2 (structure) / S3 (leadBacking) / S4 (gender) / S5 (duet)
// sí se gatean aquí.
export const ENABLED_SECTIONS = SECTION_KEYS;

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
    Object.entries(UPLOAD_SLOTS).map(async ([section, kinds]) => {
      const signed = await Promise.all(
        kinds.map(async (k) => [k, await createSongAudioSignedPutUrl(pipelineStemKey(songId, k))]),
      );
      // gender usa estructura anidada por modelo (ver modal/sections/gender.py,
      // solo queda vigente chorus_bs_roformer): uploads.gender.chorus.{male,female}.
      if (section === 'gender') return [section, { chorus: Object.fromEntries(signed) }];
      return [section, Object.fromEntries(signed)];
    }),
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
 * @param {{isRetry?:boolean}} [opts] `isRetry` solo lo pasa retry.js (acción
 *   deliberada del admin sobre una fase failed/stale) — hoy únicamente lo
 *   consume `pitch`: sin esto, el jobId (=run.id) ya visto por hkn-pitch en
 *   un dispatch anterior (aprobación de letra) hace que `start()` del lado
 *   Modal devuelva el callId cacheado (dedup) en vez de relanzar
 *   `run_pipeline`, dejando la fase colgada en 'running' sin webhook ni logs.
 * @returns {Promise<{id:string}>}
 */
export async function dispatchPhase(phase, run, { isRetry = false } = {}) {
  const webhook = webhookUrl();
  if (phase === 'stems') {
    const inputGetUrl = await signSongAudioDownload(run.inputPath);
    const uploads = await stemsUploads(run.songId);
    return dispatchStems({
      run: { id: run.id, songId: run.songId, inputGetUrl },
      uploads,
      enabledSections: ENABLED_SECTIONS,
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
    // ver nota de transcription/pitch arriba: run.lyricsReview aún no viaja
    // desde confirm.js/retry.js, undefined por ahora si no hay aprobación.
    return dispatchAlign(run.songId, run.lyricsReview?.approvedHash);
  }
  if (phase === 'pitch') {
    const leadKey = run.phases.stems?.tracks?.lead;
    const backingKey = run.phases.stems?.tracks?.backing;
    if (!leadKey || !backingKey) {
      const e = new Error("Fase 'stems' sin lead/backing: no se puede analizar el pitch");
      e.status = 409;
      throw e;
    }
    const [leadGetUrl, backingGetUrl, pipelineLyrics] = await Promise.all([
      signSongAudioDownload(leadKey),
      signSongAudioDownload(backingKey),
      getPipelineLyrics(sql, run.songId),
    ]);
    // Letra aprobada del gate (Task 2.3): sin fila en song_pipeline_lyrics
    // (job standalone de pitch_jobs) lines/language quedan undefined y
    // hkn-pitch conserva su camino actual (transcribe propio). `language`
    // sale del store, no de run.lyricsReview: ese documento no viaja en un
    // retry manual (ver nota de transcription arriba), el store sí.
    const lines = pipelineLyrics ? pipelineLinesFor(pipelineLyrics.sections) : undefined;
    return dispatchPitch({
      run: { id: run.id, songId: run.songId },
      leadGetUrl,
      backingGetUrl,
      // Fix (revisión pre-merge): antes usaba run.lyricsReview?.approvedHash,
      // que retry.js nunca trae en su SELECT (siempre undefined ahí) y
      // deshabilitaba el guard de staleness de process.js para un reintento
      // manual de pitch. pipelineLyrics.hash es el mismo valor, ya cargado
      // arriba, y no depende de qué columnas seleccionó cada llamador.
      snapshotHash: pipelineLyrics?.hash,
      lines,
      language: pipelineLyrics?.language,
      webhookUrl: webhook,
      reset: isRetry,
    });
  }
  // clips (Task B6+plan C, Task 8 song_structure): stems/lines vienen de
  // song_stems (vía run.phases.stems.tracks) y song_line_timings.
  // lineSections/totalMs se derivan de los segmentos reales detectados por
  // SongFormer (song_structure, fase `structure`) cuando existen; si no hay
  // fila song_structure, caen al fallback anterior: snapshot de letra ya
  // aprobado (plan C publica songs.sections + line timings vía sync antes de
  // que ADVANCE_AFTER dispare clips).
  const tracks = run.phases.stems?.tracks || {};
  const [song, stems, lineTimingsRow, audioRow, structureRow, pipelineLyrics] = await Promise.all([
    sql`SELECT sections FROM songs WHERE id = ${run.songId}`,
    Promise.all(
      Object.entries(tracks).map(async ([kind, key]) => ({ kind, getUrl: await signSongAudioDownload(key) })),
    ),
    sql`SELECT lines FROM song_line_timings WHERE song_id = ${run.songId}`,
    sql`SELECT duration_sec AS "durationSec" FROM song_audio WHERE song_id = ${run.songId}`,
    sql`SELECT segments FROM song_structure WHERE song_id = ${run.songId}`,
    getPipelineLyrics(sql, run.songId),
  ]);
  // El approve del pipeline (F3) ya NO escribe songs.sections: para una
  // canción pipeline esa columna queda vacía. Si hay fila en el store propio
  // (song_pipeline_lyrics) manda ella como fuente de secciones; sin fila
  // (canción standalone/manual, letra editada a mano en el cancionero) se
  // conserva el fallback anterior a songs.sections.
  const sectionSource = pipelineLyrics?.sections ?? song[0]?.sections;
  const lines = lineTimingsRow[0]?.lines || [];
  // Segmentos detectados (ya en ms, ver supabase/migrations/20260722010000_song_structure.sql):
  // [{label, startMs, endMs}]. Nada garantiza en el productor (stemsAdapter/
  // process.js no ordenan) que lleguen ordenados/contiguos, así que aquí se
  // ordenan defensivamente por startMs ascendente y se descartan filas con
  // startMs/endMs no finitos antes de derivar nada (review Task 8, Important).
  const rawSegments = structureRow[0]?.segments;
  const detectedSegments = Array.isArray(rawSegments)
    ? rawSegments
        .filter((s) => Number.isFinite(s?.startMs) && Number.isFinite(s?.endMs))
        .sort((a, b) => a.startMs - b.startMs)
    : [];
  const hasDetectedSegments = detectedSegments.length > 0;

  // Eje ÚNICO de secciones: el documento aprobado (`sectionSource`). Antes
  // lineSections salía de los segmentos detectados mientras uploads salía del
  // documento — dos ejes para la misma columna section_index, que es el
  // desfase clip↔letra del run del 24-jul (H9). Los segmentos detectados solo
  // alimentan totalMs. canonicalSections[i] = índice de sección de la línea
  // canónica i (mismo orden que usa song_line_timings.lines[].i, ver
  // projectCanonicalLines); lineSections queda paralelo a `lines` (mismo
  // largo, mismo orden), como espera modal/clips_app.py.
  const canonicalSections = projectLineSections(sectionSource);
  const lineSections = lines.map((l) => canonicalSections[l.i] ?? 0);
  // Secciones que efectivamente tienen líneas: son las únicas para las que
  // clips_app.py produce un rango (section_ranges recorre lineSections), así
  // que firmar el resto sería firmar URLs muertas — 208 firmas para 195 clips
  // en el run auditado.
  const sectionsWithLines = [...new Set(lineSections)].sort((a, b) => a - b);
  // duration_sec es NUMERIC en Postgres → llega como string vía postgres.js.
  // Puede ser null (caso real observado); ahí se cae a la última línea
  // conocida (máximo startMs) en vez de dispatchear con 0. Con segmentos
  // detectados, totalMs es el máximo endMs (no el del último elemento
  // posicional — ya se ordenó arriba, pero calcularlo así es robusto igual
  // si algún día conviven segmentos solapados).
  const durationSec = audioRow[0]?.durationSec;
  const totalMs = hasDetectedSegments
    ? Math.max(...detectedSegments.map((s) => s.endMs))
    : durationSec !== null && durationSec !== undefined
      ? Math.round(Number(durationSec) * 1000)
      : lines.reduce((max, l) => Math.max(max, l.startMs || 0), 0);
  // uploads/uploadKeys quedan atados a `sectionsWithLines` (eje único, ver
  // arriba): son la misma columna section_index que usan
  // api/songs/[id]/section-audio.js y SongView.js, pero acotada a las
  // secciones que clips_app.py efectivamente produce.
  const uploads = {};
  const uploadKeys = {};
  for (const kind of Object.keys(tracks)) {
    uploads[kind] = {};
    uploadKeys[kind] = {};
  }
  // Sufijo por snapshot (fix HIGH 5, auditoría 27-jul): las storage keys eran
  // deterministas (`songId/clips/kind/section-N.mp3`) SIN el hash del ciclo de
  // letra. Un job de clips del ciclo viejo que sigue vivo cuando ya se aprobó
  // un ciclo nuevo pisa en silencio el mp3 del ciclo nuevo (mismas keys) — la
  // UI muestra los metadatos nuevos pero suena el recorte viejo. Sin
  // approvedHash (canción standalone/manual, sin gate de letra) se conserva
  // la key sin sufijo, mismo comportamiento que antes de este fix.
  // Fix (revisión pre-merge): antes usaba run.lyricsReview?.approvedHash, que
  // retry.js nunca trae en su SELECT (siempre undefined ahí) y deshabilitaba
  // tanto el guard de staleness de process.js como este sufijo de storage key
  // en un reintento manual de clips. pipelineLyrics.hash es el mismo valor,
  // ya cargado arriba, y no depende de qué columnas seleccionó cada llamador.
  const clipsSnapshotHash = pipelineLyrics?.hash;
  const clipsKeySuffix = clipsSnapshotHash ? `-${clipsSnapshotHash.slice(0, 8)}` : '';
  // Firmado en paralelo (fix HIGH 2, auditoría 27-jul): con ~200 clips
  // (kinds × secciones) firmando en serie, el handler agotaba el maxDuration
  // del webhook antes de terminar de armar el payload de dispatchClips —
  // aquí ya no hay "volumen bajo" que justifique claridad sobre paralelismo.
  await Promise.all(
    Object.keys(tracks).flatMap((kind) =>
      sectionsWithLines.map(async (sectionIndex) => {
        const key = `${run.songId}/clips/${kind}/section-${sectionIndex}${clipsKeySuffix}.mp3`;
        uploads[kind][String(sectionIndex)] = await createSongAudioSignedPutUrl(key);
        uploadKeys[kind][String(sectionIndex)] = key;
      }),
    ),
  );
  return dispatchClips({
    run: { id: run.id, songId: run.songId },
    stems,
    lines,
    lineSections,
    totalMs,
    uploads,
    uploadKeys,
    snapshotHash: clipsSnapshotHash,
    webhookUrl: webhook,
  });
}
