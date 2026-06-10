import { describe, it, expect, vi, afterEach } from 'vitest';
import { composeLayers } from '../../src/world/avatarCompositor.js';

// jsdom no implementa canvas 2d real; mockeamos getContext para espiar drawImage.
function makeCtxMock() {
  return { drawImage: vi.fn() };
}

let ctxMock;

afterEach(() => {
  vi.restoreAllMocks();
  ctxMock = undefined;
});

function stubCanvas() {
  ctxMock = makeCtxMock();
  // Stubeamos el prototipo para que cualquier canvas creado devuelva nuestro ctx falso.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxMock);
}

describe('composeLayers', () => {
  it('dibuja las imágenes en el orden exacto recibido', () => {
    stubCanvas();
    const imgs = [
      { width: 64, height: 64 }, // cuerpo
      { width: 64, height: 64 }, // piel
      { width: 64, height: 64 }, // peinado
    ];
    composeLayers(imgs, { width: 64, height: 64 });

    expect(ctxMock.drawImage).toHaveBeenCalledTimes(3);
    // El primer call debe haber recibido imgs[0], el segundo imgs[1], etc.
    expect(ctxMock.drawImage.mock.calls[0][0]).toBe(imgs[0]);
    expect(ctxMock.drawImage.mock.calls[1][0]).toBe(imgs[1]);
    expect(ctxMock.drawImage.mock.calls[2][0]).toBe(imgs[2]);
  });

  it('omite entradas falsy (no llama drawImage para null/undefined)', () => {
    stubCanvas();
    const img = { width: 32, height: 32 };
    composeLayers([null, img, undefined, img], { width: 32, height: 32 });

    expect(ctxMock.drawImage).toHaveBeenCalledTimes(2);
    ctxMock.drawImage.mock.calls.forEach(([firstArg]) => {
      expect(firstArg).toBe(img);
    });
  });

  it('el canvas devuelto toma dims de la primera imagen no-falsy cuando no se pasan dims', () => {
    stubCanvas();
    const img = { width: 48, height: 96 };
    const canvas = composeLayers([null, img]);

    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(96);
  });

  it('dims explícitas overridean las de la imagen', () => {
    stubCanvas();
    const img = { width: 48, height: 96 };
    const canvas = composeLayers([img], { width: 128, height: 256 });

    expect(canvas.width).toBe(128);
    expect(canvas.height).toBe(256);
  });

  it('array vacío o todo-falsy devuelve un canvas con dims 0x0 y ningún drawImage', () => {
    stubCanvas();
    const canvas = composeLayers([null, undefined]);

    expect(ctxMock.drawImage).not.toHaveBeenCalled();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
});
