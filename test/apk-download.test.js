'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {publishApk}=require('../scripts/publish-apk');
const {apkDownload}=require('../apk-download');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'zap-apk-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const apk=path.join(root,'app.apk'),directory=path.join(root,'downloads');fs.writeFileSync(apk,Buffer.from('504b030474657374','hex'));return {apk,directory};}
test('failed or older publications preserve the current APK',t=>{
 const f=fixture(t);const release=publishApk({...f,version:'1.0.1',versionCode:2});
 assert.throws(()=>publishApk({...f,version:'1.0',versionCode:1}),/maior/);
 fs.writeFileSync(f.apk,'broken build');assert.throws(()=>publishApk({...f,version:'1.0.2',versionCode:3}),/inválido/);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory,'latest.json'))),release);
 assert.ok(fs.existsSync(path.join(f.directory,release.filename)));
});
test('fixed download URL and version API move together to the newest APK',async t=>{
 const f=fixture(t);publishApk({...f,version:'1.0',versionCode:1});
 const server=http.createServer((req,res)=>{if(!apkDownload(req,res,new URL(req.url,'http://localhost').pathname,f.directory)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 let metadata=await fetch(base+'/api/app/version');assert.equal(metadata.headers.get('cache-control'),'no-store, max-age=0');assert.equal((await metadata.json()).versionCode,1);
 fs.appendFileSync(f.apk,'new version');publishApk({...f,version:'1.0.1',versionCode:2});
 metadata=await fetch(base+'/api/app/version');assert.equal((await metadata.json()).versionCode,2);
 const response=await fetch(base+'/downloads/zap-encomendas.apk?v=1');assert.equal(response.headers.get('x-app-version'),'1.0.1');assert.equal(response.headers.get('content-type'),'application/vnd.android.package-archive');assert.match(response.headers.get('content-disposition'),/1\.0\.1/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(f.apk));
 const head=await fetch(base+'/downloads/zap-encomendas.apk',{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.text()).length,0);
 assert.equal((await fetch(base+'/api/app/version',{method:'POST'})).status,405);
});
test('missing APK disables download and invalid paths never leave the downloads directory',t=>{
 const f=fixture(t);const responses=[];const res={writeHead(code,headers){responses.push({code,headers})},end(){}};
 assert.equal(apkDownload({method:'GET'},res,'/api/app/version',f.directory),true);assert.equal(responses.at(-1).code,503);
 fs.mkdirSync(f.directory);fs.writeFileSync(path.join(f.directory,'latest.json'),JSON.stringify({version:'1.0',versionCode:1,filename:'../app.apk'}));
 apkDownload({method:'GET'},res,'/downloads/zap-encomendas.apk',f.directory);assert.equal(responses.at(-1).code,503);
 assert.equal(apkDownload({method:'GET'},res,'/downloads/../app.apk',f.directory),false);
});
