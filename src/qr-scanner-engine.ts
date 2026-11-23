import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

const ZXING_OVERRIDES = {
  locateFile: (path: string) => (path.endsWith('.wasm') ? zxingReaderWasmUrl : path)
};

// Register local WASM path immediately so zxing-wasm never attempts an external CDN fetch blocked by CSP.
prepareZXingModule({ overrides: ZXING_OVERRIDES });

let zxingInitPromise: Promise<unknown> | null = null;

function ensureZXingReady(): Promise<unknown> {
  if (!zxingInitPromise) {
    zxingInitPromise = prepareZXingModule({
      overrides: ZXING_OVERRIDES,
      fireImmediately: true
    }).catch((err) => {
      zxingInitPromise = null;
      throw err;
    });
  }
  return zxingInitPromise;
}

const QR_READER_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4
};

const SCAN_INTERVAL_MS = 40;
const MAX_DECODE_DIM = 960;
const MAX_FILE_DIM = 1600;

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorConstructorLike {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

interface ExtendedMediaTrackCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  exposureMode?: string[];
  torch?: boolean;
}

let cachedDetectorPromise: Promise<BarcodeDetectorLike | null> | null = null;

function getNativeQrDetector(): Promise<BarcodeDetectorLike | null> {
  if (cachedDetectorPromise) return cachedDetectorPromise;
  cachedDetectorPromise = (async () => {
    const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructorLike }).BarcodeDetector;
    if (!Ctor) return null;
    try {
      if (typeof Ctor.getSupportedFormats === 'function') {
        const supported = await Ctor.getSupportedFormats();
        if (!supported.includes('qr_code')) return null;
      }
      return new Ctor({ formats: ['qr_code'] });
    } catch {
      return null;
    }
  })();
  return cachedDetectorPromise;
}

function dedupeTexts(values: Iterable<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const val of values) {
    const trimmed = typeof val === 'string' ? val.trim() : '';
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

async function acquireCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    throw new Error('Camera API unavailable in this browser.');
  }

  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 }
      }
    },
    {
      audio: false,
      video: { facingMode: { ideal: 'environment' } }
    },
    {
      audio: false,
      video: true
    }
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const errName = (err as { name?: string })?.name;
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errName === 'SecurityError') {
        throw err;
      }
    }
  }
  throw lastError || new Error('Unable to access camera.');
}

async function applyTrackFocusAndExposure(track: MediaStreamTrack): Promise<boolean> {
  if (typeof track.getCapabilities !== 'function') return false;
  let caps: ExtendedMediaTrackCapabilities;
  try {
    caps = track.getCapabilities() as ExtendedMediaTrackCapabilities;
  } catch {
    return false;
  }

  const advanced: Array<Record<string, unknown>> = [];
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
    advanced.push({ focusMode: 'continuous' });
  }
  if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
    advanced.push({ exposureMode: 'continuous' });
  }
  if (advanced.length > 0 && typeof track.applyConstraints === 'function') {
    await track.applyConstraints({ advanced: advanced as MediaTrackConstraintSet[] }).catch(() => {});
  }

  return Boolean(caps.torch);
}

function createViewfinderOverlay(): HTMLDivElement {
  const guide = document.createElement('div');
  guide.className = 'qr-viewfinder-guide';
  guide.setAttribute('aria-hidden', 'true');
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const span = document.createElement('span');
    span.className = `qr-vf-corner is-${corner}`;
    guide.appendChild(span);
  }
  return guide;
}

async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) {
    await video.play().catch(() => {});
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      window.clearTimeout(timer);
    };
    const onReady = () => {
      if (settled || video.videoWidth === 0) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Camera video stream failed to initialize.'));
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      if (video.videoWidth > 0) resolve();
      else reject(new Error('Timed out waiting for camera video frames.'));
    }, 6000);

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
  });

  await video.play();
}

export interface FastQrCameraScannerOptions {
  container: HTMLElement;
  /** Called with all unique decoded QR strings from a frame; return true if accepted to stop scanning. */
  onDecode: (texts: string[]) => boolean;
  onTorchAvailable?: (available: boolean) => void;
}

/**
 * High-speed full-frame + center-crop QR scanner combining native GPU BarcodeDetector
 * and local C++ zxing-wasm WASM decoding with continuous autofocus.
 */
export class FastQrCameraScanner {
  private readonly container: HTMLElement;
  private readonly onDecode: (texts: string[]) => boolean;
  private readonly onTorchAvailable?: (available: boolean) => void;

  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private track: MediaStreamTrack | null = null;
  private guideEl: HTMLDivElement | null = null;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;

