// src/lib/voiceover.js
// Lógica pura de detección escritura / reflexión. Sin efectos secundarios.

/**
 * Normaliza texto para comparación: minúsculas, sin acentos, sin comillas ni
 * signos de puntuación, espacios colapsados.
 * @param {string} s
 * @returns {string}
 */
function normalizeForMatch(s) {
  return s
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/g, '') // quitar diacríticos
    .toLowerCase()
    .replaceAll(/[«»".,;…¡!¿?:—–()[\]]/g, '') // quitar puntuación
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/**
 * Divide el bloque voz-en-off en (escritura, reflexión).
 *
 * Prioridad:
 * 1. Si hay una línea `---` (con espacios opcionales) → cortar ahí.
 * 2. Si gospel_body está disponible → encontrar hasta qué línea el voiceover_body
 *    tiene alta similitud con el evangelio (comparación normalizada línea a línea).
 *    La primera línea del voz que NO pertenece al evangelio marca el inicio de
 *    la reflexión.
 * 3. Sin match → todo es scripture, reflexión vacía.
 *
 * @param {string} voiceoverBody
 * @param {string|null} gospelBody
 * @returns {{ scripture: string, reflection: string }}
 */
export function splitVoiceover(voiceoverBody, gospelBody) {
  if (!voiceoverBody) return { scripture: '', reflection: '' };

  // 1. Override manual ---
  const lines = voiceoverBody.split('\n');
  const sepIdx = lines.findIndex((l) => /^\s*---\s*$/.test(l));
  if (sepIdx !== -1) {
    return {
      scripture: lines.slice(0, sepIdx).join('\n').trim(),
      reflection: lines
        .slice(sepIdx + 1)
        .join('\n')
        .trim(),
    };
  }

  // 2. Match contra evangelio
  if (gospelBody) {
    const gospelNorm = normalizeForMatch(gospelBody);
    // Encontrar la primera línea del voiceover que no se puede asociar al evangelio.
    // Estrategia: acumular líneas del voiceover y verificar si la versión normalizada
    // acumulada todavía es sub-string del evangelio normalizado.
    let scriptureEnd = 0;
    let accumulated = '';
    for (let i = 0; i < lines.length; i++) {
      const lineNorm = normalizeForMatch(lines[i]);
      if (!lineNorm) {
        // Línea vacía: no determina el corte
        accumulated += ' ';
        continue;
      }
      const candidate = (accumulated + ' ' + lineNorm).trim();
      if (gospelNorm.includes(candidate)) {
        accumulated = candidate;
        scriptureEnd = i + 1;
      } else {
        // Esta línea ya no pertenece al evangelio
        break;
      }
    }
    if (scriptureEnd > 0 && scriptureEnd < lines.length) {
      return {
        scripture: lines.slice(0, scriptureEnd).join('\n').trim(),
        reflection: lines.slice(scriptureEnd).join('\n').trim(),
      };
    }
  }

  // 3. Degradación: sin corte
  return { scripture: voiceoverBody.trim(), reflection: '' };
}
