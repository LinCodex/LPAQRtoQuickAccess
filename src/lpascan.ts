import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import QRCode from 'qrcode';

interface LpaData {
  smdpAddress: string;
  activationCode: string;
  confirmationCode: string;
}

let html5QrCode: Html5Qrcode | null = null;
let isScannerReady = false;
let isScannerPaused = false;
let activeStream: MediaStream | null = null;

// DOM Elements
const readerElement = document.getElementById('lpa-qr-reader') as HTMLElement | null;
const statusText = document.getElementById('scanner-status') as HTMLElement | null;
const retryBtn = document.getElementById('scanner-retry-btn') as HTMLButtonElement | null;
const fileInput = document.getElementById('qr-file-input') as HTMLInputElement | null;
const screenBtn = document.getElementById('screen-cutout-btn') as HTMLButtonElement | null;

const smdpInput = document.getElementById('manual-smdp') as HTMLInputElement | null;
const codeInput = document.getElementById('manual-code') as HTMLInputElement | null;
const manualBtn = document.getElementById('manual-generate-btn') as HTMLButtonElement | null;

const resultSection = document.getElementById('lpa-result-section') as HTMLElement | null;
const verifySmdp = document.getElementById('verify-smdp') as HTMLElement | null;
const verifyCode = document.getElementById('verify-code') as HTMLElement | null;
const verifyConfirm = document.getElementById('verify-confirm') as HTMLElement | null;
const verifyConfirmRow = document.getElementById('verify-confirm-row') as HTMLElement | null;

const generatedUrlCode = document.getElementById('generated-link-code') as HTMLElement | null;
const copyBtn = document.getElementById('copy-link-btn') as HTMLButtonElement | null;
const wechatBtn = document.getElementById('wechat-share-btn') as HTMLAnchorElement | null;
const qrCanvas = document.getElementById('qr-code-canvas') as HTMLCanvasElement | null;
const resetBtn = document.getElementById('reset-scan-btn') as HTMLButtonElement | null;
const errorBox = document.getElementById('scan-error-box') as HTMLElement | null;

function parseLpaCode(code: string): LpaData | null {
  const trimmed = code.trim();

  // If already an Apple URL with carddata query param
  if (trimmed.includes('carddata=')) {
    try {
      const urlObj = new URL(trimmed);
      const carddata = urlObj.searchParams.get('carddata');
      if (carddata) return parseLpaCode(decodeURIComponent(carddata));
    } catch (_) {}
  }

  // LPA format: LPA:1$<SM-DP+ Address>$<Activation Code>[$<Confirmation Code>]
  const lpaRegex = /^(?:LPA:)?1\$([^$]+)\$([^$]+?)(?:\$([^$]*?))?(?:\$.*)?$/i;
  const match = trimmed.match(lpaRegex);

  if (!match) return null;

  return {
    smdpAddress: match[1],
    activationCode: match[2],
    confirmationCode: match[3] || ''
  };
}

function generateAppleLink(lpa: LpaData): string {
  const lpaString = `LPA:1$${lpa.smdpAddress}$${lpa.activationCode}${lpa.confirmationCode ? '$' + lpa.confirmationCode : ''}`;
  return `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaString)}`;
}

function generateRedirectLink(appleLink: string): string {
  const origin = window.location.origin;
  return `${origin}/redirect?url=${encodeURIComponent(appleLink)}`;
}

