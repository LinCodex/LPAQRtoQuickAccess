import './site';
import { getLanguage } from './site';
import { translate } from './translations';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import QRCode from 'qrcode';
import {
  encodePhoneParam,
  formatDisplayPhone,
  formatLpaString,
  parseLpaCode,
  sanitizePhoneNumber,
  type LpaData
} from './lpa-utils';

interface ActivationRecord {
  id: string;
  phoneNumber?: string;
  notes?: string;
  status: 'standby' | 'processing' | 'active';
  lpaCode?: string;
  shortUrl?: string;
  createdAt: string;
  updatedAt?: string;
}

interface HistoryRecord {
  id: string;
  lpaCode: string;
  smdpAddress: string;
  activationCode: string;
  confirmationCode?: string;
  phoneNumber?: string;
  createdAt: string;
  createdBy?: string;
}

type StatusLevel = 'healthy' | 'warning' | 'critical';

interface SystemStatusResponse {
  overall: StatusLevel;
  checkedAt: string;
  runtime: {
    platform: 'vercel' | 'local';
    environment: string;
    region: string;
    nodeVersion: string;
    publicBaseUrl: string;
    commitSha: string | null;
  };
  database: {
    type: 'redis' | 'local-json';
    provider: string;
    status: 'connected' | 'unconfigured' | 'error';
    latencyMs: number | null;
    usedBytes: number;
    limitBytes: number | null;
    limitSource: 'redis-maxmemory' | 'env-configured' | 'plan-default' | 'soft-cap' | null;
    usagePercent: number | null;
    totalKeys: number | null;
    evictionPolicy: string | null;
    errorMessage: string | null;
  };
  records: {
    activations: { total: number; standby: number; processing: number; active: number; bytes: number };
    history: { total: number; limit: number; bytes: number };
    shortlinks: { total: number; bytes: number; ttlDays: number };
    users: { total: number; hasAdmin: boolean; usingDefaultPassword: boolean };
  };
  env: Array<{
    key: string;
    required: boolean;
    configured: boolean;
    note: string;
  }>;
  limits: Array<{
    id: string;
    label: string;
    status: StatusLevel;
    detail: string;
    used: number | null;
    limit: number | null;
    unit: string | null;
    percent: number | null;
  }>;
  autoCleanup?: {
    enabled: boolean;
    thresholdPercent: number;
    targetPercent: number;
    lastRun: {
      ranAt: string;
      reason: string;
      totalDeleted: number;
      freedBytesEstimate: number;
    } | null;
  };
}

const isLocalApi = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalApi ? `http://${window.location.hostname}:3001/api` : '/api';
const TOKEN_KEY = 'ezrefill_admin_token';
const REMEMBER_KEY = 'ezrefill_admin_remember';
const REMEMBER_USER_KEY = 'ezrefill_admin_username';
const ACTIVE_TAB_KEY = 'ezrefill_admin_active_tab';
const STATUS_FILTER_KEY = 'ezrefill_admin_status_filter';
const HISTORY_SORT_KEY = 'ezrefill_admin_history_sort';

function t(en: string): string {
  return getLanguage() === 'zh-Hans' ? translate(en) : en;
}

// Login & Header Elements
const authGate = document.getElementById('admin-auth-gate');
const loginScreen = document.getElementById('login-screen')!;
const dashboard = document.getElementById('dashboard')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginUsername = document.getElementById('login-username') as HTMLInputElement;
const loginPassword = document.getElementById('login-password') as HTMLInputElement;
const loginRemember = document.getElementById('login-remember') as HTMLInputElement | null;
const toggleLoginPasswordBtn = document.getElementById('toggle-login-password') as HTMLButtonElement | null;
const loginError = document.getElementById('login-error')!;

// Dashboard Overview, Tabs & Feedback
const userDisplay = document.getElementById('user-display')!;
const refreshStatus = document.getElementById('refresh-status')!;
const dashboardToast = document.getElementById('dashboard-toast')!;
const dashboardError = document.getElementById('dashboard-error')!;
const activationsTable = document.getElementById('activations-table') as HTMLTableElement;
const activationsList = document.getElementById('activations-list')!;
const emptyState = document.getElementById('empty-state')!;
const emptyStateTitle = document.getElementById('empty-state-title')!;
const emptyStateSub = document.getElementById('empty-state-sub')!;

const statTotal = document.getElementById('stat-total')!;
const statStandby = document.getElementById('stat-standby')!;
const statProcessing = document.getElementById('stat-processing')!;
const statActive = document.getElementById('stat-active')!;
const statFilterBtns = [...document.querySelectorAll<HTMLButtonElement>('.admin-stat-card[data-filter]')];

const tabActivations = document.getElementById('tab-activations') as HTMLButtonElement;
const tabQuicklink = document.getElementById('tab-quicklink') as HTMLButtonElement;
const tabHistory = document.getElementById('tab-history') as HTMLButtonElement;
const tabStatus = document.getElementById('tab-status') as HTMLButtonElement;
const panelActivations = document.getElementById('panel-activations')!;
const panelQuicklink = document.getElementById('panel-quicklink')!;
const panelHistory = document.getElementById('panel-history')!;
const panelStatus = document.getElementById('panel-status')!;
const historyCountBadge = document.getElementById('history-count-badge')!;
const statusTabDot = document.getElementById('status-tab-dot');
const workspaceTabs = [tabQuicklink, tabActivations, tabHistory, tabStatus];
const workspacePanels = [panelQuicklink, panelActivations, panelHistory, panelStatus];

// System Status Elements
const statusOverallPill = document.getElementById('status-overall-pill');
const statusCheckedAt = document.getElementById('status-checked-at');
const statusRefreshBtn = document.getElementById('status-refresh-btn') as HTMLButtonElement | null;
const statusAlertBanner = document.getElementById('status-alert-banner');
const statusStorageMeter = document.getElementById('status-storage-meter') as HTMLProgressElement | null;
const statusStorageSummary = document.getElementById('status-storage-summary');
const statusStorageNote = document.getElementById('status-storage-note');
const statusHistoryMeter = document.getElementById('status-history-meter') as HTMLProgressElement | null;
const statusHistorySummary = document.getElementById('status-history-summary');
const statusLimitsList = document.getElementById('status-limits-list');
const statusCleanupSummary = document.getElementById('status-cleanup-summary');
const statusCleanupBtn = document.getElementById('status-cleanup-btn') as HTMLButtonElement | null;
const statusBackendDl = document.getElementById('status-backend-dl');
const statusDataGrid = document.getElementById('status-data-grid');
const statusEnvList = document.getElementById('status-env-list');

// Generated History Elements
const historySearchInput = document.getElementById('history-search') as HTMLInputElement;
const historySortSelect = document.getElementById('history-sort') as HTMLSelectElement;
const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLButtonElement;
const historyTable = document.getElementById('history-table') as HTMLTableElement;
const historyList = document.getElementById('history-list')!;
const historyEmptyState = document.getElementById('history-empty-state')!;
const historyEmptyTitle = document.getElementById('history-empty-title')!;
const historyEmptySub = document.getElementById('history-empty-sub')!;

const activationSearchInput = document.getElementById('activation-search') as HTMLInputElement;

// Quick eSIM Link Generator Panel Elements
const qlOverlayState = document.getElementById('ql-overlay-state');
const qlScannerStatus = document.getElementById('ql-scanner-status');
const qlCameraStartBtn = document.getElementById('ql-camera-start-btn') as HTMLButtonElement | null;
const qlCameraStopBar = document.getElementById('ql-camera-stop-bar');
const qlCameraStopBtn = document.getElementById('ql-camera-stop-btn') as HTMLButtonElement | null;
const qlActionRow = document.getElementById('ql-action-row');
const qlFileInput = document.getElementById('ql-file-input') as HTMLInputElement | null;
const qlCutoutBtn = document.getElementById('ql-cutout-btn') as HTMLButtonElement | null;
const qlForm = document.getElementById('ql-form') as HTMLFormElement | null;
const qlSmdpInput = document.getElementById('ql-smdp') as HTMLInputElement | null;
const qlCodeInput = document.getElementById('ql-code') as HTMLInputElement | null;
const qlConfirmInput = document.getElementById('ql-confirm') as HTMLInputElement | null;
const qlPhoneInput = document.getElementById('ql-phone') as HTMLInputElement | null;
const qlErrorBox = document.getElementById('ql-error-box');
const qlEmptyState = document.getElementById('ql-empty-state');
const qlResultContent = document.getElementById('ql-result-content');
const qlVerifySmdp = document.getElementById('ql-verify-smdp');
const qlVerifyCode = document.getElementById('ql-verify-code');
const qlVerifyConfirmRow = document.getElementById('ql-verify-confirm-row');
const qlVerifyConfirm = document.getElementById('ql-verify-confirm');
const qlVerifyPhoneRow = document.getElementById('ql-verify-phone-row');
const qlVerifyPhone = document.getElementById('ql-verify-phone');
const qlLinkCode = document.getElementById('ql-link-code');
const qlCopyLinkBtn = document.getElementById('ql-copy-link-btn') as HTMLButtonElement | null;
const qlCopyLpaQrBtn = document.getElementById('ql-copy-lpa-qr-btn') as HTMLButtonElement | null;
const qlPreviewLink = document.getElementById('ql-preview-link') as HTMLAnchorElement | null;
const qlSaveActivationBtn = document.getElementById('ql-save-activation-btn') as HTMLButtonElement | null;
const qlQrModeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-ql-qr-mode]')];
const qlQrCaption = document.getElementById('ql-qr-caption');
const qlQrCanvas = document.getElementById('ql-qr-canvas') as HTMLCanvasElement | null;
const qlCopyQrBtn = document.getElementById('ql-copy-qr-btn') as HTMLButtonElement | null;
const qlQrStatus = document.getElementById('ql-qr-status');
const qlResetBtn = document.getElementById('ql-reset-btn') as HTMLButtonElement | null;

