import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enterStage, exitStage, nextChromeVisible } from '../src/components/StageMode.js';

function mountSongView() {
  document.body.innerHTML = `
    <div class="song-view" id="sv">
      <button id="font-decrease">A−</button>
      <button id="font-increase">A+</button>
      <div class="song-view__lyrics">letra</div>
    </div>`;
  return document.getElementById('sv');
}

beforeEach(() => {
  exitStage(); // limpia estado entre tests
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('nextChromeVisible', () => {
  it('alterna el booleano', () => {
    expect(nextChromeVisible(false)).toBe(true);
    expect(nextChromeVisible(true)).toBe(false);
  });
});

describe('enterStage/exitStage', () => {
  it('enter monta overlay + chrome y marca body', () => {
    const sv = mountSongView();
    enterStage(sv);
    expect(sv.classList.contains('song-view--stage')).toBe(true);
    expect(document.body.classList.contains('stage-active')).toBe(true);
    expect(document.querySelector('.stage-chrome')).toBeTruthy();
    expect(document.querySelector('.stage-chrome--visible')).toBeTruthy();
  });

  it('el toque en el Lector alterna la visibilidad del chrome', () => {
    const sv = mountSongView();
    enterStage(sv);
    const chrome = document.querySelector('.stage-chrome');
    expect(chrome.classList.contains('stage-chrome--visible')).toBe(true);
    sv.querySelector('.song-view__lyrics').click();
    expect(chrome.classList.contains('stage-chrome--visible')).toBe(false);
    sv.querySelector('.song-view__lyrics').click();
    expect(chrome.classList.contains('stage-chrome--visible')).toBe(true);
  });

  it('A−/A+ del escenario reenvian click a los botones de fuente del Lector', () => {
    const sv = mountSongView();
    const spy = vi.fn();
    sv.querySelector('#font-decrease').addEventListener('click', spy);
    enterStage(sv);
    document.getElementById('stage-font-down').click();
    expect(spy).toHaveBeenCalled();
  });

  it('exit deshace todo y es idempotente', () => {
    const sv = mountSongView();
    enterStage(sv);
    exitStage();
    expect(document.querySelector('.stage-chrome')).toBeNull();
    expect(sv.classList.contains('song-view--stage')).toBe(false);
    expect(document.body.classList.contains('stage-active')).toBe(false);
    expect(() => exitStage()).not.toThrow(); // segunda vez: no-op
  });

  it('el boton salir cierra el escenario', () => {
    const sv = mountSongView();
    enterStage(sv);
    document.getElementById('stage-exit').click();
    expect(document.querySelector('.stage-chrome')).toBeNull();
  });
});
