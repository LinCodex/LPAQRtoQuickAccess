import './site';
import { parseSafeAppleActivationUrl } from './lpa-utils';

const loadingEl = document.getElementById('shortlink-loading');
const redirectEl = document.getElementById('shortlink-redirect');
const errorEl = document.getElementById('shortlink-error');
const errorMsgEl = document.getElementById('shortlink-error-message');
const manualLink = document.getElementById('manual-link') as HTMLAnchorElement | null;

const isLocalApi = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalApi ? `http://${window.location.hostname}:3001/api` : '/api';

let redirectTimer = 0;

function showError(msg?: string) {
  if (loadingEl) loadingEl.hidden = true;
  if (redirectEl) redirectEl.hidden = true;
  if (errorEl) errorEl.hidden = false;
  if (errorMsgEl && msg) errorMsgEl.textContent = msg;
}

async function loadShortLink() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1] || '';

  if (!id || id === 's' || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
    showError('This link may have expired or is invalid.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/shortlink/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) {
      showError('This link may have expired or is invalid.');
      return;
    }

    const data = (await res.json()) as { activationUrl?: string; lpaCode?: string };
    const safe = parseSafeAppleActivationUrl(data.activationUrl || data.lpaCode);
    if (!safe) {
      showError('This link may have expired or is invalid.');
      return;
    }

    if (loadingEl) loadingEl.hidden = true;
    if (redirectEl) redirectEl.hidden = false;
    if (manualLink) manualLink.href = safe.appleUrl;

    redirectTimer = window.setTimeout(() => {
      window.location.href = safe.appleUrl;
    }, 500);
  } catch {
    showError('This link may have expired or is invalid.');
  }
}

addEventListener('pagehide', () => clearTimeout(redirectTimer), { once: true });
void loadShortLink();
