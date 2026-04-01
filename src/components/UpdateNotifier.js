/**
 * UpdateNotifier.js — Update detection & notification
 *
 * Handles:
 * 1. App updates (SW lifecycle) → persistent banner + auto-force at 24h
 * 2. Data updates (new songs from admin) → silent data refresh
 *
 * Debug: Call `window.__showUpdateBanner()` in console to test the banner.
 */

const DATA_POLL_INTERVAL = 60_000; // Check every 60s
const FORCE_UPDATE_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastDataVersion = null;
let updateAvailableSince = null;
let swRegistration = null;

export function initUpdateNotifier() {
  // 1. Listen for SW updates (app code changes)
  listenForSWUpdate();

  // 2. Poll for data changes (new songs)
  pollDataVersion();

  // 3. Debug helper — accessible from browser console
  globalThis.__showUpdateBanner = () => {
    showUpdateBanner();
    console.log('✅ Update banner shown (debug mode)');
  };
}

function listenForSWUpdate() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready.then(reg => {
    swRegistration = reg;
    if (reg.waiting) {
      showUpdateBanner();
      return;
    }
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }
      });
    });
  }).catch(() => {
    // SW not available
  });
}

async function pollDataVersion() {
  try {
    const res = await fetch('/api/version');
    if (res.ok) {
      const { dataVersion } = await res.json();
      if (lastDataVersion && dataVersion !== lastDataVersion) {
        const { refreshData } = await import('../lib/store.js');
        await refreshData();
      }
      lastDataVersion = dataVersion;
    }
  } catch (_) {
    /* offline — skip */
  }

  setTimeout(pollDataVersion, DATA_POLL_INTERVAL);
}

function showUpdateBanner() {
  // Don't show duplicate banners
  if (document.getElementById('update-banner')) return;

  updateAvailableSince = Date.now();
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.id = 'update-banner';
  banner.innerHTML = `
    <span>Nueva versión disponible</span>
    <button class="update-banner__btn" id="update-now-btn">Actualizar</button>
  `;
  document.body.appendChild(banner);

  // Auto-show with animation
  requestAnimationFrame(() => banner.classList.add('visible'));

  banner.querySelector('#update-now-btn').addEventListener('click', applyUpdate);

  // Auto-force after 24h
  scheduleForceUpdate();
}

function applyUpdate() {
  if (swRegistration?.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  globalThis.location.reload();
}

function scheduleForceUpdate() {
  if (!updateAvailableSince) return;
  const elapsed = Date.now() - updateAvailableSince;
  const remaining = Math.max(0, FORCE_UPDATE_MS - elapsed);
  setTimeout(() => applyUpdate(), remaining);
}
