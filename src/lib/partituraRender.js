import { escapeHtml } from './escape.js';

// Render compartido letra<->nota de una voz de partitura (lead/backing...):
// una linea por linea de letra, una columna por silaba (texto arriba, nota
// debajo). Extraido de PartituraPage.js (Herramientas) para reutilizarlo en
// la vista de Partitura por cancion (D5b). Devuelve HTML string (no nodo DOM)
// porque los dos consumidores pintan via innerHTML sobre strings ya armados;
// producir un nodo DOM obligaria a un rewrite del pipeline de PartituraPage
// (riesgo de regresion visual) sin beneficio real.
export function renderVoiceLines(analysisVoice) {
  if (!analysisVoice?.lines) return '';
  return analysisVoice.lines
    .map((line) => {
      const syllables = (line.syllables ?? [])
        .map((s) => {
          const label = s.blank ? '' : s.ditto ? "''" : (s.note ?? '');
          return `<span class="partitura__syl"><span class="partitura__syl-text">${escapeHtml(s.text)}</span><span class="partitura__syl-note">${escapeHtml(label)}</span></span>`;
        })
        .join('');
      return `<p class="partitura__line">${syllables}</p>`;
    })
    .join('');
}
