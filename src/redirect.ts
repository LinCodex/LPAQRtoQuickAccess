import './site';
import { formatDisplayPhone, parseSafeAppleActivationUrl, sanitizePhoneNumber } from './lpa-utils';
import { initStoreSheet } from './store-sheet';

const esimShell = document.getElementById('esim-shell');
const activateBtn = document.getElementById('activate-btn') as HTMLAnchorElement | null;
const activateBtnTitle = document.getElementById('activate-btn-title');
const activateBtnSub = document.getElementById('activate-btn-sub');
const errorBox = document.getElementById('redirect-error');
const pollMeta = document.getElementById('poll-meta');
const phoneBox = document.getElementById('redirect-phone-box');
const phoneNumberEl = document.getElementById('redirect-phone-number');
const walkthroughPhoneEl = document.getElementById('walkthrough-phone-number');
const copyPhoneBtn = document.getElementById('copy-phone-btn') as HTMLButtonElement | null;
const phoneStatusEl = document.getElementById('redirect-phone-status');
const wechatBanner = document.getElementById('wechat-safari-banner');
const motionToggleBtn = document.getElementById('guide-motion-toggle') as HTMLButtonElement | null;
const stepButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-step-target]')];
const sheetDialog = document.getElementById('store-sheet-dialog') as HTMLDialogElement | null;

const isLocalApi = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalApi ? `http://${window.location.hostname}:3001/api` : '/api';

if (sheetDialog) {
  initStoreSheet(sheetDialog);
}

if (wechatBanner && /MicroMessenger/i.test(navigator.userAgent)) {
  wechatBanner.hidden = false;
}

activateBtn?.addEventListener('click', (event) => {
  if (activateBtn.getAttribute('aria-disabled') === 'true') {
    event.preventDefault();
  }
});

// Single iPhone 18 Pro multi-page walkthrough controller
type StepNum = 1 | 2 | 3 | 4;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let currentStep: StepNum = 1;
let stepTimer = 0;

function setStep(next: StepNum, focusBtn = false) {
  currentStep = next;
  esimShell?.setAttribute('data-step', String(next));
  esimShell?.style.setProperty('--active-step', String(next));

  for (const btn of stepButtons) {
    const target = Number(btn.dataset.stepTarget);
    const active = target === next;
    btn.setAttribute('aria-pressed', String(active));
    if (active && focusBtn) {
      btn.focus();
    }
  }
}

function stopAutoAdvance() {
  if (stepTimer) {
    clearInterval(stepTimer);
    stepTimer = 0;
  }
}

function startAutoAdvance() {
  stopAutoAdvance();
  if (reducedMotion.matches || esimShell?.hasAttribute('data-paused')) return;
  stepTimer = window.setInterval(() => {
    if (document.hidden || reducedMotion.matches || esimShell?.hasAttribute('data-paused')) return;
    const nextStep = ((currentStep % 4) + 1) as StepNum;
    setStep(nextStep);
  }, 3400);
}

for (const btn of stepButtons) {
  btn.addEventListener('click', () => {
    const target = Number(btn.dataset.stepTarget);
    if (target >= 1 && target <= 4) {
      setStep(target as StepNum);
      startAutoAdvance();
    }
  });

  btn.addEventListener('keydown', (event) => {
    let target: StepNum | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      target = ((currentStep % 4) + 1) as StepNum;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      target = (((currentStep + 2) % 4) + 1) as StepNum;
    } else if (event.key === 'Home') {
      target = 1;
    } else if (event.key === 'End') {
      target = 4;
    }
    if (target) {
      event.preventDefault();
      setStep(target, true);
      startAutoAdvance();
    }
  });
}

motionToggleBtn?.addEventListener('click', () => {
  if (!esimShell) return;
  const paused = esimShell.hasAttribute('data-paused');
  if (paused) {
    esimShell.removeAttribute('data-paused');
    startAutoAdvance();
  } else {
    esimShell.setAttribute('data-paused', '');
    stopAutoAdvance();
  }
});

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    stopAutoAdvance();
  } else {
    startAutoAdvance();
  }
});

setStep(1);
startAutoAdvance();

// URL params, phone number copy, and link validation / polling
const params = new URLSearchParams(window.location.search);
const rawCandidate = params.get('url') || params.get('lpa');
const activationId = params.get('id');
const urlPhone = sanitizePhoneNumber(params.get('phone'));

let displayedPhone = '';
let copyPhoneTimer = 0;
let lastPhoneAnnouncement = '';

function showPhoneNumber(rawPhone: string) {
  if (!phoneBox || !phoneNumberEl) return;
  if (!rawPhone) {
    displayedPhone = '';
    phoneNumberEl.textContent = '';
    if (walkthroughPhoneEl) {
      walkthroughPhoneEl.textContent = '(123) 456-7890';
    }
    phoneBox.hidden = true;
    return;
  }
  displayedPhone = rawPhone;
  phoneNumberEl.textContent = rawPhone;
  if (walkthroughPhoneEl) {
    walkthroughPhoneEl.textContent = rawPhone;
  }
  phoneBox.hidden = false;
}

