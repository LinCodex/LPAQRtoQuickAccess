import { BitmapCache,frameForProgress } from './cache';
import {sequenceMemory,type MemoryClient} from './memory-budget';
export interface Profile { frames:string[];frameCount:number;width:number;height:number;poster:string;bytes?:number }
export interface SequenceManifest { version:1;id:string;background:string;chapters:{start:number;end:number;label:string}[];profiles:{desktop:Profile;mobile:Profile} }
export interface SequenceOptions { container:HTMLElement;canvas:HTMLCanvasElement;manifestUrl:string }
export interface SequenceController { setProgress(progress:number):void;destroy():void;readonly ready:Promise<void>;readonly diagnostics:{decodedBytes:number;cacheSize:number;frame:number;static:boolean;reservedDecodeBytes:number;cacheBudget:number;profile:'desktop'|'mobile'|null;encodedBytes:number;target:number;draws:number} }
type Connection = EventTarget & {saveData?:boolean};

export function createScrollSequence({container,canvas,manifestUrl}:SequenceOptions):SequenceController {
  const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw Error('Canvas 2D is unavailable.');
  const manifestURL=new URL(manifestUrl,document.baseURI),lifecycle=new AbortController();
  const media=matchMedia('(max-width: 767px)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  // Use event.matches after initialization: polling the getter can suppress a
  // queued Chromium media-query notification during a resize.
  let mobileMode=media.matches,reducedMode=reduced.matches;
  const connection=(navigator as Navigator&{connection?:Connection}).connection;
  let saveDataMode=Boolean(connection?.saveData);
  const cache=new BitmapCache<ImageBitmap>(0);
  const encoded=new BitmapCache<{blob:Blob;close():void}>(24*1024*1024);
  const pending=new Map<number,AbortController>(),decoding=new Set<number>(),attempts=new Map<number,number>();
  let manifest:SequenceManifest|undefined,profile:Profile|undefined;
  let progress=0,desired=0,previous=0,direction=1,drawn=-1,epoch=0,raf=0,draws=0;
  let paintFrame=0,painted=false,paintPending=false;
  let destroyed=false,visible=false,failed=false,manual=false,activeDecodes=0,lastEvent=-1;
  let decodeWidth=1,decodeHeight=1;
  let lastTick=0;
  const poster=container.querySelector<HTMLImageElement>('[data-poster]')??document.createElement('img');
  if(!poster.parentNode){poster.alt='';poster.dataset.poster='';canvas.before(poster);}
  const memory:MemoryClient={active:false,limit:64*1024*1024,reserved:0,resize(bytes){cache.setBudget(bytes,desired);}};
  sequenceMemory.add(memory);
  function isStatic(){return reducedMode||saveDataMode||failed;}
  function sourceBytes(){return manifest?Math.max(...Object.values(manifest.profiles).map(p=>p.width*p.height*4)):0;}
  function updateMemory(){
    if(destroyed&&!activeDecodes){sequenceMemory.delete(memory);return;}
    memory.active=Boolean(profile&&visible&&!isStatic()&&!destroyed)||activeDecodes>0;
    memory.limit=(mobileMode?64:96)*1024*1024;
    // Reserve full source surfaces even when the decoder downsamples its output.
    memory.reserved=2*sourceBytes();sequenceMemory.rebalance();
  }
  function cancelWork(){epoch++;for(const c of pending.values())c.abort();pending.clear();decoding.clear();cancelAnimationFrame(paintFrame);paintFrame=0;painted=false;paintPending=false;}
  function setVisible(next:boolean){
    if(next===visible)return;visible=next;
    if(!visible)cancelWork();updateMemory();
  }
  function staticState(){
    const disabled=isStatic();container.classList.toggle('is-static',disabled);
    container.dispatchEvent(new CustomEvent('sequence-mode',{detail:{static:disabled}}));
    if(disabled){cancelWork();cache.clear();encoded.clear();canvas.style.opacity='0';poster.style.opacity='1';drawn=-1;updateMemory();}
    else if(profile)selectProfile();
    schedule();
  }
  function resize(){
    if(!profile)return;
    // Layout dimensions exclude scroll transforms. A resize must not change
    // decode resolution simply because the phone is currently scaled down.
    const rect={width:canvas.clientWidth,height:canvas.clientHeight};
    // The full-size master is unnecessary for a smaller on-page presentation.
    // 1.25x desktop / 1.5x mobile keeps edges crisp without decoding 1.9 MP each step.
    const dpr=Math.min(devicePixelRatio||1,mobileMode?1.5:1.25);
    const factor=Math.min(1,rect.width*dpr/profile.width,rect.height*dpr/profile.height);
    const width=Math.max(1,Math.round(profile.width*factor)),height=Math.max(1,Math.round(profile.height*factor));
    if(width===decodeWidth&&height===decodeHeight)return;
    decodeWidth=width;decodeHeight=height;
    cancelWork();cache.clear();
    const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d')?.drawImage(canvas,0,0);
    canvas.width=width;canvas.height=height;ctx!.drawImage(copy,0,0,width,height);copy.width=copy.height=0;
    drawn=-1;updateMemory();
  }
  function selectProfile(){
    if(!manifest||destroyed)return;
    cancelWork();attempts.clear();cache.clear();encoded.clear();
    profile=manifest.profiles[mobileMode?'mobile':'desktop'];
    encoded.setBudget((mobileMode?12:24)*1024*1024);
    // Authored <picture> sources provide the correct first poster before JS.
    poster.src=new URL(profile.poster,manifestURL).href;poster.style.opacity='1';canvas.style.opacity='0';
    drawn=-1;resize();updateMemory();schedule();
  }
  function draw(){
    if(destroyed||isStatic()||!visible||document.hidden)return;
    if(painted){paintPending=true;return;}
    let candidate=desired;
    if(!cache.has(candidate)){
      // Show a closer completed frame while the newest target is decoding.
      // Never jump backwards to a stale request merely because it finished last.
      let distance=drawn<0?Infinity:Math.abs(drawn-desired);candidate=-1;
      for(const key of cache.keys()){const gap=Math.abs(key-desired);if(gap<distance){candidate=key;distance=gap;}}
    }
    if(candidate<0||candidate===drawn)return;
    const bitmap=cache.get(candidate);if(!bitmap)return;
    ctx!.clearRect(0,0,canvas.width,canvas.height);ctx!.drawImage(bitmap,0,0,canvas.width,canvas.height);
    drawn=candidate;draws++;canvas.style.opacity='1';poster.style.opacity='0';container.dataset.frame=String(candidate);
    // Keep the first ready frame responsive, but avoid replacing it repeatedly
    // before the display can present it. The reset has no layout reads or drawing.
    painted=true;paintFrame=requestAnimationFrame(()=>{paintFrame=0;painted=false;if(paintPending){paintPending=false;schedule();}});
  }
  function priorities(ahead:number,behind:number){
    if(!profile)return [];
    const list=[desired];
    for(let i=1;i<=Math.max(ahead,behind);i++){
      if(i<=ahead)list.push(desired+i*direction);
      if(i<=behind)list.push(desired-i*direction);
    }
    return list.filter(n=>n>=0&&n<profile!.frameCount);
  }
  function fail(frame:number,error:unknown){
    attempts.set(frame,(attempts.get(frame)??0)+1);
    if(frame===desired&&(attempts.get(frame)??0)>=2){failed=true;container.dataset.error=String(error);staticState();}
  }
  function pump(){
    if(!profile||destroyed||isStatic()||!visible||document.hidden)return;
    if((attempts.get(desired)??0)>=2){failed=true;staticState();return;}
    const bytes=decodeWidth*decodeHeight*4;
    const slots=Math.min(18,Math.max(0,Math.floor(cache.budget/bytes)-1));
    const decodeOrder=priorities(Math.max(0,slots-3),Math.min(2,slots-1));
    // Fetch and decode have independent queues. Compressed WebPs are inexpensive
    // to retain, so reversing direction does not require another network roundtrip.
    for(const frame of priorities(32,6)){
      if(pending.size>=3)break;
      if(encoded.has(frame)||pending.has(frame)||(attempts.get(frame)??0)>=2)continue;
      const controller=new AbortController(),generation=epoch,selected=profile;
      pending.set(frame,controller);let timedOut=false;
      const timeout=setTimeout(()=>{timedOut=true;controller.abort();},8000);
      void fetch(new URL(selected.frames[frame],manifestURL),{signal:controller.signal})
        .then(res=>{if(!res.ok)throw Error(`Frame ${frame}: HTTP ${res.status}`);return res.blob();})
        .then(blob=>{
          if(destroyed||generation!==epoch||controller.signal.aborted)return;
          encoded.put(frame,{blob,close(){}},blob.size,desired);
        }).catch(error=>{if(!destroyed&&generation===epoch&&(!controller.signal.aborted||timedOut))fail(frame,error);})
        .finally(()=>{clearTimeout(timeout);if(pending.get(frame)===controller)pending.delete(frame);pump();});
    }
    for(const frame of decodeOrder){
      if(activeDecodes>=2||slots<1)break;
      if(cache.has(frame)||decoding.has(frame))continue;
      const packed=encoded.get(frame);if(!packed)continue;
      const generation=epoch,width=decodeWidth,height=decodeHeight;
      decoding.add(frame);activeDecodes++;
      void createImageBitmap(packed.blob,{resizeWidth:width,resizeHeight:height,resizeQuality:'low'})
        .then(bitmap=>{
          if(destroyed||generation!==epoch){bitmap.close();return;}
          attempts.delete(frame);cache.put(frame,bitmap,bitmap.width*bitmap.height*4,desired);
          draw();
        }).catch(error=>{if(!destroyed&&generation===epoch){encoded.delete(frame);fail(frame,error);}})
        .finally(()=>{activeDecodes--;if(generation===epoch)decoding.delete(frame);updateMemory();pump();});
    }
  }
  function update(p:number){
    progress=isStatic()?0:Number.isFinite(p)?Math.max(0,Math.min(1,p)):0;
    if(!profile||destroyed)return;
    desired=frameForProgress(progress,profile.frameCount);
    direction=desired===previous?direction:desired>previous?1:-1;previous=desired;
    if(progress!==lastEvent){
      lastEvent=progress;
      const chapterIndex=manifest!.chapters.findIndex(c=>progress>=c.start&&(progress<c.end||c.end===1));
      container.dispatchEvent(new CustomEvent('sequence-progress',{detail:{progress,frame:desired,chapter:manifest!.chapters[chapterIndex],chapterIndex,chapterCount:manifest!.chapters.length}}));
    }
    if(isStatic()||!visible)return;
    draw();pump();
  }
  function onFrame(now:number){
    raf=0;if(destroyed)return;
    const rect=container.getBoundingClientRect();
    // Recompute from geometry after resize too. Huge pinned elements can retain
    // a stale IntersectionObserver state when rotating a landscape viewport.
    setVisible(!document.hidden&&rect.top<innerHeight+150&&rect.bottom>-150);
    const target=Math.max(0,Math.min(1,-rect.top/Math.max(1,container.offsetHeight-innerHeight)));
    const dt=lastTick?Math.min(50,now-lastTick):16;lastTick=now;
    // One continuous, time-based visual timeline. Native scrolling remains
    // untouched; only the product presentation eases into its requested pose.
    const next=manual||isStatic()?progress:progress+(target-progress)*(1-Math.exp(-dt/50));
    const settled=Math.abs(target-next)<.00008;
    update(manual?progress:settled?target:next);
    if(visible&&!manual&&!isStatic()&&!settled)schedule();
  }
  function schedule(){if(!raf&&!destroyed)raf=requestAnimationFrame(onFrame);}
  const observer=new IntersectionObserver(schedule,{rootMargin:'150px'});observer.observe(container);
  const resizeObserver=new ResizeObserver(()=>{resize();schedule();});resizeObserver.observe(canvas);
  addEventListener('scroll',schedule,{passive:true,signal:lifecycle.signal});
  addEventListener('resize',schedule,{passive:true,signal:lifecycle.signal});
  addEventListener('pageshow',schedule,{signal:lifecycle.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;setVisible(false);}else{lastTick=0;schedule();}},{signal:lifecycle.signal});
  media.addEventListener('change',event=>{mobileMode=event.matches;selectProfile();},{signal:lifecycle.signal});
  reduced.addEventListener('change',event=>{reducedMode=event.matches;staticState();},{signal:lifecycle.signal});
  connection?.addEventListener('change',()=>{
    // RTT/downlink updates share this event with Save-Data. Only a real
    // preference change should discard frames or return to the poster.
    const next=Boolean(connection.saveData);if(next===saveDataMode)return;
    saveDataMode=next;staticState();
  },{signal:lifecycle.signal});
  staticState();
  const manifestTimeout=setTimeout(()=>{if(!manifest&&!destroyed){failed=true;staticState();lifecycle.abort();}},8000);
  const ready=fetch(manifestURL,{signal:lifecycle.signal}).then(res=>{if(!res.ok)throw Error('Sequence manifest unavailable');return res.json();}).then((m:SequenceManifest)=>{
    if(destroyed)return;
    if(m.version!==1||!m.profiles||!m.chapters?.length)throw Error('Invalid sequence manifest');
    for(const p of Object.values(m.profiles))if(p.frameCount<1||p.frames.length!==p.frameCount||p.width<1||p.height<1)throw Error('Invalid sequence profile');
    manifest=m;selectProfile();
  }).catch(error=>{if(!destroyed){failed=true;container.dataset.error=String(error);staticState();}}).finally(()=>clearTimeout(manifestTimeout));
  return {
    ready,
    setProgress(p){manual=true;const rect=container.getBoundingClientRect();setVisible(rect.top<innerHeight+150&&rect.bottom>-150);update(p);},
    destroy(){if(destroyed)return;destroyed=true;cancelWork();lifecycle.abort();clearTimeout(manifestTimeout);cache.clear();encoded.clear();updateMemory();observer.disconnect();resizeObserver.disconnect();cancelAnimationFrame(raf);ctx.clearRect(0,0,canvas.width,canvas.height);},
    get diagnostics(){return {decodedBytes:cache.bytes,cacheSize:cache.size,frame:drawn,static:isStatic(),reservedDecodeBytes:activeDecodes*sourceBytes(),cacheBudget:cache.budget,profile:profile?(profile===manifest?.profiles.mobile?'mobile' as const:'desktop' as const):null,encodedBytes:encoded.bytes,target:desired,draws};},
  };
}

