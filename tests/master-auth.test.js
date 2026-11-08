'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const crypto=require('node:crypto');

async function freePort(){
 return new Promise((resolve,reject)=>{
  const socket=net.createServer();
  socket.once('error',reject);
  socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});
 });
}
test('autenticacao mestre funciona sem MySQL, troca perfil e encerra sessao',async t=>{
 const port=await freePort();
 const phone='62999998888',password='senha-de-teste-123';
 const env={...process.env,PORT:String(port),HOST:'127.0.0.1',DB_HOST:'127.0.0.1',DB_PORT:'1',DB_USER:'',DB_PASSWORD:'',DB_NAME:'',MASTER_AUTH_PHONE:phone,MASTER_AUTH_PASSWORD:password,MASTER_AUTH_SECRET:crypto.randomBytes(32).toString('hex')};
 const child=spawn(process.execPath,['server.js'],{env,stdio:'ignore',cwd:require('node:path').resolve(__dirname,'..')});
 t.after(()=>child.kill());
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/auth/master/status');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,'servidor nao iniciou');
 const status=await (await fetch(base+'/api/auth/master/status')).json();
 assert.equal(status.masterAuth.ready,true);
 assert.equal(status.databaseRequired,false);
 const login=async(role,pass=password)=>fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password:pass,role})});
 const bad=await login('motorista','errada');assert.equal(bad.status,401);
 const good=await login('motorista');assert.equal(good.status,200);
 const data=await good.json();assert.equal(data.user.isMaster,true);assert.equal(data.user.role,'motorista');
 const cookie=good.headers.get('set-cookie').split(';')[0];
 const me=await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}});assert.equal(me.status,200);assert.equal((await me.json()).user.isMaster,true);
 const switchRole=await fetch(base+'/api/auth/master/switch-role',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({role:'transportadora'})});
 assert.equal(switchRole.status,200);assert.equal((await switchRole.json()).user.role,'transportadora');
 const cookie2=switchRole.headers.get('set-cookie').split(';')[0];
 const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie2},body:'{}'});assert.equal(logout.status,200);
 const expired=logout.headers.get('set-cookie');assert.match(expired,/Max-Age=0/);
});