if (urlPhone) {
  showPhoneNumber(formatDisplayPhone(urlPhone));
}

copyPhoneBtn?.addEventListener('click', async () => {
  const value = displayedPhone || phoneNumberEl?.textContent || '';
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    clearTimeout(copyPhoneTimer);
    copyPhoneBtn.setAttribute('data-copied', '');
    if (phoneStatusEl) {
      const msg = 'Phone number copied.';
      const announced = msg === lastPhoneAnnouncement ? `${msg}\u00A0` : msg;
      lastPhoneAnnouncement = msg;
      phoneStatusEl.textContent = '';
      requestAnimationFrame(() => {
        phoneStatusEl.textContent = announced;
      });
    }
    copyPhoneTimer = window.setTimeout(() => {
      copyPhoneBtn.removeAttribute('data-copied');
      if (phoneStatusEl) phoneStatusEl.textContent = '';
    }, 1800);
  } catch {
    copyPhoneBtn.removeAttribute('data-copied');
  }
});

function setShellState(state: 'ready' | 'standby' | 'processing' | 'polling' | 'invalid') {
  esimShell?.setAttribute('data-state', state);
}

function applyValidLink(appleUrl: string) {
  if (activateBtn) {
    activateBtn.href = appleUrl;
    activateBtn.removeAttribute('aria-disabled');
  }
  if (activateBtnTitle) activateBtnTitle.textContent = 'Click to Activate';
  if (activateBtnSub) activateBtnSub.textContent = '';
  if (errorBox) errorBox.hidden = true;
  if (pollMeta) pollMeta.hidden = true;
  setShellState('ready');
}

function applyPendingState(state: 'standby' | 'processing' | 'polling') {
  if (activateBtn) {
    activateBtn.removeAttribute('href');
    activateBtn.setAttribute('aria-disabled', 'true');
  }
  if (state === 'standby') {
    if (activateBtnTitle) activateBtnTitle.textContent = 'Awaiting Activation';
    if (activateBtnSub) activateBtnSub.textContent = '';
  } else if (state === 'processing') {
    if (activateBtnTitle) activateBtnTitle.textContent = 'Processing…';
    if (activateBtnSub) activateBtnSub.textContent = '';
  } else {
    if (activateBtnTitle) activateBtnTitle.textContent = 'Checking Status…';
    if (activateBtnSub) activateBtnSub.textContent = '';
  }
  if (errorBox) errorBox.hidden = true;
  if (pollMeta) pollMeta.hidden = false;
  setShellState(state);
}

function showInvalid(isPolling = false) {
  if (isPolling) {
    applyPendingState('polling');
    return;
  }
  if (activateBtn) {
    activateBtn.removeAttribute('href');
    activateBtn.setAttribute('aria-disabled', 'true');
  }
  if (activateBtnTitle) activateBtnTitle.textContent = 'Link Unavailable';
  if (activateBtnSub) activateBtnSub.textContent = '';
  if (errorBox) errorBox.hidden = false;
  if (pollMeta) pollMeta.hidden = true;
  setShellState('invalid');
}

const initialParsed = parseSafeAppleActivationUrl(rawCandidate);
let pollTimer = 0;

if (initialParsed) {
  applyValidLink(initialParsed.appleUrl);
} else {
  const hasValidPollId = Boolean(activationId && /^[A-Za-z0-9_-]{4,64}$/.test(activationId));
  showInvalid(hasValidPollId);

  if (hasValidPollId && activationId) {
    let pollVisibilityHandler: (() => void) | null = null;
    const stopVisibilityWatch = () => {
      if (pollVisibilityHandler) {
        document.removeEventListener('visibilitychange', pollVisibilityHandler);
        pollVisibilityHandler = null;
      }
    };
    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`${API_BASE}/activation/${encodeURIComponent(activationId)}`, {
          cache: 'no-store'
        });
        if (res.status === 404 || res.status === 400) {
          showInvalid(false);
          clearInterval(pollTimer);
          stopVisibilityWatch();
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as {
          status?: string;
          phoneNumber?: string | null;
          activationUrl?: string | null;
          lpaCode?: string | null;
        };
        if (data.phoneNumber && data.phoneNumber !== displayedPhone) {
          showPhoneNumber(data.phoneNumber);
        } else if (!data.phoneNumber && !urlPhone && displayedPhone) {
          showPhoneNumber('');
        }

        const parsed = parseSafeAppleActivationUrl(data.activationUrl || data.lpaCode);
        if (data.status === 'active' && parsed) {
          applyValidLink(parsed.appleUrl);
        } else if (data.status === 'processing' || (data.status === 'active' && !parsed)) {
          applyPendingState('processing');
        } else {
          applyPendingState('standby');
        }
      } catch {
        // Keep silent retry until network recovers
      }
    };
    pollVisibilityHandler = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', pollVisibilityHandler);
    addEventListener('pagehide', stopVisibilityWatch, { once: true });
    void poll();
    pollTimer = window.setInterval(() => void poll(), 4000);
  }
}

addEventListener(
  'pagehide',
  () => {
    clearInterval(pollTimer);
    stopAutoAdvance();
  },
  { once: true }
);
