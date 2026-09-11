import './site';
import store from '../config/store.json';
import assetRevisions from '../config/catalog-assets.json';
import type {ProductViewer,Angle} from './product-viewer';
document.documentElement.classList.add('js');
document.querySelector('[data-year]')!.textContent=String(new Date().getFullYear());
const dialog=document.querySelector<HTMLDialogElement>('#product-dialog')!,poster=document.querySelector<HTMLImageElement>('#product-poster')!,status=document.querySelector<HTMLElement>('.model-status')!;
let canvas=document.querySelector<HTMLCanvasElement>('#product-canvas')!;
let viewer:ProductViewer|undefined,revision=0,active=store.phones[0],trigger:HTMLElement|undefined,overflow='',requestedAngle:Angle='angle';
function angle(a:Angle){requestedAngle=a;poster.src=`/catalog/${active.model}/${a}.webp?v=${assetRevisions[active.model as keyof typeof assetRevisions]}`;poster.alt=`${active.name}, ${a==='rear'?'back':a==='front'?'front':'three-quarter'} view`;for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-angle]'))b.setAttribute('aria-pressed',String(b.dataset.angle===a));viewer?.setAngle(a);}
async function open(id:string,button:HTMLElement){active=store.phones.find(p=>p.id===id)!;trigger=button;const generation=++revision;viewer?.destroy();viewer=undefined;const fresh=canvas.cloneNode(false);canvas.replaceWith(fresh);canvas=fresh as HTMLCanvasElement;canvas.style.opacity='0';poster.style.opacity='1';angle('angle');dialog.querySelector('#product-title')!.textContent=active.name;dialog.querySelector('[data-product-storage]')!.textContent=active.storage;dialog.querySelector('.dialog-price')!.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(active.price);status.textContent='Front, back, and every angle in between.';overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();dialog.scrollTop=0;
 if((navigator as Navigator&{connection?:{saveData?:boolean}}).connection?.saveData){status.textContent='Choose a view below.';return;}
 try{const {createProductViewer}=await import('./product-viewer');if(generation!==revision)return;viewer=createProductViewer(canvas,`/catalog/${active.model}/model.glb?v=${assetRevisions[active.model as keyof typeof assetRevisions]}`,()=>{if(generation!==revision)return;canvas.style.opacity='1';poster.style.opacity='0';status.textContent='Drag to turn. Or choose a view.';dialog.dataset.loaded=active.model;},()=>{if(generation!==revision)return;poster.style.opacity='1';status.textContent='Choose a view below.';delete dialog.dataset.loaded;});viewer.setAngle(requestedAngle);await viewer.ready;}catch{if(generation!==revision)return;viewer?.destroy();viewer=undefined;poster.style.opacity='1';status.textContent='Choose a view below.';}
}
for(const button of document.querySelectorAll<HTMLElement>('[data-product]'))button.addEventListener('click',()=>void open(button.dataset.product!,button));
for(const button of dialog.querySelectorAll<HTMLButtonElement>('[data-angle]'))button.addEventListener('click',()=>angle(button.dataset.angle as Angle));
dialog.querySelector('.dialog-close')!.addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('close',()=>{revision++;viewer?.destroy();viewer=undefined;delete dialog.dataset.loaded;document.body.style.overflow=overflow;trigger?.focus({preventScroll:true});});
addEventListener('pagehide',()=>{revision++;viewer?.destroy();viewer=undefined;delete dialog.dataset.loaded;poster.style.opacity='1';document.body.style.overflow=overflow;if(dialog.open)dialog.close();});