async function displayResult(lpa: LpaData) {
  const appleLink = generateAppleLink(lpa);
  const redirectLink = generateRedirectLink(appleLink);

  if (verifySmdp) verifySmdp.textContent = lpa.smdpAddress;
  if (verifyCode) verifyCode.textContent = lpa.activationCode;

  if (verifyConfirm && verifyConfirmRow) {
    if (lpa.confirmationCode) {
      verifyConfirm.textContent = lpa.confirmationCode;
      verifyConfirmRow.hidden = false;
    } else {
      verifyConfirmRow.hidden = true;
    }
  }

  if (generatedUrlCode) {
    generatedUrlCode.textContent = redirectLink;
  }

  if (qrCanvas) {
    try {
      await QRCode.toCanvas(qrCanvas, redirectLink, {
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      });
    } catch (err) {
      console.error('QR rendering error:', err);
    }
  }

  if (resultSection) {
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (errorBox) errorBox.hidden = true;
}

function showError(msg: string) {
  if (errorBox) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
}

async function onCodeDetected(code: string) {
  if (html5QrCode && isScannerReady && !isScannerPaused) {
    try {
      html5QrCode.pause(true);
      isScannerPaused = true;
    } catch (_) {}
  }

  const lpa = parseLpaCode(code);
  if (lpa) {
    await displayResult(lpa);
  } else {
    showError('QR code scanned, but it does not match eSIM LPA format: ' + code.slice(0, 40));
  }
}

async function initScanner() {
  if (!readerElement) return;

  try {
    html5QrCode = new Html5Qrcode('lpa-qr-reader', {
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    });

    await html5QrCode.start(
      { facingMode: 'environment' },
      {
        fps: 30,
        qrbox: { width: 240, height: 240 },
        aspectRatio: 1.0,
        disableFlip: false
      },
      (decodedText) => onCodeDetected(decodedText),
      () => {}
    );

    isScannerReady = true;
    if (statusText) statusText.hidden = true;
    if (retryBtn) retryBtn.hidden = true;
  } catch (err) {
    console.warn('Camera access unavailable or denied:', err);
    if (statusText) {
      statusText.textContent = 'Camera unavailable. You can upload an image or enter manually below.';
      statusText.hidden = false;
    }
    if (retryBtn) retryBtn.hidden = false;
  }
}

// File Upload Handler
fileInput?.addEventListener('change', async (event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const tempId = `lpa-scan-temp-${Date.now()}`;
  const tempDiv = document.createElement('div');
  tempDiv.id = tempId;
  tempDiv.style.display = 'none';
  document.body.appendChild(tempDiv);

  try {
    const scanner = new Html5Qrcode(tempId, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false
    });
    const result = await scanner.scanFile(file, false);
    await scanner.clear();
    document.body.removeChild(tempDiv);
    await onCodeDetected(result);
  } catch (err) {
    document.body.removeChild(tempDiv);
    showError('Could not read a QR code from this image. Please ensure the code is clear and well-lit.');
  } finally {
    target.value = '';
  }
});

// Screen Capture Cutout Handler
screenBtn?.addEventListener('click', async () => {
  if (activeStream) {
    activeStream.getTracks().forEach(t => t.stop());
    activeStream = null;
    screenBtn.classList.remove('active');
    return;
  }

  try {
    screenBtn.classList.add('active');
    activeStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor', cursor: 'never' } as any,
      preferCurrentTab: false
    } as any);

    const video = document.createElement('video');
    video.srcObject = activeStream;
    video.autoplay = true;

    await new Promise(resolve => {
      video.onloadedmetadata = () => {
        video.play();
        resolve(null);
      };
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(video, 0, 0);

    activeStream.getTracks().forEach(t => t.stop());
    activeStream = null;
    screenBtn.classList.remove('active');

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Capture failed');

    const file = new File([blob], 'screenshot.png', { type: 'image/png' });
    const tempId = `lpa-cutout-temp-${Date.now()}`;
    const tempDiv = document.createElement('div');
    tempDiv.id = tempId;
    tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);

    const scanner = new Html5Qrcode(tempId, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false
    });
    const result = await scanner.scanFile(file, false);
    await scanner.clear();
    document.body.removeChild(tempDiv);

    await onCodeDetected(result);
  } catch (err: any) {
    screenBtn.classList.remove('active');
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
    }
    if (err.name !== 'NotAllowedError') {
      showError('Screen cutout capture failed: ' + (err.message || 'No QR found.'));
    }
  }
});

// Manual Input Handler
manualBtn?.addEventListener('click', () => {
  const smdp = smdpInput?.value.trim() || '';
  const code = codeInput?.value.trim() || '';

  if (!smdp || !code) {
    showError('Please enter both SM-DP+ Address and Activation Code');
    return;
  }

  const lpa: LpaData = {
    smdpAddress: smdp,
    activationCode: code,
    confirmationCode: ''
  };

  displayResult(lpa);
});

// Copy link button
copyBtn?.addEventListener('click', async () => {
  const text = generatedUrlCode?.textContent || '';
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  } catch (err) {
    showError('Failed to copy to clipboard.');
  }
});

// WeChat share button
wechatBtn?.addEventListener('click', () => {
  const text = generatedUrlCode?.textContent || '';
  if (text) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
});

// Reset Handler
resetBtn?.addEventListener('click', () => {
  if (resultSection) resultSection.hidden = true;
  if (errorBox) errorBox.hidden = true;
  if (smdpInput) smdpInput.value = '';
  if (codeInput) codeInput.value = '';

  if (html5QrCode && isScannerPaused) {
    try {
      html5QrCode.resume();
      isScannerPaused = false;
    } catch (_) {}
  }
});

retryBtn?.addEventListener('click', () => {
  initScanner();
});

// Auto-start camera scanner
initScanner();
