export interface Closable { close(): void }
/** Byte-bounded LRU. Replacing or evicting a bitmap releases its native resources. */
export class BitmapCache<T extends Closable> {
  private items = new Map<number, {value:T;bytes:number}>();
  bytes=0;
  constructor(public budget:number) {}
  setBudget(budget:number,protect?:number){
    this.budget=Math.max(0,budget);
    while(this.bytes>this.budget){
      const victim=[...this.items.keys()].find(k=>k!==protect)??this.items.keys().next().value;
      if(victim===undefined)break;this.delete(victim);
    }
  }
  get(key:number):T|undefined {
    const item=this.items.get(key);if(!item)return;
    this.items.delete(key);this.items.set(key,item);return item.value;
  }
  has(key:number){return this.items.has(key)}
  keys(){return this.items.keys()}
  put(key:number,value:T,bytes:number,protect?:number){
    this.delete(key);
    if(bytes>this.budget){value.close();return false;}
    this.items.set(key,{value,bytes});this.bytes+=bytes;
    while(this.bytes>this.budget){
      const victim=[...this.items.keys()].find(k=>k!==protect&&k!==key);
      if(victim===undefined){this.delete(key);return false;}
      this.delete(victim);
    }
    return true;
  }
  delete(key:number){const item=this.items.get(key);if(item){item.value.close();this.bytes-=item.bytes;this.items.delete(key);}}
  clear(){for(const key of this.items.keys())this.delete(key)}
  get size(){return this.items.size}
}
export function frameForProgress(progress:number,count:number){
  const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
  return Math.round(p*Math.max(0,count-1));
}
export function priorityWindow(frame:number,count:number,direction:number,ahead=4){
  const keys=[frame];
  for(let d=1;d<=ahead;d++){
    for(const k of [frame+d*direction,frame-d*direction])if(k>=0&&k<count)keys.push(k);
  }
  return keys;
}
