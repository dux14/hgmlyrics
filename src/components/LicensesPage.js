/**
 * LicensesPage.js — Atribuciones de los modelos de IA usados en el Estudio.
 *
 * Contenido estático; textos extraídos de docs/licenses/estudio-modelos.md
 * (auditoría junio 2026).
 */
import { icon } from '../lib/icons.js';
import '../styles/licenses.css';

/**
 * @param {HTMLElement} container
 */
export function renderLicenses(container) {
  try {
    container.innerHTML = `
      <div class="lc-page profile-page fade-in">
        <div class="lc-top">
          <h1 class="lc-title">Licencias y créditos</h1>
          <p class="lc-intro">
            El Estudio y la Partitura vocal usan modelos de inteligencia artificial de terceros
            para separar, transcribir y analizar el audio.
            A continuación se listan los modelos, sus autores y sus licencias.
          </p>
        </div>

        <div class="lc-card">
          <div class="lc-card__head">
            <span class="lc-card__num">S1</span>
            Voz e Instrumental
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>BS-RoFormer ep_317</strong>
              <span class="lc-badge lc-badge--ok">MIT</span>
            </div>
            <p class="lc-model__detail">
              Framework: <a href="https://github.com/ZFTurbo/Music-Source-Separation-Training" target="_blank" rel="noopener">ZFTurbo / Music-Source-Separation-Training</a>.
              Uso comercial permitido.
            </p>
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>Demucs htdemucs_6s</strong>
              <span class="lc-badge lc-badge--ok">MIT</span>
            </div>
            <p class="lc-model__detail">
              Repo: <a href="https://github.com/facebookresearch/demucs" target="_blank" rel="noopener">Meta Research / Demucs</a>.
              Uso comercial permitido.
            </p>
          </div>
        </div>

        <div class="lc-card">
          <div class="lc-card__head">
            <span class="lc-card__num">S2</span>
            Estructura musical
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>SongFormer</strong> — ASLP-lab
              <span class="lc-badge lc-badge--ok">CC-BY-4.0</span>
            </div>
            <p class="lc-model__detail">
              Repo: <a href="https://github.com/ASLP-lab/SongFormer" target="_blank" rel="noopener">ASLP-lab/SongFormer</a>
              &middot; <a href="https://huggingface.co/ASLP-lab/SongFormer" target="_blank" rel="noopener">HuggingFace</a>.
              Autores: Hao, Yuan, Yao, Deng, Bai, Wang, Xue, Xie (arxiv 2510.02797).
              Uso comercial permitido con atribución.
            </p>
          </div>
        </div>

        <div class="lc-card">
          <div class="lc-card__head">
            <span class="lc-card__num">S3</span>
            Lead / Backing vocals
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>MedleyVox</strong>
              <span class="lc-badge lc-badge--ok">CC-BY-4.0</span>
              <span class="lc-badge lc-badge--nc">código base sin confirmar</span>
            </div>
            <p class="lc-model__detail">
              Pesos: <a href="https://huggingface.co/Cyru5/MedleyVox" target="_blank" rel="noopener">Cyru5 / Carson Evans (HuggingFace)</a> — CC-BY-4.0.
              Código base: <a href="https://github.com/jeonchangbin49/MedleyVox" target="_blank" rel="noopener">jeonchangbin49/MedleyVox</a>, ICASSP 2023 — licencia sin confirmar.
            </p>
          </div>
        </div>

        <div class="lc-card">
          <div class="lc-card__head">
            <span class="lc-card__num">S4</span>
            Género vocal
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>chorus_bs_roformer ep_267</strong> — Sucial
              <span class="lc-badge lc-badge--nc">NC</span>
            </div>
            <p class="lc-model__detail">
              <a href="https://huggingface.co/Sucial/Chorus_Male_Female_BS_Roformer" target="_blank" rel="noopener">Sucial/Chorus_Male_Female_BS_Roformer</a>.
              CC-BY-NC-SA-4.0 — uso comercial no permitido. Derivados deben usar la misma licencia.
            </p>
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>bs_roformer_male_female (aufr33)</strong> — modelo alternativo
              <span class="lc-badge lc-badge--nc">sin confirmar</span>
            </div>
            <p class="lc-model__detail">
              El repositorio HuggingFace no era accesible públicamente en la verificación de junio 2026.
            </p>
          </div>
        </div>

        <div class="lc-card">
          <div class="lc-card__head">
            <span class="lc-card__num">P1</span>
            Partitura vocal - Afinación y análisis
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>torchcrepe</strong>
              <span class="lc-badge lc-badge--ok">MIT</span>
            </div>
            <p class="lc-model__detail">
              Detector de tono (F0) por voz. Envuelve el modelo
              <a href="https://github.com/marl/crepe" target="_blank" rel="noopener">CREPE (marl/crepe)</a>, también MIT.
              Repo: <a href="https://github.com/maxrmorrison/torchcrepe" target="_blank" rel="noopener">maxrmorrison/torchcrepe</a>.
              Uso comercial permitido.
            </p>
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>librosa</strong>
              <span class="lc-badge lc-badge--ok">ISC</span>
            </div>
            <p class="lc-model__detail">
              Utilidades de análisis de audio.
              Repo: <a href="https://github.com/librosa/librosa" target="_blank" rel="noopener">librosa/librosa</a>.
              Uso comercial permitido.
            </p>
          </div>
        </div>

        <div class="lc-card">
          <div class="lc-card__head">
            <span class="lc-card__num">P2</span>
            Partitura vocal - Letra y sílabas
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>WhisperX</strong> — Max Bain
              <span class="lc-badge lc-badge--ok">BSD-2-Clause</span>
            </div>
            <p class="lc-model__detail">
              Alineación temporal palabra a palabra de la transcripción.
              Repo: <a href="https://github.com/m-bain/whisperX" target="_blank" rel="noopener">m-bain/whisperX</a>.
              Uso comercial permitido.
            </p>
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>Whisper</strong> — OpenAI
              <span class="lc-badge lc-badge--ok">MIT</span>
            </div>
            <p class="lc-model__detail">
              Modelo base de transcripción que usa WhisperX.
              Repo: <a href="https://github.com/openai/whisper" target="_blank" rel="noopener">openai/whisper</a>.
              Uso comercial permitido.
            </p>
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>pyphen</strong>
              <span class="lc-badge lc-badge--ok">GPL/LGPL/MPL</span>
            </div>
            <p class="lc-model__detail">
              Silabación (división en sílabas) es_ES / en_US. Tri-licencia
              GPL-2.0 / LGPL-2.1 / MPL-1.1.
              Repo: <a href="https://github.com/Kozea/Pyphen" target="_blank" rel="noopener">Kozea/Pyphen</a>.
              Uso comercial permitido.
            </p>
          </div>
        </div>

        <div class="lc-card">
          <div class="lc-card__head">
            <span class="lc-card__num">P3</span>
            Partitura vocal - Render y exportación
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>music21</strong>
              <span class="lc-badge lc-badge--ok">BSD-3-Clause</span>
            </div>
            <p class="lc-model__detail">
              Genera la notación musical y la exporta a MusicXML (partitura editable).
              Repo: <a href="https://github.com/cuthbertLab/music21" target="_blank" rel="noopener">cuthbertLab/music21</a>.
              Uso comercial permitido.
            </p>
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>pretty_midi</strong>
              <span class="lc-badge lc-badge--ok">MIT</span>
            </div>
            <p class="lc-model__detail">
              Construye y serializa el archivo MIDI (una pista por voz).
              Repo: <a href="https://github.com/craffel/pretty-midi" target="_blank" rel="noopener">craffel/pretty-midi</a>.
              Uso comercial permitido.
            </p>
          </div>
          <div class="lc-model">
            <div class="lc-model__row">
              <strong>cairosvg</strong>
              <span class="lc-badge lc-badge--ok">LGPL-3.0</span>
            </div>
            <p class="lc-model__detail">
              Rasteriza la hoja SVG a PNG. Se usa como biblioteca dinámica sin
              modificarla, por lo que la LGPL permite uso comercial.
              Repo: <a href="https://github.com/Kozea/CairoSVG" target="_blank" rel="noopener">Kozea/CairoSVG</a>.
            </p>
          </div>
        </div>

        <div class="lc-card">
          <div class="lc-card__head">
            <span class="lc-card__num">${icon('star', { size: 14 })}</span>
            Créditos y referencias
          </div>
          <div class="lc-model">
            <div class="lc-model__row"><strong>Mariana Medina</strong></div>
            <p class="lc-model__detail">
              Referencia de diseño y concepto. Su página fue base fundamental de este proyecto:
              <a href="https://bymarianamedinaugc.my.canva.site/pagina-coro-hkn" target="_blank" rel="noopener noreferrer">Página Coro HKN (Canva)</a>.
            </p>
          </div>
          <div class="lc-model">
            <div class="lc-model__row"><strong>Hakuna Group Music</strong></div>
            <p class="lc-model__detail">
              Grupo e intérpretes oficiales de las canciones:
              <a href="https://hakuna.org/hakuna-group-music/" target="_blank" rel="noopener noreferrer">hakuna.org/hakuna-group-music</a>.
            </p>
          </div>
          <p class="lc-note">Todos los derechos reservados a sus respectivos autores.</p>
        </div>

        <div class="lc-card lc-card--muted">
          <div class="lc-card__head">
            <span class="lc-card__num lc-card__num--muted">${icon('info', { size: 14 })}</span>
            Nota de monetización
          </div>
          <p class="lc-model__detail">
            La app HKN Lyrics no está monetizada, por lo que las licencias NonCommercial (NC)
            son aceptables en el estado actual. Si la app se monetiza en el futuro,
            <strong>S4 quedará bloqueada</strong>: el modelo <code>chorus_bs_roformer</code> (Sucial)
            es CC-BY-NC-SA-4.0 y no permite uso comercial.
          </p>
          <p class="lc-note">Auditoría realizada: junio 2026.</p>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="lc-error fade-in">
        <div class="lc-error__icon">${icon('alert-triangle', { size: 40 })}</div>
        <p class="lc-error__title">No se pudo cargar la página</p>
        <p class="lc-error__text">Recarga la aplicación para intentarlo de nuevo.</p>
      </div>
    `;
    console.error('[LicensesPage] render error:', err);
  }
}
