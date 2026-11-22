import './site';
import { parseSafeAppleActivationUrl } from './lpa-utils';
import { initStoreSheet } from './store-sheet';

interface ActivationResponse {
  id: string;
  status: 'standby' | 'processing' | 'active';
  phoneNumber?: string | null;
  activationUrl?: string | null;
  lpaCode?: string | null;
}

const statusBadge = document.getElementById('status-badge');
const actDesc = document.getElementById('act-desc');
const phoneDisplay = document.getElementById('phone-display');
const phoneNumber = document.getElementById('phone-number');
const activateBtn = document.getElementById('activate-btn') as HTMLButtonElement | null;
const standbyBtn = document.getElementById('standby-btn') as HTMLButtonElement | null;
const processingBtn = document.getElementById('processing-btn') as HTMLButtonElement | null;
const errorDiv = document.getElementById('error-div');

const instructionsDialog = document.getElementById('instructions-dialog') as HTMLDialogElement | null;
const instrClose = document.getElementById('instr-close') as HTMLButtonElement | null;
const proceedBtn = document.getElementById('proceed-btn') as HTMLAnchorElement | null;
const storeDialog = document.getElementById('store-sheet-dialog') as HTMLDialogElement | null;

const isLocalApi = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalApi ? `http://${window.location.hostname}:3001/api` : '/api';

if (storeDialog) {
  initStoreSheet(storeDialog);
}

if (instructionsDialog && !('closedBy' in HTMLDialogElement.prototype)) {
  instructionsDialog.addEventListener('click', (event) => {
    if (event.target !== instructionsDialog) return;
    const r = instructionsDialog.getBoundingClientRect();
    const inside =
      r.top <= event.clientY &&
      event.clientY <= r.top + r.height &&
      r.left <= event.clientX &&
      event.clientX <= r.left + r.width;
    if (!inside) instructionsDialog.close();
  });
}

instrClose?.addEventListener('click', () => instructionsDialog?.close());

let currentAppleUrl: string | null = null;
let pollTimer = 0;

function showError() {
  if (actDesc) {
    actDesc.textContent = '';
    actDesc.hidden = true;
  }
  if (statusBadge) statusBadge.hidden = true;
  if (phoneDisplay) phoneDisplay.hidden = true;
  if (activateBtn) activateBtn.hidden = true;
  if (standbyBtn) standbyBtn.hidden = true;
  if (processingBtn) processingBtn.hidden = true;
  if (errorDiv) errorDiv.hidden = false;
}

function renderActivation(data: ActivationResponse) {
  if (errorDiv) errorDiv.hidden = true;
  const status = data.status === 'active' || data.status === 'processing' ? data.status : 'standby';

  if (statusBadge) {
    statusBadge.className = `status-pill status-${status}`;
    statusBadge.textContent = status === 'active' ? 'Ready' : status === 'processing' ? 'Processing' : 'Standby';
    statusBadge.hidden = false;
  }

  if (actDesc) {
    actDesc.hidden = false;
    actDesc.textContent =
      status === 'active'
        ? 'One tap to download your eSIM profile.'
        : status === 'processing'
          ? 'Your eSIM is being processed.'
          : 'Your eSIM is being prepared. Please wait.';
  }

  if (phoneDisplay && phoneNumber) {
    if (data.phoneNumber) {
      phoneNumber.textContent = data.phoneNumber;
      phoneDisplay.hidden = false;
    } else {
      phoneDisplay.hidden = true;
    }
  }

  if (activateBtn) activateBtn.hidden = true;
  if (standbyBtn) standbyBtn.hidden = true;
  if (processingBtn) processingBtn.hidden = true;

  const safe = parseSafeAppleActivationUrl(data.activationUrl || data.lpaCode);
  currentAppleUrl = safe?.appleUrl ?? null;

  if (status === 'active' && currentAppleUrl) {
    if (activateBtn) activateBtn.hidden = false;
  } else if (status === 'processing') {
    if (processingBtn) processingBtn.hidden = false;
  } else {
    if (standbyBtn) standbyBtn.hidden = false;
  }
}

activateBtn?.addEventListener('click', () => {
  if (!currentAppleUrl || !instructionsDialog || !proceedBtn) return;
  proceedBtn.href = currentAppleUrl;
  if (!instructionsDialog.open) instructionsDialog.showModal();
});

const id = new URLSearchParams(window.location.search).get('id');

async function fetchActivation() {
  if (!id || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
    showError();
    clearInterval(pollTimer);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/activation/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) {
      showError();
      if (res.status === 404 || res.status === 400) clearInterval(pollTimer);
      return;
    }
    const data = (await res.json()) as ActivationResponse;
    renderActivation(data);
  } catch {
    showError();
  }
}

void fetchActivation();
pollTimer = window.setInterval(() => {
  if (!document.hidden) {
    void fetchActivation();
  }
}, 5000);

addEventListener('pagehide', () => clearInterval(pollTimer), { once: true });
