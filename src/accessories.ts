import './site';

document.documentElement.classList.add('js');

const image = document.querySelector<HTMLImageElement>('[data-gallery-image]');
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-gallery]')];

if (image) {
  for (const button of buttons) {
    button.addEventListener('click', () => {
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.src = `/stills/${button.dataset.gallery}.webp`;
      const isAirpods = location.pathname.includes('airpods');
      const viewName = button.dataset.gallery || '';
      if (isAirpods) {
        image.alt =
          viewName === 'airpods-closed'
            ? 'AirPods 4 and closed standard USB-C charging case'
            : viewName === 'airpods-rear'
              ? 'AirPods 4 and standard charging case, back view'
              : 'AirPods 4 and standard charging case';
      } else {
        image.alt =
          viewName === 'accessories-charger-c-port'
            ? 'Unbranded white USB-C charger port view'
            : viewName === 'accessories-charger-a-plug'
              ? 'Unbranded white USB-A charger plug view'
              : 'Unbranded white chargers and cable';
      }
      for (const b of buttons) {
        b.setAttribute('aria-pressed', String(b === button));
      }
    });
  }
}
