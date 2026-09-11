import './site';
import {createScrollSequence} from './scroll-sequence';
import {initPlans} from './plans';
document.documentElement.classList.add('js');
const smooth=(a:number,b:number,p:number)=>{const t=Math.max(0,Math.min(1,(p-a)/(b-a)));return t*t*(3-2*t)};
const controllers=[...document.querySelectorAll<HTMLElement>('[data-sequence]')].map(container=>{
 const id=container.dataset.sequence!;
 const line=container.querySelector<HTMLElement>('.progress-track i');
 const mast=container.querySelector<HTMLElement>('.hero-masthead');
 const opening=container.querySelector<HTMLElement>('.hero-opening');
 const narrative=container.querySelector<HTMLElement>('.hero-narrative');
 container.addEventListener('sequence-progress',event=>{
  const {progress}=(event as CustomEvent).detail;
  container.style.setProperty('--progress',progress.toFixed(5));
  container.style.setProperty('--unfold',smooth(.08,.4,progress).toFixed(5));
  if(line)line.style.transform=`scaleX(${progress})`;
  if(mast&&opening&&narrative){
   const out=smooth(.015,.24,progress),intro=smooth(.17,.39,progress);
   mast.style.opacity=String(1-out);mast.style.transform=`translate3d(0,${-out*85}px,0)`;
   opening.style.opacity=String(1-out);opening.style.transform=`translate3d(0,${-out*25}px,0)`;
   opening.style.visibility=out>.98?'hidden':'visible';opening.inert=out>.98;
   narrative.style.opacity=String(intro);narrative.style.transform=`translate3d(0,${(1-intro)*45}px,0)`;
   narrative.style.visibility=intro<.02?'hidden':'visible';narrative.inert=intro<.02;
  }
 });
 return createScrollSequence({container,canvas:container.querySelector('canvas')!,manifestUrl:`/sequences/${id}/manifest.json`});
});
(window as Window&{sequenceControllers?:typeof controllers}).sequenceControllers=controllers;
document.querySelector('[data-year]')!.textContent=String(new Date().getFullYear());
initPlans();
const motion=matchMedia('(prefers-reduced-motion:reduce)');let reduced=motion.matches;
const connection=(navigator as Navigator&{connection?:EventTarget&{saveData?:boolean}}).connection;
const stills=[...document.querySelectorAll<HTMLElement>('[data-parallax]')];
let parallaxFrame=0;const lifecycle=new AbortController();
function parallax(){parallaxFrame=0;for(const img of stills){const r=img.parentElement!.getBoundingClientRect();if(r.top>innerHeight+100||r.bottom< -100)continue;const p=Math.max(0,Math.min(1,(innerHeight-r.top)/(innerHeight+r.height)));img.style.transform=reduced||connection?.saveData?'':`translate3d(0,${(p-.5)*42}px,0)`;}}
function schedule(){if(!parallaxFrame)parallaxFrame=requestAnimationFrame(parallax)}
addEventListener('scroll',schedule,{passive:true,signal:lifecycle.signal});addEventListener('resize',schedule,{passive:true,signal:lifecycle.signal});
motion.addEventListener('change',e=>{reduced=e.matches;schedule()},{signal:lifecycle.signal});connection?.addEventListener('change',schedule,{signal:lifecycle.signal});schedule();
addEventListener('pagehide',e=>{if(!e.persisted){controllers.forEach(c=>c.destroy());lifecycle.abort();cancelAnimationFrame(parallaxFrame)}});
