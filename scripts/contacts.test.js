'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(native=true){
 const messages=[],errors=[];let client={name:'Empresa',contactName:'Anterior',phone:'11999999999',document:'123',address:'Rua A'};
 const window={navigator:{}};
 if(native)window.ZapNative={postMessage(message){messages.push(JSON.parse(message));}};
 const context=vm.createContext({window,navigator:window.navigator,Date,Promise,Error,console,
  setClientError:error=>errors.push(error),setNewClient:update=>{client=update(client);},formatClientPhone:phone=>phone.replace(/\D/g,'')});
 vm.runInContext(fs.readFileSync('mobile/contacts.js','utf8'),context);
 const html=fs.readFileSync('index.html','utf8');
 const start=html.indexOf(' async function pickPhoneContact()');
 vm.runInContext(html.slice(start,html.indexOf('\n async function registerClient',start)),context);
 return {window,messages,errors,client:()=>client,pick:()=>vm.runInContext('pickPhoneContact()',context)};
}
test('botão usa a ponte nativa e preenche somente contato e telefone escolhidos',async()=>{
 const s=setup();const result=s.pick();assert.equal(s.messages[0].type,'pick_contact');
 s.window.ZapContacts.receive({id:'outro',contacts:[]});
 s.window.ZapContacts.receive({id:s.messages[0].id,contacts:[{name:['Ana'],tel:['(11) 98888-7777']}]});
 await result;assert.deepEqual(JSON.parse(JSON.stringify(s.client())),{name:'Empresa',contactName:'Ana',phone:'11988887777',document:'123',address:'Rua A'});
 assert.equal(s.errors.at(-1),'');
});
test('cancelar mantém formulário; agenda pode ser reaberta',async()=>{
 const s=setup();const original={...s.client()};
 const first=s.pick();s.window.ZapContacts.receive({id:s.messages[0].id,contacts:[]});await first;
 assert.deepEqual(s.client(),original);
 const second=s.pick();assert.notEqual(s.messages[1].id,s.messages[0].id);
 s.window.ZapContacts.receive({id:s.messages[1].id,contacts:[]});await second;
});
test('erro nativo é exibido e permite tentar novamente',async()=>{
 const s=setup();const first=s.pick();s.window.ZapContacts.receive({id:s.messages[0].id,error:'Agenda indisponível'});await first;
 assert.equal(s.errors.at(-1),'Agenda indisponível');
 const next=s.pick();s.window.ZapContacts.receive({id:s.messages[1].id,contacts:[]});await next;
});
test('navegador continua usando Contact Picker API quando disponível',async()=>{
 const s=setup(false);s.window.navigator.contacts={select:async()=>[{name:['Web'],tel:['1234567890']}]};
 await s.pick();assert.equal(s.client().contactName,'Web');assert.equal(s.messages.length,0);
});
test('compatibilidade da página anterior usa ponte via navigator.contacts',async()=>{
 const s=setup();const pending=s.window.navigator.contacts.select(['name','tel'],{multiple:false});
 await assert.rejects(s.window.ZapContacts.select(),/seleção/);
 s.window.ZapContacts.receive({id:s.messages[0].id,contacts:[]});assert.equal((await pending).length,0);
});
