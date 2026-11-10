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



 if(path==='/api/admin/import-legacy'||(path==='/api/admin/overview'&&url.searchParams.get('migration')==='1')){
  const u=await session(req);if(!u)return json(res,401,{error:'Faça login'});
  if(u.role!=='administrador')return json(res,403,{error:'Acesso restrito'});
  if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
  const origin=req.headers.origin,host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
  if(origin&&new URL(origin).host!==host)return json(res,403,{error:'Origem não autorizada'});
  const b=typeof req.body==='object'&&req.body?req.body:JSON.parse(String(req.body||'{}'));
  const rows=b.rows,allowed=new Set(['caixa_lancamentos','company','drivers','driver_tracking','locais','locations','merchandises','order_logs','orders','users','bills','clients','customers','config_cities']);
  if(!Array.isArray(rows)||rows.length<1||rows.length>300)return json(res,400,{error:'Envie de 1 a 300 registros por lote'});
  for(let i=0;i<rows.length;i++){const r=rows[i];if(!r||!allowed.has(r.source_table)||!Number.isSafeInteger(r.source_id)||r.source_id<0||!r.payload||typeof r.payload!=='object'||Array.isArray(r.payload)||JSON.stringify(r.payload).length>30000)return json(res,400,{error:'Registro de importação inválido',index:i,source_table:r?.source_table||null,source_id:r?.source_id??null});}
  const payload=JSON.stringify(rows);
  if(Buffer.byteLength(payload,'utf8')>1500000)return json(res,413,{error:'Lote muito grande. Reduza a quantidade de registros.'});
  const result=await db().query(`insert into legacy_hostinger.raw_records(source_table,source_id,payload)
    select source_table,source_id,payload
    from jsonb_to_recordset($1::jsonb) as x(source_table text,source_id bigint,payload jsonb)
    on conflict(source_table,source_id) do update set payload=excluded.payload
    where legacy_hostinger.raw_records.payload is distinct from excluded.payload`,[payload]);
  return json(res,200,{ok:true,processed:rows.length,changed:result.rowCount,mode:'staging'});
 }
 if(['/api/admin/overview','/api/admin/drivers','/api/admin/carriers','/api/admin/administrators','/api/admin/orders'].includes(path)){
  const u=await session(req);if(!u)return json(res,401,{error:'Faça login'});
  if(u.role!=='administrador')return json(res,403,{error:'Acesso restrito'});
  if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
  if(path==='/api/admin/overview'){
   const users=await db().query("select role,count(*)::int as count from zap_app.app_users group by role");
   const orders=await db().query("select count(*)::int as total from zap_app.zap_order_entries"); const statuses=await db().query("select status,count(*)::int as total from zap_app.zap_order_entries group by status"); const recent=await db().query("select o.id,o.place,o.client_name,o.service_type,o.status,o.created_at,t.nome as carrier_name from zap_app.zap_order_entries o left join zap_app.transportadoras t on t.id=o.transportadora_id order by o.id desc limit 100");
   const carriers=await db().query("select count(*)::int as total from zap_app.transportadoras");
   const roles=Object.fromEntries(users.rows.map(r=>[r.role,r.count]));roles.transportadora=carriers.rows[0].total;
   return json(res,200,{ok:true,users:roles,orders:{total:orders.rows[0].total,byStatus:Object.fromEntries(statuses.rows.map(x=>[x.status,x.total]))},recentOrders:recent.rows});
  }
  const page=Math.max(1,Math.min(10000,parseInt(url.searchParams.get('page'),10)||1)),limit=25,term=String(url.searchParams.get('search')||'').slice(0,100);
  const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';
  if(path==='/api/admin/orders'){
   const count=await db().query("select count(*)::int as total from zap_app.zap_order_entries");
   const rows=await db().query("select o.id,o.place,o.client_name,o.service_type,o.status,o.created_at,t.nome as carrier_name from zap_app.zap_order_entries o left join zap_app.transportadoras t on t.id=o.transportadora_id order by o.id desc limit 25 offset $1",[(page-1)*limit]);
   return json(res,200,{ok:true,items:rows.rows,total:count.rows[0].total,limit});
  }
  const isCarriers=path==='/api/admin/carriers';
  const role=path==='/api/admin/drivers'?'motorista':isCarriers?'transportadora':'administrador';
  const from=isCarriers?"zap_app.transportadoras t left join zap_app.app_users u on u.id=t.usuario_principal_id":"zap_app.app_users u";
  const where=isCarriers?"where (t.nome ilike $1 or coalesce(u.phone,'') ilike $1)":"where u.role=$3 and (u.full_name ilike $1 or u.phone ilike $1)";
  const params=isCarriers?[pattern, (page-1)*limit]:[pattern,(page-1)*limit,role];
  const count=await db().query("select count(*)::int as total from "+from+" "+where.replace('$3','$2'),isCarriers?[pattern]:[pattern,role]);
  const fields=isCarriers?"t.id,t.nome as full_name,u.phone,u.id as usuario_id,t.created_at, '' as vehicles":"u.id,u.full_name,u.phone,u.vehicles,u.created_at";
  const rows=await db().query("select "+fields+" from "+from+" "+where+" order by "+(isCarriers?'t.id':'u.id')+" desc limit 25 offset $2",params);
  return json(res,200,{ok:true,items:rows.rows,total:count.rows[0].total,limit});
 }
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
   const page=Math.max(0,Math.min(10000,Number.parseInt(url.searchParams.get('page')||'0',10)||0)),limit=Math.max(1,Math.min(100,Number.parseInt(url.searchParams.get('limit')||'100',10)||100));
   const r=await db().query("select id,tipo,descricao,categoria,valor,vencimento,pago_em,status,origem_sistema,created_at from zap_app.financeiro_lancamentos where transportadora_id=$1 order by id desc limit $2 offset $3",[u.transportadora_id,limit+1,page*limit]);
   const totals=await db().query("select tipo,status,coalesce(sum(valor),0) as total from zap_app.financeiro_lancamentos where transportadora_id=$1 group by tipo,status",[u.transportadora_id]);
   return json(res,200,{ok:true,items:r.rows.slice(0,limit),hasMore:r.rows.length>limit,page,totals:totals.rows});
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
 if(path==='/api/carrier/pending-orders'){
  const u=await session(req);if(!u)return json(res,401,{error:'Autenticação necessária'});
  if(u.role!=='transportadora'||!u.transportadora_id)return json(res,403,{error:'Transportadora não vinculada'});
  if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
  const active=await db().query("select id,client_name,place,address,status,created_at,pickup_date,service_type,vehicle_type,legacy_order_id from zap_app.zap_order_entries where transportadora_id=$1 and legacy_order_id is null order by created_at desc limit 500",[u.transportadora_id]);
  const legacy=Number(u.transportadora_id)===1?await db().query("select legacy_order_id as id,client_name,place,stage as status,pickup_date::text as order_date,source_created_at as created_at,service_type,vehicle_type,total_value,payment_status from zap_app.legacy_orders_normalized where coalesce(payment_status,'') not in ('pago','paid') order by pickup_date desc nulls last,source_created_at desc nulls last,legacy_order_id desc limit 500"): {rows:[]};
  const items=[...active.rows.filter(x=>!['pago','paid'].includes(String(x.payment_status||'').toLowerCase())).map(x=>({...x,origin:'current',order_id:x.id})),...legacy.rows.map(x=>({...x,origin:'legacy',order_id:x.id}))].sort((a,b)=>{const da=Date.parse(a.order_date||a.created_at||'')||0,db=Date.parse(b.order_date||b.created_at||'')||0;return db-da||Number(b.order_id)-Number(a.order_id)});
  return json(res,200,{ok:true,items});
 }
 if(path==='/api/carrier/actionable-orders'){
  const u=await session(req);if(!u)return json(res,401,{error:'Autenticação necessária'});
  if(u.role!=='transportadora'||!u.transportadora_id)return json(res,403,{error:'Transportadora não vinculada'});
  if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
  const page=Math.max(0,Math.min(10000,Number.parseInt(url.searchParams.get('page')||'0',10)||0));
  const term=String(url.searchParams.get('q')||'').trim().slice(0,100);
  const where="o.transportadora_id=$1 and o.legacy_order_id is not null and (coalesce(l.payload->>'stage','') not in ('finalizado','entregue') or coalesce(l.payload->>'payment_status','') not in ('pago','paid')) and ($2='' or o.client_name ilike '%'||$2||'%' or o.place ilike '%'||$2||'%' or o.legacy_order_id::text=$2)";
  const base=" from zap_app.zap_order_entries o join legacy_hostinger.raw_records l on l.source_table='orders' and l.source_id=o.legacy_order_id where "+where;
  const r=await db().query("select o.id,o.legacy_order_id,o.place,o.address,o.client_name,o.service_type,o.vehicle_type,o.created_at,l.payload->>'date' order_date,l.payload->>'stage' original_stage,l.payload->>'payment_status' payment_status,l.payload->>'total' total_value"+base+" order by o.pickup_date desc nulls last,o.created_at desc,o.id desc limit 31 offset $3",[u.transportadora_id,term,page*30]);
  const total=await db().query("select count(*)::int n"+base,[u.transportadora_id,term]);
  return json(res,200,{ok:true,items:r.rows.slice(0,30),total:total.rows[0].n,hasMore:r.rows.length>30,page});
 }
 if(path==='/api/carrier/history'){
  const u=await session(req);if(!u)return json(res,401,{error:'Autenticação necessária'});
  if(u.role!=='transportadora'||!u.transportadora_id)return json(res,403,{error:'Transportadora não vinculada'});
  if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
  const page=Math.max(0,Math.min(10000,Number.parseInt(url.searchParams.get('page')||'0',10)||0));
  const term=String(url.searchParams.get('q')||'').trim().slice(0,100);
  const stage=String(url.searchParams.get('stage')||'todos');
  const stageFilter=stage==='concluidos'?"and o.legacy_stage in ('finalizado','entregue')":stage==='andamento'?"and o.legacy_stage not in ('finalizado','entregue')":'';
  const where="o.transportadora_id=$1 and o.legacy_order_id is not null and ($2='' or o.client_name ilike '%'||$2||'%' or o.place ilike '%'||$2||'%' or o.legacy_order_id::text=$2 or coalesce(l.payload->>'client_name','') ilike '%'||$2||'%') "+stageFilter;
  const base=" from zap_app.zap_order_entries o left join legacy_hostinger.raw_records l on l.source_table='orders' and l.source_id=o.legacy_order_id where "+where;
  const result=await db().query("select o.id,o.legacy_order_id,o.legacy_stage,o.place,o.address,o.service_type,o.vehicle_type,o.client_name,o.client_phone,o.created_at,o.pickup_date,l.payload->>'order_type' original_type,coalesce(o.pickup_date::text,l.payload->>'date') order_date,l.payload->>'total' total_value,l.payload->>'payment_status' payment_status,l.payload->>'orig_city' origin_city,l.payload->>'dest_city' destination_city,l.payload->>'orig_name' origin_name,l.payload->>'dest_name' destination_name,l.payload->>'notes' original_notes"+base+" order by o.created_at desc,o.id desc limit 31 offset $3",[u.transportadora_id,term,page*30]);
  const total=await db().query("select count(*)::int n"+base,[u.transportadora_id,term]);
  return json(res,200,{ok:true,items:result.rows.slice(0,30),hasMore:result.rows.length>30,total:total.rows[0].n,page});
 }
 if(path==='/api/clients' || path==='/api/orders'){
  const u=await session(req);if(!u)return json(res,401,{error:'Autenticação necessária'});
  if(u.role!=='transportadora' || !u.transportadora_id)return json(res,403,{error:'Transportadora não vinculada'});
  const isClients=path==='/api/clients';const table=isClients?'zap_app.zap_quick_clients':'zap_app.zap_order_entries';
  if(req.method==='GET'){
   const q=await db().query(isClients?'select * from zap_app.zap_quick_clients where transportadora_id=$1 order by name asc limit 1000':'select * from zap_app.zap_order_entries where transportadora_id=$1 and legacy_order_id is null order by id desc limit 200',[u.transportadora_id]);
   return json(res,200,isClients?{ok:true,items:q.rows,clients:q.rows.map(c=>({...c,contactName:c.contact_name,document:c.document_number,lat:c.latitude,lng:c.longitude}))}:{ok:true,items:q.rows,orders:q.rows.map(o=>({...o,client:o.client_name,clientPhone:o.client_phone,vehicle:o.vehicle_type,service:o.service_type,lat:o.latitude,lng:o.longitude,instructions:o.instructions,carrier:'Zap Encomendas'}))});
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