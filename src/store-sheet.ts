import store from '../config/store.json';

type OfferingKey = 'accessories' | 'contact';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initStoreSheet(dialog: HTMLDialogElement) {
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

  function open(key: OfferingKey) {
    dialog.replaceChildren();

    const head = el('div', 'sheet-head');
    const title = el('h2');
    const closeBtn = el('button', 'sheet-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => dialog.close());
    head.append(title, closeBtn);
    dialog.append(head);

    const rows = el('div', 'sheet-rows');

    if (key === 'accessories') {
      title.textContent = 'Chargers, Cables & AirPods';
      const items: [string, string][] = [
        ['AirPods 4', 'USB-C case'],
        ['Chargers & Cables (USB-C, USB-A, Lightning)', 'In store'],
        ['Screen Protector + Install', `$${store.screenProtector.price}`]
      ];
      for (const [label, meta] of items) {
        const row = el('div', 'sheet-row');
        row.append(el('span', undefined, label), el('strong', undefined, meta));
        rows.append(row);
      }
      dialog.append(rows);

      const actions = el('div', 'sheet-actions');
      actions.style.marginTop = '16px';
      const explore = el('a', 'lpa-secondary-btn', 'Explore accessories');
      explore.style.marginTop = '0';
      explore.href = '/accessories/';
      const callBtn = el('a', 'lpa-primary-btn', 'Call the store');
      callBtn.href = `tel:${store.phone}`;
      actions.append(explore, callBtn);
      dialog.append(actions);
    } else {
      title.textContent = 'Visit Store';
      const lines: [string, string][] = [
        ['FIND US', store.address],
        ['COME BY', store.hours],
        ['LET’S TALK', '(718) 509-5888']
      ];
      for (const [label, val] of lines) {
        const row = el('div', 'sheet-row');
        row.append(el('span', undefined, label), el('strong', undefined, val));
        rows.append(row);
      }
      dialog.append(rows);

      const actions = el('div', 'sheet-actions');
      const callBtn = el('a', 'lpa-secondary-btn', 'Call the store');
      callBtn.style.marginTop = '0';
      callBtn.href = `tel:${store.phone}`;
      const mapsBtn = el('a', 'lpa-primary-btn', 'Get directions ↗');
      mapsBtn.href = 'https://www.google.com/maps/search/?api=1&query=136-78%20Roosevelt%20Ave%2C%20Flushing%2C%20NY';
      mapsBtn.target = '_blank';
      mapsBtn.rel = 'noopener noreferrer';
      actions.append(callBtn, mapsBtn);
      dialog.append(actions);
    }

    if (!dialog.open) dialog.showModal();
  }

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-offering]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.offering as OfferingKey | undefined;
      if (key === 'accessories' || key === 'contact') open(key);
    });
  }
}
