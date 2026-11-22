import './site';
import { createScrollSequence } from './scroll-sequence';
import { initPlans } from './plans';

document.documentElement.classList.add('js');

const smooth = (a: number, b: number, p: number) => {
  const t = Math.max(0, Math.min(1, (p - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const mobileStageQuery = matchMedia('(max-width: 767px)');

const controllers = [...document.querySelectorAll<HTMLElement>('[data-sequence]')].map((container) => {
  const id = container.dataset.sequence!;
  const line = container.querySelector<HTMLElement>('.progress-track i');
  const mast = container.querySelector<HTMLElement>('.hero-masthead');
  const opening = container.querySelector<HTMLElement>('.hero-opening');
  const narrative = container.querySelector<HTMLElement>('.hero-narrative');
  const stageEl = container.querySelector<HTMLElement>('.product-stage');
  let openingHidden = false;
  let narrativeHidden = true;

  container.addEventListener('sequence-progress', (event) => {
    const { progress } = (event as CustomEvent).detail;
    const unfold = smooth(0.08, 0.4, progress);

    if (line) line.style.transform = `scaleX(${progress.toFixed(5)})`;

    if (id === 'hero' && stageEl) {
      if (mobileStageQuery.matches) {
        const ty = unfold * 7 - Math.max(0, (progress - 0.5) * 8);
        const sc = 1 - unfold * 0.08;
        stageEl.style.transform = `translate3d(0,${ty.toFixed(3)}vh,0) scale(${sc.toFixed(4)})`;
      } else {
        const tx = (1 - unfold) * 5;
        const ty = -progress;
        const sc = 0.95 + unfold * 0.05;
        stageEl.style.transform = `translate3d(${tx.toFixed(3)}vw,${ty.toFixed(3)}vh,0) scale(${sc.toFixed(4)})`;
      }
    } else if (id === 'airpods' && stageEl) {
      const delta = progress - 0.5;
      stageEl.style.transform = mobileStageQuery.matches
        ? `translate3d(0,${(delta * -3).toFixed(3)}vh,0)`
        : `translate3d(${(delta * 3).toFixed(3)}vw,${(delta * -3).toFixed(3)}vh,0)`;
    }

    if (mast && opening && narrative) {
      const out = smooth(0.015, 0.24, progress);
      const intro = smooth(0.17, 0.39, progress);
      mast.style.opacity = String(1 - out);
      mast.style.transform = `translate3d(0,${(-out * 85).toFixed(2)}px,0)`;
      opening.style.opacity = String(1 - out);
      opening.style.transform = `translate3d(0,${(-out * 25).toFixed(2)}px,0)`;
      const nextOpeningHidden = out > 0.98;
      if (nextOpeningHidden !== openingHidden) {
        openingHidden = nextOpeningHidden;
        opening.style.visibility = nextOpeningHidden ? 'hidden' : 'visible';
        opening.inert = nextOpeningHidden;
      }

      narrative.style.opacity = String(intro);
      narrative.style.transform = `translate3d(0,${((1 - intro) * 45).toFixed(2)}px,0)`;
      const nextNarrativeHidden = intro < 0.02;
      if (nextNarrativeHidden !== narrativeHidden) {
        narrativeHidden = nextNarrativeHidden;
        narrative.style.visibility = nextNarrativeHidden ? 'hidden' : 'visible';
        narrative.inert = nextNarrativeHidden;
      }
    }
  });

  return createScrollSequence({
    container,
    canvas: container.querySelector('canvas')!,
    manifestUrl: `/sequences/${id}/manifest.json`
  });
});

(window as Window & { sequenceControllers?: typeof controllers }).sequenceControllers = controllers;

initPlans();

// Use native CSS Scroll-Driven Animations where supported; fall back to RAF scroll listener otherwise.
const supportsScrollTimeline =
  typeof CSS !== 'undefined' && CSS.supports('(animation-timeline: view()) and (animation-range: entry)');
const motion = matchMedia('(prefers-reduced-motion:reduce)');
let reduced = motion.matches;
const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
const stills = [...document.querySelectorAll<HTMLElement>('[data-parallax]')];
let parallaxFrame = 0;
const lifecycle = new AbortController();

function parallax() {
  parallaxFrame = 0;
  for (const img of stills) {
    const r = img.parentElement!.getBoundingClientRect();
    if (r.top > innerHeight + 100 || r.bottom < -100) continue;
    const p = Math.max(0, Math.min(1, (innerHeight - r.top) / (innerHeight + r.height)));
    img.style.transform = reduced || connection?.saveData ? '' : `translate3d(0,${(p - 0.5) * 42}px,0)`;
  }
}

function schedule() {
  if (!parallaxFrame) parallaxFrame = requestAnimationFrame(parallax);
}

if (!supportsScrollTimeline && stills.length > 0) {
  addEventListener('scroll', schedule, { passive: true, signal: lifecycle.signal });
  addEventListener('resize', schedule, { passive: true, signal: lifecycle.signal });
  motion.addEventListener(
    'change',
    (e) => {
      reduced = e.matches;
      schedule();
    },
    { signal: lifecycle.signal }
  );
  connection?.addEventListener('change', schedule, { signal: lifecycle.signal });
  schedule();
}

addEventListener('pagehide', (e) => {
  if (!e.persisted) {
    controllers.forEach((c) => c.destroy());
    lifecycle.abort();
    cancelAnimationFrame(parallaxFrame);
  }
});
