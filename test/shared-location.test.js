const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function setup(storage=new Map()){
 const sent=[],window={sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},ZapNative:{postMessage:raw=>sent.push(JSON.parse(raw))}};
 vm.runInNewContext(fs.readFileSync('shared-location.js','utf8'),{window,Date,Set,JSON});return {inbox:window.ZapSharedLocation,sent,storage};
}
const payload=(id='share-1')=>({id,text:'geo:-16.6869,-49.2648',receivedAt:Date.now()});
test('native delivery survives login reload; acknowledgement happens only after consumption',()=>{
 const x=setup();assert.equal(x.sent[0].type,'location_ready');x.inbox.receive(payload());
 const reloaded=setup(x.storage);assert.equal(reloaded.inbox.peek().id,'share-1');assert.equal(reloaded.sent.filter(m=>m.type==='location_ack').length,0);
 reloaded.inbox.clear('share-1');assert.equal(reloaded.inbox.peek(),null);assert.equal(reloaded.sent.at(-1).type,'location_ack');
 reloaded.inbox.receive(payload());assert.equal(reloaded.inbox.peek(),null);
});
test('warm intents replace pending delivery; duplicates and stale data do not reopen an order',()=>{
 const {inbox}=setup();let changes=0;const unsubscribe=inbox.subscribe(()=>changes++);
 inbox.receive(payload());inbox.receive(payload());assert.equal(changes,2);
 inbox.receive(payload('share-2'));assert.equal(inbox.peek().id,'share-2');
 inbox.clear('share-1');assert.equal(inbox.peek().id,'share-2');unsubscribe();
 assert.equal(inbox.receive({...payload('stale'),receivedAt:Date.now()-3*60*60*1000}),false);
 assert.equal(inbox.receive({...payload('future'),receivedAt:Date.now()+120000}),false);
});