// Create / Edit Activation Dialog Elements
const activationDialog = document.getElementById('activation-dialog') as HTMLDialogElement;
const activationDialogTitle = document.getElementById('activation-dialog-title')!;
const activationForm = document.getElementById('activation-form') as HTMLFormElement;
const editIdInput = document.getElementById('edit-id') as HTMLInputElement;
const phoneInput = document.getElementById('phone-input') as HTMLInputElement;
const notesInput = document.getElementById('notes-input') as HTMLTextAreaElement;
const lpaInput = document.getElementById('lpa-input') as HTMLTextAreaElement;
const statusButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-status-btn]')];
const linkPreview = document.getElementById('link-preview')!;
const shortLinkSection = document.getElementById('short-link-section')!;
const shortLinkDisplay = document.getElementById('short-link-display') as HTMLInputElement;
const linkDisplay = document.getElementById('link-display') as HTMLInputElement;
const formError = document.getElementById('form-error')!;
const activationSubmitBtn = document.getElementById('activation-submit-btn') as HTMLButtonElement;

const adminQrScanBtn = document.getElementById('admin-qr-scan-btn') as HTMLButtonElement;
const adminQrFile = document.getElementById('admin-qr-file') as HTMLInputElement;
const adminCutoutBtn = document.getElementById('admin-cutout-btn') as HTMLButtonElement;
const adminManualToggle = document.getElementById('admin-manual-toggle') as HTMLButtonElement;
const adminQrContainer = document.getElementById('admin-qr-container')!;
const adminQrStatus = document.getElementById('admin-qr-status')!;
const adminManualFields = document.getElementById('admin-manual-fields')!;
const adminSmdpInput = document.getElementById('admin-smdp-input') as HTMLInputElement;
const adminCodeInput = document.getElementById('admin-code-input') as HTMLInputElement;
const adminApplyManualBtn = document.getElementById('admin-apply-manual-btn') as HTMLButtonElement;

// Account Dialogs
const changePwDialog = document.getElementById('change-password-dialog') as HTMLDialogElement;
const defaultPwNote = document.getElementById('default-pw-note')!;
const changePwForm = document.getElementById('change-password-form') as HTMLFormElement;
const currentPwInput = document.getElementById('current-password') as HTMLInputElement;
const newPwInput = document.getElementById('new-password') as HTMLInputElement;
const confirmPwInput = document.getElementById('confirm-password') as HTMLInputElement;
const changePwError = document.getElementById('change-pw-error')!;
const skipPwBtn = document.getElementById('skip-pw-btn') as HTMLButtonElement;

const resetPwDialog = document.getElementById('reset-password-dialog') as HTMLDialogElement;
const resetPwForm = document.getElementById('reset-password-form') as HTMLFormElement;
const resetTokenInput = document.getElementById('reset-token-input') as HTMLInputElement;
const resetNewPwInput = document.getElementById('reset-new-password') as HTMLInputElement;
const resetConfirmPwInput = document.getElementById('reset-confirm-password') as HTMLInputElement;
const resetPwError = document.getElementById('reset-pw-error')!;
const resetPwSuccess = document.getElementById('reset-pw-success')!;

const deleteDialog = document.getElementById('delete-dialog') as HTMLDialogElement;
const deleteError = document.getElementById('delete-error')!;

let activations: ActivationRecord[] = [];
let historyEntries: HistoryRecord[] = [];
let historySortOrder: 'desc' | 'asc' = 'desc';
let historySearchQuery = '';
let lastRecordedHistoryKey = '';
let lastRecordedHistoryAt = 0;
let lastStatusData: SystemStatusResponse | null = null;
let statusFetchedAtMs = 0;
let statusLoading = false;
let currentUsername = '';
let formStatus: 'standby' | 'processing' | 'active' = 'standby';
let statusFilter: 'all' | 'standby' | 'processing' | 'active' = 'all';
let searchQuery = '';
let deleteTargetId: string | null = null;
let lastDataHash = '';
let countdownInterval = 0;
let refreshCountdown = 5;
let toastTimer = 0;

let modalScanner: Html5Qrcode | null = null;
let modalScannerActive = false;

let qlScanner: Html5Qrcode | null = null;
let qlScannerActive = false;
let currentQlLpa: LpaData | null = null;
let currentQlPhone = '';
let qlQrMode: 'redirect' | 'raw' = 'redirect';
let qlQrStatusTimer = 0;

const hasScreenCapture = Boolean(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);
if (!hasScreenCapture) {
  if (adminCutoutBtn) adminCutoutBtn.hidden = true;
  if (qlCutoutBtn && qlActionRow) {
    qlCutoutBtn.hidden = true;
    qlActionRow.classList.add('is-single');
  }
}

try {
  const savedRemember = localStorage.getItem(REMEMBER_KEY);
  if (loginRemember && savedRemember !== null) {
    loginRemember.checked = savedRemember !== 'false';
  }
  const savedUser = localStorage.getItem(REMEMBER_USER_KEY);
  if (savedUser && (!loginRemember || loginRemember.checked)) {
    loginUsername.value = savedUser;
  }
} catch {
  // Ignore storage restrictions
}

toggleLoginPasswordBtn?.addEventListener('click', () => {
  const showing = loginPassword.type === 'text';
  loginPassword.type = showing ? 'password' : 'text';
  toggleLoginPasswordBtn.setAttribute('aria-pressed', String(!showing));
  toggleLoginPasswordBtn.textContent = t(showing ? 'Show' : 'Hide');
});

function enableBackdropFallback(dialog: HTMLDialogElement) {
  if ('closedBy' in HTMLDialogElement.prototype) return;
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside =
      r.top <= event.clientY &&
      event.clientY <= r.top + r.height &&
      r.left <= event.clientX &&
      event.clientX <= r.left + r.width;
    if (!inside) dialog.close();
  });
}

[activationDialog, changePwDialog, resetPwDialog, deleteDialog].forEach(enableBackdropFallback);

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearStoredToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage restrictions
  }
}

function apiFetch(path: string, init: RequestInit = {}) {
  const storedToken = getStoredToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: isLocalApi ? 'include' : 'same-origin',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
      ...(init.headers || {})
    }
  });
}

function getActivationLink(id: string): string {
  return `${window.location.origin}/redirect?id=${encodeURIComponent(id)}`;
}

function generateQuickRedirectLink(lpa: LpaData, phone?: string): string {
  const params = new URLSearchParams();
  params.set('lpa', formatLpaString(lpa));
  const compactPhone = encodePhoneParam(phone);
  if (compactPhone) {
    params.set('phone', compactPhone);
  }
  return `${window.location.origin}/redirect?${params.toString()}`;
}

function showToast(msg: string) {
  clearTimeout(toastTimer);
  dashboardToast.textContent = msg;
  dashboardToast.hidden = false;
  toastTimer = window.setTimeout(() => {
    dashboardToast.hidden = true;
  }, 2600);
}

function showError(target: HTMLElement | null | undefined, msg: string) {
  if (!target) return;
  target.textContent = msg;
  target.hidden = false;
}

function clearError(target: HTMLElement | null | undefined) {
  if (!target) return;
  target.hidden = true;
  target.textContent = '';
}

function setFormStatus(next: 'standby' | 'processing' | 'active') {
  formStatus = next;
  for (const btn of statusButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.statusBtn === next));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_PATHS = {
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z'],
  trash: [
    'M3 6h18',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'
  ],
  qr: [
    'M3 3h7v7H3z',
    'M14 3h7v7h-7z',
    'M3 14h7v7H3z',
    'M14 14h3v3h-3z',
    'M18 18h3v3h-3z',
    'M21 14v2',
    'M14 21h2'
  ],
  load: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  preview: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14L21 3']
} as const;

function createSvgIcon(paths: readonly string[], size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const qrBtnTimers = new WeakMap<HTMLButtonElement, number>();

async function copyQrImagePayload(
  payload: string,
  opts: {
    triggerBtn?: HTMLButtonElement | null;
    statusEl?: HTMLElement | null;
    downloadName: string;
    toastText: string;
    statusCopiedText?: string;
  }
) {
  if (!payload) return;
  if (opts.statusEl) clearTimeout(qlQrStatusTimer);
  if (opts.triggerBtn) {
    const prevTimer = qrBtnTimers.get(opts.triggerBtn);
    if (prevTimer) clearTimeout(prevTimer);
  }
  try {
    const offscreen = document.createElement('canvas');
    await QRCode.toCanvas(offscreen, payload, {
      scale: 10,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#101114', light: '#ffffff' }
    });
    const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Unable to encode QR PNG.');

    const ClipboardItemCtor = window.ClipboardItem;
    if (ClipboardItemCtor && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      if (opts.triggerBtn) {
        opts.triggerBtn.removeAttribute('data-failed');
        opts.triggerBtn.setAttribute('data-copied', '');
      }
      if (opts.statusEl) {
        opts.statusEl.textContent = t(opts.statusCopiedText || opts.toastText);
      }
      showToast(t(opts.toastText));
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = opts.downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (opts.triggerBtn) {
        opts.triggerBtn.removeAttribute('data-failed');
        opts.triggerBtn.setAttribute('data-copied', '');
      }
      if (opts.statusEl) opts.statusEl.textContent = t('Saved QR photo as PNG.');
      showToast(t('Saved QR photo as PNG.'));
    }
  } catch {
    if (opts.triggerBtn) {
      opts.triggerBtn.removeAttribute('data-copied');
      opts.triggerBtn.setAttribute('data-failed', '');
    }
    if (opts.statusEl) opts.statusEl.textContent = t('Could not copy QR image.');
    showToast(t('Could not copy QR image.'));
  }

  if (opts.triggerBtn) {
    const btn = opts.triggerBtn;
    qrBtnTimers.set(
      btn,
      window.setTimeout(() => {
        btn.removeAttribute('data-copied');
        btn.removeAttribute('data-failed');
      }, 2600)
    );
  }
  if (opts.statusEl) {
    const statusEl = opts.statusEl;
    qlQrStatusTimer = window.setTimeout(() => {
      statusEl.textContent = '';
    }, 2600);
  }
}

function syncTableHeaderVars() {
  if (activationsTable) {
    activationsTable.style.setProperty('--col-phone', `"${t('Phone & Note')}"`);
    activationsTable.style.setProperty('--col-status', `"${t('Status')}"`);
    activationsTable.style.setProperty('--col-lpa', `"${t('LPA Code')}"`);
    activationsTable.style.setProperty('--col-created', `"${t('Created')}"`);
  }
  if (historyTable) {
    historyTable.style.setProperty('--col-h-phone', `"${t('Phone')}"`);
    historyTable.style.setProperty('--col-h-esim', `"${t('eSIM Details')}"`);
  }
}

function formatDate(dateStr: string, includeYear = false): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '—';
  const locale = getLanguage() === 'zh-Hans' ? 'zh-CN' : 'en-US';
  return date.toLocaleString(locale, {
    ...(includeYear ? { year: 'numeric' } : {}),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeYear ? { second: '2-digit' } : {})
  });
}

