'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function publishApk({apk,version,versionCode,directory=path.resolve(__dirname,'../downloads')}) {
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(version)||!Number.isSafeInteger(versionCode)||versionCode<1)throw Error('Versão Android inválida');
  const source=fs.readFileSync(apk);
  if(source.length<4||source.readUInt32LE(0)!==0x04034b50)throw Error('Arquivo APK inválido');
  fs.mkdirSync(directory,{recursive:true});
  const manifest=path.join(directory,'latest.json');
  let previous;try{previous=JSON.parse(fs.readFileSync(manifest,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous&&previous.versionCode>=versionCode)throw Error('A nova compilação precisa ter versionCode maior que o APK publicado');
  const filename=`zap-encomendas-${versionCode}.apk`;
  const file=path.join(directory,filename),temporary=file+'.tmp';
  fs.writeFileSync(temporary,source);fs.renameSync(temporary,file);
  const release={version,versionCode,filename,bytes:source.length,sha256:crypto.createHash('sha256').update(source).digest('hex'),builtAt:new Date().toISOString(),url:'/downloads/zap-encomendas.apk'};
  // Publish the pointer last: a failed build/copy never replaces the live download.
  fs.writeFileSync(manifest+'.tmp',JSON.stringify(release,null,2)+'\n');fs.renameSync(manifest+'.tmp',manifest);
  // Keep the previous file for readers already downloading during replacement.
  for(const entry of fs.readdirSync(directory))if(/^zap-encomendas-\d+\.apk$/.test(entry)&&entry!==filename&&entry!==previous?.filename)fs.unlinkSync(path.join(directory,entry));
  return release;
}
if(require.main===module){
  const [apk,version,code]=process.argv.slice(2);
  try{console.log(JSON.stringify(publishApk({apk,version,versionCode:Number(code)})));}catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={publishApk};
