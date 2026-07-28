import { describe, it, expect, afterEach } from 'vitest';
import { avatarThumb } from './avatarUrl.js';

const STORAGE =
  'https://omntufksfhezqtqgmhlp.supabase.co/storage/v1/object/public/avatars/u1/avatar.jpg?t=1781377580727';

function setDpr(value) {
  Object.defineProperty(globalThis, 'devicePixelRatio', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('avatarThumb', () => {
  afterEach(() => setDpr(1));

  it('reescribe una URL de Storage al transformador con las medidas pedidas', () => {
    setDpr(1);
    const url = new URL(avatarThumb(STORAGE, 46));
    expect(url.pathname).toBe('/storage/v1/render/image/public/avatars/u1/avatar.jpg');
    expect(url.searchParams.get('width')).toBe('46');
    expect(url.searchParams.get('height')).toBe('46');
    expect(url.searchParams.get('resize')).toBe('cover');
  });

  it('conserva el cache-buster del avatar', () => {
    expect(new URL(avatarThumb(STORAGE, 46)).searchParams.get('t')).toBe('1781377580727');
  });

  it('pide el doble de píxeles en pantallas retina, con tope en 2x', () => {
    setDpr(2);
    expect(new URL(avatarThumb(STORAGE, 46)).searchParams.get('width')).toBe('92');
    setDpr(3);
    expect(new URL(avatarThumb(STORAGE, 46)).searchParams.get('width')).toBe('92');
  });

  it('deja intactas las URLs de otros orígenes', () => {
    const google = 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c';
    expect(avatarThumb(google, 46)).toBe(google);
  });

  it('devuelve cadena vacía cuando no hay avatar', () => {
    expect(avatarThumb('', 46)).toBe('');
    expect(avatarThumb(null, 46)).toBe('');
    expect(avatarThumb(undefined, 46)).toBe('');
  });

  it('no toca URLs de Storage que no sean del bucket público', () => {
    const signed =
      'https://omntufksfhezqtqgmhlp.supabase.co/storage/v1/object/sign/stems-jobs/x.mp3?token=abc';
    expect(avatarThumb(signed, 46)).toBe(signed);
  });
});