function formatDateParts(dateStr: string): { date: string; time: string } {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
  const locale = getLanguage() === 'zh-Hans' ? 'zh-CN' : 'en-US';
  return {
    date: d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
}

function updateStats() {
  statTotal.textContent = String(activations.length);
  statStandby.textContent = String(activations.filter((a) => a.status === 'standby').length);
  statProcessing.textContent = String(activations.filter((a) => a.status === 'processing').length);
  statActive.textContent = String(activations.filter((a) => a.status === 'active').length);
}

function getFilteredActivations(): ActivationRecord[] {
  const query = searchQuery.trim().toLowerCase();
  return activations.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (!query) return true;
    return (
      a.id.toLowerCase().includes(query) ||
      (a.phoneNumber || '').toLowerCase().includes(query) ||
      (a.notes || '').toLowerCase().includes(query) ||
      (a.lpaCode || '').toLowerCase().includes(query)
    );
  });
}

function renderActivations() {
  syncTableHeaderVars();
  activationsList.replaceChildren();
  const visibleRows = getFilteredActivations();

  if (visibleRows.length === 0) {
    emptyState.hidden = false;
    if (activations.length === 0) {
      emptyStateTitle.textContent = 'No activations yet';
      emptyStateSub.textContent = 'Click "+ New Activation" above to create your first activation link.';
    } else {
      emptyStateTitle.textContent = 'No matching activations';
      emptyStateSub.textContent = 'Try clearing your search or selecting All Activations above.';
    }
    return;
  }
  emptyState.hidden = true;

  for (const a of visibleRows) {
    const tr = document.createElement('tr');

    // Row header: Phone & Note cell
    const phoneTh = document.createElement('th');
    phoneTh.scope = 'row';
    phoneTh.title = a.id;
    const phoneCell = document.createElement('div');
    phoneCell.className = 'admin-phone-cell';
    const phoneDiv = document.createElement('div');
    phoneDiv.className = 'admin-phone-main';
    phoneDiv.setAttribute('data-no-translate', '');
    phoneDiv.textContent = a.phoneNumber || '—';
    phoneCell.append(phoneDiv);
    if (a.notes) {
      const noteDiv = document.createElement('div');
      noteDiv.className = 'admin-note-sub';
      noteDiv.title = a.notes;
      noteDiv.textContent = a.notes;
      phoneCell.append(noteDiv);
    }
    phoneTh.append(phoneCell);

    // Inline Status Selector cell
    const statusTd = document.createElement('td');
    const statusSelect = document.createElement('select');
    statusSelect.className = 'admin-status-select custom-select';
    statusSelect.name = `status-${a.id}`;
    statusSelect.dataset.status = a.status;
    statusSelect.setAttribute('aria-label', `Status for ${a.id}`);

    const options: Array<{ value: ActivationRecord['status']; label: string }> = [
      { value: 'standby', label: 'Standby' },
      { value: 'processing', label: 'Processing' },
      { value: 'active', label: 'Active' }
    ];
    for (const optDef of options) {
      const opt = document.createElement('option');
      opt.value = optDef.value;
      opt.textContent = optDef.label;
      if (optDef.value === a.status) opt.selected = true;
      statusSelect.append(opt);
    }

    statusSelect.addEventListener('change', async () => {
      const nextStatus = statusSelect.value as ActivationRecord['status'];
      const previousStatus = a.status;

      if (nextStatus === 'active' && !(a.lpaCode && a.lpaCode.trim())) {
        statusSelect.value = previousStatus;
        statusSelect.dataset.status = previousStatus;
        openEditModal(a);
        setFormStatus('active');
        showError(formError, 'Add an LPA code before setting status to Active.');
        lpaInput.focus();
        return;
      }

      statusSelect.disabled = true;
      statusSelect.dataset.status = nextStatus;

      try {
        const res = await apiFetch(`/admin/activations/${encodeURIComponent(a.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ status: nextStatus })
        });
        if (!res.ok) {
          statusSelect.value = previousStatus;
          statusSelect.dataset.status = previousStatus;
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          showError(dashboardError, errData.error || 'Could not update status.');
          return;
        }
        const updated = (await res.json()) as ActivationRecord;
        const idx = activations.findIndex((item) => item.id === a.id);
        if (idx >= 0) activations[idx] = updated;
        lastDataHash = JSON.stringify(activations);
        updateStats();
        clearError(dashboardError);
        showToast('Status updated.');
        if (statusFilter !== 'all' && statusFilter !== nextStatus) {
          renderActivations();
        }
      } catch {
        statusSelect.value = previousStatus;
        statusSelect.dataset.status = previousStatus;
        showError(dashboardError, 'Network error while updating status.');
      } finally {
        statusSelect.disabled = false;
      }
    });
    statusTd.append(statusSelect);

    // LPA Code preview cell
    const lpaTd = document.createElement('td');
    if (a.lpaCode) {
      const chip = document.createElement('code');
      chip.className = 'admin-lpa-chip admin-mono';
      chip.setAttribute('data-no-translate', '');
      chip.textContent = a.lpaCode;
      chip.title = a.lpaCode;
      lpaTd.append(chip);
    } else {
      const emptyLpa = document.createElement('span');
      emptyLpa.className = 'admin-lpa-empty';
      emptyLpa.textContent = 'Pending LPA';
      lpaTd.append(emptyLpa);
    }

    // Created date cell
    const createdTd = document.createElement('td');
    createdTd.className = 'admin-created-cell';
    createdTd.title = formatDate(a.createdAt, true);
    createdTd.textContent = formatDate(a.createdAt);

    // Actions cell
    const actionsTd = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'admin-row-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'icon-btn is-compact-pill';
    copyBtn.textContent = 'Copy Link';
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(getActivationLink(a.id)).then(() => showToast(t('Activation link copied.')));
    });

    const previewAnchor = document.createElement('a');
    previewAnchor.className = 'icon-btn is-square';
    previewAnchor.href = getActivationLink(a.id);
    previewAnchor.target = '_blank';
    previewAnchor.rel = 'noopener noreferrer';
    previewAnchor.title = t('Open customer preview');
    previewAnchor.setAttribute('aria-label', t('Open customer preview'));
    previewAnchor.append(createSvgIcon(ICON_PATHS.preview));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn is-square';
    editBtn.title = t('Edit activation');
    editBtn.setAttribute('aria-label', `${t('Edit activation')} ${a.id}`);
    editBtn.append(createSvgIcon(ICON_PATHS.edit));
    editBtn.addEventListener('click', () => openEditModal(a));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn is-square is-danger';
    delBtn.title = t('Delete activation');
    delBtn.setAttribute('aria-label', `${t('Delete activation')} ${a.id}`);
    delBtn.append(createSvgIcon(ICON_PATHS.trash));
    delBtn.addEventListener('click', () => openDeleteModal(a.id));

    actionsWrap.append(copyBtn, previewAnchor, editBtn, delBtn);
    actionsTd.append(actionsWrap);

    tr.append(phoneTh, statusTd, lpaTd, createdTd, actionsTd);
    activationsList.append(tr);
  }
}

function stopAutoRefresh() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = 0;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshCountdown = 5;
  refreshStatus.textContent = `Auto-refresh: ${refreshCountdown}s`;

  countdownInterval = window.setInterval(() => {
    if (document.hidden || dashboard.hidden) return;
    refreshCountdown--;
    if (refreshCountdown <= 0) {
      refreshStatus.textContent = 'Checking…';
      void loadActivations(true).finally(() => {
        refreshCountdown = 5;
        refreshStatus.textContent = `Auto-refresh: ${refreshCountdown}s`;
      });
    } else {
      refreshStatus.textContent = `Auto-refresh: ${refreshCountdown}s`;
    }
  }, 1000);
}

async function loadActivations(silent = false) {
  try {
    const res = await apiFetch('/admin/activations');
    if (res.status === 401 || res.status === 403) {
      clearStoredToken();
      showLogin();
      return;
    }
    if (!res.ok) {
      if (!silent) showError(dashboardError, 'Could not load activations.');
      return;
    }
    const data = (await res.json()) as ActivationRecord[];
    const hash = JSON.stringify(data);
    if (!silent || hash !== lastDataHash) {
      lastDataHash = hash;
      activations = data;
      renderActivations();
      updateStats();
    }
    clearError(dashboardError);
  } catch {
    if (!silent) showError(dashboardError, 'Network error while loading activations.');
  }
}

function getTabKey(tab: HTMLButtonElement): 'quicklink' | 'activations' | 'history' | 'status' {
  if (tab === tabActivations) return 'activations';
  if (tab === tabHistory) return 'history';
  if (tab === tabStatus) return 'status';
  return 'quicklink';
}

function getSavedWorkspaceTab(): HTMLButtonElement {
  try {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    if (saved === 'activations') return tabActivations;
    if (saved === 'history') return tabHistory;
    if (saved === 'status') return tabStatus;
  } catch {
    // Ignore storage restrictions
  }
  return tabQuicklink;
}

function restoreSavedWorkspacePrefs() {
  try {
    const savedFilter = localStorage.getItem(STATUS_FILTER_KEY);
    if (
      savedFilter === 'all' ||
      savedFilter === 'standby' ||
      savedFilter === 'processing' ||
      savedFilter === 'active'
    ) {
      statusFilter = savedFilter;
      for (const card of statFilterBtns) {
        card.setAttribute('aria-pressed', String(card.dataset.filter === savedFilter));
      }
    }

    const savedSort = localStorage.getItem(HISTORY_SORT_KEY);
    if (savedSort === 'asc' || savedSort === 'desc') {
      historySortOrder = savedSort;
      if (historySortSelect) historySortSelect.value = savedSort;
    }
  } catch {
    // Ignore storage restrictions
  }
}

function clearSavedWorkspaceState() {
  try {
    localStorage.removeItem(ACTIVE_TAB_KEY);
    localStorage.removeItem(STATUS_FILTER_KEY);
  } catch {
    // Ignore storage restrictions
  }
}

function showLogin() {
  stopAutoRefresh();
  void stopModalQrScanner();
  void stopQlScanner();
  currentUsername = '';
  if (authGate) authGate.hidden = true;
  dashboard.hidden = true;
  loginScreen.hidden = false;
}

function showDashboard(username: string) {
  currentUsername = username;
  if (authGate) authGate.hidden = true;
  loginScreen.hidden = true;
  dashboard.hidden = false;
  userDisplay.textContent = username;
  restoreSavedWorkspacePrefs();
  selectWorkspaceTab(getSavedWorkspaceTab(), false, { scroll: false, persist: false });
  syncTableHeaderVars();
  void loadActivations().then(() => startAutoRefresh());
  void loadHistory();
  void loadSystemStatus(true);
}

// Generated eSIM History Controllers
function updateHistoryBadge() {
  if (historyCountBadge) {
    historyCountBadge.textContent = String(historyEntries.length);
  }
  if (clearHistoryBtn) {
    clearHistoryBtn.disabled = historyEntries.length === 0;
  }
}

function getFilteredAndSortedHistory(): HistoryRecord[] {
  const q = historySearchQuery.trim().toLowerCase();
  const filtered = q
    ? historyEntries.filter(
        (h) =>
          (h.phoneNumber || '').toLowerCase().includes(q) ||
          h.smdpAddress.toLowerCase().includes(q) ||
          h.activationCode.toLowerCase().includes(q) ||
          h.lpaCode.toLowerCase().includes(q)
      )
    : [...historyEntries];

  filtered.sort((a, b) => {
    const tA = new Date(a.createdAt).getTime() || 0;
    const tB = new Date(b.createdAt).getTime() || 0;
    return historySortOrder === 'asc' ? tA - tB : tB - tA;
  });
  return filtered;
}

function renderHistory() {
  syncTableHeaderVars();
  updateHistoryBadge();
  if (!historyList || !historyEmptyState) return;
  historyList.replaceChildren();

  const rows = getFilteredAndSortedHistory();
  if (rows.length === 0) {
    historyEmptyState.hidden = false;
    if (historyEntries.length === 0) {
      historyEmptyTitle.textContent = 'No generated eSIMs yet';
      historyEmptySub.textContent = 'Links generated in the Quick eSIM Link tab are automatically saved here with date and time.';
    } else {
      historyEmptyTitle.textContent = 'No matching history entries';
      historyEmptySub.textContent = 'Try clearing your search filter.';
    }
    return;
  }
  historyEmptyState.hidden = true;

  for (const h of rows) {
    const tr = document.createElement('tr');
    const lpaObj: LpaData = {
      smdpAddress: h.smdpAddress,
      activationCode: h.activationCode,
      confirmationCode: h.confirmationCode || ''
    };
    const quickUrl = generateQuickRedirectLink(lpaObj, h.phoneNumber);

    const dtTh = document.createElement('th');
    dtTh.scope = 'row';
    const dtDiv = document.createElement('div');
    dtDiv.className = 'admin-history-dt';
    dtDiv.title = formatDate(h.createdAt, true);
    const { date, time } = formatDateParts(h.createdAt);
    const dateSpan = document.createElement('span');
    dateSpan.className = 'admin-history-date';
    dateSpan.setAttribute('data-no-translate', '');
    dateSpan.textContent = date;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'admin-history-time';
    timeSpan.setAttribute('data-no-translate', '');
    timeSpan.textContent = time;
    dtDiv.append(dateSpan, timeSpan);
    dtTh.append(dtDiv);

    const phoneTd = document.createElement('td');
    const phoneSpan = document.createElement('span');
    phoneSpan.className = 'admin-phone-main';
    phoneSpan.setAttribute('data-no-translate', '');
    phoneSpan.textContent = h.phoneNumber || '—';
    phoneTd.append(phoneSpan);

    const esimTd = document.createElement('td');
    const esimWrap = document.createElement('div');
    esimWrap.className = 'admin-history-esim';
    const smdpSpan = document.createElement('span');
    smdpSpan.className = 'admin-history-smdp';
    smdpSpan.setAttribute('data-no-translate', '');
    smdpSpan.title = h.smdpAddress;
    smdpSpan.textContent = h.smdpAddress;

    const codeChip = document.createElement('code');
    codeChip.className = 'admin-lpa-chip admin-history-code admin-mono';
    codeChip.setAttribute('data-no-translate', '');
    codeChip.title = h.lpaCode;
    codeChip.textContent = h.activationCode;
    esimWrap.append(smdpSpan, codeChip);
    esimTd.append(esimWrap);

    const actionsTd = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'admin-row-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'icon-btn is-compact-pill';
    copyBtn.textContent = 'Copy Link';
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(quickUrl).then(() => showToast(t('Quick activation link copied.')));
    });

    const copyQrBtn = document.createElement('button');
    copyQrBtn.type = 'button';
    copyQrBtn.className = 'icon-btn is-compact-pill';
    copyQrBtn.title = t('Copy LPA QR code');
    copyQrBtn.setAttribute('aria-label', `${t('Copy LPA QR code')} ${h.id}`);
    const copyQrLabel = document.createElement('span');
    copyQrLabel.textContent = 'Copy QR';
    copyQrBtn.append(createSvgIcon(ICON_PATHS.qr, 14), copyQrLabel);
    copyQrBtn.addEventListener('click', () => {
      void copyQrImagePayload(h.lpaCode, {
        triggerBtn: copyQrBtn,
        downloadName: 'ezrefill-lpa-qr.png',
        toastText: 'LPA QR code copied.'
      });
    });

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'icon-btn is-square';
    loadBtn.title = t('Load into Quick eSIM Link');
    loadBtn.setAttribute('aria-label', t('Load into Quick eSIM Link'));
    loadBtn.append(createSvgIcon(ICON_PATHS.load));
    loadBtn.addEventListener('click', () => {
      if (qlSmdpInput) qlSmdpInput.value = lpaObj.smdpAddress;
      if (qlCodeInput) qlCodeInput.value = lpaObj.activationCode;
      if (qlConfirmInput) qlConfirmInput.value = lpaObj.confirmationCode;
      if (qlPhoneInput) qlPhoneInput.value = h.phoneNumber || '';
      selectWorkspaceTab(tabQuicklink);
      void displayQlResult(lpaObj, h.phoneNumber, false);
      showToast(t('Loaded into Quick eSIM Link.'));
    });

    const previewA = document.createElement('a');
    previewA.className = 'icon-btn is-square';
    previewA.href = quickUrl;
    previewA.target = '_blank';
    previewA.rel = 'noopener noreferrer';
    previewA.title = t('Open customer preview');
    previewA.setAttribute('aria-label', t('Open customer preview'));
    previewA.append(createSvgIcon(ICON_PATHS.preview));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn is-square is-danger';
    delBtn.title = t('Delete history entry');
    delBtn.setAttribute('aria-label', `${t('Delete history entry')} ${h.id}`);
    delBtn.append(createSvgIcon(ICON_PATHS.trash));
    delBtn.addEventListener('click', () => void deleteHistoryEntry(h.id));

    actionsWrap.append(copyBtn, copyQrBtn, loadBtn, previewA, delBtn);
    actionsTd.append(actionsWrap);

    tr.append(dtTh, phoneTd, esimTd, actionsTd);
    historyList.append(tr);
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getLevelPillClass(level: StatusLevel): string {
  if (level === 'healthy') return 'is-healthy';
  if (level === 'warning') return 'is-warning';
  return 'is-critical';
}

function getLevelLabel(level: StatusLevel): string {
  if (level === 'healthy') return 'Healthy';
  if (level === 'warning') return 'Warning';
  return 'Critical';
}

function getOverallLabel(overall: StatusLevel): string {
  if (overall === 'healthy') return 'All Systems Operational';
  if (overall === 'warning') return 'Attention Needed';
  return 'Service Issue';
}

function getStorageNoteText(data: SystemStatusResponse): string {
  if (data.database.status !== 'connected') {
    return data.database.errorMessage || 'Database unavailable';
  }
  switch (data.database.limitSource) {
    case 'redis-maxmemory':
      return 'Limit read directly from Redis maxmemory.';
    case 'env-configured':
      return 'Limit configured via REDIS_MAX_MEMORY_MB.';
    case 'plan-default':
      return 'Default limit estimate for database plan (Upstash 256 MB / Redis 30 MB).';
    case 'soft-cap':
      return 'Local file storage soft cap (30 MiB).';
    default:
      return 'Storage limit unknown.';
  }
}

function appendKvRow(dl: HTMLElement, label: string, valueNode: Node | string, noTranslateVal = true) {
  const row = document.createElement('div');
  row.className = 'status-kv-row';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  if (typeof valueNode === 'string') {
    if (noTranslateVal) dd.setAttribute('data-no-translate', '');
    dd.textContent = valueNode;
  } else {
    dd.append(valueNode);
  }
  row.append(dt, dd);
  dl.append(row);
}

function appendMiniTile(
  container: HTMLElement,
  kicker: string,
  valueText: string,
  subNodes: Array<string | Node>
) {
  const tile = document.createElement('div');
  tile.className = 'status-mini-tile';
  const k = document.createElement('p');
  k.className = 'status-mini-kicker';
  k.textContent = kicker;
  const v = document.createElement('p');
  v.className = 'status-mini-val';
  v.setAttribute('data-no-translate', '');
  v.textContent = valueText;
  const sub = document.createElement('p');
  sub.className = 'status-mini-sub';
  sub.append(...subNodes);
  tile.append(k, v, sub);
  container.append(tile);
}

function renderSystemStatus(data: SystemStatusResponse) {
  if (statusTabDot) {
    statusTabDot.dataset.state = data.overall;
  }

  if (statusOverallPill) {
    statusOverallPill.className = `status-pill ${getLevelPillClass(data.overall)}`;
    statusOverallPill.textContent = getOverallLabel(data.overall);
  }

  if (statusCheckedAt) {
    statusCheckedAt.replaceChildren();
    const prefix = document.createElement('span');
    prefix.textContent = 'Last checked: ';
    const ts = document.createElement('span');
    ts.setAttribute('data-no-translate', '');
    ts.textContent = formatDate(data.checkedAt, true);
    statusCheckedAt.append(prefix, ts);
  }

  if (statusAlertBanner) {
    if (data.overall === 'healthy' && data.database.status === 'connected') {
      statusAlertBanner.hidden = true;
      statusAlertBanner.textContent = '';
    } else {
      statusAlertBanner.hidden = false;
      statusAlertBanner.className = `lpa-alert ${data.overall === 'warning' ? 'is-warn' : 'is-error'}`;
      if (data.database.status === 'unconfigured') {
        statusAlertBanner.textContent =
          'Redis database is not configured. Connect a Redis store in Vercel Project Storage so REDIS_URL is available.';
      } else if (data.database.status === 'error') {
        statusAlertBanner.textContent =
          'Database connection failed. Check that your Vercel Redis store is active and REDIS_URL is valid.';
      } else if (data.overall === 'critical') {
        statusAlertBanner.textContent =
          'A required backend service or storage limit needs immediate attention.';
      } else {
        statusAlertBanner.textContent = 'One or more backend checks reported a warning below.';
      }
    }
  }

  // Storage meter
  const storagePct = typeof data.database.usagePercent === 'number'
    ? Math.max(0, Math.min(100, data.database.usagePercent))
    : 0;
  const storageLevel: StatusLevel =
    data.database.status !== 'connected' || storagePct >= 90
      ? 'critical'
      : storagePct >= 70
        ? 'warning'
        : 'healthy';
  if (statusStorageMeter) {
    statusStorageMeter.value = data.database.status === 'connected' ? storagePct : 0;
    statusStorageMeter.dataset.level = storageLevel;
  }
  if (statusStorageSummary) {
    if (data.database.status !== 'connected') {
      statusStorageSummary.textContent = 'Offline';
    } else if (data.database.limitBytes) {
      statusStorageSummary.textContent =
        `${formatBytes(data.database.usedBytes)} / ${formatBytes(data.database.limitBytes)} (${storagePct}%)`;
    } else {
      statusStorageSummary.textContent = formatBytes(data.database.usedBytes);
    }
  }
  if (statusStorageNote) {
    statusStorageNote.textContent = getStorageNoteText(data);
  }

  // History cap meter
  const histLimit = data.records.history.limit || 500;
  const histPct = Number(((data.records.history.total / histLimit) * 100).toFixed(1));
  const histLevel: StatusLevel =
    data.records.history.total >= 475
      ? 'critical'
      : data.records.history.total >= 400
        ? 'warning'
        : 'healthy';
  if (statusHistoryMeter) {
    statusHistoryMeter.value = Math.max(0, Math.min(100, histPct));
    statusHistoryMeter.dataset.level = histLevel;
  }
  if (statusHistorySummary) {
    statusHistorySummary.textContent =
      `${data.records.history.total} / ${histLimit} (${Math.min(100, histPct)}%)`;
  }

  // Limit check rows
  if (statusLimitsList) {
    statusLimitsList.replaceChildren();
    for (const check of data.limits) {
      const row = document.createElement('div');
      row.className = 'status-check-row';
      const textWrap = document.createElement('div');
      textWrap.className = 'status-check-text';
      const labelEl = document.createElement('p');
      labelEl.className = 'status-check-label';
      labelEl.textContent = check.label;
      const detailEl = document.createElement('p');
      detailEl.className = 'status-check-detail';
      detailEl.textContent = check.detail;
      textWrap.append(labelEl, detailEl);

      const pill = document.createElement('span');
      pill.className = `status-pill ${getLevelPillClass(check.status)}`;
      pill.textContent = getLevelLabel(check.status);

      row.append(textWrap, pill);
      statusLimitsList.append(row);
    }
  }

  // Auto-cleanup policy & last-run summary
  if (statusCleanupSummary) {
    const policy = data.autoCleanup || {
      enabled: true,
      thresholdPercent: 80,
      targetPercent: 65,
      lastRun: null
    };
    statusCleanupSummary.replaceChildren();
    const policySpan = document.createElement('span');
    policySpan.textContent = `Auto-clean enabled at ${policy.thresholdPercent}% (target ${policy.targetPercent}%)`;
    statusCleanupSummary.append(policySpan);

    if (policy.lastRun) {
      const sepSpan = document.createElement('span');
      sepSpan.textContent = ' · Last run: ';
      const timeSpan = document.createElement('span');
      timeSpan.setAttribute('data-no-translate', '');
      timeSpan.textContent = formatDate(policy.lastRun.ranAt, true);
      const countOpen = document.createElement('span');
      countOpen.setAttribute('data-no-translate', '');
      countOpen.textContent = ` (${policy.lastRun.totalDeleted} `;
      const removedLbl = document.createElement('span');
      removedLbl.textContent = 'removed';
      const freedClose = document.createElement('span');
      freedClose.setAttribute('data-no-translate', '');
      freedClose.textContent = `, ${formatBytes(policy.lastRun.freedBytesEstimate)})`;
      statusCleanupSummary.append(sepSpan, timeSpan, countOpen, removedLbl, freedClose);
    }
  }
  if (statusCleanupBtn) {
    statusCleanupBtn.disabled = data.database.status !== 'connected';
  }

  // Backend & Database Health <dl>
  if (statusBackendDl) {
    statusBackendDl.replaceChildren();
    const dbStatusLabel =
      data.database.status === 'connected'
        ? 'Connected'
        : data.database.status === 'unconfigured'
          ? 'Not Configured'
          : 'Error';
    const dbPillLevel: StatusLevel =
      data.database.status === 'connected' ? 'healthy' : 'critical';
    const dbPill = document.createElement('span');
    dbPill.className = `status-pill ${getLevelPillClass(dbPillLevel)}`;
    dbPill.textContent = dbStatusLabel;

    appendKvRow(statusBackendDl, 'Database Engine', data.database.provider, true);
    appendKvRow(statusBackendDl, 'Connection Status', dbPill, false);
    appendKvRow(
      statusBackendDl,
      'Ping Latency',
      typeof data.database.latencyMs === 'number' ? `${data.database.latencyMs} ms` : '—',
      true
    );
    appendKvRow(
      statusBackendDl,
      'Runtime Environment',
      `${data.runtime.platform} · ${data.runtime.environment}`,
      true
    );
    appendKvRow(
      statusBackendDl,
      'Region / Node.js',
      `${data.runtime.region} · ${data.runtime.nodeVersion}`,
      true
    );
    appendKvRow(
      statusBackendDl,
      'Total DB Keys',
      typeof data.database.totalKeys === 'number' ? String(data.database.totalKeys) : '—',
      true
    );
    if (data.database.evictionPolicy) {
      appendKvRow(statusBackendDl, 'Eviction Policy', data.database.evictionPolicy, true);
    }
    appendKvRow(statusBackendDl, 'Public Base URL', data.runtime.publicBaseUrl, true);
    if (data.runtime.commitSha) {
      appendKvRow(statusBackendDl, 'Deployment Commit', data.runtime.commitSha, true);
    }
  }

  // Stored Data Breakdown grid
  if (statusDataGrid) {
    statusDataGrid.replaceChildren();
    const act = data.records.activations;
    const standbyLbl = document.createElement('span');
    standbyLbl.textContent = 'Standby';
    const procLbl = document.createElement('span');
    procLbl.textContent = 'Processing';
    const activeLbl = document.createElement('span');
    activeLbl.textContent = 'Active';
    appendMiniTile(statusDataGrid, 'Activation Records', String(act.total), [
      `${act.standby} `,
      standbyLbl,
      ` · ${act.processing} `,
      procLbl,
      ` · ${act.active} `,
      activeLbl,
      ` (${formatBytes(act.bytes)})`
    ]);

    const hist = data.records.history;
    const capTxt = document.createElement('span');
    capTxt.textContent = 'cap';
    appendMiniTile(statusDataGrid, 'Generated History', String(hist.total), [
      `${hist.total} / ${hist.limit} `,
      capTxt,
      ` · ${formatBytes(hist.bytes)}`
    ]);

    const sl = data.records.shortlinks;
    const ttlTxt = document.createElement('span');
    ttlTxt.textContent = '30d TTL';
    appendMiniTile(statusDataGrid, 'Short Links', String(sl.total), [
      ttlTxt,
      ` · ${formatBytes(sl.bytes)}`
    ]);

    const usr = data.records.users;
    const pwStatus = document.createElement('span');
    pwStatus.textContent = !usr.hasAdmin
      ? 'No admin user initialized yet'
      : usr.usingDefaultPassword
        ? 'Using bootstrap password'
        : 'Using custom password';
    appendMiniTile(statusDataGrid, 'Admin Accounts', String(usr.total), [pwStatus]);
  }

  // Environment & Security checklist
  if (statusEnvList) {
    statusEnvList.replaceChildren();
    for (const item of data.env) {
      const row = document.createElement('div');
      row.className = 'status-env-row';

      const meta = document.createElement('div');
      meta.className = 'status-env-meta';

      const topLine = document.createElement('div');
      const code = document.createElement('code');
      code.className = 'status-env-key';
      code.setAttribute('data-no-translate', '');
      code.textContent = item.key;

      const reqTag = document.createElement('span');
      reqTag.className = 'status-env-req';
      reqTag.textContent = item.required ? 'Required' : 'Optional';

      topLine.append(code, reqTag);

      const note = document.createElement('p');
      note.className = 'status-env-note';
      note.textContent = item.note;
      meta.append(topLine, note);

      const badge = document.createElement('span');
      if (item.configured) {
        badge.className = 'status-pill is-healthy';
        badge.textContent = 'Configured';
      } else if (item.required) {
        badge.className = 'status-pill is-critical';
        badge.textContent = 'Missing';
      } else {
        badge.className = 'status-pill is-neutral';
        badge.textContent = 'Not Set';
      }

      row.append(meta, badge);
      statusEnvList.append(row);
    }
  }
}

async function loadSystemStatus(silent = false) {
  if (statusLoading) return;
  statusLoading = true;
  if (statusRefreshBtn) {
    statusRefreshBtn.disabled = true;
    statusRefreshBtn.textContent = 'Refreshing…';
  }
  if (!lastStatusData && statusOverallPill) {
    statusOverallPill.className = 'status-pill is-neutral';
    statusOverallPill.textContent = 'Checking…';
  }

  try {
    const res = await apiFetch('/admin/status');
    if (res.status === 401 || res.status === 403) {
      clearStoredToken();
      showLogin();
      return;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as SystemStatusResponse;
    lastStatusData = data;
    statusFetchedAtMs = Date.now();
    renderSystemStatus(data);
    if (!silent) {
      clearError(dashboardError);
    }
  } catch {
    if (statusTabDot && !lastStatusData) {
      statusTabDot.dataset.state = 'critical';
    }
    if (!silent) {
      if (statusAlertBanner) {
        statusAlertBanner.hidden = false;
        statusAlertBanner.className = 'lpa-alert is-error';
        statusAlertBanner.textContent = 'Could not load system status from backend.';
      }
      if (statusOverallPill) {
        statusOverallPill.className = 'status-pill is-critical';
        statusOverallPill.textContent = 'Service Issue';
      }
    }
  } finally {
    statusLoading = false;
    if (statusRefreshBtn) {
      statusRefreshBtn.disabled = false;
      statusRefreshBtn.textContent = 'Refresh Status';
    }
  }
}

async function loadHistory() {
  try {
    const res = await apiFetch('/admin/history');
    if (!res.ok) return;
    historyEntries = (await res.json()) as HistoryRecord[];
    renderHistory();
  } catch {
    // Non-blocking fallback
  }
}

async function recordHistoryEntry(lpa: LpaData, rawPhone: string) {
  const formattedLpa = formatLpaString(lpa);
  const formattedPhone = rawPhone ? formatDisplayPhone(rawPhone) : '';
  const dedupeKey = `${formattedLpa}|${formattedPhone}`;
  const nowMs = Date.now();
  if (dedupeKey === lastRecordedHistoryKey && nowMs - lastRecordedHistoryAt < 3000) {
    return;
  }
  lastRecordedHistoryKey = dedupeKey;
  lastRecordedHistoryAt = nowMs;

  try {
    const res = await apiFetch('/admin/history', {
      method: 'POST',
      body: JSON.stringify({
        lpaCode: formattedLpa,
        phoneNumber: formattedPhone
      })
    });
    if (!res.ok) return;
    const saved = (await res.json()) as HistoryRecord;
    historyEntries.unshift(saved);
    renderHistory();
  } catch {
    // Keep QR UI responsive even if logging fails
  }
}

async function deleteHistoryEntry(id: string) {
  try {
    const res = await apiFetch(`/admin/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) return;
    historyEntries = historyEntries.filter((h) => h.id !== id);
    renderHistory();
    showToast('History entry deleted.');
  } catch {
    showError(dashboardError, 'Could not delete history entry.');
  }
}

historySearchInput?.addEventListener('input', () => {
  historySearchQuery = historySearchInput.value;
  renderHistory();
});

historySortSelect?.addEventListener('change', () => {
  historySortOrder = historySortSelect.value === 'asc' ? 'asc' : 'desc';
  try {
    localStorage.setItem(HISTORY_SORT_KEY, historySortOrder);
  } catch {
    // Ignore storage restrictions
  }
  renderHistory();
});

clearHistoryBtn?.addEventListener('click', async () => {
  if (historyEntries.length === 0) return;
  clearHistoryBtn.disabled = true;
  try {
    const res = await apiFetch('/admin/history', { method: 'DELETE' });
    if (!res.ok) {
      showError(dashboardError, 'Could not clear history.');
      return;
    }
    historyEntries = [];
    renderHistory();
    showToast('History cleared.');
  } catch {
    showError(dashboardError, 'Network error while clearing history.');
  } finally {
    clearHistoryBtn.disabled = historyEntries.length === 0;
  }
});

async function checkAuth() {
  try {
    const res = await apiFetch('/auth/verify');
    if (res.ok) {
      const data = (await res.json()) as { username?: string };
      showDashboard(data.username || 'admin');
    } else {
      clearStoredToken();
      showLogin();
    }
  } catch {
    showLogin();
  }
}

// Accessible Workspace Tabs
function selectWorkspaceTab(
  nextTab: HTMLButtonElement,
  moveFocus = false,
  opts: { scroll?: boolean; persist?: boolean } = {}
) {
  if (nextTab !== tabQuicklink) {
    void stopQlScanner();
  }
  workspaceTabs.forEach((tab, idx) => {
    const active = tab === nextTab;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = workspacePanels[idx];
    if (panel) {
      panel.hidden = !active;
      if (active) {
        panel.setAttribute('tabindex', '0');
      } else {
        panel.removeAttribute('tabindex');
      }
    }
  });
  if (opts.persist !== false) {
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, getTabKey(nextTab));
    } catch {
      // Ignore storage restrictions
    }
  }
  if (opts.scroll !== false) {
    nextTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (nextTab === tabStatus && (!lastStatusData || Date.now() - statusFetchedAtMs > 30000)) {
    void loadSystemStatus(false);
  }
  if (moveFocus) nextTab.focus();
}

statusRefreshBtn?.addEventListener('click', () => {
  void loadSystemStatus(false);
});

statusCleanupBtn?.addEventListener('click', async () => {
  if (!statusCleanupBtn || statusCleanupBtn.disabled) return;
  statusCleanupBtn.disabled = true;
  statusCleanupBtn.textContent = 'Cleaning…';
  try {
    const res = await apiFetch('/admin/cleanup', { method: 'POST' });
    if (res.status === 401 || res.status === 403) {
      clearStoredToken();
      showLogin();
      return;
    }
    if (!res.ok) {
      showError(dashboardError, 'Storage cleanup failed.');
      return;
    }
    const report = (await res.json()) as { totalDeleted?: number };
    const removed = Number(report.totalDeleted || 0);
    showToast(
      removed > 0
        ? t('Storage cleanup complete.')
        : t('Storage already within limits.')
    );
    await loadSystemStatus(false);
  } catch {
    showError(dashboardError, 'Network error while running storage cleanup.');
  } finally {
    if (statusCleanupBtn) {
      statusCleanupBtn.disabled = Boolean(lastStatusData && lastStatusData.database.status !== 'connected');
      statusCleanupBtn.textContent = 'Run Cleanup';
    }
  }
});

workspaceTabs.forEach((tab, idx) => {
  tab.addEventListener('click', () => selectWorkspaceTab(tab));
  tab.addEventListener('keydown', (e) => {
    let targetIdx: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      targetIdx = (idx + 1) % workspaceTabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      targetIdx = (idx - 1 + workspaceTabs.length) % workspaceTabs.length;
    } else if (e.key === 'Home') {
      targetIdx = 0;
    } else if (e.key === 'End') {
      targetIdx = workspaceTabs.length - 1;
    }
    if (targetIdx !== null) {
      e.preventDefault();
      selectWorkspaceTab(workspaceTabs[targetIdx], true);
    }
  });
});

// Status Filter Cards & Search
for (const btn of statFilterBtns) {
  btn.addEventListener('click', () => {
    const filter = (btn.dataset.filter as 'all' | 'standby' | 'processing' | 'active') || 'all';
    statusFilter = filter;
    try {
      localStorage.setItem(STATUS_FILTER_KEY, filter);
    } catch {
      // Ignore storage restrictions
    }
    for (const card of statFilterBtns) {
      card.setAttribute('aria-pressed', String(card === btn));
    }
    if (tabActivations.getAttribute('aria-selected') !== 'true') {
      selectWorkspaceTab(tabActivations);
    }
    renderActivations();
  });
}

activationSearchInput?.addEventListener('input', () => {
  searchQuery = activationSearchInput.value;
  renderActivations();
});

// Shared QR Image Decoder & Screen Cutout Helper
async function decodeQrFile(file: File): Promise<LpaData | null> {
  const tempId = `admin-qr-temp-${Date.now()}`;
  const tempDiv = document.createElement('div');
  tempDiv.id = tempId;
  tempDiv.className = 'sr-only';
  document.body.appendChild(tempDiv);

  try {
    const scanner = new Html5Qrcode(tempId, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false
    });
    const decoded = await scanner.scanFile(file, false);
    await scanner.clear();
    return parseLpaCode(decoded);
  } finally {
    tempDiv.remove();
  }
}

