/** Share one decoded-memory ceiling across overlapping sequence sections. */
export interface MemoryClient {
  active:boolean;
  limit:number;
  reserved:number;
  resize(bytes:number):void;
}
export class SequenceMemoryBudget {
  private clients=new Set<MemoryClient>();
  add(client:MemoryClient){this.clients.add(client);this.rebalance();}
  delete(client:MemoryClient){this.clients.delete(client);this.rebalance();}
  rebalance(){
    const active=[...this.clients].filter(c=>c.active);
    const ceiling=active.length?Math.min(...active.map(c=>c.limit)):0;
    const reserved=active.reduce((sum,c)=>sum+c.reserved,0);
    const share=active.length?Math.floor(Math.max(0,ceiling-reserved)/active.length):0;
    for(const client of this.clients)client.resize(client.active?share:0);
  }
}
export const sequenceMemory=new SequenceMemoryBudget();
