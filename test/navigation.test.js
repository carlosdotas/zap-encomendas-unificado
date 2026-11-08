const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(native=false){
 const listeners={},history=[];
 const window={location:{href:'https://dotas.site/'},history:{pushState(...args){history.push(args)}},addEventListener(type,fn){listeners[type]=fn}};
 if(native)window.ZapNative={};
 vm.runInNewContext(fs.readFileSync('navigation.js','utf8'),{window});
 return {nav:window.ZapNavigation,listeners,history};
}
test('top layers close before internal pages and root exit',()=>{
 const {nav}=setup(true);let dialog=true,page='profile';
 nav.register(()=>{if(page==='profile'){page='map';return true;}return 'root';},-100);
 const remove=nav.register(()=>{if(dialog){dialog=false;return true;}return false;},20);
 assert.equal(nav.back(),'handled');assert.equal(page,'profile');
 assert.equal(nav.back(),'handled');assert.equal(page,'map');
 assert.equal(nav.back(),'root');remove();assert.equal(nav.back(),'root');
});
test('unmounted handlers do not intercept the next screen',()=>{
 const {nav}=setup(true);const remove=nav.register(()=>true,20);nav.register(()=>'root',-100);
 assert.equal(nav.back(),'handled');remove();assert.equal(nav.back(),'root');
});
test('browser Back restores the guard for a dialog but allows leaving root',()=>{
 const {nav,listeners,history}=setup();let dialog=true;
 nav.register(()=>{if(dialog){dialog=false;return true;}return 'root';});
 assert.equal(history.length,1);listeners.popstate();assert.equal(history.length,2);
 listeners.popstate();assert.equal(history.length,2);
});
test('Escape shares the close command; native mode never pushes browser history',()=>{
 const {nav,listeners,history}=setup(true);let calls=0,prevented=0;nav.register(()=>{calls++;return true;});
 listeners.keydown({key:'Escape',preventDefault(){prevented++}});
 assert.equal(calls,1);assert.equal(prevented,1);assert.equal(history.length,0);
});
test('opening a new layer after reaching root rearms only one browser guard',()=>{
 const {nav,listeners,history}=setup();nav.register(()=>'root');
 listeners.popstate();assert.equal(history.length,1);
 nav.arm();nav.arm();assert.equal(history.length,2);
});