async function captureScreenCutoutFile(): Promise<File> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'monitor', cursor: 'never' } as MediaTrackConstraints,
    preferCurrentTab: false
  } as DisplayMediaStreamOptions);

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  await new Promise<void>((resolve) => {
    video.onloadedmetadata = () => {
      void video.play();
      resolve();
    };
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')?.drawImage(video, 0, 0);
  stream.getTracks().forEach((track) => track.stop());

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Capture failed');
  return new File([blob], 'screenshot.png', { type: 'image/png' });
}

// Modal Scanner Controls
async function stopModalQrScanner() {
  if (modalScanner && modalScannerActive) {
    try {
      await modalScanner.stop();
      await modalScanner.clear();
    } catch {
      // Ignore cleanup errors
    }
  }
  modalScannerActive = false;
  adminQrContainer.hidden = true;
  adminQrScanBtn.textContent = 'Scan QR';
}

function openCreateModal() {
  clearError(formError);
  activationDialogTitle.textContent = 'New Activation';
  activationSubmitBtn.textContent = 'Create';
  editIdInput.value = '';
  phoneInput.value = '';
  notesInput.value = '';
  lpaInput.value = '';
  adminSmdpInput.value = '';
  adminCodeInput.value = '';
  adminManualFields.hidden = true;
  linkPreview.hidden = true;
  shortLinkSection.hidden = true;
  setFormStatus('standby');
  activationDialog.showModal();
}

function openEditModal(a: ActivationRecord) {
  clearError(formError);
  activationDialogTitle.textContent = 'Edit Activation';
  activationSubmitBtn.textContent = 'Save';
  editIdInput.value = a.id;
  phoneInput.value = a.phoneNumber || '';
  notesInput.value = a.notes || '';
  lpaInput.value = a.lpaCode || '';
  adminSmdpInput.value = '';
  adminCodeInput.value = '';
  adminManualFields.hidden = true;
  setFormStatus(a.status);

  linkDisplay.value = getActivationLink(a.id);
  if (a.shortUrl) {
    shortLinkDisplay.value = a.shortUrl;
    shortLinkSection.hidden = false;
  } else {
    shortLinkDisplay.value = '';
    shortLinkSection.hidden = true;
  }
  linkPreview.hidden = false;
  activationDialog.showModal();
}

function openDeleteModal(id: string) {
  deleteTargetId = id;
  clearError(deleteError);
  deleteDialog.showModal();
}

// Login & Account Handlers
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(loginError);

  const cleanUsername = loginUsername.value.trim();
  const rememberMe = loginRemember ? loginRemember.checked : true;

  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: cleanUsername,
        password: loginPassword.value,
        rememberMe
      })
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showError(loginError, data.error || 'Invalid username or password.');
      return;
    }

    const data = (await res.json()) as { token?: string; username?: string; isDefaultPassword?: boolean };
    try {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, 'true');
        localStorage.setItem(REMEMBER_USER_KEY, data.username || cleanUsername || 'admin');
        if (data.token) {
          localStorage.setItem(TOKEN_KEY, data.token);
          sessionStorage.removeItem(TOKEN_KEY);
        }
      } else {
        localStorage.setItem(REMEMBER_KEY, 'false');
        localStorage.removeItem(REMEMBER_USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
        if (data.token) {
          sessionStorage.setItem(TOKEN_KEY, data.token);
        }
      }
    } catch {
      // Ignore storage restrictions
    }

    loginPassword.value = '';
    if (loginPassword.type === 'text' && toggleLoginPasswordBtn) {
      loginPassword.type = 'password';
      toggleLoginPasswordBtn.setAttribute('aria-pressed', 'false');
      toggleLoginPasswordBtn.textContent = 'Show';
    }

    if (data.isDefaultPassword) {
      currentUsername = data.username || 'admin';
      defaultPwNote.hidden = false;
      skipPwBtn.hidden = false;
      clearError(changePwError);
      changePwDialog.showModal();
    } else {
      showDashboard(data.username || 'admin');
    }
  } catch {
    showError(loginError, 'Connection error. Please try again.');
  }
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  stopAutoRefresh();
  clearStoredToken();
  clearSavedWorkspaceState();
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore logout transport failure
  }
  showLogin();
});

