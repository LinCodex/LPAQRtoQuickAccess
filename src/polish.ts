import './polish.css';
export function initSurfaceMotion(){
 const lifecycle=new AbortController(),signal=lifecycle.signal;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const connection=(navigator as Navigator&{connection?:EventTarget&{saveData?:boolean}}).connection;
 const setData=()=>document.documentElement.toggleAttribute('data-save-data',Boolean(connection?.saveData));
 setData();connection?.addEventListener?.('change',setData,{signal});
 const animations=new Set<Animation>(),observers:{disconnect():void}[]=[];
 const frames=new Set<number>();
 function animate(el:Element,keyframes:Keyframe[],options:KeyframeAnimationOptions){
  const a=el.animate(keyframes,options);animations.add(a);
  a.finished.finally(()=>animations.delete(a)).catch(()=>{});return a;
 }
 reduced.addEventListener('change',e=>{if(e.matches)for(const a of animations)a.finish();},{signal});
 const reveal=new IntersectionObserver(entries=>{
  for(const e of entries)if(e.isIntersecting){
   reveal.unobserve(e.target);if(reduced.matches||connection?.saveData)continue;
   animate(e.target,[{opacity:.45,transform:'translate3d(0,16px,0)'},{opacity:1,transform:'none'}],{duration:500,easing:'cubic-bezier(.16,1,.3,1)'});
  }
 },{threshold:.12});
 document.querySelectorAll('.phone-card,.home-phone-card,.essentials-title,.connection-intro>h2,.detail-grid article,.contact-heading,.catalog-heading>h1').forEach(e=>reveal.observe(e));observers.push(reveal);

 const menu=document.querySelector<HTMLElement>('#mobile-menu'),toggle=document.querySelector<HTMLButtonElement>('.menu-toggle');
 let open=false,menuAnimation:Animation|undefined,revision=0;
 function menuState(next:boolean,focus=false){
  if(!menu||!toggle)return;
  const current=getComputedStyle(menu),fromTransform=menu.hidden?'translateY(-8px) scale(.97)':current.transform,fromOpacity=menu.hidden?'0':current.opacity;
  menuAnimation?.cancel();const generation=++revision;open=next;
  toggle.setAttribute('aria-expanded',String(next));toggle.setAttribute('aria-label',next?'Close menu':'Open menu');
  if(!next&&(focus||menu.contains(document.activeElement)))toggle.focus({preventScroll:true});
  menu.inert=!next;
  if(reduced.matches){menu.hidden=!next;return;}
  menu.hidden=false;
  menuAnimation=animate(menu,[{opacity:fromOpacity,transform:fromTransform},{opacity:next?1:0,transform:next?'none':'translateY(-6px) scale(.98)'}],{duration:next?360:220,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
  menuAnimation.finished.then(()=>{if(generation===revision){menu.hidden=!next;menuAnimation?.cancel();menuAnimation=undefined;}}).catch(()=>{});
 }
 toggle?.addEventListener('click',()=>menuState(!open),{signal});
 menu?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>menuState(false),{signal}));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)menuState(false,true);},{signal});
 document.addEventListener('click',e=>{if(open&&e.target instanceof Node&&!menu?.contains(e.target)&&!toggle?.contains(e.target))menuState(false);},{signal});
 matchMedia('(min-width:960px)').addEventListener('change',e=>{if(e.matches)menuState(false);},{signal});

 for(const rail of document.querySelectorAll<HTMLElement>('.angle-controls,.site-header>nav:not(#mobile-menu)')){
  const isNav=rail.closest('.site-header')!==null;
  const links=[...rail.querySelectorAll<HTMLAnchorElement>('a')];
  const current=links.find(a=>new URL(a.href).pathname===location.pathname&&location.pathname!=='/');
  current?.setAttribute('aria-current','page');
  let hovered:HTMLElement|undefined,activeAnimation:Animation|undefined,pending=0,initialized=false,last='';
  const indicator=document.createElement('span');indicator.className='selection-indicator';indicator.setAttribute('aria-hidden','true');indicator.dataset.noTranslate='';rail.prepend(indicator);
  function update(){
   frames.delete(pending);pending=0;
   const active=isNav?(hovered??current):rail.querySelector<HTMLElement>('[aria-pressed="true"]');
   if(!active||!rail.offsetWidth){indicator.style.opacity='0';return;}
   const x=active.offsetLeft,y=active.offsetTop,w=active.offsetWidth,h=active.offsetHeight,key=[x,y,w,h].join(':');
   indicator.style.opacity='1';if(last===key)return;last=key;
   const old=indicator.getBoundingClientRect(),parent=rail.getBoundingClientRect();
   activeAnimation?.cancel();
   indicator.style.width=w+'px';indicator.style.height=h+'px';indicator.style.top=y+'px';indicator.style.transform='translateX('+x+'px)';indicator.style.transformOrigin='left center';
   rail.classList.add('selection-rail');
   if(initialized&&!reduced.matches){
    activeAnimation=animate(indicator,[{transform:'translateX('+(old.left-parent.left-rail.clientLeft)+'px) scaleX('+(old.width/w)+')'},{transform:'translateX('+x+'px) scaleX(1)'}],{duration:320,easing:'cubic-bezier(.16,1,.3,1)'});
   }
   initialized=true;
  }
  const schedule=()=>{if(!pending){pending=requestAnimationFrame(update);frames.add(pending);}};
  if(isNav){for(const link of links){link.addEventListener('pointerenter',()=>{hovered=link;schedule();},{signal});link.addEventListener('focus',()=>{hovered=link;schedule();},{signal});}
   rail.addEventListener('pointerleave',()=>{hovered=undefined;schedule();},{signal});
   rail.addEventListener('focusout',()=>{hovered=undefined;schedule();},{signal});
  }
  const mutation=new MutationObserver(schedule);mutation.observe(rail,{subtree:true,attributes:true,attributeFilter:['aria-pressed'],childList:true,characterData:true});
  const resize=new ResizeObserver(schedule);resize.observe(rail);observers.push(mutation,resize);schedule();
 }
 addEventListener('pagehide',e=>{if(!e.persisted){lifecycle.abort();for(const a of animations)a.cancel();for(const o of observers)o.disconnect();for(const f of frames)cancelAnimationFrame(f);}},{signal});
}
