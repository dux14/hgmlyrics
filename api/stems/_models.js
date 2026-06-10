/**
 * _models.js — Registry de modelos Replicate del Estudio de pistas.
 * ÚNICO lugar donde viven slugs e inputs. Si un modelo cambia, se toca SOLO este archivo.
 * Slugs y schemas verificados el 2026-06-09 contra la API de Replicate (cuenta dux1401).
 */

export const MODELS = {
  // Etapa 1: separación 6-stem. ryan5453/demucs corriendo htdemucs_6s (única vía a 6 stems).
  // Salvedad conocida: el stem de piano es flojo. Pedimos output mp3 (más liviano que wav para
  // almacenamiento efímero); el modelo devuelve un objeto { vocals, drums, bass, guitar, piano, other }.
  stems: {
    slug: 'ryan5453/demucs',
    buildInput: (audioUrl) => ({ audio: audioUrl, model: 'htdemucs_6s', output_format: 'mp3' }),
    parseOutput: (output) => ({
      vocals: output.vocals,
      drums: output.drums,
      bass: output.bass,
      guitar: output.guitar,
      piano: output.piano,
      other: output.other,
    }),
  },

  // Etapa 2a: líder vs coros sobre el stem vocal. No existe un RoFormer karaoke turnkey en
  // Replicate (verificado 2026-06-09) → fallback MDX23. LIMITACIÓN: MDX23 separa voz/instrumental,
  // no líder/coros; su output es un ARRAY de URLs [vocals, instrumental]. "backing" aquí es el
  // residual instrumental del stem vocal, así que los coros pueden venir casi vacíos. Toda la voz
  // principal va a "lead".
  karaoke: {
    slug: 'lucataco/mvsep-mdx23-music-separation',
    buildInput: (vocalUrl) => ({ audio: vocalUrl }),
    parseOutput: (output) => {
      const arr = Array.isArray(output) ? output : [];
      return { lead: arr[0] ?? null, backing: arr[1] ?? null };
    },
  },

  // Etapa 2b: diarización (segmentos por cantante). collectiveai-team/speaker-diarization-3 (pyannote).
  // Output: { segments: [{ speaker, start, stop }], speakers }. OJO: start/stop vienen como STRINGS
  // (segundos) y el campo es "stop", no "end".
  diarization: {
    slug: 'collectiveai-team/speaker-diarization-3',
    buildInput: (vocalUrl) => ({ audio: vocalUrl }),
    parseOutput: (output) => {
      const segments = output?.segments ?? [];
      const speakerNames = new Map();
      return (Array.isArray(segments) ? segments : []).map((s) => {
        const raw = s.speaker ?? 'S0';
        if (!speakerNames.has(raw)) speakerNames.set(raw, `Voz ${speakerNames.size + 1}`);
        return { voice: speakerNames.get(raw), start: Number(s.start), end: Number(s.stop) };
      });
    },
  },
};