document.getElementById('new-activation-btn')?.addEventListener('click', openCreateModal);
document.getElementById('activation-dialog-close')?.addEventListener('click', () => activationDialog.close());
document.getElementById('activation-cancel-btn')?.addEventListener('click', () => activationDialog.close());
activationDialog.addEventListener('close', () => {
  void stopModalQrScanner();
});

for (const btn of statusButtons) {
  btn.addEventListener('click', () => {
    const val = btn.dataset.statusBtn as 'standby' | 'processing' | 'active';
    setFormStatus(val);
  });
}

adminManualToggle.addEventListener('click', () => {
  adminManualFields.hidden = !adminManualFields.hidden;
  if (!adminManualFields.hidden && lpaInput.value.trim()) {
    const parsed = parseLpaCode(lpaInput.value.trim());
    if (parsed) {
      adminSmdpInput.value = parsed.smdpAddress;
      adminCodeInput.value = parsed.activationCode;
    }
  }
});

adminApplyManualBtn.addEventListener('click', () => {
  const smdp = adminSmdpInput.value.trim();
  const code = adminCodeInput.value.trim();
  if (!smdp || !code) {
    showError(formError, 'Enter both SM-DP+ Address and Activation Code.');
    return;
  }
  clearError(formError);
  lpaInput.value = formatLpaString({ smdpAddress: smdp, activationCode: code, confirmationCode: '' });
  adminManualFields.hidden = true;
});

