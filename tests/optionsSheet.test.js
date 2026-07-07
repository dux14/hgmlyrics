import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildVoiceOptionRows, openOptionsSheet } from '../src/components/OptionsSheet.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('buildVoiceOptionRows', () => {
  it('devuelve una fila por voz del roster (no por categoría), en orden SATB', () => {
    const song = {
      voiceRoster: [
        { id: 't1', category: 'tenor', name: 'Juan' },
        { id: 's1', category: 'soprano', name: 'Ana' },
        { id: 't2', category: 'tenor', name: 'Luis' },
      ],
    };
    const rows = buildVoiceOptionRows(song);
    expect(rows.map((r) => r.id)).toEqual(['s1', 't1', 't2']);
  });

  it('cada fila trae colorVar y referenceKey (null si no hay)', () => {
    const song = { voiceRoster: [{ id: 'b1', category: 'bass', name: 'Pedro', referenceKey: 'E2' }] };
    const [row] = buildVoiceOptionRows(song);
    expect(row).toEqual({
      id: 'b1',
      category: 'bass',
      colorVar: '--color-voice-bass',
      name: 'Pedro',
      referenceKey: 'E2',
    });
  });

  it('tolera roster vacío o ausente', () => {
    expect(buildVoiceOptionRows({})).toEqual([]);
    expect(buildVoiceOptionRows(null)).toEqual([]);
  });
});

function baseSong() {
  return {
    key: 'G major',
    voiceRoster: [
      { id: 's1', category: 'soprano', name: 'Ana', referenceKey: 'B3' },
      { id: 't1', category: 'tenor', name: 'Juan', referenceKey: null },
    ],
  };
}

describe('openOptionsSheet — montaje', () => {
  it('monta .osheet con una fila por voz y switches reflejando visibleVoices', () => {
    openOptionsSheet({
      song: baseSong(),
      visibleVoices: new Set(['s1']),
      showTono: true,
      tonoLabel: 'Sol · Original',
      useFlats: false,
      notation: 'latin',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
    });
    const rows = document.querySelectorAll('.osheet__voice-row');
    expect(rows).toHaveLength(2);
    const switches = document.querySelectorAll('.osheet__switch');
    expect(switches[0].classList.contains('is-on')).toBe(true);
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    expect(switches[1].classList.contains('is-on')).toBe(false);
    expect(switches[1].getAttribute('aria-checked')).toBe('false');
  });

  it('sin roster: no pinta la sección de voces visibles', () => {
    openOptionsSheet({ song: { voiceRoster: [] }, visibleVoices: new Set(), showTono: false });
    expect(document.querySelector('.osheet__voices')).toBeNull();
  });

  it('showTono=false oculta la sección Tono', () => {
    openOptionsSheet({ song: baseSong(), visibleVoices: new Set(), showTono: false });
    expect(document.querySelector('#osheet-tono')).toBeNull();
  });

  it('notación refleja el segmento activo', () => {
    openOptionsSheet({ song: baseSong(), visibleVoices: new Set(), showTono: false, notation: 'anglo' });
    const anglo = document.querySelector('[data-notation="anglo"]');
    const latin = document.querySelector('[data-notation="latin"]');
    expect(anglo.classList.contains('is-active')).toBe(true);
    expect(anglo.getAttribute('aria-pressed')).toBe('true');
    expect(latin.classList.contains('is-active')).toBe(false);
  });
});

describe('openOptionsSheet — interacción', () => {
  it('toggle de voz muta el switch y dispara onToggleVoice con el id', () => {
    const onToggleVoice = vi.fn();
    openOptionsSheet({ song: baseSong(), visibleVoices: new Set(['s1', 't1']), showTono: false, onToggleVoice });
    const [switchS1] = document.querySelectorAll('.osheet__switch');
    switchS1.click();
    expect(onToggleVoice).toHaveBeenCalledWith('s1');
    expect(switchS1.classList.contains('is-on')).toBe(false);
    expect(switchS1.getAttribute('aria-checked')).toBe('false');
  });

  it('cambiar notación activa el botón clicado y dispara onNotationChange', () => {
    const onNotationChange = vi.fn();
    openOptionsSheet({ song: baseSong(), visibleVoices: new Set(), showTono: false, notation: 'latin', onNotationChange });
    document.querySelector('[data-notation="anglo"]').click();
    expect(onNotationChange).toHaveBeenCalledWith('anglo');
    expect(document.querySelector('[data-notation="anglo"]').classList.contains('is-active')).toBe(true);
    expect(document.querySelector('[data-notation="latin"]').classList.contains('is-active')).toBe(false);
  });

  it('stepper de tono dispara onTranspose(1)/onTranspose(-1), bubble dispara onResetTranspose', () => {
    const onTranspose = vi.fn();
    const onResetTranspose = vi.fn();
    openOptionsSheet({
      song: baseSong(),
      visibleVoices: new Set(),
      showTono: true,
      tonoLabel: '+2',
      onTranspose,
      onResetTranspose,
    });
    document.querySelector('[data-act="tup"]').click();
    document.querySelector('[data-act="tdown"]').click();
    document.querySelector('[data-act="treset"]').click();
    expect(onTranspose).toHaveBeenNthCalledWith(1, 1);
    expect(onTranspose).toHaveBeenNthCalledWith(2, -1);
    expect(onResetTranspose).toHaveBeenCalledTimes(1);
  });

  it('A−/A+ disparan onFont con la dirección correcta', () => {
    const onFont = vi.fn();
    openOptionsSheet({ song: baseSong(), visibleVoices: new Set(), showTono: false, onFont });
    document.querySelector('[data-act="fup"]').click();
    document.querySelector('[data-act="fdown"]').click();
    expect(onFont).toHaveBeenNthCalledWith(1, 1);
    expect(onFont).toHaveBeenNthCalledWith(2, -1);
  });

  it('velocidad autoscroll dispara onAutoscroll y actualiza el valor mostrado', () => {
    const onAutoscroll = vi.fn().mockReturnValue('75%');
    openOptionsSheet({
      song: baseSong(),
      visibleVoices: new Set(),
      showTono: false,
      autoscrollLabel: '50%',
      onAutoscroll,
    });
    document.querySelector('[data-act="asup"]').click();
    expect(onAutoscroll).toHaveBeenCalledWith(1);
    expect(document.querySelector('#osheet-autoscroll').textContent).toBe('75%');
  });

  it('click en el overlay cierra el sheet y llama onClose', () => {
    const onClose = vi.fn();
    openOptionsSheet({ song: baseSong(), visibleVoices: new Set(), showTono: false, onClose });
    document.querySelector('.osheet-dim').click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.osheet')).toBeNull();
  });

  it('Escape cierra el sheet', () => {
    const onClose = vi.fn();
    openOptionsSheet({ song: baseSong(), visibleVoices: new Set(), showTono: false, onClose });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.osheet')).toBeNull();
  });
});
