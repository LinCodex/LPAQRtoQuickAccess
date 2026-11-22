function normalizePath(pathname: string): string {
  const cleaned = pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '');
  return cleaned || '/';
}

export function initSurfaceMotion() {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
  const setData = () => document.documentElement.toggleAttribute('data-save-data', Boolean(connection?.saveData));
  setData();
  connection?.addEventListener?.('change', setData, { signal });

  const animations = new Set<Animation>();
  const observers: { disconnect(): void }[] = [];
  const frames = new Set<number>();

  function animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const a = el.animate(keyframes, options);
    animations.add(a);
    a.finished.finally(() => animations.delete(a)).catch(() => {});
    return a;
  }

  reduced.addEventListener(
    'change',
    (e) => {
      if (e.matches) {
        for (const a of animations) a.finish();
      }
    },
    { signal }
  );

  const nativeScrollReveal =
    typeof CSS !== 'undefined' && CSS.supports('(animation-timeline: view()) and (animation-range: entry)');

  if (!nativeScrollReveal) {
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            reveal.unobserve(e.target);
            if (reduced.matches || connection?.saveData) continue;
            animate(
              e.target,
              [{ opacity: 0.45, transform: 'translate3d(0,16px,0)' }, { opacity: 1, transform: 'none' }],
              { duration: 500, easing: 'cubic-bezier(.16,1,.3,1)' }
            );
          }
        }
      },
      { threshold: 0.12 }
    );
    document
      .querySelectorAll('.phone-card,.home-phone-card,.essentials-title,.connection-intro>h2,.detail-grid article,.contact-heading,.catalog-heading>h1')
      .forEach((e) => reveal.observe(e));
    observers.push(reveal);
  }

  const menu = document.querySelector<HTMLElement>('#mobile-menu');
  const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
  let scrim: HTMLElement | undefined;
  if (menu && toggle) {
    scrim = document.createElement('div');
    scrim.className = 'menu-scrim';
    scrim.hidden = true;
    scrim.setAttribute('aria-hidden', 'true');
    document.body.append(scrim);
  }

  let open = false;
  let menuAnimation: Animation | undefined;
  let revision = 0;

  function menuState(next: boolean, focus = false) {
    if (!menu || !toggle) return;
    const current = getComputedStyle(menu);
    const fromTransform = menu.hidden ? 'translateY(-8px) scale(.97)' : current.transform;
    const fromOpacity = menu.hidden ? '0' : current.opacity;
    menuAnimation?.cancel();
    const generation = ++revision;
    open = next;
    toggle.setAttribute('aria-expanded', String(next));
    toggle.setAttribute('aria-label', next ? 'Close menu' : 'Open menu');
    if (scrim) scrim.hidden = !next;
    if (!next && (focus || menu.contains(document.activeElement))) {
      toggle.focus({ preventScroll: true });
    }
    menu.inert = !next;
    if (reduced.matches) {
      menu.hidden = !next;
      return;
    }
    menu.hidden = false;
    menuAnimation = animate(
      menu,
      [
        { opacity: fromOpacity, transform: fromTransform },
        { opacity: next ? 1 : 0, transform: next ? 'none' : 'translateY(-6px) scale(.98)' }
      ],
      { duration: next ? 360 : 220, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }
    );
    menuAnimation.finished
      .then(() => {
        if (generation === revision) {
          menu.hidden = !next;
          menuAnimation?.cancel();
          menuAnimation = undefined;
        }
      })
      .catch(() => {});
  }

  toggle?.addEventListener('click', () => menuState(!open), { signal });
  scrim?.addEventListener('click', () => menuState(false), { signal });
  menu?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => menuState(false), { signal }));
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && open) menuState(false, true);
    },
    { signal }
  );
  document.addEventListener(
    'click',
    (e) => {
      if (open && e.target instanceof Node && !menu?.contains(e.target) && !toggle?.contains(e.target)) {
        menuState(false);
      }
    },
    { signal }
  );
  matchMedia('(min-width:960px)').addEventListener(
    'change',
    (e) => {
      if (e.matches) menuState(false);
    },
    { signal }
  );

  const currentPath = normalizePath(location.pathname);

  for (const rail of document.querySelectorAll<HTMLElement>('.angle-controls,.site-header>nav:not(#mobile-menu)')) {
    const isNav = rail.closest('.site-header') !== null;
    const links = [...rail.querySelectorAll<HTMLAnchorElement>('a')];
    const current = links.find((a) => {
      const linkUrl = new URL(a.href, location.href);
      if (linkUrl.hash) return false;
      const linkPath = normalizePath(linkUrl.pathname);
      return linkPath === currentPath && currentPath !== '/';
    });
    current?.setAttribute('aria-current', 'page');

    let hovered: HTMLElement | undefined;
    let activeAnimation: Animation | undefined;
    let pending = 0;
    let initialized = false;
    let last = '';
    const indicator = document.createElement('span');
    indicator.className = 'selection-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.dataset.noTranslate = '';
    rail.prepend(indicator);

    function update() {
      frames.delete(pending);
      pending = 0;
      const active = isNav ? hovered ?? current : rail.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!active || !rail.offsetWidth) {
        indicator.style.opacity = '0';
        return;
      }
      const x = active.offsetLeft;
      const y = active.offsetTop;
      const w = active.offsetWidth;
      const h = active.offsetHeight;
      const key = [x, y, w, h].join(':');
      indicator.style.opacity = '1';
      if (last === key) return;
      last = key;
      const old = indicator.getBoundingClientRect();
      const parent = rail.getBoundingClientRect();
      activeAnimation?.cancel();
      indicator.style.width = `${w}px`;
      indicator.style.height = `${h}px`;
      indicator.style.top = `${y}px`;
      indicator.style.transform = `translateX(${x}px)`;
      indicator.style.transformOrigin = 'left center';
      rail.classList.add('selection-rail');
      if (initialized && !reduced.matches && w > 0) {
        activeAnimation = animate(
          indicator,
          [
            { transform: `translateX(${old.left - parent.left - rail.clientLeft}px) scaleX(${old.width / w})` },
            { transform: `translateX(${x}px) scaleX(1)` }
          ],
          { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' }
        );
      }
      initialized = true;
    }

    const schedule = () => {
      if (!pending) {
        pending = requestAnimationFrame(update);
        frames.add(pending);
      }
    };

    if (isNav) {
      for (const link of links) {
        link.addEventListener(
          'pointerenter',
          () => {
            hovered = link;
            schedule();
          },
          { signal }
        );
        link.addEventListener(
          'focus',
          () => {
            hovered = link;
            schedule();
          },
          { signal }
        );
      }
      rail.addEventListener(
        'pointerleave',
        () => {
          hovered = undefined;
          schedule();
        },
        { signal }
      );
      rail.addEventListener(
        'focusout',
        () => {
          hovered = undefined;
          schedule();
        },
        { signal }
      );
    }

    const mutation = new MutationObserver(schedule);
    mutation.observe(rail, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
      childList: true,
      characterData: true
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(rail);
    observers.push(mutation, resize);
    schedule();
  }

  addEventListener(
    'pagehide',
    (e) => {
      if (!e.persisted) {
        lifecycle.abort();
        scrim?.remove();
        for (const a of animations) a.cancel();
        for (const o of observers) o.disconnect();
        for (const f of frames) cancelAnimationFrame(f);
      }
    },
    { signal }
  );
}