adminQrScanBtn.addEventListener('click', async () => {
  if (modalScannerActive) {
    await stopModalQrScanner();
    return;
  }
  clearError(formError);
  adminQrContainer.hidden = false;
  adminQrScanBtn.textContent = 'Stop Scanner';
  adminQrStatus.textContent = 'Starting camera…';

  try {
    modalScanner = new Html5Qrcode('admin-qr-reader', {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    });
    await modalScanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        const parsed = parseLpaCode(decodedText);
        if (parsed) {
          lpaInput.value = formatLpaString(parsed);
          void stopModalQrScanner();
        }
      },
      () => {}
    );
    modalScannerActive = true;
    adminQrStatus.textContent = 'Point camera at LPA QR code.';
  } catch {
    adminQrStatus.textContent = 'Camera unavailable or permission denied.';
    modalScannerActive = false;
    adminQrScanBtn.textContent = 'Scan QR';
  }
});

async function scanModalImage(file: File) {
  try {
    const parsed = await decodeQrFile(file);
    if (!parsed) {
      showError(formError, 'QR code found, but it is not a valid LPA code.');
      return;
    }
    clearError(formError);
    lpaInput.value = formatLpaString(parsed);
  } catch {
    showError(formError, 'Could not read QR code from image.');
  }
}

