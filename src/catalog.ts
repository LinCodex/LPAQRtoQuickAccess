import './site';
import store from '../config/store.json';
import assetRevisions from '../config/catalog-assets.json';
import type { ProductViewer, Angle } from './product-viewer';

document.documentElement.classList.add('js');

const dialog = document.querySelector<HTMLDialogElement>('#product-dialog')!;
const poster = document.querySelector<HTMLImageElement>('#product-poster')!;
const status = document.querySelector<HTMLElement>('.model-status')!;
const loaderBadge = document.querySelector<HTMLElement>('.model-loader');
let canvas = document.querySelector<HTMLCanvasElement>('#product-canvas')!;
let viewer: ProductViewer | undefined;
let revision = 0;
let active = store.phones[0];
let trigger: HTMLElement | undefined;
let requestedAngle: Angle = 'angle';

const ANGLES: Angle[] = ['front', 'angle', 'rear'];

function angle(a: Angle) {
  requestedAngle = a;
  poster.src = `/catalog/${active.model}/${a}.webp?v=${assetRevisions[active.model as keyof typeof assetRevisions]}`;
  poster.alt = `${active.name}, ${a === 'rear' ? 'back' : a === 'front' ? 'front' : 'three-quarter'} view`;
  for (const b of dialog.querySelectorAll<HTMLButtonElement>('[data-angle]')) {
    b.setAttribute('aria-pressed', String(b.dataset.angle === a));
  }
  viewer?.setAngle(a);
}

async function open(id: string, button: HTMLElement) {
  const found = store.phones.find((p) => p.id === id);
  if (!found) return;
  active = found;
  trigger = button;
  const generation = ++revision;

  viewer?.destroy();
  viewer = undefined;
  const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
  canvas.replaceWith(fresh);
  canvas = fresh;
  canvas.style.opacity = '0';
  poster.style.opacity = '1';
  angle('angle');

  dialog.querySelector('#product-title')!.textContent = active.name;
  dialog.querySelector('[data-product-storage]')!.textContent = active.storage;
  const finishEl = dialog.querySelector('[data-product-finish]');
  if (finishEl) finishEl.textContent = active.finish;
  dialog.querySelector('.dialog-price')!.textContent = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(active.price);
  status.textContent = 'Front, back, and every angle in between.';

  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;

  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) {
    status.textContent = 'Choose a view below.';
    if (loaderBadge) loaderBadge.hidden = true;
    return;
  }

  if (loaderBadge) loaderBadge.hidden = false;

  try {
    const { createProductViewer } = await import('./product-viewer');
    if (generation !== revision) return;
    viewer = createProductViewer(
      canvas,
      `/catalog/${active.model}/model.glb?v=${assetRevisions[active.model as keyof typeof assetRevisions]}`,
      () => {
        if (generation !== revision) return;
        if (loaderBadge) loaderBadge.hidden = true;
        canvas.style.opacity = '1';
        poster.style.opacity = '0';
        status.textContent = 'Drag to turn. Or choose a view.';
        dialog.dataset.loaded = active.model;
      },
      () => {
        if (generation !== revision) return;
        if (loaderBadge) loaderBadge.hidden = true;
        poster.style.opacity = '1';
        status.textContent = 'Choose a view below.';
        delete dialog.dataset.loaded;
      }
    );
    viewer.setAngle(requestedAngle);
    await viewer.ready;
  } catch {
    if (generation !== revision) return;
    if (loaderBadge) loaderBadge.hidden = true;
    viewer?.destroy();
    viewer = undefined;
    poster.style.opacity = '1';
    status.textContent = 'Choose a view below.';
  }
}

for (const button of document.querySelectorAll<HTMLElement>('[data-product]')) {
  button.addEventListener('click', () => void open(button.dataset.product!, button));
}

for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-angle]')) {
  button.addEventListener('click', () => angle(button.dataset.angle as Angle));
}

dialog.querySelector('.angle-controls')?.addEventListener('keydown', (event) => {
  const e = event as KeyboardEvent;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const idx = ANGLES.indexOf(requestedAngle);
  const next = ANGLES[(idx + (e.key === 'ArrowRight' ? 1 : -1) + ANGLES.length) % ANGLES.length];
  angle(next);
  dialog.querySelector<HTMLButtonElement>(`[data-angle="${next}"]`)?.focus();
});

dialog.querySelector('.dialog-close')!.addEventListener('click', () => dialog.close());

// Fallback for browsers without <dialog closedby="any"> support (e.g. Safari)
if (!('closedBy' in HTMLDialogElement.prototype)) {
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

dialog.addEventListener('close', () => {
  revision++;
  if (loaderBadge) loaderBadge.hidden = true;
  viewer?.destroy();
  viewer = undefined;
  delete dialog.dataset.loaded;
  trigger?.focus({ preventScroll: true });
});

addEventListener('pagehide', () => {
  revision++;
  if (loaderBadge) loaderBadge.hidden = true;
  viewer?.destroy();
  viewer = undefined;
  delete dialog.dataset.loaded;
  poster.style.opacity = '1';
  if (dialog.open) dialog.close();
});
