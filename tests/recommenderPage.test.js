import { describe, it, expect, beforeEach } from 'vitest';
import { renderRecommenderPage } from '../src/components/RecommenderPage.js';

describe('renderRecommenderPage', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });

  it('renderiza el título Recomendador con badge BETA', () => {
    renderRecommenderPage(container);
    expect(container.textContent).toContain('Recomendador');
    expect(container.querySelector('.badge--beta')).not.toBeNull();
  });

  it('muestra copy de construcción', () => {
    renderRecommenderPage(container);
    expect(container.textContent.toLowerCase()).toContain('construyendo');
  });
});
