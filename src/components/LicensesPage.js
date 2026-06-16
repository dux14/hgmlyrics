/**
 * LicensesPage.js — Atribuciones de los modelos de IA usados en el Estudio.
 *
 * Contenido estático; textos extraídos de docs/licenses/estudio-modelos.md
 * (auditoría junio 2026).
 */
import { navigate } from '../router.js';

/**
 * @param {HTMLElement} container
 */
export function renderLicenses(container) {
  container.innerHTML = `
    <div class="profile-page fade-in">
      <div style="display:flex; align-items:center; gap:var(--space-sm); margin-bottom:var(--space-lg);">
        <button class="auth-btn" id="back-btn" style="max-width:140px;">← Volver</button>
        <h1 style="margin:0;">Licencias y créditos</h1>
      </div>

      <p style="color:var(--color-text-muted); margin-bottom:var(--space-xl);">
        El Estudio usa modelos de inteligencia artificial de terceros para separar y analizar el audio.
        A continuación se listan los modelos, sus autores y sus licencias.
      </p>

      <section style="margin-bottom:var(--space-xl);">
        <h2 style="margin-bottom:var(--space-sm);">S1 — Voz e Instrumental</h2>

        <div class="profile-field">
          <p><strong>BS-RoFormer ep_317</strong></p>
          <p>Framework: <a href="https://github.com/ZFTurbo/Music-Source-Separation-Training" target="_blank" rel="noopener">ZFTurbo / Music-Source-Separation-Training</a></p>
          <p>Licencia: <strong>MIT</strong> — uso comercial permitido.</p>
        </div>

        <div class="profile-field">
          <p><strong>Demucs htdemucs_6s</strong></p>
          <p>Repo: <a href="https://github.com/facebookresearch/demucs" target="_blank" rel="noopener">Meta Research / Demucs</a></p>
          <p>Licencia: <strong>MIT</strong> — uso comercial permitido.</p>
        </div>
      </section>

      <section style="margin-bottom:var(--space-xl);">
        <h2 style="margin-bottom:var(--space-sm);">S2 — Estructura musical</h2>

        <div class="profile-field">
          <p><strong>SongFormer</strong> — ASLP-lab</p>
          <p>Repo: <a href="https://github.com/ASLP-lab/SongFormer" target="_blank" rel="noopener">ASLP-lab/SongFormer</a> &middot; <a href="https://huggingface.co/ASLP-lab/SongFormer" target="_blank" rel="noopener">HuggingFace</a></p>
          <p>Autores: Hao, Yuan, Yao, Deng, Bai, Wang, Xue, Xie (arxiv 2510.02797).</p>
          <p>Licencia: <strong>CC-BY-4.0</strong> — uso comercial permitido con atribución.</p>
        </div>
      </section>

      <section style="margin-bottom:var(--space-xl);">
        <h2 style="margin-bottom:var(--space-sm);">S3 — Lead / Backing vocals</h2>

        <div class="profile-field">
          <p><strong>MedleyVox</strong></p>
          <p>Pesos: <a href="https://huggingface.co/Cyru5/MedleyVox" target="_blank" rel="noopener">Cyru5 / Carson Evans (HuggingFace)</a> — <strong>CC-BY-4.0</strong>.</p>
          <p>Código base: <a href="https://github.com/jeonchangbin49/MedleyVox" target="_blank" rel="noopener">jeonchangbin49/MedleyVox</a>, ICASSP 2023 — licencia del código base sin confirmar.</p>
        </div>
      </section>

      <section style="margin-bottom:var(--space-xl);">
        <h2 style="margin-bottom:var(--space-sm);">S4 — Género vocal</h2>

        <div class="profile-field">
          <p><strong>chorus_bs_roformer ep_267</strong> — Sucial</p>
          <p>HuggingFace: <a href="https://huggingface.co/Sucial/Chorus_Male_Female_BS_Roformer" target="_blank" rel="noopener">Sucial/Chorus_Male_Female_BS_Roformer</a></p>
          <p>Licencia: <strong>CC-BY-NC-SA-4.0</strong> — <em>uso comercial NO permitido</em>. Derivados deben usar la misma licencia.</p>
        </div>

        <div class="profile-field">
          <p><strong>bs_roformer_male_female (aufr33)</strong> — modelo alternativo</p>
          <p>Licencia: <em>sin confirmar</em> — el repositorio HuggingFace no era accesible públicamente en la verificación de junio 2026.</p>
        </div>
      </section>

      <section style="border-top:1px solid var(--color-border, #333); padding-top:var(--space-lg); margin-bottom:var(--space-xl);">
        <h2 style="margin-bottom:var(--space-sm);">Créditos y referencias</h2>

        <div class="profile-field">
          <p><strong>Mariana Medina</strong></p>
          <p>Referencia de diseño y concepto. Su página fue base fundamental de este proyecto:</p>
          <p><a href="https://bymarianamedinaugc.my.canva.site/pagina-coro-hkn" target="_blank" rel="noopener noreferrer">Página Coro HKN (Canva)</a></p>
        </div>

        <div class="profile-field">
          <p><strong>Hakuna Group Music</strong></p>
          <p>Grupo e intérpretes oficiales de las canciones:</p>
          <p><a href="https://hakuna.org/hakuna-group-music/" target="_blank" rel="noopener noreferrer">hakuna.org/hakuna-group-music</a></p>
        </div>

        <p style="color:var(--color-text-muted); margin-top:var(--space-md); font-size:0.9em;">
          Todos los derechos reservados a sus respectivos autores.
        </p>
      </section>

      <section style="border-top:1px solid var(--color-border, #333); padding-top:var(--space-lg); margin-bottom:var(--space-xl);">
        <h2 style="margin-bottom:var(--space-sm);">Nota de monetización</h2>
        <p>
          La app HKN Lyrics no está monetizada, por lo que las licencias NonCommercial (NC)
          son aceptables en el estado actual. Si la app se monetiza en el futuro,
          <strong>S4 quedará BLOQUEADA</strong>: el modelo <code>chorus_bs_roformer</code> (Sucial)
          es CC-BY-NC-SA-4.0 y no permite uso comercial.
        </p>
        <p style="color:var(--color-text-muted); margin-top:var(--space-sm); font-size:0.85em;">
          Auditoría realizada: junio 2026.
        </p>
      </section>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => navigate('/perfil'));
}
