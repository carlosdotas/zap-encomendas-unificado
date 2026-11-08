const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
function setup(enabled=true){
 const messages=[],module={exports:{}};
 vm.runInNewContext(fs.readFileSync('native-push.js','utf8'),{module,exports:module.exports,process:{env:enabled?{FIREBASE_PROJECT_ID:'test',GOOGLE_APPLICATION_CREDENTIALS:'/private/key'}:{}},Date,Map,Set,console,require(name){
  if(name==='node:crypto')return crypto;
  if(name==='firebase-admin/app')return {initializeApp(){},applicationDefault(){}};
  if(name==='firebase-admin/messaging')return {getMessaging:()=>({send:async m=>messages.push(m)})};
  throw Error(name);
 }});
 return {push:module.exports,messages};
}
test('push is optional and rejects a vehicle not registered to the driver',()=>{
 const {push}=setup();assert.equal(push.register({id:1,vehicles:'moto'},{vehicle:'carro',token:'a'.repeat(40)},'hash'),false);
 assert.equal(setup(false).push.enabled,false);
});
test('push uses high priority, validates session, and logout revokes availability',async()=>{
 const {push,messages}=setup();const cookie='a'.repeat(64),hash=crypto.createHash('sha256').update(cookie).digest('hex');
 assert.ok(push.register({id:1,vehicles:'carro'},{vehicle:'carro',token:'b'.repeat(40)},hash));assert.equal(push.candidates('moto')[0],'1');assert.equal(push.candidates('utilitario').length,0);
 await push.send('1',{type:'call_offer',expiresAt:Date.now()+30000},{execute:async()=>[[{user_id:1}]]});assert.equal(messages[0].android.priority,'high');assert.ok(messages[0].android.ttl<=30000);
 push.removeSession('zap_session='+cookie);assert.equal(push.candidates('moto').length,0);
});
test('expired sessions do not receive calls',async()=>{
 const {push,messages}=setup();push.register({id:1,vehicles:'moto'},{vehicle:'moto',token:'c'.repeat(40)},'hash');await push.send('1',{type:'call_offer'},{execute:async()=>[[]]});assert.equal(messages.length,0);assert.equal(push.candidates('moto').length,0);
});
