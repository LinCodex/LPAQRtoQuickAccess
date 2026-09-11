import store from '../config/store.json';
export type Plan={data:string;months:number;price:number};
export function plansForCarrier(carrier:string):Plan[]{
 if(carrier==='tmobile')return [{data:'Unlimited',months:3,price:120}];
 if(carrier==='h2o')return store.plans.options.filter(p=>['4 GB','8 GB','12 GB','40 GB'].includes(p.data)).map(p=>({data:p.data,months:4,price:Math.round(p.price*100*4/6)/100}));
 if(carrier==='lyca')return store.plans.options.filter(p=>p.data!=='Unlimited').map(p=>({...p,months:6}));
 return [...store.plans.options.map(p=>({...p,months:6})),{data:'Unlimited',months:3,price:155}];
}
export function initPlans(){
 const options=document.querySelector<HTMLElement>('#data-options');if(!options)return;
 const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2});let carrier='ultra',selected=0;
 function select(index:number){selected=index;const plan=plansForCarrier(carrier)[selected];for(const [i,b]of [...options!.querySelectorAll('button')].entries())b.setAttribute('aria-pressed',String(i===selected));document.querySelector('[data-selected-data]')!.textContent=plan.data;document.querySelector('[data-selected-price]')!.textContent=money.format(plan.price);document.querySelector('[data-selected-term]')!.textContent=`for ${plan.months} months`;document.querySelector('[data-monthly-cost]')!.textContent=`That's ${money.format(plan.price/plan.months)} per month, paid upfront.`;document.querySelector('#plan-summary')!.textContent=`${store.carriers.find(c=>c.id===carrier)!.name}: ${plan.data}${plan.data==='Unlimited'?' data':' per month'}, ${plan.months} months for ${money.format(plan.price)} total. Taxes and fees included.`;}
 function render(preferred?:Plan){const plans=plansForCarrier(carrier);options!.replaceChildren(...plans.map((p,i)=>{const b=document.createElement('button');b.type='button';b.textContent=p.data;b.append(Object.assign(document.createElement('span'),{textContent:`${p.months} months`}));b.addEventListener('click',()=>select(i));return b;}));select(Math.max(0,plans.findIndex(p=>p.data===preferred?.data&&p.months===preferred.months)));}
 for(const radio of document.querySelectorAll<HTMLInputElement>('[name="carrier"]'))radio.addEventListener('change',()=>{const previous=plansForCarrier(carrier)[selected];carrier=radio.value;render(previous);});render();
}
