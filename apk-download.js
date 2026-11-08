'use strict';
const fs=require('node:fs');
const path=require('node:path');
const DEFAULT_DIRECTORY=path.join(__dirname,'downloads');
function readRelease(directory){
  const r=JSON.parse(fs.readFileSync(path.join(directory,'latest.json'),'utf8'));
  if(!Number.isSafeInteger(r.versionCode)||r.versionCode<1||!/^\d+\.\d+(?:\.\d+)?$/.test(r.version)||r.filename!==`zap-encomendas-${r.versionCode}.apk`)throw Error('Versão de download inválida');
  return r;
}
function apkDownload(req,res,pathname,directory=DEFAULT_DIRECTORY){
  if(!['/api/app/version','/downloads/zap-encomendas.apk'].includes(pathname))return false;
  const headers={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'};
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headers,Allow:'GET, HEAD'});res.end();return true;}
  let release,fd,stat;
  try{release=readRelease(directory);fd=fs.openSync(path.join(directory,release.filename),'r');stat=fs.fstatSync(fd);if(stat.size!==release.bytes)throw Error('APK incompleto');}
  catch(error){if(fd!==undefined)fs.closeSync(fd);res.writeHead(503,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(req.method==='HEAD'?undefined:JSON.stringify({available:false,error:'Aplicativo temporariamente indisponível para download.'}));return true;}
  if(pathname==='/api/app/version'){
    fs.closeSync(fd);res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(req.method==='HEAD'?undefined:JSON.stringify({available:true,...release,filename:undefined}));return true;
  }
  res.writeHead(200,{...headers,'Content-Type':'application/vnd.android.package-archive','Content-Length':stat.size,'Content-Disposition':`attachment; filename="zap-encomendas-${release.version}.apk"`,'X-App-Version':release.version,'X-App-Version-Code':String(release.versionCode)});
  if(req.method==='HEAD'){fs.closeSync(fd);res.end();return true;}
  const stream=fs.createReadStream(null,{fd,autoClose:true});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return true;
}
module.exports={apkDownload};