  private rafId = 0;
  private lastScanAt = 0;
  private frameIndex = 0;
  private decoding = false;
  private active = false;
  private paused = false;
  private stopped = true;
  private torchOn = false;
  private nativeDetectorDisabled = false;
  private refocusTimer = 0;

  constructor(opts: FastQrCameraScannerOptions) {
    this.container = opts.container;
    this.onDecode = opts.onDecode;
    this.onTorchAvailable = opts.onTorchAvailable;
  }

  public isActive(): boolean {
    return this.active;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public isTorchOn(): boolean {
    return this.torchOn;
  }

  public async start(): Promise<void> {
    await this.stop();
    this.stopped = false;
    this.paused = false;
    this.torchOn = false;
    this.frameIndex = 0;
    this.lastScanAt = 0;
    this.nativeDetectorDisabled = false;

    const wasmWarmup = ensureZXingReady().catch((err) => {
      console.warn('zxing-wasm prewarm warning:', err);
    });
    const detectorPromise = getNativeQrDetector();

    let stream: MediaStream;
    try {
      stream = await acquireCameraStream();
    } catch (err) {
      this.stopped = true;
      throw err;
    }

    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.stream = stream;
    this.track = stream.getVideoTracks()[0] || null;
    if (this.track) {
      const hasTorch = await applyTrackFocusAndExposure(this.track);
      this.onTorchAvailable?.(hasTorch);
    } else {
      this.onTorchAvailable?.(false);
    }

    const video = document.createElement('video');
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.muted = true;
    video.setAttribute('muted', 'true');
    video.autoplay = true;
    video.srcObject = stream;
    video.addEventListener('click', () => {
      void this.triggerRefocus();
    });

    const guide = createViewfinderOverlay();
    this.container.replaceChildren(video, guide);
    this.video = video;
    this.guideEl = guide;

    await waitForVideoReady(video);
    if (this.stopped) {
      await this.stop();
      return;
    }

    const nativeDetector = await detectorPromise;
    if (!nativeDetector) {
      await wasmWarmup;
    }

    this.active = true;
    this.scheduleLoop();
  }

  public pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    try {
      this.video?.pause();
    } catch {
      // Ignore video pause errors
    }
  }

  public async resume(): Promise<boolean> {
    if (!this.active || !this.video || !this.track || this.track.readyState !== 'live') {
      return false;
    }
    this.paused = false;
    this.decoding = false;
    this.lastScanAt = 0;
    try {
      await this.video.play();
    } catch {
      return false;
    }
    this.scheduleLoop();
    return true;
  }

