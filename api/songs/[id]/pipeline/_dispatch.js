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

// Pistas que produce la fase 'stems' agrupadas por sección Modal (mismo shape
// {seccion: {pista: url}} que arma api/stems/jobs/[id]/start.js).
const STEM_KINDS = { leadBacking: ['lead', 'backing'], gender: ['male', 'female'] };

function webhookUrl() {
  return `${process.env.PUBLIC_BASE_URL}/api/pipeline/webhook`;
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
    const vocalsGetUrl = await signSongAudioDownload(vocalsKey);
    return dispatchTranscribe({ run: { id: run.id, songId: run.songId }, vocalsGetUrl, webhookUrl: webhook });
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
      webhookUrl: webhook,
    });
  }
  return dispatchClips({
    run: { id: run.id, songId: run.songId },
    stems: {},
    sections: {},
    timings: {},
    uploads: {},
    webhookUrl: webhook,
  });
}
