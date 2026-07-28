import { noteToMidi, midiToName } from '../../lib/notes.js';

/**
 * Onda de rango vocal (canvas 2D animado). Barre grave->agudo->grave cada 6s;
 * gradiente de voz morado->cian->rosa a lo largo del eje x; etiqueta de nota en vivo.
 * Auto-cancela el RAF cuando el canvas sale del DOM (router sin teardown).
 * @param {{low:string, high:string, height?:number}} opts
 * @returns {{el: HTMLCanvasElement} | null}
 */
export function createWaveRange({ low, high, height = 110 }) {
  let lowMidi, highMidi;
  try {
    lowMidi = noteToMidi(low);
    highMidi = noteToMidi(high);
  } catch {
    return null;
  }
  if (!Number.isFinite(lowMidi) || !Number.isFinite(highMidi)) return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'pf-wave';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.width = '100%';
  canvas.style.height = `${height}px`;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  if (!ctx) return { el: canvas };

  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = (rect.width || 300) * dpr;
    canvas.height = (rect.height || height) * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const paint = (t, start) => {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 300;
    const h = rect.height || height;
    ctx.clearRect(0, 0, w, h);
    const cycle = reduced ? 0.5 : ((t - start) % 6000) / 6000;
    const tri = cycle < 0.5 ? cycle * 2 : 2 - cycle * 2;
    const freq = 2 + tri * 8;
    const amp = h * 0.32;
    const phase = reduced ? 0 : (t - start) * 0.001 * 60 * 0.06;

    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgb(124,92,255)');
    g.addColorStop(0.5, 'rgb(53,184,201)');
    g.addColorStop(1, 'rgb(255,92,138)');
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = g;
    ctx.shadowBlur = 16;
    ctx.shadowColor = 'rgba(53,184,201,.9)';
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      const nx = x / w;
      const env = Math.sin(nx * Math.PI);
      const y = h / 2 + Math.sin(nx * freq * Math.PI * 2 + phase) * amp * env;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,92,138,.5)';
    ctx.shadowColor = 'rgba(255,92,138,.6)';
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      const nx = x / w;
      const env = Math.sin(nx * Math.PI);
      const y = h / 2 + Math.sin(nx * freq * Math.PI * 2 + phase * 0.8 + 1) * amp * 0.6 * env;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    const cur = Math.round(lowMidi + (highMidi - lowMidi) * tri);
    ctx.fillStyle = 'rgb(255,92,138)';
    ctx.font = '700 17px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(midiToName(cur), w - 10, 24);
  };

  // Montaje diferido: esperar a que el canvas este en el DOM para medir.
  requestAnimationFrame(() => {
    resize();
    if (reduced) {
      paint(0, 0); // un frame estatico
      return;
    }
    const start = performance.now();
    window.addEventListener('resize', resize);
    const loop = (t) => {
      if (!document.contains(canvas)) {
        window.removeEventListener('resize', resize);
        return; // auto-cleanup
      }
      paint(t, start);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  return { el: canvas };
}