  public async toggleTorch(): Promise<boolean> {
    if (!this.track || typeof this.track.applyConstraints !== 'function') return false;
    const next = !this.torchOn;
    try {
      await this.track.applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet]
      });
      this.torchOn = next;
      return true;
    } catch {
      return false;
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.active = false;
    this.paused = false;
    this.decoding = false;
    this.torchOn = false;
    window.clearTimeout(this.refocusTimer);

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      }
      this.stream = null;
    }
    this.track = null;

    if (this.video) {
      try {
        this.video.pause();
        this.video.srcObject = null;
      } catch {
        // Ignore cleanup errors
      }
      this.video = null;
    }

    this.guideEl = null;
    this.offscreenCtx = null;
    this.offscreenCanvas = null;
    this.container.replaceChildren();
    this.onTorchAvailable?.(false);
  }

  private async triggerRefocus(): Promise<void> {
    if (!this.track || this.paused || typeof this.track.getCapabilities !== 'function') return;
    this.guideEl?.classList.add('is-refocusing');
    window.clearTimeout(this.refocusTimer);
    this.refocusTimer = window.setTimeout(() => {
      this.guideEl?.classList.remove('is-refocusing');
    }, 400);

    try {
      const caps = this.track.getCapabilities() as ExtendedMediaTrackCapabilities;
      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('single-shot')) {
          await this.track.applyConstraints({
            advanced: [{ focusMode: 'single-shot' } as unknown as MediaTrackConstraintSet]
          });
        }
        if (caps.focusMode.includes('continuous')) {
          await this.track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet]
          });
        }
      }
    } catch {
      // Refocus constraints are optional across camera drivers
    }
  }

  private scheduleLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const tick = (now: number) => {
      this.rafId = 0;
      if (this.stopped || !this.active || this.paused) return;

      if (!this.decoding && !document.hidden && now - this.lastScanAt >= SCAN_INTERVAL_MS) {
        this.lastScanAt = now;
        this.decoding = true;
        void this.scanFrame().finally(() => {
          this.decoding = false;
        });
      }

      if (!this.stopped && this.active && !this.paused) {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private ensureCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.offscreenCanvas || !this.offscreenCtx) return null;
    return { canvas: this.offscreenCanvas, ctx: this.offscreenCtx };
  }

  private async scanFrame(): Promise<void> {
    const video = this.video;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    // Pass 1: Hardware-accelerated native BarcodeDetector when available
    if (!this.nativeDetectorDisabled) {
      const detector = await getNativeQrDetector();
      if (detector && !this.stopped && this.active && !this.paused) {
        try {
          const detected = await detector.detect(video);
          const texts = dedupeTexts(detected.map((item) => item.rawValue));
          if (texts.length > 0 && !this.stopped && !this.paused) {
            if (this.onDecode(texts)) return;
          }
        } catch {
          this.nativeDetectorDisabled = true;
        }
      }
    }

    if (this.stopped || !this.active || this.paused) return;

    // Pass 2: Local C++ zxing-wasm reader alternating between full frame (2/3) and center native crop (1/3)
    const surfaces = this.ensureCanvas();
    if (!surfaces) return;
    const { canvas, ctx } = surfaces;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const isCenterCrop = this.frameIndex % 3 === 2;
    this.frameIndex += 1;

    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    if (isCenterCrop) {
      sw = Math.max(1, Math.round(vw * 0.65));
      sh = Math.max(1, Math.round(vh * 0.65));
      sx = Math.round((vw - sw) / 2);
      sy = Math.round((vh - sh) / 2);
    }

    const scale = Math.min(1, MAX_DECODE_DIM / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    if (canvas.width !== dw) canvas.width = dw;
    if (canvas.height !== dh) canvas.height = dh;

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    const imageData = ctx.getImageData(0, 0, dw, dh);

    try {
      await ensureZXingReady();
      if (this.stopped || !this.active || this.paused) return;
      const results = await readBarcodes(imageData, QR_READER_OPTIONS);
      const texts = dedupeTexts(results.map((r) => r.text));
      if (texts.length > 0 && !this.stopped && !this.paused) {
        this.onDecode(texts);
      }
    } catch {
      // Ignore single-frame decode failure and continue scanning
    }
  }
}

async function decodeImageFallback(file: File): Promise<string[]> {
  let bitmap: ImageBitmap | null = null;
  let imgEl: HTMLImageElement | null = null;
  let objectUrl: string | null = null;

  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
    } else {
      objectUrl = URL.createObjectURL(file);
      imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = objectUrl!;
      });
    }

    const srcWidth = bitmap ? bitmap.width : imgEl!.naturalWidth || imgEl!.width;
    const srcHeight = bitmap ? bitmap.height : imgEl!.naturalHeight || imgEl!.height;
    if (!srcWidth || !srcHeight) return [];

    const scale = Math.min(1, MAX_FILE_DIM / Math.max(srcWidth, srcHeight));
    const drawW = Math.max(1, Math.round(srcWidth * scale));
    const drawH = Math.max(1, Math.round(srcHeight * scale));
    const pad = 24;

    const canvas = document.createElement('canvas');
    canvas.width = drawW + pad * 2;
    canvas.height = drawH + pad * 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (bitmap) {
      ctx.drawImage(bitmap, 0, 0, srcWidth, srcHeight, pad, pad, drawW, drawH);
    } else if (imgEl) {
      ctx.drawImage(imgEl, 0, 0, srcWidth, srcHeight, pad, pad, drawW, drawH);
    }

    const detector = await getNativeQrDetector();
    if (detector) {
      try {
        const detected = await detector.detect(canvas);
        const texts = dedupeTexts(detected.map((item) => item.rawValue));
        if (texts.length > 0) return texts;
      } catch {
        // Continue to WASM reader fallback
      }
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    await ensureZXingReady();
    const results = await readBarcodes(imageData, QR_READER_OPTIONS);
    return dedupeTexts(results.map((r) => r.text));
  } catch {
    return [];
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** Decodes all QR code strings from an uploaded image or screen capture file. */
export async function decodeQrFromFile(file: File): Promise<string[]> {
  try {
    await ensureZXingReady();
    const direct = await readBarcodes(file, QR_READER_OPTIONS);
    const texts = dedupeTexts(direct.map((r) => r.text));
    if (texts.length > 0) return texts;
  } catch {
    // Fall through to canvas quiet-zone + native BarcodeDetector fallback
  }

  return decodeImageFallback(file);
}
