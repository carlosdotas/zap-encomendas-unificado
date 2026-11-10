'use strict';
// Baixa financeira isolada do fluxo operacional; backend MySQL atual.
// Não importa nem cobra pedidos históricos.
function money(v){if(typeof v!=='string'&&typeof v!=='number')return null;const s=String(v).trim();if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=BigInt(a)*100n+BigInt((b+'00').slice(0,2));return n>0n&&n<=1000000000000n?n:null;}
function format(n){return (Number(n)/100).toFixed(2);}
function originOK(req){if(!req.headers.origin)return true;try{return new URL(req.headers.origin).host===String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim()}catch{return false}}
function parse(req){return new Promise((resolve,reject)=>{let s='',done=false;req.on('data',b=>{if(done)return;s+=b;if(s.length>10000){done=true;reject(Error('Requisição muito grande'));req.resume()}});req.on('end',()=>{if(done)return;try{resolve(JSON.parse(s||'{}'))}catch{reject(Error('JSON inválido'))}});req.on('error',reject)})}
function createFinancialRoutes({getPool,getSession,sendJson,ensureDatabase,databaseReady}){
 return async function financeRoutes(req,res,path){
  const match=path.match(/^\/api\/finance\/orders\/(\d+)\/(?:payment|payments)$/);
  if(!match)return false;
  if(!['GET','POST'].includes(req.method)){sendJson(res,405,{error:'Método não permitido'});return true}
  await ensureDatabase();
  if(!databaseReady()){sendJson(res,503,{error:'Banco indisponível'});return true}
  const user=await getSession(req);
  if(!user){sendJson(res,401,{error:'Autenticação necessária'});return true}
  if(!['transportadora','administrador'].includes(user.role)){sendJson(res,403,{error:'Acesso financeiro não autorizado'});return true}
  if(req.method==='POST'&&!originOK(req)){sendJson(res,403,{error:'Origem não autorizada'});return true}
  const id=match[1],conn=await getPool().getConnection();
  try{
   if(req.method==='GET'){
    const [orders]=await conn.execute('SELECT id,owner_user_id,value_items FROM zap_order_entries WHERE id=?',[id]);
    if(!orders.length||user.role!=='administrador'&&String(orders[0].owner_user_id)!==String(user.id)){sendJson(res,404,{error:'Pedido não encontrado'});return true}
    const [payments]=await conn.execute('SELECT id,amount,method,received_by_name,paid_at,created_at FROM zap_order_payments WHERE order_id=? ORDER BY id',[id]);
    const [totals]=await conn.execute('SELECT COALESCE(SUM(amount),0) AS total FROM zap_order_payments WHERE order_id=?',[id]);
    sendJson(res,200,{ok:true,orderId:id,paidAmount:String(totals[0].total),payments:payments.map(p=>({...p,id:String(p.id)}))});return true;
   }
   let body;try{body=await parse(req)}catch{sendJson(res,400,{error:'Dados inválidos'});return true}
   const cents=money(body.amount),method=String(body.method||'').trim(),key=String(body.idempotencyKey||'').trim();
   if(cents===null||!['pix','dinheiro','cartao','transferencia','outro'].includes(method)||!/^[A-Za-z0-9_-]{16,100}$/.test(key)){sendJson(res,400,{error:'Informe valor positivo, forma de pagamento e idempotencyKey de 16 a 100 caracteres'});return true}
   const paidAt=body.paidAt==null?null:String(body.paidAt);
   if(paidAt!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)||Number.isNaN(Date.parse(paidAt+'T12:00:00Z')))){sendJson(res,400,{error:'Data de pagamento inválida'});return true}
   await conn.beginTransaction();
   const [orders]=await conn.execute('SELECT id,owner_user_id,value_items FROM zap_order_entries WHERE id=? FOR UPDATE',[id]);
   if(!orders.length||user.role!=='administrador'&&String(orders[0].owner_user_id)!==String(user.id)){await conn.rollback();sendJson(res,404,{error:'Pedido não encontrado'});return true}
   const [existing]=await conn.execute('SELECT id,order_id,amount,method FROM zap_order_payments WHERE idempotency_key=? LIMIT 1',[key]);
   if(existing.length){
    await conn.rollback();
    if(String(existing[0].order_id)!==id||String(existing[0].amount)!==format(cents)||existing[0].method!==method){sendJson(res,409,{error:'Chave de idempotência já utilizada com outros dados'});return true}
    sendJson(res,200,{ok:true,alreadyProcessed:true,paymentId:String(existing[0].id)});return true;
   }
   // value_items não contém necessariamente o preço final; não inferir total.
   // Sem total contratual confirmado, registrar recebimento sem marcar quitação integral.
   const [insert]=await conn.execute('INSERT INTO zap_order_payments (order_id,owner_user_id,amount,method,received_by_user_id,received_by_name,paid_at,idempotency_key) VALUES (?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?)',[id,orders[0].owner_user_id,format(cents),method,user.id,user.full_name||null,paidAt?paidAt+' 12:00:00':null,key]);
   await conn.commit();
   sendJson(res,201,{ok:true,paymentId:String(insert.insertId),orderId:id,amount:format(cents),status:'recebimento_registrado',fullyPaid:null});
  }catch(e){try{await conn.rollback()}catch{};if(e.code==='ER_DUP_ENTRY'){sendJson(res,409,{error:'Pagamento já registrado'});return true}console.error('[FINANCE]',e.code||'ERROR');sendJson(res,500,{error:'Não foi possível registrar pagamento'});}
  finally{conn.release()}
  return true;
 }
}
module.exports={createFinancialRoutes,money};
