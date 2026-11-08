const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function helpers(fetch){
 const server=fs.readFileSync('server.js','utf8'),source=server.slice(server.indexOf('function mapsUrlFromInput'),server.indexOf('async function googleAddressSearch'));
 const module={exports:{}};vm.runInNewContext(source+';module.exports={expandMapsUrl,parseMapsLocation};',{module,locationInput:require('../location-input'),fetch,AbortController,URL,setTimeout,clearTimeout});return module.exports;
}
test('explicit destination coordinates do not require external fetches or place-name approximation',async()=>{
 const h=helpers(()=>{throw Error('unexpected network')});const url=new URL('https://www.google.com/maps/place/Loja/@-10,-40,12z/data=!3d-15.7942!4d-47.8822');
 assert.equal(await h.expandMapsUrl(url),url);const point=h.parseMapsLocation(url);assert.equal(point.lat,-15.7942);assert.equal(point.lon,-47.8822);assert.equal(point.term,'Loja');
});
test('short links may resolve only inside the approved map services',async()=>{
 const calls=[];const h=helpers(async url=>{calls.push(url);return {status:302,headers:{get:()=> 'https://www.waze.com/ul?ll=-15.7942%2C-47.8822'},body:{cancel:async()=>{}}};});
 const result=await h.expandMapsUrl(new URL('https://waze.com/ul/SHORT'));assert.equal(calls.length,1);assert.equal(h.parseMapsLocation(result).lat,-15.7942);
});
test('redirects cannot request private or arbitrary hosts',async()=>{
 for(const location of ['http://127.0.0.1/','https://evil.test/','https://maps.google.com.evil.test/']){
  let calls=0;const h=helpers(async()=>{calls++;return {status:302,headers:{get:()=>location},body:{cancel:async()=>{}}};});
  await assert.rejects(h.expandMapsUrl(new URL('https://maps.app.goo.gl/SHORT')));assert.equal(calls,1);
 }
});
