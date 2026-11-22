import { BitmapCache, frameForProgress } from './cache';
import { sequenceMemory, type MemoryClient } from './memory-budget';

export interface Profile {
  frames: string[];
  frameCount: number;
  width: number;
  height: number;
  poster: string;
  bytes?: number;
}

export interface SequenceManifest {
  version: 1;
  id: string;
  background: string;
  chapters: { start: number; end: number; label: string }[];
  profiles: { desktop: Profile; mobile: Profile };
}

export interface SequenceOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  manifestUrl: string;
}

export interface SequenceController {
  setProgress(progress: number): void;
  destroy(): void;
  readonly ready: Promise<void>;
  readonly diagnostics: {
    decodedBytes: number;
    cacheSize: number;
    frame: number;
    static: boolean;
    reservedDecodeBytes: number;
    cacheBudget: number;
    profile: 'desktop' | 'mobile' | null;
    encodedBytes: number;
    target: number;
    draws: number;
  };
}

type Connection = EventTarget & { saveData?: boolean };

export function createScrollSequence({ container, canvas, manifestUrl }: SequenceOptions): SequenceController {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw Error('Canvas 2D is unavailable.');
  const manifestURL = new URL(manifestUrl, document.baseURI);
  const lifecycle = new AbortController();
  const media = matchMedia('(max-width: 767px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // Use event.matches after initialization: polling the getter can suppress a
  // queued Chromium media-query notification during a resize.
  let mobileMode = media.matches;
  let reducedMode = reduced.matches;
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  let saveDataMode = Boolean(connection?.saveData);

  const cache = new BitmapCache<ImageBitmap>(0);
  const encoded = new BitmapCache<{ blob: Blob; close(): void }>(36 * 1024 * 1024);
  const pending = new Map<number, AbortController>();
  const decoding = new Set<number>();
  const attempts = new Map<number, number>();

  let manifest: SequenceManifest | undefined;
  let profile: Profile | undefined;
  let progress = 0;
  let desired = 0;
  let previous = 0;
  let direction = 1;
  let drawn = -1;
  let epoch = 0;
  let raf = 0;
  let draws = 0;
  let destroyed = false;
  let visible = false;
  let failed = false;
  let manual = false;
  let activeDecodes = 0;
  let lastEvent = -1;
  let decodeWidth = 1;
  let decodeHeight = 1;
  let lastTick = 0;

  // Cached layout geometry so scroll ticks read only window.scrollY without forcing reflow
  let sectionTop = 0;
  let sectionHeight = 1;
  let scrollRange = 1;

  const poster = container.querySelector<HTMLImageElement>('[data-poster]') ?? document.createElement('img');
  if (!poster.parentNode) {
    poster.alt = '';
    poster.dataset.poster = '';
    canvas.before(poster);
  }

  const memory: MemoryClient = {
    active: false,
    limit: 144 * 1024 * 1024,
    reserved: 0,
    resize(bytes) {
      cache.setBudget(bytes, desired);
    }
  };
  sequenceMemory.add(memory);

  function measure() {
    const rect = container.getBoundingClientRect();
    sectionTop = rect.top + window.scrollY;
    sectionHeight = Math.max(1, container.offsetHeight);
    scrollRange = Math.max(1, sectionHeight - innerHeight);
  }

  function isStatic() {
    return reducedMode || saveDataMode || failed;
  }

  function sourceBytes() {
    return manifest ? Math.max(...Object.values(manifest.profiles).map((p) => p.width * p.height * 4)) : 0;
  }

  function updateMemory() {
    if (destroyed && !activeDecodes) {
      sequenceMemory.delete(memory);
      return;
    }
    memory.active = Boolean(profile && visible && !isStatic() && !destroyed) || activeDecodes > 0;
    memory.limit = (mobileMode ? 80 : 144) * 1024 * 1024;
    // Reserve full source surfaces even when the decoder downsamples its output.
    memory.reserved = 2 * sourceBytes();
    sequenceMemory.rebalance();
  }

  function cancelWork() {
    epoch++;
    for (const c of pending.values()) c.abort();
    pending.clear();
    decoding.clear();
  }

  function setVisible(next: boolean) {
    if (next === visible) return;
    visible = next;
    if (!visible) cancelWork();
    updateMemory();
  }

  function staticState() {
    const disabled = isStatic();
    container.classList.toggle('is-static', disabled);
    container.dispatchEvent(new CustomEvent('sequence-mode', { detail: { static: disabled } }));
    if (disabled) {
      cancelWork();
      cache.clear();
      encoded.clear();
      canvas.style.opacity = '0';
      poster.style.opacity = '1';
      drawn = -1;
      updateMemory();
    } else if (profile) {
      selectProfile();
    }
    measure();
    schedule();
  }

  function resize() {
    measure();
    if (!profile) return;
    // Layout dimensions exclude scroll transforms. A resize must not change
    // decode resolution simply because the phone is currently scaled down.
    const rect = { width: canvas.clientWidth, height: canvas.clientHeight };
    const dpr = Math.min(devicePixelRatio || 1, mobileMode ? 1.5 : 1.25);
    const factor = Math.min(1, (rect.width * dpr) / profile.width, (rect.height * dpr) / profile.height);
    const width = Math.max(1, Math.round(profile.width * factor));
    const height = Math.max(1, Math.round(profile.height * factor));
    if (width === decodeWidth && height === decodeHeight) return;
    decodeWidth = width;
    decodeHeight = height;
    cancelWork();
    cache.clear();
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    canvas.width = width;
    canvas.height = height;
    ctx!.drawImage(copy, 0, 0, width, height);
    copy.width = copy.height = 0;
    drawn = -1;
    updateMemory();
  }

  function selectProfile() {
    if (!manifest || destroyed) return;
    cancelWork();
    attempts.clear();
    cache.clear();
    encoded.clear();
    profile = manifest.profiles[mobileMode ? 'mobile' : 'desktop'];
    encoded.setBudget((mobileMode ? 18 : 36) * 1024 * 1024);
    // Authored <picture> sources provide the correct first poster before JS.
    poster.src = new URL(profile.poster, manifestURL).href;
    poster.style.opacity = '1';
    canvas.style.opacity = '0';
    drawn = -1;
    resize();
    updateMemory();
    schedule();
  }

  function draw() {
    if (destroyed || isStatic() || !visible || document.hidden) return;
    let candidate = desired;
    if (!cache.has(candidate)) {
      // Show a closer completed frame while the newest target is decoding.
      // Never jump backwards to a stale request merely because it finished last.
      let distance = drawn < 0 ? Infinity : Math.abs(drawn - desired);
      candidate = -1;
      for (const key of cache.keys()) {
        const gap = Math.abs(key - desired);
        if (gap < distance) {
          candidate = key;
          distance = gap;
        }
      }
    }
    if (candidate < 0 || candidate === drawn) return;
    const bitmap = cache.get(candidate);
    if (!bitmap) return;
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    drawn = candidate;
    draws++;
    canvas.style.opacity = '1';
    poster.style.opacity = '0';
    container.dataset.frame = String(candidate);
  }

  function priorities(ahead: number, behind: number) {
    if (!profile) return [];
    const list = [desired];
    for (let i = 1; i <= Math.max(ahead, behind); i++) {
      if (i <= ahead) list.push(desired + i * direction);
      if (i <= behind) list.push(desired - i * direction);
    }
    return list.filter((n) => n >= 0 && n < profile!.frameCount);
  }

  function fail(frame: number, error: unknown) {
    attempts.set(frame, (attempts.get(frame) ?? 0) + 1);
    if (frame === desired && (attempts.get(frame) ?? 0) >= 2) {
      failed = true;
      container.dataset.error = String(error);
      staticState();
    }
  }

  function pump() {
    if (!profile || destroyed || isStatic() || !visible || document.hidden) return;
    if ((attempts.get(desired) ?? 0) >= 2) {
      failed = true;
      staticState();
      return;
    }
    const bytes = decodeWidth * decodeHeight * 4;
    const slots = Math.min(48, Math.max(0, Math.floor(cache.budget / bytes) - 1));
    const decodeOrder = priorities(Math.max(0, slots - 4), Math.min(4, Math.max(0, slots - 1)));

    for (const frame of priorities(40, 12)) {
      if (pending.size >= 6) break;
      if (encoded.has(frame) || pending.has(frame) || (attempts.get(frame) ?? 0) >= 2) continue;
      const controller = new AbortController();
      const generation = epoch;
      const selected = profile;
      pending.set(frame, controller);
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 8000);
      void fetch(new URL(selected.frames[frame], manifestURL), { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw Error(`Frame ${frame}: HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          if (destroyed || generation !== epoch || controller.signal.aborted) return;
          encoded.put(frame, { blob, close() {} }, blob.size, desired);
        })
        .catch((error) => {
          if (!destroyed && generation === epoch && (!controller.signal.aborted || timedOut)) fail(frame, error);
        })
        .finally(() => {
          clearTimeout(timeout);
          if (pending.get(frame) === controller) pending.delete(frame);
          pump();
        });
    }

    for (const frame of decodeOrder) {
      if (activeDecodes >= 4 || slots < 1) break;
      if (cache.has(frame) || decoding.has(frame)) continue;
      const packed = encoded.get(frame);
      if (!packed) continue;
      const generation = epoch;
      const width = decodeWidth;
      const height = decodeHeight;
      decoding.add(frame);
      activeDecodes++;
      void createImageBitmap(packed.blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
        .then((bitmap) => {
          if (destroyed || generation !== epoch) {
            bitmap.close();
            return;
          }
          attempts.delete(frame);
          cache.put(frame, bitmap, bitmap.width * bitmap.height * 4, desired);
          draw();
        })
        .catch((error) => {
          if (!destroyed && generation === epoch) {
            encoded.delete(frame);
            fail(frame, error);
          }
        })
        .finally(() => {
          activeDecodes--;
          if (generation === epoch) decoding.delete(frame);
          updateMemory();
          pump();
        });
    }
  }

  function update(p: number) {
    progress = isStatic() ? 0 : Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
    if (!profile || destroyed) return;
    desired = frameForProgress(progress, profile.frameCount);
    direction = desired === previous ? direction : desired > previous ? 1 : -1;
    previous = desired;
    if (progress !== lastEvent) {
      lastEvent = progress;
      const chapterIndex = manifest!.chapters.findIndex((c) => progress >= c.start && (progress < c.end || c.end === 1));
      container.dispatchEvent(
        new CustomEvent('sequence-progress', {
          detail: {
            progress,
            frame: desired,
            chapter: manifest!.chapters[chapterIndex],
            chapterIndex,
            chapterCount: manifest!.chapters.length
          }
        })
      );
    }
    if (isStatic() || !visible) return;
    draw();
    pump();
  }

  function onFrame(now: number) {
    raf = 0;
    if (destroyed) return;
    const top = sectionTop - window.scrollY;
    const bottom = top + sectionHeight;
    setVisible(!document.hidden && top < innerHeight + 150 && bottom > -150);
    const target = Math.max(0, Math.min(1, -top / scrollRange));
    const dt = lastTick ? Math.max(4, Math.min(32, now - lastTick)) : 16;
    lastTick = now;
    const next = manual || isStatic() ? progress : progress + (target - progress) * (1 - Math.exp(-dt / 22));
    const settled = Math.abs(target - next) < 0.00015;
    update(manual ? progress : settled ? target : next);
    if (visible && !manual && !isStatic() && !settled) schedule();
  }

  function schedule() {
    if (!raf && !destroyed) raf = requestAnimationFrame(onFrame);
  }

  measure();
  const observer = new IntersectionObserver(
    () => {
      measure();
      schedule();
    },
    { rootMargin: '150px' }
  );
  observer.observe(container);
  const resizeObserver = new ResizeObserver(() => {
    resize();
    schedule();
  });
  resizeObserver.observe(container);
  resizeObserver.observe(canvas);
  document.fonts?.ready.then(() => {
    if (!destroyed) {
      measure();
      schedule();
    }
  });
  addEventListener('scroll', schedule, { passive: true, signal: lifecycle.signal });
  addEventListener(
    'resize',
    () => {
      measure();
      schedule();
    },
    { passive: true, signal: lifecycle.signal }
  );
  addEventListener(
    'pageshow',
    () => {
      measure();
      schedule();
    },
    { signal: lifecycle.signal }
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
        setVisible(false);
      } else {
        lastTick = 0;
        measure();
        schedule();
      }
    },
    { signal: lifecycle.signal }
  );
  media.addEventListener(
    'change',
    (event) => {
      mobileMode = event.matches;
      selectProfile();
    },
    { signal: lifecycle.signal }
  );
  reduced.addEventListener(
    'change',
    (event) => {
      reducedMode = event.matches;
      staticState();
    },
    { signal: lifecycle.signal }
  );
  connection?.addEventListener(
    'change',
    () => {
      const next = Boolean(connection.saveData);
      if (next === saveDataMode) return;
      saveDataMode = next;
      staticState();
    },
    { signal: lifecycle.signal }
  );

  staticState();

  const manifestTimeout = setTimeout(() => {
    if (!manifest && !destroyed) {
      failed = true;
      staticState();
      lifecycle.abort();
    }
  }, 8000);

  const ready = fetch(manifestURL, { signal: lifecycle.signal })
    .then((res) => {
      if (!res.ok) throw Error('Sequence manifest unavailable');
      return res.json();
    })
    .then((m: SequenceManifest) => {
      if (destroyed) return;
      if (m.version !== 1 || !m.profiles || !m.chapters?.length) throw Error('Invalid sequence manifest');
      for (const p of Object.values(m.profiles)) {
        if (p.frameCount < 1 || p.frames.length !== p.frameCount || p.width < 1 || p.height < 1) {
          throw Error('Invalid sequence profile');
        }
      }
      manifest = m;
      selectProfile();
    })
    .catch((error) => {
      if (!destroyed) {
        failed = true;
        container.dataset.error = String(error);
        staticState();
      }
    })
    .finally(() => clearTimeout(manifestTimeout));

  return {
    ready,
    setProgress(p) {
      manual = true;
      const top = sectionTop - window.scrollY;
      setVisible(top < innerHeight + 150 && top + sectionHeight > -150);
      update(p);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelWork();
      lifecycle.abort();
      clearTimeout(manifestTimeout);
      cache.clear();
      encoded.clear();
      updateMemory();
      observer.disconnect();
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    get diagnostics() {
      return {
        decodedBytes: cache.bytes,
        cacheSize: cache.size,
        frame: drawn,
        static: isStatic(),
        reservedDecodeBytes: activeDecodes * sourceBytes(),
        cacheBudget: cache.budget,
        profile: profile ? (profile === manifest?.profiles.mobile ? ('mobile' as const) : ('desktop' as const)) : null,
        encodedBytes: encoded.bytes,
        target: desired,
        draws
      };
    }
  };
}
