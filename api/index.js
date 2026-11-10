'use strict';
const crypto=require('node:crypto');
const {Pool}=require('pg');
let pool;
function db(){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL ausente');
 if(!pool){
  const raw=new URL(process.env.DATABASE_URL);
  const direct=new RegExp('^db[.]([a-z0-9]+)[.]supabase[.]co$').exec(raw.hostname);
  if(direct){
   const project=direct[1];
   const region=process.env.SUPABASE_DB_REGION||'sa-east-1';
   const host=process.env.SUPABASE_POOLER_HOST||'aws-1-'+region+'.pooler.supabase.com';
   raw.hostname=host;
   raw.port='6543';
   raw.username='postgres.'+project;
   raw.searchParams.delete('pgbouncer');
   console.info('[PG API] Usando Supavisor transaction pooler:',host);
  }
  pool=new Pool({connectionString:raw.toString(),ssl:{rejectUnauthorized:false},max:2,connectionTimeoutMillis:8000,options:'-c search_path=zap_app,public'});
 }
 return pool;
}
function json(res,status,obj){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(obj));}
function parseCookie(req){return String(req.headers.cookie||'').match(/(?:^|;\s*)zap_session=([a-f0-9]{64})(?:;|$)/)?.[1];}
function userView(u){return {id:u.id,name:u.full_name,phone:u.phone,role:u.role,vehicles:String(u.vehicles||'').split(',').filter(Boolean),transportadora_id:u.transportadora_id||null};}
async function session(req){const token=parseCookie(req);if(!token)return null;const hash=crypto.createHash('sha256').update(token).digest('hex');const q=await db().query('select u.id,u.full_name,u.phone,u.role,u.vehicles,t.id as transportadora_id from zap_app.zap_login_sessions s join zap_app.app_users u on u.id=s.user_id left join zap_app.transportadoras t on t.usuario_principal_id=u.id where s.token_hash=$1 and s.expires_at>now() limit 1',[hash]);return q.rows[0]||null;}
function cookie(res,token,age){res.setHeader('Set-Cookie','zap_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age);}
module.exports=async function handler(req,res){
 const url=new URL(req.url||'/', 'https://localhost');const path=url.searchParams.has('health')?'/health':url.searchParams.has('auth')?'/api/auth/'+url.searchParams.get('auth'):url.searchParams.has('admin')?'/api/admin/'+url.searchParams.get('admin'):url.searchParams.has('resource')?'/api/'+url.searchParams.get('resource'):url.pathname;
 try{
 if(path==='/health'){await db().query('select 1');return json(res,200,{ok:true,database:'postgresql',status:'connected'});}


 if(path==='/api/admin/transportadoras'||path==='/api/admin/reset-password'){
  const u=await session(req);
  if(!u)return json(res,401,{error:'Faça login como administrador'});
  if(u.role!=='administrador')return json(res,403,{error:'Acesso restrito à administração geral'});
  if(path==='/api/admin/transportadoras'&&req.method==='GET'){
   const r=await db().query("select t.id,t.nome,u.id as usuario_id,u.full_name from zap_app.transportadoras t join zap_app.app_users u on u.id=t.usuario_principal_id order by t.id");
   return json(res,200,{ok:true,transportadoras:r.rows});
  }
  if(path==='/api/admin/reset-password'&&req.method==='POST'){
   const origin=req.headers.origin,host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
   if(origin&&new URL(origin).host!==host)return json(res,403,{error:'Origem não autorizada'});
   const b=typeof req.body==='object'&&req.body?req.body:JSON.parse(String(req.body||'{}'));
   const id=Number(b.transportadora_id),password=b.nova_senha;
   if(!Number.isSafeInteger(id)||id<1||typeof password!=='string'||password.length<12||Buffer.byteLength(password)>256||!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password))return json(res,400,{error:'Use uma senha com pelo menos 12 caracteres, letras e números'});
   const salt=crypto.randomBytes(16).toString('hex'),encoded='scrypt:'+salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
   const client=await db().connect();
   try{await client.query('BEGIN');
    const r=await client.query('update zap_app.app_users u set password_hash=$1 from zap_app.transportadoras t where t.usuario_principal_id=u.id and t.id=$2 and u.role=$3 returning u.id',[encoded,id,'transportadora']);
    if(!r.rowCount){await client.query('ROLLBACK');return json(res,404,{error:'Transportadora não encontrada'});}
    await client.query('delete from zap_app.zap_login_sessions where user_id=$1',[r.rows[0].id]);
    await client.query('COMMIT');return json(res,200,{ok:true,mensagem:'Senha atualizada e sessões anteriores encerradas'});
   }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  return json(res,405,{error:'Método não permitido'});
 }
 if(path==='/api/financeiro'){
  const u=await session(req);
  if(!u)return json(res,401,{error:'Autenticação necessária'});
  if(u.role!=='transportadora'||!u.transportadora_id)return json(res,403,{error:'Transportadora não vinculada'});
  if(req.method==='GET'){
   const r=await db().query("select id,tipo,descricao,categoria,valor,vencimento,pago_em,status,origem_sistema,created_at from zap_app.financeiro_lancamentos where transportadora_id=$1 order by id desc limit 500",[u.transportadora_id]);
   const totals=await db().query("select tipo,status,coalesce(sum(valor),0) as total from zap_app.financeiro_lancamentos where transportadora_id=$1 group by tipo,status",[u.transportadora_id]);
   return json(res,200,{ok:true,items:r.rows,totals:totals.rows});
  }
  if(req.method==='POST'){
   const origin=req.headers.origin,host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
   if(origin&&new URL(origin).host!==host)return json(res,403,{error:'Origem não autorizada'});
   const b=typeof req.body==='object'&&req.body?req.body:JSON.parse(String(req.body||'{}'));
   const tipo=b.tipo,descricao=String(b.descricao||'').trim(),categoria=String(b.categoria||'geral').trim().slice(0,100);
   const valor=Number(b.valor),status=b.status||'pendente',vencimento=b.vencimento||null;
   if(!['receita','despesa'].includes(tipo)||descricao.length<3||descricao.length>240||!Number.isFinite(valor)||valor<=0||valor>100000000||!['pendente','pago'].includes(status)||vencimento&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(vencimento))return json(res,400,{error:'Dados financeiros inválidos'});
   const r=await db().query("insert into zap_app.financeiro_lancamentos(transportadora_id,tipo,descricao,categoria,valor,vencimento,status,pago_em,criado_por) values($1,$2,$3,$4,$5,$6,$7,case when $7='pago' then now() else null end,$8) returning id,tipo,descricao,categoria,valor,vencimento,status",[u.transportadora_id,tipo,descricao,categoria,valor,vencimento,status,u.id]);
   return json(res,201,{ok:true,item:r.rows[0]});
  }
  return json(res,405,{error:'Método não permitido'});
 }
 if(path==='/api/clients' || path==='/api/orders'){
  const u=await session(req);if(!u)return json(res,401,{error:'Autenticação necessária'});
  if(u.role!=='transportadora' || !u.transportadora_id)return json(res,403,{error:'Transportadora não vinculada'});
  const isClients=path==='/api/clients';const table=isClients?'zap_app.zap_quick_clients':'zap_app.zap_order_entries';
  if(req.method==='GET'){
   const q=await db().query('select * from '+table+' where transportadora_id=$1 order by id desc limit 200',[u.transportadora_id]);
   return json(res,200,{ok:true,items:q.rows});
  }
  if(req.method==='POST'&&isClients){
   const b=typeof req.body==='object'&&req.body?req.body:JSON.parse(String(req.body||'{}'));
   const name=String(b.name||'').trim(),phone=String(b.phone||'').replace(/\D/g,'');
   if(name.length<2||name.length>160||phone.length>20)return json(res,400,{error:'Cliente inválido'});
   const q=await db().query('insert into zap_app.zap_quick_clients(owner_user_id,transportadora_id,name,contact_name,document_number,phone,address,latitude,longitude) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',[u.id,u.transportadora_id,name,String(b.contact_name||''),String(b.document_number||''),phone,String(b.address||''),Number.isFinite(Number(b.latitude))&&b.latitude!=null?Number(b.latitude):null,Number.isFinite(Number(b.longitude))&&b.longitude!=null?Number(b.longitude):null]);
   return json(res,201,{ok:true,item:q.rows[0]});
  }
  return json(res,405,{error:'Método não permitido'});
 }
 if(!path.startsWith('/api/auth/'))return json(res,404,{error:'Rota não encontrada'});
 if(path==='/api/auth/me'&&req.method==='GET'){const u=await session(req);return json(res,u?200:401,u?{ok:true,user:userView(u)}:{ok:false,error:'Sessão não encontrada'});}
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 const origin=req.headers.origin;const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
 if(origin&&new URL(origin).host!==host)return json(res,403,{error:'Origem não autorizada'});
 if(path==='/api/auth/logout'){const t=parseCookie(req);if(t)await db().query('delete from zap_app.zap_login_sessions where token_hash=$1',[crypto.createHash('sha256').update(t).digest('hex')]);cookie(res,'',0);return json(res,200,{ok:true});}
 const b=typeof req.body==='object'&&req.body?req.body:JSON.parse(String(req.body||'{}'));
 const phone=String(b.phone||'').replace(/\D/g,'');const password=b.password;
 if(!/^\d{10,11}$/.test(phone)||typeof password!=='string'||password.length<6||Buffer.byteLength(password)>256)return json(res,400,{error:'Informe telefone com DDD e senha de pelo menos 6 caracteres.'});
 let u;
 if(path==='/api/auth/login'){
 const q=await db().query('select u.id,u.full_name,u.phone,u.password_hash,u.role,u.vehicles,t.id as transportadora_id from zap_app.app_users u left join zap_app.transportadoras t on t.usuario_principal_id=u.id where u.phone=$1 limit 1',[phone]);u=q.rows[0];
 const parts=String(u?.password_hash||'').split(':');let valid=false;
 if(parts.length===3&&parts[0]==='scrypt'&&/^[a-f0-9]{32}$/.test(parts[1])&&/^[a-f0-9]{128}$/.test(parts[2])){const hash=crypto.scryptSync(password,parts[1],64);valid=crypto.timingSafeEqual(hash,Buffer.from(parts[2],'hex'));}
 if(!valid)return json(res,401,{error:'Telefone ou senha incorretos.'});
 if(b.role&&b.role!==u.role)return json(res,403,{error:'Esta conta pertence a outro tipo de acesso.'});
 }else if(path==='/api/auth/register'){
 const name=String(b.name||'').trim().replace(/\s+/g,' ');const role=b.role==='transportadora'?'transportadora':'motorista';const vehicles=Array.isArray(b.vehicles)?b.vehicles.filter(v=>['moto','carro','utilitario'].includes(v)).slice(0,3):[];const city=String(b.city||'').trim();const cities=['Goiânia','Anápolis','Leopoldo de Bulhões','Silvânia','Vianópolis','Bonfinópolis'];
 if(name.length<3||name.length>160||(role==='motorista'&&(!vehicles.length||!cities.includes(city))))return json(res,400,{error:'Informe nome, cidade e veículo válido.'});
 const salt=crypto.randomBytes(16).toString('hex');const encoded='scrypt:'+salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
 try{const q=await db().query('insert into zap_app.app_users(full_name,phone,password_hash,role,vehicles,city) values($1,$2,$3,$4,$5,$6) returning id,full_name,phone,role,vehicles',[name,phone,encoded,role,vehicles.join(','),role==='motorista'?city:null]);u=q.rows[0];if(role==='transportadora'){const t=await db().query('insert into zap_app.transportadoras(nome,usuario_principal_id) values($1,$2) returning id',[name,u.id]);u.transportadora_id=t.rows[0].id;}}catch(e){if(e.code==='23505')return json(res,409,{error:'Telefone já cadastrado. Faça login.'});throw e;}
 }else return json(res,404,{error:'Rota não encontrada'});
 const token=crypto.randomBytes(32).toString('hex');await db().query("insert into zap_app.zap_login_sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '7 days')",[crypto.createHash('sha256').update(token).digest('hex'),u.id]);cookie(res,token,604800);return json(res,200,{ok:true,user:userView(u)});
 }catch(e){console.error('[PG API]',e.code||'ERROR',e.message);return json(res,503,{error:'Serviço temporariamente indisponível',code:e.code||'DB_UNAVAILABLE'});}
};