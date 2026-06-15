/**
 * AdminWorldPanel.js — Panel admin para gestionar mapas del mundo virtual.
 *
 * Secciones:
 *   1. Subir nuevo mapa (map.json + tileset image → validación + zones inline-edit + guardar)
 *   2. Versiones existentes (listMaps → activar con un clic)
 *
 * Solo se monta cuando el admin está autenticado (la verificación se hace en
 * renderAdminDashboard antes de incluir este panel).
 */
import { supabase } from '../lib/supabase.js';
import { icon } from '../lib/icons.js';
import { validateTiledMap } from '../../api/_lib/validateTiledMap.js';
import { listMaps, saveMap, activate } from '../world/worldMapStore.js';
import { joinWorldAdmin } from '../lib/worldAdminChannel.js';
import { diffZoneChannels } from '../world/zoneChannelsDiff.js';
import { escapeHtml as esc } from '../lib/escape.js';

// ---------------------------------------------------------------------------
// Formatear fecha ISO a local legible
// ---------------------------------------------------------------------------
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Construir el aviso de impacto en channelIds (E4.3)
// Devuelve '' si no hay impacto; de lo contrario devuelve el HTML del aviso.
// ---------------------------------------------------------------------------
function buildChannelWarning(currentZones, nextZones) {
  const { changed, removed } = diffZoneChannels(currentZones, nextZones);
  if (!changed.length && !removed.length) return '';

  const lines = [];
  if (changed.length) {
    const names = changed.map((z) => `"${esc(z.name)}"`).join(', ');
    lines.push(
      `Las zonas ${names} cambian de channelId: los usuarios conectados perderán su sesión de chat/voz.`,
    );
  }
  if (removed.length) {
    const names = removed.map((z) => `"${esc(z.name)}"`).join(', ');
    lines.push(
      `Las zonas ${names} desaparecen del nuevo mapa: los usuarios en esas zonas perderán su conexión.`,
    );
  }

  return `
    <div style="margin-top:var(--space-sm);padding:var(--space-sm);background:var(--color-warning-bg,#fff8e1);border:1px solid var(--color-warning,#f59e0b);border-radius:var(--border-radius-sm);font-size:var(--font-size-sm);color:var(--color-warning-text,#92400e);">
      <strong>Aviso:</strong> ${lines.join(' ')}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Renderizar la lista de versiones
// ---------------------------------------------------------------------------
async function renderVersions(listEl, statusEl, adminChannel) {
  listEl.innerHTML =
    '<p style="color:var(--color-text-secondary);font-size:var(--font-size-sm);">Cargando versiones…</p>';
  try {
    const maps = await listMaps({});
    if (!maps.length) {
      listEl.innerHTML =
        '<p style="color:var(--color-text-secondary);font-size:var(--font-size-sm);">No hay mapas guardados.</p>';
      return;
    }

    // Zonas del mapa actualmente activo (para la comparación E4.3)
    const activeMap = maps.find((m) => m.isActive);
    const activeZones = activeMap?.zones ?? [];

    listEl.innerHTML = maps
      .map((m) => {
        // Aviso de impacto en channelIds para mapas inactivos
        const warning = !m.isActive ? buildChannelWarning(activeZones, m.zones ?? []) : '';
        return `
      <div class="ff-item wm-version-item" data-id="${esc(m.id)}">
        <div class="ff-item__head">
          <strong>${esc(m.name)}</strong>
          <span>${fmtDate(m.updatedAt)}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-sm);">
          <span class="wm-badge ${m.isActive ? 'wm-badge--active' : 'wm-badge--inactive'}">
            ${m.isActive ? `${icon('check', { size: 14 })} Activo` : 'Inactivo'}
          </span>
          ${
            !m.isActive
              ? `<button class="btn btn--primary btn--sm wm-activate-btn">Activar</button>`
              : ''
          }
        </div>
        ${warning}
      </div>
    `;
      })
      .join('');

    // Eventos de activar
    listEl.querySelectorAll('.wm-activate-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = btn.closest('.wm-version-item');
        const mapId = item?.dataset.id;
        if (!mapId) return;
        // Obtener el nombre del mapa activado (para el payload del broadcast)
        const targetMap = maps.find((m) => m.id === mapId);
        btn.disabled = true;
        btn.textContent = 'Activando…';
        try {
          const result = await activate({ id: mapId });
          // Notificar a todos los clientes conectados que el mapa cambió (E4.1).
          // Fire-and-forget; no bloqueamos el UX de éxito. Un fallo silencioso
          // se volvería invisible, así que lo registramos como advertencia.
          adminChannel
            ?.broadcastMapUpdated({
              mapId: result.map?.id ?? mapId,
              mapName: result.map?.name ?? targetMap?.name ?? '',
            })
            ?.catch((err) => {
              console.warn('[mundo] No se pudo difundir map-updated a los clientes:', err);
            });
          if (statusEl) {
            statusEl.textContent = 'Mapa activado correctamente.';
            statusEl.style.color = 'var(--color-success, green)';
          }
          await renderVersions(listEl, statusEl, adminChannel);
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = `Error al activar: ${err.message}`;
            statusEl.style.color = 'var(--color-error)';
          }
          btn.disabled = false;
          btn.textContent = 'Activar';
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--color-error);font-size:var(--font-size-sm);">Error al cargar versiones: ${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Renderizar la lista de zonas detectadas con edición inline
// ---------------------------------------------------------------------------
function renderZones(zonesContainer, zones, tiledJsonRef) {
  if (!zones.length) {
    zonesContainer.innerHTML =
      '<p style="color:var(--color-text-secondary);font-size:var(--font-size-sm);">No se detectaron zonas en el mapa.</p>';
    return;
  }

  zonesContainer.innerHTML = `
    <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:var(--space-sm);">
      Zonas detectadas (${zones.length}). Puedes editar el nombre y channelId antes de guardar.
    </p>
    <div class="ff-list wm-zones-list">
      ${zones
        .map(
          (z, idx) => `
        <div class="ff-item wm-zone-item" data-idx="${idx}">
          <div class="ff-item__add" style="flex-direction:column;gap:var(--space-xs);">
            <label style="font-size:var(--font-size-sm);font-weight:var(--font-weight-semibold);">Nombre</label>
            <input class="ff-input wm-zone-name" value="${esc(z.name)}" placeholder="Nombre de la zona" />
            <label style="font-size:var(--font-size-sm);font-weight:var(--font-weight-semibold);">channelId</label>
            <input class="ff-input wm-zone-channel" value="${esc(z.channelId)}" placeholder="channelId único" />
          </div>
        </div>
      `,
        )
        .join('')}
    </div>
  `;

  // Propagar ediciones de vuelta al tiledJson (escribe sobre el objectgroup zones)
  function syncZones() {
    // Localizar el layer "zones" en el tiledJson y actualizar cada objeto.
    const json = tiledJsonRef.value;
    if (!json) return;
    const zonesLayer = (json.layers ?? []).find(
      (l) => l && l.type === 'objectgroup' && l.name?.toLowerCase() === 'zones',
    );
    if (!zonesLayer || !Array.isArray(zonesLayer.objects)) return;

    zonesContainer.querySelectorAll('.wm-zone-item').forEach((item) => {
      const idx = parseInt(item.dataset.idx, 10);
      const obj = zonesLayer.objects[idx];
      if (!obj) return;
      if (!Array.isArray(obj.properties)) obj.properties = [];
      const nameInput = item.querySelector('.wm-zone-name');
      const channelInput = item.querySelector('.wm-zone-channel');
      const newName = nameInput?.value ?? '';
      const newChannel = channelInput?.value ?? '';

      // Upsert en el array de properties
      ['name', 'channelId'].forEach((key) => {
        const val = key === 'name' ? newName : newChannel;
        const existing = obj.properties.find((p) => p.name === key);
        if (existing) {
          existing.value = val;
        } else {
          obj.properties.push({ name: key, type: 'string', value: val });
        }
      });
    });
  }

  zonesContainer.querySelectorAll('.ff-input').forEach((input) => {
    input.addEventListener('input', syncZones);
  });
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * Monta el panel de mapas del mundo virtual en `container`.
 * El container puede ser cualquier HTMLElement ya en el DOM.
 *
 * @param {HTMLElement} container
 */
export function mountAdminWorldPanel(container) {
  container.innerHTML = `
    <section class="ff-section" id="wm-section">
      <h2 class="ff-section__title">${icon('upload', { size: 18 })} Mundo Virtual — Mapas</h2>

      <!-- Subir nuevo mapa -->
      <div class="ff-item" id="wm-upload-card">
        <h3 style="font-size:var(--font-size-base);font-weight:var(--font-weight-semibold);margin-bottom:var(--space-md);">
          Subir nuevo mapa
        </h3>

        <div style="display:flex;flex-direction:column;gap:var(--space-md);">
          <div>
            <label class="wm-label" for="wm-name">Nombre del mapa</label>
            <input id="wm-name" class="ff-input" type="text" maxlength="80" placeholder="ej. Sala Principal v2" />
          </div>

          <div>
            <label class="wm-label" for="wm-map-file">Archivo map.json (Tiled)</label>
            <input id="wm-map-file" class="ff-input" type="file" accept=".json,application/json" style="height:auto;padding:var(--space-sm);" />
          </div>

          <div>
            <label class="wm-label" for="wm-tileset-file">Imagen del tileset (PNG/JPEG)</label>
            <input id="wm-tileset-file" class="ff-input" type="file" accept="image/png,image/jpeg,image/webp" style="height:auto;padding:var(--space-sm);" />
          </div>
        </div>

        <!-- Errores de validacion del JSON -->
        <div id="wm-validation-errors" style="display:none;margin-top:var(--space-md);padding:var(--space-sm);background:var(--color-error-bg,#fff0f0);border:1px solid var(--color-error);border-radius:var(--border-radius-sm);font-size:var(--font-size-sm);color:var(--color-error);"></div>

        <!-- Zonas detectadas -->
        <div id="wm-zones-container" style="margin-top:var(--space-md);display:none;"></div>

        <div style="margin-top:var(--space-lg);display:flex;gap:var(--space-sm);">
          <button id="wm-save-btn" class="btn btn--primary" disabled>
            ${icon('upload', { size: 16 })} Guardar mapa
          </button>
          <span id="wm-save-status" style="font-size:var(--font-size-sm);align-self:center;"></span>
        </div>
      </div>

      <!-- Estado general (activar, etc.) -->
      <div id="wm-status" style="font-size:var(--font-size-sm);min-height:1.2em;margin-top:var(--space-sm);"></div>

      <!-- Lista de versiones -->
      <div id="wm-versions-list" class="ff-list" style="margin-top:var(--space-lg);"></div>
    </section>
  `;

  // Referencias DOM
  const nameInput = container.querySelector('#wm-name');
  const mapFileInput = container.querySelector('#wm-map-file');
  const tilesetFileInput = container.querySelector('#wm-tileset-file');
  const validationErrors = container.querySelector('#wm-validation-errors');
  const zonesContainer = container.querySelector('#wm-zones-container');
  const saveBtn = container.querySelector('#wm-save-btn');
  const saveStatus = container.querySelector('#wm-save-status');
  const statusEl = container.querySelector('#wm-status');
  const versionsList = container.querySelector('#wm-versions-list');

  // Canal world:admin — usado para notificar a los clientes cuando el admin
  // activa un mapa (E4.1). Se desmonta junto con el panel (no hay teardown
  // explícito del panel en esta versión, pero la conexión vive lo que dura la
  // sesión admin, que es aceptable).
  const adminChannel = joinWorldAdmin({ supabase });

  // Estado local: guardamos el tiledJson parseado y las zonas detectadas.
  // tiledJsonRef.value es el objeto que se modifica cuando el admin edita zonas.
  const tiledJsonRef = { value: null };
  let tilesetBlob = null;
  let mapValid = false;

  function updateSaveEnabled() {
    const nameOk = nameInput.value.trim().length > 0;
    saveBtn.disabled = !(nameOk && mapValid && tilesetBlob);
  }

  // Leer y validar el archivo map.json al seleccionarlo
  mapFileInput.addEventListener('change', () => {
    const file = mapFileInput.files?.[0];
    validationErrors.style.display = 'none';
    zonesContainer.style.display = 'none';
    zonesContainer.innerHTML = '';
    tiledJsonRef.value = null;
    mapValid = false;
    updateSaveEnabled();

    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch {
        validationErrors.textContent = 'El archivo no es un JSON válido.';
        validationErrors.style.display = 'block';
        updateSaveEnabled();
        return;
      }

      const { ok, errors, zones } = validateTiledMap(parsed);

      if (!ok) {
        validationErrors.innerHTML = errors.map((err) => `<div>• ${esc(err)}</div>`).join('');
        validationErrors.style.display = 'block';
        updateSaveEnabled();
        return;
      }

      // JSON válido: guardar referencia y mostrar zonas
      tiledJsonRef.value = parsed;
      mapValid = true;
      zonesContainer.style.display = 'block';
      renderZones(zonesContainer, zones, tiledJsonRef);
      updateSaveEnabled();
    };
    reader.readAsText(file);
  });

  // Guardar referencia al blob del tileset
  tilesetFileInput.addEventListener('change', () => {
    tilesetBlob = tilesetFileInput.files?.[0] ?? null;
    updateSaveEnabled();
  });

  nameInput.addEventListener('input', updateSaveEnabled);

  // Guardar mapa
  saveBtn.addEventListener('click', async () => {
    if (!tiledJsonRef.value || !tilesetBlob) return;
    saveBtn.disabled = true;
    saveStatus.style.color = 'var(--color-text-secondary)';
    saveStatus.textContent = 'Guardando…';

    try {
      const result = await saveMap({
        supabase,
        name: nameInput.value.trim(),
        tiledJson: tiledJsonRef.value,
        tilesetBlob,
      });

      saveStatus.textContent = `Mapa "${esc(result.map?.name ?? '')}" creado. Zonas: ${result.zones?.length ?? 0}.`;
      saveStatus.style.color = 'var(--color-success, green)';

      // Resetear el formulario
      nameInput.value = '';
      mapFileInput.value = '';
      tilesetFileInput.value = '';
      tilesetBlob = null;
      tiledJsonRef.value = null;
      mapValid = false;
      zonesContainer.style.display = 'none';
      zonesContainer.innerHTML = '';
      validationErrors.style.display = 'none';
      updateSaveEnabled();

      // Refrescar lista de versiones
      await renderVersions(versionsList, statusEl, adminChannel);
    } catch (err) {
      const msgs = err.errors ? err.errors.map((m) => `• ${m}`).join('\n') : err.message;
      saveStatus.textContent = `Error: ${msgs}`;
      saveStatus.style.color = 'var(--color-error)';
      saveBtn.disabled = false;
      updateSaveEnabled();
    }
  });

  // Cargar lista de versiones al montar
  renderVersions(versionsList, statusEl, adminChannel);
}
