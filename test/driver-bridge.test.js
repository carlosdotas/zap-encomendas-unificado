const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('mobile/driver-bridge.js','utf8');
function setup(origin='https://dotas.site') {
 const sent=[],listeners={};
 class BrowserSocket {constructor(url){this.url=url}}
 const location={origin,href:origin+'/',reload(){}};
 const window={WebSocket:BrowserSocket,ZapNative:{postMessage(raw){sent.push(JSON.parse(raw))}},addEventListener(t,f){listeners[t]=f},fetch:async()=>({ok:true})};
 const sandbox={window,location,navigator:{geolocation:{}},URL,EventTarget,Event,MessageEvent,CloseEvent:class extends Event{},DOMException,queueMicrotask,setInterval,clearInterval};
 vm.runInNewContext(source,sandbox);
 return {window,sent,listeners,sandbox,BrowserSocket};
}
test('only the trusted host receives the native bridge',()=>{
 const x=setup('https://example.com');assert.equal(x.window.WebSocket,x.BrowserSocket);assert.equal(x.sent.length,0);
});
test('call messages reach the native socket; unrelated sockets use the browser',()=>{
 const x=setup();assert.ok(new x.window.WebSocket('wss://example.com/ws/calls') instanceof x.BrowserSocket);
 const socket=new x.window.WebSocket('wss://dotas.site/ws/calls');assert.equal(x.sent[0].type,'start');
 assert.throws(()=>socket.send('{}'),/desconectado/);
 let opened=0,offer;socket.onopen=()=>opened++;socket.onmessage=e=>offer=JSON.parse(e.data);
 x.window.__zapDispatch('open',{});x.window.__zapDispatch('open',{});assert.equal(opened,1);
 socket.send(JSON.stringify({type:'online',vehicle:'moto'}));assert.equal(x.sent.at(-1).type,'send');
 x.window.__zapDispatch('message',{type:'call_offer',order:{id:'5'}});assert.equal(offer.order.id,'5');
});
test('profile navigation and backgrounding keep the journey active; logout stops it',async()=>{
 const x=setup();const socket=new x.window.WebSocket('wss://dotas.site/ws/calls');x.window.__zapDispatch('open',{});
 socket.send('{"type":"offline"}');socket.close();x.listeners.pagehide();
 assert.equal(x.sent.filter(m=>m.type==='stop').length,0);
 await x.window.fetch('/api/auth/logout',{method:'POST'});assert.equal(x.sent.at(-1).type,'stop');
});
test('native GPS updates feed existing map watchers and can be cancelled',async()=>{
 const x=setup();x.window.__zapDispatch('position',{latitude:-16,longitude:-49,accuracy:5,timestamp:123});
 let received;const id=x.sandbox.navigator.geolocation.watchPosition(p=>received=p);
 assert.equal(received.coords.accuracy,5);assert.equal(received.timestamp,123);x.sandbox.navigator.geolocation.clearWatch(id);
});
