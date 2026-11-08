const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parse,mapsURL}=require('../location-input');
const point=input=>{const result=parse(input);assert.equal(result?.kind,'coordinates',input);assert.equal(result.lat,-16.6869);assert.equal(result.lon,-49.2648);return result;};
test('GPS coordinates and geo links select the actual point instead of the 0,0 placeholder',()=>{
 point('-16.6869, -49.2648');point('geo:-16.6869,-49.2648');
 assert.equal(point('geo:0,0?q=-16.6869%2C-49.2648%28Loja%29').name,'Loja');
 point('google.navigation:q=-16.6869,-49.2648&mode=d');
 assert.equal(parse('geo:0,0?q=Rua+das+Flores').kind,'address');
});
test('Google Maps and Waze shared links carry exact coordinates',()=>{
 point('Minha localização: https://maps.google.com/?q=-16.6869,-49.2648');
 point('https://www.google.com/maps/search/?api=1&query=-16.6869%2C-49.2648');
 assert.equal(point('https://www.google.com/maps/place/Loja/@-15,-48,10z/data=!3d-16.6869!4d-49.2648').name,'Loja');
 point('https://waze.com/ul?ll=-16.6869%2C-49.2648&navigate=yes');
 point('waze://?ll=-16.6869,-49.2648&navigate=yes');
 point('https://www.waze.com/live-map/directions?to=ll.-16.6869%2C-49.2648');
});
test('short links require lookup; named places do not mistake camera center for the destination',()=>{
 assert.equal(parse('https://maps.app.goo.gl/ABC123').kind,'lookup');
 assert.equal(parse('https://waze.com/ul/h6vj123').kind,'lookup');
 const named=parse('https://www.google.com/maps/place/Loja/@-16,-49,12z');assert.equal(named.kind,'lookup');assert.equal(named.term,'Loja');
});
test('invalid coordinates, arbitrary URLs and credential-bearing links are rejected',()=>{
 for(const input of ['91,10','geo:0,0?q=91,10','geo:NaN,20','waze://?ll=-16,181','https://waze.com/ul?ll=-16,181','javascript:alert(1)','https://evil.test/?q=-16,-49','https://maps.google.com.evil.test/?q=-16,-49','https://u:p@maps.google.com/?q=-16,-49'])assert.equal(parse(input),null,input);
 assert.equal(mapsURL('https://www.google.com/search?q=test'),null);
 assert.equal(parse('x'.repeat(2001)),null);
});

test('direction links use the destination rather than the starting point',()=>{
 point('https://www.google.com/maps/dir/?api=1&destination=-16.6869%2C-49.2648&data=!3d-10!4d-40');
 point('https://www.google.com/maps/dir/Inicio/Destino/data=!3d-10!4d-40!3d-16.6869!4d-49.2648');
});
