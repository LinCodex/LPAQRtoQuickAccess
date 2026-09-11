import {translate} from './translations';
import {initSurfaceMotion} from './polish';
type Language='en'|'zh-Hans';
let language:Language=document.documentElement.lang==='zh-Hans'?'zh-Hans':'en';
const original=new WeakMap<Text,{english:string;shown:string}>(),attributes=new WeakMap<Element,Map<string,{english:string;shown:string}>>();
const observer=new MutationObserver(()=>apply());
function watch(){observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['alt','aria-label']});}
function apply(){observer.disconnect();const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node:Text|null;while((node=walker.nextNode() as Text|null)){if(node.parentElement?.closest('script,style,[data-no-translate],.language-toggle'))continue;let saved=original.get(node);if(!saved||saved.shown!==node.data)saved={english:node.data,shown:node.data};const value=language==='en'?saved.english:translate(saved.english);if(node.data!==value)node.data=value;saved.shown=value;original.set(node,saved);}
 for(const el of document.querySelectorAll('[alt],[aria-label]')){if(el.matches('.language-toggle'))continue;let saved=attributes.get(el);if(!saved){saved=new Map();attributes.set(el,saved)}for(const key of ['alt','aria-label']){const value=el.getAttribute(key);if(!value)continue;let entry=saved.get(key);if(!entry||entry.shown!==value)entry={english:value,shown:value};const output=language==='en'?entry.english:translate(entry.english);if(value!==output)el.setAttribute(key,output);entry.shown=output;saved.set(key,entry);}}
 document.documentElement.lang=language;for(const button of document.querySelectorAll('.language-toggle')){button.textContent=language==='en'?'中文':'EN';button.setAttribute('aria-label',language==='en'?'切换为中文':'Switch to English');}watch();}
document.querySelectorAll('.language-toggle').forEach(button=>button.addEventListener('click',()=>{language=language==='en'?'zh-Hans':'en';try{localStorage.setItem('ezrefill-language',language)}catch{}apply();document.dispatchEvent(new CustomEvent('language-change',{detail:language}));}));
apply();
initSurfaceMotion();

