import './site';
document.documentElement.classList.add('js');
document.querySelector('[data-year]')!.textContent=String(new Date().getFullYear());
const image=document.querySelector<HTMLImageElement>('[data-gallery-image]')!;
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-gallery]'))button.addEventListener('click',()=>{
 image.src=`/stills/${button.dataset.gallery}.webp`;
 image.alt=`${location.pathname.includes('airpods')?'AirPods 4 and case':'Chargers and cable'}, ${button.textContent?.toLowerCase()} view`;
 for(const b of document.querySelectorAll('[data-gallery]'))b.setAttribute('aria-pressed',String(b===button));
});