adminQrFile.addEventListener('change', async (e) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    await scanModalImage(file);
  } finally {
    target.value = '';
  }
});

adminCutoutBtn.addEventListener('click', async () => {
  try {
    const file = await captureScreenCutoutFile();
    await scanModalImage(file);
  } catch (err: unknown) {
    const errObj = err as { name?: string; message?: string };
    if (errObj?.name !== 'NotAllowedError') {
      showError(formError, `Screen cutout failed: ${errObj?.message || 'Unknown error'}`);
    }
  }
});

document.getElementById('copy-full-link-btn')?.addEventListener('click', () => {
  if (linkDisplay.value) {
    void navigator.clipboard.writeText(linkDisplay.value).then(() => showToast('Customer link copied.'));
  }
});

document.getElementById('copy-short-link-btn')?.addEventListener('click', () => {
  if (shortLinkDisplay.value) {
    void navigator.clipboard.writeText(shortLinkDisplay.value).then(() => showToast('Short link copied.'));
  }
});

activationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(formError);

  const editId = editIdInput.value.trim();
  const isEditing = Boolean(editId);
  const rawLpa = lpaInput.value.trim();

  if (rawLpa && !parseLpaCode(rawLpa)) {
    showError(formError, 'Invalid LPA code format (expected LPA:1$SM-DP+$CODE).');
    lpaInput.focus();
    return;
  }

  if (formStatus === 'active' && !rawLpa) {
    showError(formError, 'Add an LPA code before setting status to Active.');
    lpaInput.focus();
    return;
  }

  activationSubmitBtn.disabled = true;
  activationSubmitBtn.textContent = isEditing ? 'Saving…' : 'Creating…';

  const payload = {
    phoneNumber: phoneInput.value.trim(),
    notes: notesInput.value.trim(),
    lpaCode: rawLpa,
    status: formStatus
  };

  try {
    const url = isEditing ? `/admin/activations/${encodeURIComponent(editId)}` : '/admin/activations';
    const res = await apiFetch(url, {
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showError(formError, data.error || 'Failed to save activation.');
      return;
    }

    const saved = (await res.json()) as ActivationRecord;
    activationDialog.close();
    if (!isEditing && saved.id) {
      const link = getActivationLink(saved.id);
      navigator.clipboard.writeText(link).catch(() => {});
      showToast(`Created ${saved.id} (link copied).`);
    } else {
      showToast('Activation updated.');
    }
    await loadActivations();
  } catch {
    showError(formError, 'Network error while saving activation.');
  } finally {
    activationSubmitBtn.disabled = false;
    activationSubmitBtn.textContent = isEditing ? 'Save' : 'Create';
  }
});

// Integrated Quick eSIM Link Generator Panel Controller
function getActiveQlQrPayload(): string | null {
  if (!currentQlLpa) return null;
  if (qlQrMode === 'raw') return formatLpaString(currentQlLpa);
  return generateQuickRedirectLink(currentQlLpa, currentQlPhone);
}

async function renderQlQr() {
  const payload = getActiveQlQrPayload();
  if (!qlQrCanvas || !payload) return;

  if (qlQrCaption) {
    qlQrCaption.textContent =
      qlQrMode === 'raw'
        ? 'Raw LPA QR (scan from Android eSIM settings)'
        : 'Quick Link QR (opens activation page directly)';
  }

  for (const btn of qlQrModeButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.qlQrMode === qlQrMode));
  }

  try {
    await QRCode.toCanvas(qlQrCanvas, payload, {
      scale: 6,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#101114', light: '#ffffff' }
    });
  } catch (err) {
    console.error('QR rendering error:', err);
  }
}

function updateQlLinkAndPhone() {
  if (!currentQlLpa) return;
  const link = generateQuickRedirectLink(currentQlLpa, currentQlPhone);
  if (qlVerifyPhone && qlVerifyPhoneRow) {
    if (currentQlPhone) {
      qlVerifyPhone.textContent = formatDisplayPhone(currentQlPhone);
      qlVerifyPhoneRow.hidden = false;
    } else {
      qlVerifyPhone.textContent = '';
      qlVerifyPhoneRow.hidden = true;
    }
  }
  if (qlLinkCode) qlLinkCode.textContent = link;
  if (qlPreviewLink) qlPreviewLink.href = link;
}

async function displayQlResult(lpa: LpaData, phone?: string, recordHistory = true) {
  currentQlLpa = lpa;
  currentQlPhone = sanitizePhoneNumber(phone ?? qlPhoneInput?.value);

  if (qlVerifySmdp) qlVerifySmdp.textContent = lpa.smdpAddress;
  if (qlVerifyCode) qlVerifyCode.textContent = lpa.activationCode;
  if (qlVerifyConfirm && qlVerifyConfirmRow) {
    if (lpa.confirmationCode) {
      qlVerifyConfirm.textContent = lpa.confirmationCode;
      qlVerifyConfirmRow.hidden = false;
    } else {
      qlVerifyConfirm.textContent = '';
      qlVerifyConfirmRow.hidden = true;
    }
  }

  updateQlLinkAndPhone();
  await renderQlQr();
  if (qlEmptyState) qlEmptyState.hidden = true;
  if (qlResultContent) qlResultContent.hidden = false;
  clearError(qlErrorBox);

  if (recordHistory) {
    void recordHistoryEntry(lpa, currentQlPhone);
  }
}

async function stopQlScanner() {
  if (qlScanner && qlScannerActive) {
    try {
      await qlScanner.stop();
      await qlScanner.clear();
    } catch {
      // Ignore cleanup errors
    }
  }
  qlScannerActive = false;
  if (qlOverlayState) qlOverlayState.hidden = false;
  if (qlCameraStopBar) qlCameraStopBar.hidden = true;
}

qlCameraStartBtn?.addEventListener('click', async () => {
  await stopQlScanner();
  clearError(qlErrorBox);
  if (qlScannerStatus) qlScannerStatus.textContent = 'Starting camera…';
  if (qlCameraStartBtn) qlCameraStartBtn.disabled = true;

  try {
    qlScanner = new Html5Qrcode('ql-qr-reader', {
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    });
    await qlScanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 220, height: 220 } },
      (decoded) => {
        const parsed = parseLpaCode(decoded);
        if (parsed) {
          void stopQlScanner();
          if (qlSmdpInput) qlSmdpInput.value = parsed.smdpAddress;
          if (qlCodeInput) qlCodeInput.value = parsed.activationCode;
          if (qlConfirmInput) qlConfirmInput.value = parsed.confirmationCode;
          void displayQlResult(parsed, qlPhoneInput?.value);
        }
      },
      () => {}
    );
    qlScannerActive = true;
    if (qlOverlayState) qlOverlayState.hidden = true;
    if (qlCameraStopBar) qlCameraStopBar.hidden = false;
  } catch {
    if (qlScannerStatus) qlScannerStatus.textContent = 'Camera unavailable or permission denied.';
    showError(qlErrorBox, 'Camera permission denied or no camera available.');
  } finally {
    if (qlCameraStartBtn) qlCameraStartBtn.disabled = false;
  }
});

