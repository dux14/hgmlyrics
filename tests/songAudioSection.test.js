import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/pipelineApi.js', () => ({
  getPipelineRun: vi.fn(),
}));
vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));

const pipelineApi = await import('../src/lib/pipelineApi.js');
const { navigate } = await import('../src/router.js');
const { createSongAudioSection } = await import('../src/components/editor/SongAudioSection.js');

describe('SongAudioSection', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('sin songId: hint de guardar primero, sin llamar a getPipelineRun', () => {
    const section = createSongAudioSection({ songId: null });
    container.appendChild(section.el);

    expect(section.el.textContent).toContain('Guarda la canción para procesar el audio');
    expect(pipelineApi.getPipelineRun).not.toHaveBeenCalled();

    section.destroy();
  });

  it('sin run activo: estado "Sin procesamiento"', async () => {
    pipelineApi.getPipelineRun.mockResolvedValue(null);
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__status')?.textContent).toContain(
        'Sin procesamiento',
      ),
    );

    section.destroy();
  });

  it.each([
    ['created', 'Procesando audio'],
    ['uploading', 'Procesando audio'],
    ['processing', 'Procesando audio'],
    ['awaiting_lyrics', 'Esperando revisión de letra'],
    ['running', 'Generando sincronía y tono'],
    ['done', 'Procesamiento completo'],
    ['failed', 'Con errores'],
  ])('run con status %s muestra "%s"', async (status, label) => {
    pipelineApi.getPipelineRun.mockResolvedValue({
      run: { status, inputMeta: { filename: 'full.mp3' } },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__status')?.textContent).toContain(label),
    );

    section.destroy();
  });

  it('muestra el nombre del audio: displayName tiene prioridad sobre filename', async () => {
    pipelineApi.getPipelineRun.mockResolvedValue({
      run: {
        status: 'done',
        inputMeta: { filename: 'full.mp3', displayName: 'Mi canción.mp3' },
      },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__file')?.textContent).toBe('Mi canción.mp3'),
    );

    section.destroy();
  });

  it('sin run, no muestra el bloque de nombre de archivo', async () => {
    pipelineApi.getPipelineRun.mockResolvedValue(null);
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__status')).not.toBeNull(),
    );
    expect(section.el.querySelector('.song-audio__file')).toBeNull();

    section.destroy();
  });

  it('botón "Abrir procesamiento" navega a /song/:id/procesamiento', async () => {
    pipelineApi.getPipelineRun.mockResolvedValue(null);
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('[data-action="song-audio-open"]')).not.toBeNull(),
    );
    section.el.querySelector('[data-action="song-audio-open"]').click();

    expect(navigate).toHaveBeenCalledWith('/song/song-1/procesamiento');

    section.destroy();
  });

  it('errores de getPipelineRun no rompen el render: cae a "Sin procesamiento"', async () => {
    pipelineApi.getPipelineRun.mockRejectedValue(new Error('red caída'));
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__status')?.textContent).toContain(
        'Sin procesamiento',
      ),
    );

    section.destroy();
  });

  it('destroy() es seguro de llamar sin haber montado (sin songId)', () => {
    const section = createSongAudioSection({ songId: null });
    expect(() => section.destroy()).not.toThrow();
  });
});
