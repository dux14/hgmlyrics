import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/pitchApi.js', () => ({
  listJobs: vi.fn(),
}));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));

import { renderPartituraPage } from './PartituraPage.js';
import * as pitchApi from '../lib/pitchApi.js';

describe('PartituraPage — estado idle', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    pitchApi.listJobs.mockReset();
    pitchApi.listJobs.mockResolvedValue({ jobs: [], quota: { used: 0, limit: 2 } });
  });

  it('llama listJobs y pinta el input de archivo + 2 perfiles', async () => {
    await renderPartituraPage(container);
    expect(pitchApi.listJobs).toHaveBeenCalled();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-profile]').length).toBe(2);
  });

  it('archivo .txt en change muestra error de formato no soportado', async () => {
    await renderPartituraPage(container);
    const input = container.querySelector('input[type="file"]');
    const file = new File(['hola'], 'notas.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(container.textContent).toMatch(/no soportado|formato/i);
  });
});