qlCameraStopBtn?.addEventListener('click', () => void stopQlScanner());

async function scanQlImage(file: File) {
  try {
    const parsed = await decodeQrFile(file);
    if (!parsed) {
      showError(qlErrorBox, 'QR code found, but it is not a valid LPA code.');
      return;
    }
    if (qlSmdpInput) qlSmdpInput.value = parsed.smdpAddress;
    if (qlCodeInput) qlCodeInput.value = parsed.activationCode;
    if (qlConfirmInput) qlConfirmInput.value = parsed.confirmationCode;
    await displayQlResult(parsed, qlPhoneInput?.value);
  } catch {
    showError(qlErrorBox, 'Could not read QR code from image.');
  }
}

qlFileInput?.addEventListener('change', async (e) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    await scanQlImage(file);
  } finally {
    target.value = '';
  }
});

qlCutoutBtn?.addEventListener('click', async () => {
  try {
    const file = await captureScreenCutoutFile();
    await scanQlImage(file);
  } catch (err: unknown) {
    const errObj = err as { name?: string; message?: string };
    if (errObj?.name !== 'NotAllowedError') {
      showError(qlErrorBox, `Screen cutout failed: ${errObj?.message || 'Unknown error'}`);
    }
  }
});

qlSmdpInput?.addEventListener('input', () => {
  const val = qlSmdpInput.value.trim();
  if (/^(?:LPA:)?1\$/i.test(val) || /^https?:\/\//i.test(val)) {
    const parsed = parseLpaCode(val);
    if (parsed) {
      qlSmdpInput.value = parsed.smdpAddress;
      if (qlCodeInput) qlCodeInput.value = parsed.activationCode;
      if (qlConfirmInput) qlConfirmInput.value = parsed.confirmationCode;
      void displayQlResult(parsed, qlPhoneInput?.value);
    }
  }
});

qlPhoneInput?.addEventListener('input', () => {
  if (!currentQlLpa) return;
  currentQlPhone = sanitizePhoneNumber(qlPhoneInput.value);
  updateQlLinkAndPhone();
  if (qlQrMode === 'redirect') void renderQlQr();
});

qlForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const smdp = qlSmdpInput?.value.trim() || '';
  const code = qlCodeInput?.value.trim() || '';
  const confirm = qlConfirmInput?.value.trim() || '';

  const parsedFromSmdp = /^(?:LPA:)?1\$/i.test(smdp) || /^https?:\/\//i.test(smdp) ? parseLpaCode(smdp) : null;
  if (parsedFromSmdp) {
    if (qlSmdpInput) qlSmdpInput.value = parsedFromSmdp.smdpAddress;
    if (qlCodeInput) qlCodeInput.value = parsedFromSmdp.activationCode;
    if (qlConfirmInput) qlConfirmInput.value = parsedFromSmdp.confirmationCode;
    void displayQlResult(parsedFromSmdp, qlPhoneInput?.value);
    return;
  }

  if (!smdp || !code) {
    showError(qlErrorBox, 'Enter both SM-DP+ Address and Activation Code.');
    return;
  }

  const parsed = parseLpaCode(`LPA:1$${smdp}$${code}${confirm ? '$' + confirm : ''}`);
  if (!parsed) {
    showError(qlErrorBox, 'Invalid LPA parameters. Remove spaces and $ characters.');
    return;
  }

  void displayQlResult(parsed, qlPhoneInput?.value);
});

for (const btn of qlQrModeButtons) {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.qlQrMode === 'raw' ? 'raw' : 'redirect';
    qlQrMode = mode;
    void renderQlQr();
  });
}

qlCopyLinkBtn?.addEventListener('click', () => {
  if (!currentQlLpa) return;
  const link = generateQuickRedirectLink(currentQlLpa, currentQlPhone);
  void navigator.clipboard.writeText(link).then(() => showToast(t('Quick activation link copied.')));
});

qlCopyLpaQrBtn?.addEventListener('click', () => {
  if (!currentQlLpa || !qlCopyLpaQrBtn) return;
  void copyQrImagePayload(formatLpaString(currentQlLpa), {
    triggerBtn: qlCopyLpaQrBtn,
    statusEl: qlQrStatus,
    downloadName: 'ezrefill-lpa-qr.png',
    toastText: 'LPA QR code copied.',
    statusCopiedText: 'LPA QR code copied to clipboard.'
  });
});

qlCopyQrBtn?.addEventListener('click', () => {
  const payload = getActiveQlQrPayload();
  if (!payload || !qlCopyQrBtn) return;
  void copyQrImagePayload(payload, {
    triggerBtn: qlCopyQrBtn,
    statusEl: qlQrStatus,
    downloadName: qlQrMode === 'raw' ? 'ezrefill-lpa-qr.png' : 'ezrefill-quicklink-qr.png',
    toastText: 'QR code photo copied.',
    statusCopiedText: 'QR code photo copied to clipboard.'
  });
});

qlSaveActivationBtn?.addEventListener('click', async () => {
  if (!currentQlLpa) return;
  const formattedPhone = currentQlPhone ? formatDisplayPhone(currentQlPhone) : '';
  qlSaveActivationBtn.disabled = true;

  try {
    const res = await apiFetch('/admin/activations', {
      method: 'POST',
      body: JSON.stringify({
        phoneNumber: formattedPhone,
        notes: 'Quick Link Generator',
        lpaCode: formatLpaString(currentQlLpa),
        status: 'active'
      })
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showError(qlErrorBox, data.error || 'Failed to save activation.');
      return;
    }
    const saved = (await res.json()) as ActivationRecord;
    showToast(`Created ${saved.id} (link copied).`);
    navigator.clipboard.writeText(getActivationLink(saved.id)).catch(() => {});
    await loadActivations();
  } catch {
    showError(qlErrorBox, 'Network error while saving activation.');
  } finally {
    qlSaveActivationBtn.disabled = false;
  }
});

qlResetBtn?.addEventListener('click', () => {
  currentQlLpa = null;
  currentQlPhone = '';
  clearTimeout(qlQrStatusTimer);
  qlForm?.reset();
  qlCopyQrBtn?.removeAttribute('data-copied');
  qlCopyQrBtn?.removeAttribute('data-failed');
  qlCopyLpaQrBtn?.removeAttribute('data-copied');
  qlCopyLpaQrBtn?.removeAttribute('data-failed');
  if (qlQrStatus) qlQrStatus.textContent = '';
  if (qlResultContent) qlResultContent.hidden = true;
  if (qlEmptyState) qlEmptyState.hidden = false;
  clearError(qlErrorBox);
  void stopQlScanner();
});

// Delete & Password Dialogs
document.getElementById('delete-close')?.addEventListener('click', () => deleteDialog.close());
document.getElementById('delete-cancel-btn')?.addEventListener('click', () => deleteDialog.close());
document.getElementById('delete-confirm-btn')?.addEventListener('click', async () => {
  if (!deleteTargetId) return;
  clearError(deleteError);
  try {
    const res = await apiFetch(`/admin/activations/${encodeURIComponent(deleteTargetId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showError(deleteError, data.error || 'Failed to delete activation.');
      return;
    }
    deleteDialog.close();
    deleteTargetId = null;
    showToast('Activation deleted.');
    await loadActivations();
  } catch {
    showError(deleteError, 'Network error while deleting activation.');
  }
});

document.getElementById('open-change-password-btn')?.addEventListener('click', () => {
  defaultPwNote.hidden = true;
  skipPwBtn.hidden = true;
  clearError(changePwError);
  changePwForm.reset();
  changePwDialog.showModal();
});
document.getElementById('change-pw-close')?.addEventListener('click', () => changePwDialog.close());
skipPwBtn.addEventListener('click', () => {
  changePwDialog.close();
  showDashboard(currentUsername || 'admin');
});

changePwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(changePwError);
  if (newPwInput.value !== confirmPwInput.value) {
    showError(changePwError, 'Passwords do not match.');
    return;
  }
  if (newPwInput.value.length < 8) {
    showError(changePwError, 'New password must be at least 8 characters.');
    return;
  }

  try {
    const res = await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: currentPwInput.value,
        newPassword: newPwInput.value
      })
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showError(changePwError, data.error || 'Could not change password.');
      return;
    }
    changePwDialog.close();
    changePwForm.reset();
    if (dashboard.hidden) showDashboard(currentUsername || 'admin');
    showToast('Password updated.');
  } catch {
    showError(changePwError, 'Connection error. Please try again.');
  }
});

document.getElementById('open-reset-btn')?.addEventListener('click', () => {
  clearError(resetPwError);
  resetPwSuccess.hidden = true;
  resetPwForm.reset();
  resetPwDialog.showModal();
});
document.getElementById('reset-pw-close')?.addEventListener('click', () => resetPwDialog.close());
document.getElementById('reset-cancel-btn')?.addEventListener('click', () => resetPwDialog.close());

resetPwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(resetPwError);
  resetPwSuccess.hidden = true;

  if (resetNewPwInput.value !== resetConfirmPwInput.value) {
    showError(resetPwError, 'Passwords do not match.');
    return;
  }
  if (resetNewPwInput.value.length < 8) {
    showError(resetPwError, 'Password must be at least 8 characters.');
    return;
  }

  try {
    const res = await apiFetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        resetToken: resetTokenInput.value,
        newPassword: resetNewPwInput.value
      })
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showError(resetPwError, data.error || 'Failed to reset password.');
      return;
    }
    resetPwSuccess.textContent = 'Password reset. You can sign in now.';
    resetPwSuccess.hidden = false;
    window.setTimeout(() => resetPwDialog.close(), 1500);
  } catch {
    showError(resetPwError, 'Connection error. Please try again.');
  }
});

document.addEventListener('language-change', () => {
  syncTableHeaderVars();
  renderActivations();
  renderHistory();
  if (lastStatusData) renderSystemStatus(lastStatusData);
});

addEventListener(
  'pagehide',
  () => {
    stopAutoRefresh();
    void stopModalQrScanner();
    void stopQlScanner();
  },
  { once: true }
);

void checkAuth();
