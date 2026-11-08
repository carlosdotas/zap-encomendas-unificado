'use strict';

// ZAP ENCOMENDAS - servidor único Node.js + MySQL
// Configure DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME na hospedagem.
// O código nunca envia credenciais para o navegador.
const http = require('node:http');
const fs = require('node:fs');
const pathModule = require('node:path');
const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const {WebSocketServer,WebSocket}=require('ws');
const nativePush=require('./native-push');
const {apkDownload}=require('./apk-download');
const locationInput=require('./location-input');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_NAME = process.env.DB_NAME || '';
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 10000,
  charset: 'utf8mb4'
};
let pool = null;
let databaseStatus = { ok: false, message: 'Aguardando configuração MySQL', checkedAt: null };
let migrationStatus = 'pendente';
let lastDatabaseError = null;
let lastAttemptAt = 0;
let connectionTask = null;

const migrations = [
  [1, [
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS carriers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS clients (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, carrier_id BIGINT UNSIGNED NOT NULL DEFAULT 1, name VARCHAR(160) NOT NULL, phone VARCHAR(30) NOT NULL, address VARCHAR(500) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_client_phone (carrier_id,phone), KEY idx_clients_name (name)) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS drivers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, carrier_id BIGINT UNSIGNED NOT NULL DEFAULT 1, name VARCHAR(160) NOT NULL, phone VARCHAR(30) NOT NULL, vehicle_type VARCHAR(30) NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_driver_phone (carrier_id,phone)) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS orders (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, carrier_id BIGINT UNSIGNED NOT NULL DEFAULT 1, client_id BIGINT UNSIGNED NULL, driver_id BIGINT UNSIGNED NULL, place VARCHAR(255) NOT NULL, address VARCHAR(600) NULL, latitude DECIMAL(10,7) NULL, longitude DECIMAL(10,7) NULL, service_type VARCHAR(40) NOT NULL DEFAULT 'coleta', vehicle_type VARCHAR(40) NOT NULL DEFAULT 'moto', instructions TEXT NULL, status VARCHAR(40) NOT NULL DEFAULT 'aguardando_motorista', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, KEY idx_orders_status (status), KEY idx_orders_client (client_id), KEY idx_orders_driver (driver_id)) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS api_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, event_type VARCHAR(100) NOT NULL, detail VARCHAR(500) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, KEY idx_events_date (created_at)) ENGINE=InnoDB"
  ]],
  [2, [
    "CREATE TABLE IF NOT EXISTS app_users (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, full_name VARCHAR(160) NOT NULL, phone VARCHAR(20) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, role ENUM('motorista','transportadora') NOT NULL DEFAULT 'motorista', vehicles VARCHAR(100) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS auth_sessions (token_hash CHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, expires_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, KEY idx_sessions_user (user_id), KEY idx_sessions_expiry (expires_at)) ENGINE=InnoDB"
  ]],
  [3, [
    "CREATE TABLE IF NOT EXISTS zap_login_sessions (token_hash CHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, expires_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, KEY idx_zap_login_user (user_id), KEY idx_zap_login_expiry (expires_at)) ENGINE=InnoDB"
  ]],
  [4, [
    "CREATE TABLE IF NOT EXISTS zap_order_entries (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_user_id BIGINT UNSIGNED NOT NULL, place VARCHAR(255) NOT NULL, address VARCHAR(600) NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, service_type ENUM('coleta','entrega','troca') NOT NULL, vehicle_type ENUM('moto','carro','utilitario') NOT NULL, client_name VARCHAR(160) NOT NULL, client_phone VARCHAR(20) NULL, instructions TEXT NULL, status VARCHAR(40) NOT NULL DEFAULT 'aguardando_motorista', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, KEY idx_zap_orders_owner (owner_user_id), KEY idx_zap_orders_status (status)) ENGINE=InnoDB"
  ]],
  [5, [
    "CREATE TABLE IF NOT EXISTS zap_locations (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, place_id VARCHAR(255) NULL, name VARCHAR(255) NOT NULL, address VARCHAR(600) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, source ENUM('google','pedido') NOT NULL DEFAULT 'google', expires_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_zap_location_place (place_id), KEY idx_zap_location_name (name(100)), KEY idx_zap_location_expiry (expires_at)) ENGINE=InnoDB"
  ]],
  [6, [
    "CREATE TABLE IF NOT EXISTS zap_quick_clients (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_user_id BIGINT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL, contact_name VARCHAR(160) NOT NULL, document_number VARCHAR(14) NOT NULL, phone VARCHAR(20) NOT NULL, address VARCHAR(600) NOT NULL, latitude DECIMAL(10,7) NULL, longitude DECIMAL(10,7) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, KEY idx_quick_owner (owner_user_id), KEY idx_quick_name (name)) ENGINE=InnoDB"
  ]],
  [7, [
    "CREATE TABLE IF NOT EXISTS zap_location_aliases (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_user_id BIGINT UNSIGNED NOT NULL, place_id VARCHAR(255) NULL, custom_name VARCHAR(255) NOT NULL, address VARCHAR(600) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_alias_owner_place (owner_user_id,place_id), KEY idx_alias_name (custom_name(100))) ENGINE=InnoDB"
   ]] ,
  [8, ["ALTER TABLE app_users MODIFY COLUMN role ENUM('motorista','transportadora','administrador') NOT NULL DEFAULT 'motorista'"]],
  [9, ["ALTER TABLE zap_order_entries ADD COLUMN closes_at TIME NULL"]],
  [10, ["ALTER TABLE zap_order_entries ADD COLUMN driver_id BIGINT UNSIGNED NULL", "ALTER TABLE zap_order_entries ADD INDEX idx_zap_order_driver (driver_id)"]],
  [11, ["CREATE TABLE IF NOT EXISTS zap_driver_positions (user_id BIGINT UNSIGNED PRIMARY KEY, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, accuracy FLOAT NOT NULL, captured_at DATETIME NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB"]],
  [12, ["CREATE TABLE IF NOT EXISTS zap_carrier_driver_settings (carrier_id BIGINT UNSIGNED PRIMARY KEY, configured TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB", "CREATE TABLE IF NOT EXISTS zap_carrier_allowed_drivers (carrier_id BIGINT UNSIGNED NOT NULL, driver_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY (carrier_id,driver_id), KEY idx_allowed_driver (driver_id)) ENGINE=InnoDB"]],
  [13, ["ALTER TABLE zap_order_entries ADD COLUMN value_items JSON NULL"]],
  [14, ["CREATE TABLE IF NOT EXISTS zap_order_proofs (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL, driver_id BIGINT UNSIGNED NOT NULL, action ENUM('coleta','entrega','troca') NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_order_action (order_id,action), KEY idx_proof_order (order_id), KEY idx_proof_driver (driver_id)) ENGINE=InnoDB", "CREATE TABLE IF NOT EXISTS zap_order_proof_photos (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, proof_id BIGINT UNSIGNED NOT NULL, mime_type VARCHAR(32) NOT NULL, image_data LONGBLOB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, KEY idx_proof_photo (proof_id)) ENGINE=InnoDB"]]
];

function configured() { return Boolean(DB_CONFIG.user && DB_NAME); }
function safeErrorCode(err) { return String(err?.code || 'ERRO_DESCONHECIDO').replace(/[^A-Z0-9_]/g,'').slice(0,60); }
function dbErrorHint(code) { const hints={ER_NO_SUCH_TABLE:'Tabela de autenticação não existe. Verifique as migrações e permissões CREATE TABLE.',ER_BAD_FIELD_ERROR:'A tabela existente tem colunas incompatíveis com o cadastro.',ER_ACCESS_DENIED_ERROR:'Credenciais ou permissões MySQL incorretas.',ER_DBACCESS_DENIED_ERROR:'Usuário sem acesso ao banco configurado.',ER_TABLEACCESS_DENIED_ERROR:'Usuário sem permissão nas tabelas.',ER_BAD_DB_ERROR:'Banco DB_NAME não existe.',ECONNREFUSED:'MySQL recusou a conexão: confira DB_HOST e DB_PORT.',ENOTFOUND:'Endereço DB_HOST não encontrado.',ETIMEDOUT:'Conexão MySQL expirou.',ER_DUP_ENTRY:'Já existe cadastro com esses dados.',ER_NO_REFERENCED_ROW_2:'Uma chave estrangeira aponta para registro ausente. Verifique as relações da tabela mencionada nos logs.'};return hints[code]||'Consulte o código do erro nos logs da hospedagem.'; }

async function reconcileAuthSchema() {
  // CREATE IF NOT EXISTS nao modifica tabelas antigas; corrigir apenas colunas ausentes.
  const tables = {
    app_users: {
      full_name:"VARCHAR(160) NULL",
      phone:"VARCHAR(20) NULL",
      password_hash:"VARCHAR(255) NULL",
      role:"ENUM('motorista','transportadora') NOT NULL DEFAULT 'motorista'",
      vehicles:"VARCHAR(100) NULL",
      created_at:"TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
    },
    zap_login_sessions: {
      token_hash:"CHAR(64) NULL",
      user_id:"BIGINT UNSIGNED NULL",
      expires_at:"DATETIME NULL",
      created_at:"TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
    }
  };
  for(const [table,expected] of Object.entries(tables)) {
    const [cols]=await pool.query('SHOW COLUMNS FROM `'+table+'`');
    const existing=new Set(cols.map(c=>c.Field));
    for(const [column,definition] of Object.entries(expected)) {
      if(!existing.has(column)) {
        console.log('[MIGRATION] Adicionando coluna '+table+'.'+column);
        await pool.query('ALTER TABLE `'+table+'` ADD COLUMN `'+column+'` '+definition);
      }
    }
  }
}

async function connectAndMigrate() {
  lastAttemptAt = Date.now();
  if (!configured()) {
    databaseStatus = {ok:false, message:'Configure DB_USER e DB_NAME nas variáveis de ambiente', checkedAt:new Date().toISOString()};
    migrationStatus = 'aguardando_configuracao';
    lastDatabaseError = !DB_CONFIG.user ? 'DB_USER_AUSENTE' : 'DB_NAME_AUSENTE';
    return;
  }
  try {
    if (!pool) pool = mysql.createPool(DB_CONFIG);
    await pool.query('SELECT 1');
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    const [applied] = await pool.query('SELECT version FROM schema_migrations');
    const versions = new Set(applied.map(row => Number(row.version)));
    for (const [version, statements] of migrations) {
      if (versions.has(version)) continue;
      for (const sql of statements) await pool.query(sql);
      await pool.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    }
    await reconcileAuthSchema();
    await pool.query("INSERT INTO carriers (id,name) VALUES (1,'Zap Encomendas') ON DUPLICATE KEY UPDATE id=id");
    await provisionInitialAdmin();
    databaseStatus = {ok:true, message:'MySQL conectado e estrutura verificada', checkedAt:new Date().toISOString()};
    migrationStatus = 'atualizado';
    lastDatabaseError = null;
  } catch (err) {
    databaseStatus = {ok:false, message:'Falha na conexão ou migração do MySQL', checkedAt:new Date().toISOString()};
    migrationStatus = 'erro';
    lastDatabaseError = safeErrorCode(err);
    console.error('[MYSQL]', err.code || 'ERROR', err.message);
  }
}

async function provisionInitialAdmin(){
 const phone=phoneDigits(process.env.ADMIN_PHONE||'');
 const password=process.env.ADMIN_PASSWORD||'';
 const name=String(process.env.ADMIN_NAME||'Administrador').trim();
 if(!process.env.ADMIN_PHONE&&!process.env.ADMIN_PASSWORD)return;
 if(!/^\d{10,11}$/.test(phone)||typeof password!=='string'||password.length<12||Buffer.byteLength(password)>256||name.length<3||name.length>160){
  console.error('[ADMIN] Credenciais iniciais inválidas: informe ADMIN_PHONE com DDD, ADMIN_PASSWORD com pelo menos 12 caracteres e ADMIN_NAME válido.');
  return;
 }
 const [existing]=await pool.execute('SELECT id,role FROM app_users WHERE phone=? LIMIT 1',[phone]);
 const reset=process.env.ADMIN_RESET_PASSWORD==='true';
 if(reset){
  if(!existing.length||existing[0].role!=='administrador'){
   console.error('[ADMIN] Redefinição recusada: ADMIN_PHONE deve corresponder a um administrador existente.');
   return;
  }
  const salt=crypto.randomBytes(16).toString('hex');
  const encoded='scrypt:'+salt+':'+hashPassword(password,salt);
  await pool.execute("UPDATE app_users SET password_hash=? WHERE id=? AND role='administrador'",[encoded,existing[0].id]);
  await pool.execute('DELETE FROM zap_login_sessions WHERE user_id=?',[existing[0].id]);
  console.log('[ADMIN] Senha do administrador redefinida. Remova ADMIN_RESET_PASSWORD e ADMIN_PASSWORD do ambiente e reinicie o servidor.');
  return;
 }
 const [[{total}]]=await pool.query("SELECT COUNT(*) AS total FROM app_users WHERE role='administrador'");
 if(Number(total)>0)return;
 if(existing.length){
  console.error('[ADMIN] O telefone informado já pertence a uma conta existente. Não alteramos seu perfil automaticamente.');
  return;
 }
 const salt=crypto.randomBytes(16).toString('hex');
 const encoded='scrypt:'+salt+':'+hashPassword(password,salt);
 await pool.execute("INSERT INTO app_users (full_name,phone,password_hash,role,vehicles) VALUES (?,?,?,'administrador','')",[name,phone,encoded]);
 console.log('[ADMIN] Conta administrativa inicial criada no MySQL.');
}

function ensureDatabase(force=false) {
  if(connectionTask) return connectionTask;
  if(!force && databaseStatus.ok && migrationStatus==='atualizado') return Promise.resolve();
  if(!force && Date.now()-lastAttemptAt < 10000) return Promise.resolve();
  connectionTask=connectAndMigrate().finally(()=>{connectionTask=null});
  return connectionTask;
}
function databaseDiagnostics() {
  return {
    configured:configured(),
    environment:{DB_HOST:Boolean(process.env.DB_HOST),DB_PORT:Boolean(process.env.DB_PORT),DB_NAME:Boolean(process.env.DB_NAME),DB_USER:Boolean(process.env.DB_USER),DB_PASSWORD:Boolean(process.env.DB_PASSWORD)},
    code:lastDatabaseError,
    hint:!configured()?'Defina DB_NAME e DB_USER nas variáveis de ambiente da hospedagem.':lastDatabaseError==='ECONNREFUSED'?'O endereço/porta do MySQL recusou a conexão. DB_HOST=127.0.0.1 só funciona se o banco estiver no mesmo servidor.':lastDatabaseError==='ENOTFOUND'?'DB_HOST não foi encontrado no DNS.':lastDatabaseError==='ETIMEDOUT'?'MySQL não respondeu. Confira host, porta e acesso remoto.':lastDatabaseError==='ER_ACCESS_DENIED_ERROR'?'Usuário ou senha MySQL incorretos ou sem permissão.':lastDatabaseError==='ER_BAD_DB_ERROR'?'O banco DB_NAME não existe; crie-o no painel.':lastDatabaseError==='ER_DBACCESS_DENIED_ERROR'?'Usuário MySQL não tem permissão neste banco.':lastDatabaseError==='ER_TABLEACCESS_DENIED_ERROR'?'Usuário MySQL não tem permissão para criar ou acessar tabelas.':'Confira a configuração do MySQL e os logs do servidor.'
  };
}

function sendJson(res, code, data) {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function homeHtml() {
  const dbOk = databaseStatus.ok;
  const label = dbOk ? 'Banco MySQL conectado' : 'Banco MySQL aguardando conexão';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zap Encomendas • Servidor</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f7f5;color:#173a35;font:16px system-ui,Arial,sans-serif;padding:20px}.card{width:min(100%,520px);background:white;padding:36px;border-radius:20px;box-shadow:0 12px 40px #123a2920}.logo{font-weight:800;color:#08765b;letter-spacing:.03em}.pill{display:inline-block;margin:18px 0 6px;padding:9px 13px;border-radius:40px;background:#e4f6ed;color:#076b45;font-weight:700}.warn{background:#fff1da;color:#945b00}h1{font-size:clamp(26px,5vw,38px);margin:12px 0}p{color:#536b64;line-height:1.6}.status{padding:16px;background:#f5f8f7;border-radius:12px;margin-top:20px}a{color:#08765b}</style></head><body><main class="card"><div class="logo">ZAP ENCOMENDAS</div><div class="pill">✓ Projeto Node.js online</div><h1>Servidor iniciado com sucesso!</h1><p>O aplicativo está respondendo. Esta é a primeira etapa da plataforma unificada.</p><div class="status"><strong class="${dbOk?'':'warn'}">${escapeHtml(label)}</strong><p>${escapeHtml(databaseStatus.message)}</p><p>Migrações: ${escapeHtml(migrationStatus)}</p></div><p>Verificação técnica: <a href="/health">/health</a></p><small>O frontend completo será integrado em uma próxima etapa.</small></main></body></html>`;
}

const attempts = new Map();
function rateLimit(req, key) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const id = ip + ':' + key;
  const now = Date.now();
  if (attempts.size > 3000) for (const [k,v] of attempts) if (v.until < now) attempts.delete(k);
  const value = attempts.get(id);
  if (!value || value.until < now) { attempts.set(id,{count:1,until:now+15*60*1000}); return false; }
  value.count++;
  return value.count > 12;
}
function readBody(req) {
  return new Promise((resolve,reject) => {
    let body = '', done = false;
    req.on('data', chunk => {
      if(done) return;
      body += chunk;
      if (body.length > 10000) {done=true; reject(new Error('Requisição muito grande')); req.destroy();}
    });
    req.on('end', () => {if(!done) {try {resolve(JSON.parse(body || '{}'));} catch {reject(new Error('JSON inválido'));}}});
    req.on('error', reject);
  });
}
function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g,'');
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
}
function hashPassword(password,salt) {
  return crypto.scryptSync(password,salt,64).toString('hex');
}
function secureEquals(a,b) {
  const x=Buffer.from(a,'hex'), y=Buffer.from(b,'hex');
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function setSessionCookie(req,res,token,maxAge) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto']==='https';
  res.setHeader('Set-Cookie','zap_session='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':''));
}

async function getSession(req) {
  if(!pool || !databaseStatus.ok) return null;
  const cookie=String(req.headers.cookie || '').match(/(?:^|;\s*)zap_session=([a-f0-9]{64})(?:;|$)/);
  if(!cookie) return null;
  const hash=crypto.createHash('sha256').update(cookie[1]).digest('hex');
  const [rows]=await pool.execute('SELECT u.id,u.full_name,u.phone,u.role,u.vehicles FROM zap_login_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1',[hash]);
  return rows[0] || null;
}
function publicUser(user) {
  return {id:user.id,name:user.full_name,phone:user.phone,role:user.role,vehicles:(user.vehicles || '').split(',').filter(Boolean)};
}
async function loginSession(req,res,user) {
  const token=crypto.randomBytes(32).toString('hex');
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  await pool.execute('INSERT INTO zap_login_sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))',[tokenHash,user.id]);
  setSessionCookie(req,res,token,7*24*60*60);
  sendJson(res,200,{ok:true,user:publicUser(user)});
}
async function authRoutes(req,res,path) {
  if(path==='/api/auth/me' && req.method==='GET') {
    const user=await getSession(req);
    sendJson(res,user?200:401,user?{ok:true,user:publicUser(user)}:{ok:false,error:'Sessão não encontrada'});
    return true;
  }
  if(!['/api/auth/register','/api/auth/login','/api/auth/logout'].includes(path) || req.method!=='POST') return false;
  if(req.headers.origin) {
    let originHost='';
    try{originHost=new URL(req.headers.origin).host;}catch{}
    const host=String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if(!originHost || originHost!==host){sendJson(res,403,{error:'Origem não autorizada'});return true;}
  }
  if(rateLimit(req,path)) {sendJson(res,429,{error:'Muitas tentativas. Aguarde 15 minutos.'});return true;}
  let body;
  try {body=await readBody(req)} catch(err) {sendJson(res,400,{error:'Corpo da requisição inválido.'});return true;}
  if(path==='/api/auth/logout') {
    nativePush.removeSession(req.headers.cookie);
    if(!pool||!databaseStatus.ok)await ensureDatabase();
    if(!pool||!databaseStatus.ok){setSessionCookie(req,res,'',0);sendJson(res,200,{ok:true});return true;}
    const match=String(req.headers.cookie||'').match(/(?:^|;\s*)zap_session=([a-f0-9]{64})(?:;|$)/);
    if(match) await pool.execute('DELETE FROM zap_login_sessions WHERE token_hash=?',[crypto.createHash('sha256').update(match[1]).digest('hex')]);
    setSessionCookie(req,res,'',0);sendJson(res,200,{ok:true});return true;
  }
  const phone=phoneDigits(body.phone), password=body.password;
  if(!pool||!databaseStatus.ok||migrationStatus!=='atualizado')await ensureDatabase();
  if(!pool||!databaseStatus.ok||migrationStatus!=='atualizado'){sendJson(res,503,{error:'Banco de dados indisponível',diagnostic:databaseDiagnostics()});return true;}
  if(!/^\d{10,11}$/.test(phone) || typeof password!=='string' || password.length<6 || Buffer.byteLength(password)>256) {
    sendJson(res,400,{error:'Informe telefone com DDD e senha de pelo menos 6 caracteres.'});return true;
  }
  if(path==='/api/auth/register') {
    const name=String(body.name||'').trim().replace(/\s+/g,' ');
    const role=body.role==='transportadora'?'transportadora':'motorista';
    const vehicles=Array.isArray(body.vehicles)?body.vehicles.filter(v=>['moto','carro','utilitario'].includes(v)).slice(0,3):[];
    if(name.length<3 || name.length>160 || (role==='motorista' && vehicles.length===0)) {
      sendJson(res,400,{error:'Informe nome completo e pelo menos um veículo para motorista.'});return true;
    }
    const salt=crypto.randomBytes(16).toString('hex');
    const encoded='scrypt:'+salt+':'+hashPassword(password,salt);
    try {
      const [result]=await pool.execute('INSERT INTO app_users (full_name,phone,password_hash,role,vehicles) VALUES (?,?,?,?,?)',[name,phone,encoded,role,vehicles.join(',')]);
      await loginSession(req,res,{id:result.insertId,full_name:name,phone,role,vehicles:vehicles.join(',')});
    } catch(err) {
      if(err.code==='ER_DUP_ENTRY'){sendJson(res,409,{error:'Telefone já cadastrado. Faça login.'});return true;}
      throw err;
    }
    return true;
  }
  const [rows]=await pool.execute('SELECT id,full_name,phone,password_hash,role,vehicles FROM app_users WHERE phone=? LIMIT 1',[phone]);
  const user=rows[0];
  const parts=user?.password_hash?.split(':')||[];
  const valid=parts.length===3 && parts[0]==='scrypt' && secureEquals(parts[2],hashPassword(password,parts[1]));
  if(!valid) {sendJson(res,401,{error:'Telefone ou senha incorretos.'});return true;}
  if(body.role && body.role!==user.role) {sendJson(res,403,{error:'Esta conta pertence a outro tipo de acesso.'});return true;}
  await loginSession(req,res,user);return true;
}


async function adminRoutes(req,res,path){
 if(!path.startsWith('/api/admin/'))return false;
 if(req.method!=='GET'){sendJson(res,405,{error:'Método não permitido.'});return true;}
 const user=await getSession(req);
 if(!user){sendJson(res,401,{error:'Faça login para acessar a administração.'});return true;}
 if(user.role!=='administrador'){sendJson(res,403,{error:'Acesso restrito à administração.'});return true;}
 const url=new URL(req.url,'http://localhost');
 const page=Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page'),10)||1));
 const limit=25,offset=(page-1)*limit;
 const search=String(url.searchParams.get('search')||'').trim().slice(0,100);
 if(path==='/api/admin/overview'){
  const [[users],[orders],[recent]]=await Promise.all([
   pool.query("SELECT role,COUNT(*) AS total FROM app_users GROUP BY role"),
   pool.query("SELECT status,COUNT(*) AS total FROM zap_order_entries GROUP BY status"),
   pool.query("SELECT o.id,o.place,o.service_type,o.vehicle_type,o.status,o.created_at,u.full_name AS carrier_name FROM zap_order_entries o LEFT JOIN app_users u ON u.id=o.owner_user_id ORDER BY o.created_at DESC LIMIT 100")
  ]);
  const counts={motorista:0,transportadora:0,administrador:0};
  for(const item of users)counts[item.role]=Number(item.total);
  const statuses={};let totalOrders=0;
  for(const item of orders){statuses[item.status]=Number(item.total);totalOrders+=Number(item.total);}
  sendJson(res,200,{users:counts,orders:{total:totalOrders,byStatus:statuses},recentOrders:recent.map(o=>({...o,id:String(o.id)}))});return true;
 }
 const roleByPath={'/api/admin/drivers':'motorista','/api/admin/carriers':'transportadora','/api/admin/administrators':'administrador'};
 if(Object.prototype.hasOwnProperty.call(roleByPath,path)){
  const role=roleByPath[path],where="WHERE role=?"+(search?" AND (full_name LIKE ? OR phone LIKE ?)":"");
  const params=search?[role,'%'+search+'%','%'+search+'%']:[role];
  const [[{total}],[rows]]=await Promise.all([
   pool.query("SELECT COUNT(*) AS total FROM app_users "+where,params),
   pool.query("SELECT id,full_name,phone,role,vehicles,created_at FROM app_users "+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",[...params,limit,offset])
  ]);
  sendJson(res,200,{items:rows.map(u=>({...u,id:String(u.id)})),total:Number(total),page,limit});return true;
 }
 if(path==='/api/admin/orders'){
  const where=search?"WHERE o.place LIKE ? OR o.status LIKE ? OR u.full_name LIKE ? OR o.client_name LIKE ?":"";
  const params=search?Array(4).fill('%'+search+'%'):[];
  const [[{total}],[rows]]=await Promise.all([
   pool.query("SELECT COUNT(*) AS total FROM zap_order_entries o LEFT JOIN app_users u ON u.id=o.owner_user_id "+where,params),
   pool.query("SELECT o.id,o.place,o.address,o.client_name,o.service_type,o.vehicle_type,o.status,o.created_at,u.full_name AS carrier_name FROM zap_order_entries o LEFT JOIN app_users u ON u.id=o.owner_user_id "+where+" ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?",[...params,limit,offset])
  ]);
  sendJson(res,200,{items:rows.map(o=>({...o,id:String(o.id)})),total:Number(total),page,limit});return true;
 }
 sendJson(res,404,{error:'Página administrativa não encontrada.'});return true;
}

function mapOrder(row) {
 return {id:String(row.id),ownerId:row.owner_user_id==null?null:String(row.owner_user_id),place:row.place,address:row.address||'',lat:Number(row.latitude),lng:Number(row.longitude),type:row.service_type,vehicle:row.vehicle_type,carrier:'Zap Encomendas',client:row.client_name,clientPhone:row.client_phone||'',closesAt:row.closes_at?String(row.closes_at).slice(0,5):'',instructions:row.instructions||'',values:(()=>{try{const items=typeof row.value_items==='string'?JSON.parse(row.value_items):row.value_items;return Array.isArray(items)?items:[]}catch{return []}})(),driverId:row.driver_id==null?null:String(row.driver_id),driverName:row.driver_name||null,status:row.status==='aguardando_motorista'?'Aguardando motorista':row.status};
}

async function quickClientRoutes(req,res,path){
 if(path!=='/api/clients'||!['GET','POST'].includes(req.method))return false;
 await ensureDatabase();
 if(!databaseStatus.ok||migrationStatus!=='atualizado'){sendJson(res,503,{error:'Banco indisponível'});return true;}
 const user=await getSession(req);
 if(!user){sendJson(res,401,{error:'Faça login para acessar clientes'});return true;}
 if(user.role!=='transportadora'){sendJson(res,403,{error:'Acesso restrito a transportadoras'});return true;}
 if(req.method==='GET'){
  const [rows]=await pool.execute('SELECT c.id,c.name,c.contact_name,c.document_number,c.phone,c.address,c.latitude,c.longitude,(SELECT COUNT(*) FROM zap_order_entries o WHERE o.owner_user_id=c.owner_user_id AND (o.client_phone=c.phone AND c.phone<>\'\' OR LOWER(TRIM(o.client_name))=LOWER(TRIM(c.name)) AND c.name<>\'\')) AS usage_count FROM zap_quick_clients c WHERE c.owner_user_id=? ORDER BY usage_count DESC,c.id DESC LIMIT 500',[user.id]);
  sendJson(res,200,{clients:rows.map(c=>({id:String(c.id),name:c.name,contactName:c.contact_name,document:c.document_number,phone:c.phone,usageCount:Number(c.usage_count)||0,address:c.address,lat:c.latitude===null?null:Number(c.latitude),lng:c.longitude===null?null:Number(c.longitude)}))});return true;
 }
 if(req.headers.origin){let origin='';try{origin=new URL(req.headers.origin).host}catch{}const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();if(origin!==host){sendJson(res,403,{error:'Origem não autorizada'});return true;}}
 if(rateLimit(req,'quick-client')){sendJson(res,429,{error:'Muitas tentativas. Aguarde alguns minutos.'});return true;}
 let body;try{body=await readBody(req)}catch{sendJson(res,400,{error:'Dados inválidos'});return true;}
 const name=String(body.name||'').trim(),contact=String(body.contactName||'').trim(),phone=phoneDigits(body.phone),document=String(body.document||'').replace(/\D/g,''),address=String(body.address||'').trim();
 const lat=body.lat==null?null:Number(body.lat),lng=body.lng==null?null:Number(body.lng);
 if(name.length<2||name.length>160||contact.length<2||contact.length>160||!/^\d{10,11}$/.test(phone)||![11,14].includes(document.length)||address.length<5||address.length>600||(lat!==null&&(!Number.isFinite(lat)||lat < -90||lat>90))||(lng!==null&&(!Number.isFinite(lng)||lng < -180||lng>180))||((lat===null)!==(lng===null))){
  sendJson(res,400,{error:'Informe nome, contato, CPF/CNPJ, telefone e localização.'});return true;
 }
 const [result]=await pool.execute('INSERT INTO zap_quick_clients (owner_user_id,name,contact_name,document_number,phone,address,latitude,longitude) VALUES (?,?,?,?,?,?,?,?)',[user.id,name,contact,document,phone,address,lat,lng]);
 sendJson(res,201,{client:{id:String(result.insertId),name,contactName:contact,document,phone,address,lat,lng}});return true;
}

async function carrierDriverRoutes(req,res,path){
 if(path!=='/api/carrier/drivers')return false;
 if(!['GET','PUT'].includes(req.method)){sendJson(res,405,{error:'Método não permitido'});return true}
 await ensureDatabase();
 if(!databaseStatus.ok||migrationStatus!=='atualizado'){sendJson(res,503,{error:'Banco indisponível'});return true}
 const user=await getSession(req);
 if(!user||user.role!=='transportadora'){sendJson(res,403,{error:'Acesso exclusivo da transportadora'});return true}
 if(req.method==='GET'){
  const [rows]=await pool.execute("SELECT id,full_name,vehicles,role FROM app_users WHERE role='motorista' ORDER BY full_name ASC");
  const [settings]=await pool.execute('SELECT configured FROM zap_carrier_driver_settings WHERE carrier_id=?',[user.id]);
  const [allowed]=await pool.execute('SELECT driver_id FROM zap_carrier_allowed_drivers WHERE carrier_id=?',[user.id]);
  sendJson(res,200,{configured:settings.length>0,drivers:rows.map(d=>({id:String(d.id),name:d.full_name,vehicles:String(d.vehicles||'').split(',').filter(Boolean),role:d.role,allowed:settings.length===0||allowed.some(a=>String(a.driver_id)===String(d.id))}))});return true;
 }
 if(req.headers.origin){let host='';try{host=new URL(req.headers.origin).host}catch{}if(host!==String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim()){sendJson(res,403,{error:'Origem não autorizada'});return true}}
 let body;try{body=await readBody(req)}catch{sendJson(res,400,{error:'Dados inválidos'});return true}
 if(!Array.isArray(body.driverIds)||body.driverIds.length>500||body.driverIds.some(id=>!/^\\d+$/.test(String(id)))){sendJson(res,400,{error:'Seleção inválida'});return true}
 const ids=[...new Set(body.driverIds.map(String))];
 const conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  await conn.execute('INSERT INTO zap_carrier_driver_settings (carrier_id,configured) VALUES (?,1) ON DUPLICATE KEY UPDATE configured=1',[user.id]);
  await conn.execute('DELETE FROM zap_carrier_allowed_drivers WHERE carrier_id=?',[user.id]);
  for(const id of ids){const [valid]=await conn.execute("SELECT id FROM app_users WHERE id=? AND role='motorista'",[id]);if(!valid.length)throw Error('Profissional inválido');await conn.execute('INSERT INTO zap_carrier_allowed_drivers (carrier_id,driver_id) VALUES (?,?)',[user.id,id])}
  await conn.commit();
 }catch(err){await conn.rollback();sendJson(res,400,{error:err.message||'Falha ao salvar seleção'});return true}finally{conn.release()}
 carrierAllowedCache.delete(String(user.id));
 for(const q of callQueues.values())if(String(q.order.ownerId)===String(user.id)){stopOffer(q);q.tried.clear();nextOffer(q)}
 sendJson(res,200,{ok:true});return true;
}

async function orderProofRoutes(req,res,path){
 const match=path.match(/^\/api\/driver\/orders\/(\d+)\/proofs(?:\/(\d+)\/photos\/(\d+))?$/);
 if(!match)return false;
 if(req.method!=='POST'&&req.method!=='GET'){sendJson(res,405,{error:'Método não permitido'});return true;}
 if(req.method==='POST'&&req.headers.origin){let origin='';try{origin=new URL(req.headers.origin).host}catch{}const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();if(origin!==host){sendJson(res,403,{error:'Origem não autorizada'});return true;}}
 await ensureDatabase();
 if(!databaseStatus.ok||migrationStatus!=='atualizado'){sendJson(res,503,{error:'Banco indisponível'});return true;}
 const user=await getSession(req);
 if(!user||user.role!=='motorista'){sendJson(res,403,{error:'Acesso restrito ao profissional'});return true;}
 const orderId=match[1];
 const [orders]=await pool.execute('SELECT id,driver_id,service_type,status FROM zap_order_entries WHERE id=? AND driver_id=?',[orderId,user.id]);
 if(!orders.length){sendJson(res,404,{error:'Pedido não atribuído a este profissional'});return true;}
 if(req.method==='GET'){
  if(match[2]&&match[3]){
   const [photos]=await pool.execute('SELECT p.mime_type,p.image_data FROM zap_order_proof_photos p JOIN zap_order_proofs f ON f.id=p.proof_id WHERE p.id=? AND f.id=? AND f.order_id=? AND f.driver_id=?',[match[3],match[2],orderId,user.id]);
   if(!photos.length){sendJson(res,404,{error:'Foto não encontrada'});return true;}
   res.writeHead(200,{'Content-Type':photos[0].mime_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(photos[0].image_data);return true;
  }
  const [rows]=await pool.execute('SELECT id,action,created_at FROM zap_order_proofs WHERE order_id=? AND driver_id=? ORDER BY id DESC',[orderId,user.id]);
  sendJson(res,200,{proofs:rows});return true;
 }
 if(match[2]){sendJson(res,405,{error:'Método não permitido'});return true;}
 if(orders[0].status!=='aceito'){sendJson(res,409,{error:'O pedido precisa estar aceito para registrar o serviço'});return true;}
 let body;try{body=await readProofBody(req)}catch(e){sendJson(res,413,{error:e.message||'Fotos muito grandes'});return true;}
 const action=String(body.action||'');
 if(!['coleta','entrega','troca'].includes(action)||action!==orders[0].service_type){sendJson(res,400,{error:'Tipo de confirmação incompatível com o pedido'});return true;}
 const photos=body.photos;
 if(!Array.isArray(photos)||photos.length>5||(action!=='entrega'&&!photos.length)){sendJson(res,400,{error:'Informe de 1 a 5 fotos para coleta ou troca'});return true;}
 const parsed=[];
 for(const data of photos){
  const m=typeof data==='string'&&data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!m){sendJson(res,400,{error:'Formato de foto inválido'});return true;}
  const bytes=Buffer.from(m[2],'base64');
  if(!bytes.length||bytes.length>2*1024*1024){sendJson(res,413,{error:'Cada foto deve ter no máximo 2 MB'});return true;}
  parsed.push({mime:m[1],bytes});
 }
 const connection=await pool.getConnection();
 try{
  await connection.beginTransaction();
  const [existing]=await connection.execute('SELECT id FROM zap_order_proofs WHERE order_id=? AND driver_id=? AND action=? LIMIT 1',[orderId,user.id,action]);
  if(existing.length){await connection.rollback();sendJson(res,409,{error:'Este serviço já foi registrado'});return true;}
  const [saved]=await connection.execute('INSERT INTO zap_order_proofs (order_id,driver_id,action) VALUES (?,?,?)',[orderId,user.id,action]);
  for(const photo of parsed)await connection.execute('INSERT INTO zap_order_proof_photos (proof_id,mime_type,image_data) VALUES (?,?,?)',[saved.insertId,photo.mime,photo.bytes]);
  await connection.execute("UPDATE zap_order_entries SET status='concluido' WHERE id=? AND driver_id=? AND status='aceito'",[orderId,user.id]);
  await connection.commit();
  sendJson(res,201,{ok:true,proofId:String(saved.insertId),photoCount:parsed.length});
 }catch(e){await connection.rollback();sendJson(res,500,{error:'Não foi possível salvar a confirmação e as fotos'});}finally{connection.release();}
 return true;
}
function readProofBody(req){
 return new Promise((resolve,reject)=>{
  let size=0,parts=[],done=false;
  req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>14*1024*1024){done=true;reject(new Error('Limite de 14 MB por confirmação'));req.resume();return;}parts.push(chunk)});
  req.on('end',()=>{if(done)return;try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch{reject(new Error('Dados inválidos'))}});
  req.on('error',reject);
 });
}
async function orderRoutes(req,res,path) {
 if(!path.startsWith('/api/orders') && path!=='/api/driver/orders') return false;
 if(!['GET','POST','PUT'].includes(req.method)){sendJson(res,405,{error:'Método não permitido'});return true;}
 if(req.method!=='GET' && req.headers.origin) {
   let originHost='';try{originHost=new URL(req.headers.origin).host}catch{}
   const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
   if(!originHost || originHost!==host){sendJson(res,403,{error:'Origem não autorizada'});return true;}
 }
 await ensureDatabase();
 if(!databaseStatus.ok || migrationStatus!=='atualizado'){sendJson(res,503,{error:'Banco indisponível',diagnostic:databaseDiagnostics()});return true;}
 const user=await getSession(req);
 if(!user){sendJson(res,401,{error:'Faça login para gerenciar pedidos'});return true;}
 if(req.method==='GET' && (path==='/api/driver/orders' || (path==='/api/orders' && user.role==='motorista')) && ['motorista','transportadora'].includes(user.role)){
   const [rows]=await pool.execute("SELECT o.*,u.full_name AS carrier_name FROM zap_order_entries o JOIN app_users u ON u.id=o.owner_user_id WHERE (o.status='aguardando_motorista' AND (NOT EXISTS (SELECT 1 FROM zap_carrier_driver_settings cs WHERE cs.carrier_id=o.owner_user_id) OR EXISTS (SELECT 1 FROM zap_carrier_allowed_drivers ad WHERE ad.carrier_id=o.owner_user_id AND ad.driver_id=?))) OR (o.driver_id=? AND o.status='aceito') ORDER BY o.created_at ASC LIMIT 500",[user.id,user.id]);
   sendJson(res,200,{orders:rows.map(row=>({...mapOrder(row),carrier:row.carrier_name||'Transportadora'}))});return true;
 }
 if(user.role!=='transportadora'){sendJson(res,403,{error:'Apenas transportadoras podem cadastrar pedidos'});return true;}
 if(req.method==='GET' && path==='/api/orders') {
   const [rows]=await pool.execute('SELECT o.*,d.full_name AS driver_name FROM zap_order_entries o LEFT JOIN app_users d ON d.id=o.driver_id WHERE o.owner_user_id=? ORDER BY o.id DESC LIMIT 500',[user.id]);
   sendJson(res,200,{orders:rows.map(mapOrder)});return true;
 }
 const match=path.match(/^\/api\/orders\/(\d+)$/);
 if(!((req.method==='POST' && path==='/api/orders')||(req.method==='PUT' && match))) {sendJson(res,404,{error:'Pedido não encontrado'});return true;}
 if(rateLimit(req,'orders')){sendJson(res,429,{error:'Muitas tentativas. Aguarde alguns minutos.'});return true;}
 let body;try{body=await readBody(req)}catch{sendJson(res,400,{error:'Dados inválidos'});return true;}
 const place=String(body.place||'').trim(),address=String(body.address||'').trim(),client=String(body.client||'').trim();
 const phone=phoneDigits(body.clientPhone||''),instructions=String(body.instructions||'').trim(),closesAt=String(body.closesAt||'').trim();
 const lat=Number(body.lat),lng=Number(body.lng);
 const type=body.type,vehicle=body.vehicle;
 if(place.length<2||place.length>255||address.length>600||client.length>160||instructions.length>5000||(closesAt&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(closesAt))||!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180||!['coleta','entrega','troca'].includes(type)||!['moto','carro','utilitario'].includes(vehicle)|| (phone && !/^\d{10,11}$/.test(phone))) {
   sendJson(res,400,{error:'Confira local, coordenadas, telefone e tipo do pedido.'});return true;
 }
 const values=body.values===undefined?[]:body.values;
 if(!Array.isArray(values)||values.length>100||values.some(v=>!v||!['custo','desconto'].includes(v.type)||typeof v.description!=='string'||!v.description.trim()||v.description.length>120||!Number.isFinite(Number(v.amount))||Number(v.amount)<0||Number(v.amount)>1000000)){sendJson(res,400,{error:'Custos e descontos inválidos.'});return true;}
 const safeValues=values.map(v=>({type:v.type,description:v.description.trim(),amount:Math.round(Number(v.amount)*100)/100}));
 const params=[place,address,lat,lng,type,vehicle,client,phone||null,instructions,closesAt||null,JSON.stringify(safeValues)];
 let id;
 if(req.method==='POST'){
   const [result]=await pool.execute('INSERT INTO zap_order_entries (place,address,latitude,longitude,service_type,vehicle_type,client_name,client_phone,instructions,closes_at,value_items,owner_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[...params,user.id]);
   id=result.insertId;
 } else {
   id=match[1];
   const [result]=await pool.execute('UPDATE zap_order_entries SET place=?,address=?,latitude=?,longitude=?,service_type=?,vehicle_type=?,client_name=?,client_phone=?,instructions=?,closes_at=?,value_items=? WHERE id=? AND owner_user_id=?',[...params,id,user.id]);
   if(!result.affectedRows){sendJson(res,404,{error:'Pedido não encontrado para esta transportadora'});return true;}
 }
 const [rows]=await pool.execute('SELECT * FROM zap_order_entries WHERE id=? AND owner_user_id=?',[id,user.id]);
 const saved=mapOrder(rows[0]);
 if(req.method==='POST')queueOrder({...saved,carrier:user.full_name||'Transportadora'});
 sendJson(res,req.method==='POST'?201:200,{ok:true,order:saved});return true;
}




async function locationAliasRoutes(req,res,path){
 if(path!=='/api/maps/alias'||req.method!=='POST')return false;
 await ensureDatabase();
 if(!databaseStatus.ok||migrationStatus!=='atualizado'){sendJson(res,503,{error:'Banco indisponível'});return true;}
 const user=await getSession(req);
 if(!user||user.role!=='transportadora'){sendJson(res,403,{error:'Use uma conta de transportadora real para nomear locais.'});return true;}
 if(req.headers.origin){let origin='';try{origin=new URL(req.headers.origin).host}catch{}const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();if(origin!==host){sendJson(res,403,{error:'Origem não autorizada'});return true;}}
 let body;try{body=await readBody(req)}catch{sendJson(res,400,{error:'Dados inválidos'});return true;}
 const name=String(body.name||'').trim(),address=String(body.address||'').trim(),placeId=String(body.place_id||'').trim()||null,lat=Number(body.lat),lng=Number(body.lng);
 if(name.length<2||name.length>255||address.length<2||address.length>600||(placeId&&placeId.length>255)||!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180){sendJson(res,400,{error:'Local inválido'});return true;}
 const [existing]=await pool.execute('SELECT id FROM zap_location_aliases WHERE owner_user_id=? AND ((place_id IS NOT NULL AND place_id=?) OR (ABS(latitude-?)<0.00001 AND ABS(longitude-?)<0.00001)) LIMIT 1',[user.id,placeId,lat,lng]);
 if(existing.length)await pool.execute('UPDATE zap_location_aliases SET custom_name=?,address=?,place_id=?,latitude=?,longitude=? WHERE id=? AND owner_user_id=?',[name,address,placeId,lat,lng,existing[0].id,user.id]);
 else await pool.execute('INSERT INTO zap_location_aliases (owner_user_id,place_id,custom_name,address,latitude,longitude) VALUES (?,?,?,?,?,?)',[user.id,placeId,name,address,lat,lng]);
 sendJson(res,200,{ok:true});return true;
}

function normalizeLocationSearch(q){return String(q||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
async function savedPlacesRoutes(req,res,path){
 if(path!=='/api/maps/saved'||req.method!=='GET')return false;
 const user=await getSession(req);
 if(!user||user.role!=='transportadora'){sendJson(res,403,{error:'Acesso restrito à transportadora'});return true;}
 await ensureDatabase();
 if(!databaseStatus.ok||migrationStatus!=='atualizado'){sendJson(res,503,{error:'Banco de locais indisponível'});return true;}
 const [aliases]=await pool.execute('SELECT place_id,custom_name AS name,address,latitude AS lat,longitude AS lon FROM zap_location_aliases WHERE owner_user_id=? ORDER BY updated_at DESC LIMIT 200',[user.id]);
 const [orders]=await pool.execute('SELECT place AS name,address,latitude AS lat,longitude AS lon FROM zap_order_entries WHERE owner_user_id=? ORDER BY updated_at DESC LIMIT 10000',[user.id]);
 const [locations]=await pool.execute('SELECT place_id,name,address,latitude AS lat,longitude AS lon FROM zap_locations WHERE expires_at IS NULL OR expires_at>UTC_TIMESTAMP() ORDER BY updated_at DESC LIMIT 300');
 const keyFor=row=>Number(row.lat).toFixed(5)+','+Number(row.lon).toFixed(5);
 const usage=new Map();
 for(const row of orders){if(Number.isFinite(Number(row.lat))&&Number.isFinite(Number(row.lon))){const key=keyFor(row);usage.set(key,(usage.get(key)||0)+1)}}
 const seen=new Set(),results=[];
 for(const row of [...aliases,...orders,...locations]){
  const lat=Number(row.lat),lon=Number(row.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
  const name=String(row.name||'').trim(),address=String(row.address||'').trim();
  if(!name&&!address)continue;
  const key=keyFor(row);
  if(seen.has(key))continue;seen.add(key);
  results.push({place_id:row.place_id||null,name:name||address.split(',')[0],display_name:address||name,lat,lon,usageCount:usage.get(key)||0});
 }
 results.sort((a,b)=>b.usageCount-a.usageCount||a.name.localeCompare(b.name,'pt-BR'));
 sendJson(res,200,{results});return true;
}

function mapsUrlFromInput(value){return locationInput.mapsURL(value);}
async function expandMapsUrl(url){
 let current=url;
 for(let i=0;i<5;i++){
  if(locationInput.parse(current.href)?.kind==='coordinates')return current;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
   const response=await fetch(current.href,{redirect:'manual',signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 ZapEncomendas/1.0'}});
   const next=response.headers.get('location');
   if(response.body)response.body.cancel().catch(()=>{});
   if(!next||![301,302,303,307,308].includes(response.status))return current;
   const target=new URL(next,current);
   if(['geo:','waze:','google.navigation:'].includes(target.protocol)&&locationInput.parse(target.href)?.kind==='coordinates')return target;
   if(target.protocol!=='https:'||!mapsUrlFromInput(target.href))throw Error('Redirecionamento fora dos serviços de mapas permitidos');
   current=target;
  }finally{clearTimeout(timer)}
 }
 return current;
}
function parseMapsLocation(url){
 const parsed=locationInput.parse(url.href);
 return {lat:parsed?.kind==='coordinates'?parsed.lat:null,lon:parsed?.kind==='coordinates'?parsed.lon:null,term:parsed?.kind==='coordinates'&&parsed.name!=='Localização compartilhada'?parsed.name:parsed?.term||(parsed?.kind==='address'?parsed.query:'')};
}
async function googleAddressSearch(req,res,path) {
 if(path!=='/api/maps/search' || req.method!=='GET')return false;
 let query=new URL(req.url,'http://localhost').searchParams.get('q')?.trim()||'';
 const mapsUrl=mapsUrlFromInput(query);
 if(query.length<3||query.length>2000){sendJson(res,400,{error:'Informe um endereço de 3 a 200 caracteres.'});return true;}
 if(rateLimit(req,'maps-search')){sendJson(res,429,{error:'Limite de buscas atingido. Tente novamente mais tarde.'});return true;}
 await ensureDatabase();
 if(!databaseStatus.ok || migrationStatus!=='atualizado'){sendJson(res,503,{error:'Banco de locais indisponível',diagnostic:databaseDiagnostics()});return true;}
 if(mapsUrl){
  let expanded,parsed;
  try{expanded=await expandMapsUrl(mapsUrl);parsed=parseMapsLocation(expanded)}catch(err){sendJson(res,422,{error:'Não foi possível abrir o link de localização. Confira se ele é público e válido.'});return true}
  if(parsed.lat!==null){
   const lat=parsed.lat,lon=parsed.lon;
   const [known]=await pool.execute('SELECT place_id,name,address,latitude,longitude FROM zap_locations WHERE ABS(latitude-?)<0.00003 AND ABS(longitude-?)<0.00003 ORDER BY updated_at DESC LIMIT 1',[lat,lon]);
   if(known.length){const p=known[0];sendJson(res,200,{source:'maps-link',results:[{place_id:p.place_id,name:p.name,display_name:p.address,lat:Number(p.latitude),lon:Number(p.longitude)}]});return true}
   {
    const label=parsed.term||'Localização compartilhada',address=lat.toFixed(6)+', '+lon.toFixed(6);
    const [exists]=await pool.execute('SELECT id FROM zap_locations WHERE ABS(latitude-?)<0.00003 AND ABS(longitude-?)<0.00003 LIMIT 1',[lat,lon]);
    if(!exists.length)await pool.execute("INSERT INTO zap_locations (place_id,name,address,latitude,longitude,source,expires_at) VALUES (NULL,?,?,?,?,'pedido',NULL)",[label,address,lat,lon]);
    sendJson(res,200,{source:'maps-link',results:[{name:label,display_name:address,lat,lon}]});return true;
   }
  }
  if(!parsed.term){sendJson(res,422,{error:'O link não contém endereço ou coordenadas identificáveis.'});return true}
  query=parsed.term;
 }
 const normalized=normalizeLocationSearch(query);
 const terms=normalized.split(' ').filter(w=>w.length>=2).slice(0,8);
 if(!terms.length){sendJson(res,400,{error:'Informe um local válido.'});return true;}
 const where=terms.map(()=>"(LOWER(name) LIKE ? OR LOWER(address) LIKE ?)").join(' AND ');
 const params=terms.flatMap(t=>['%'+t+'%','%'+t+'%']);
 const user=await getSession(req);
 if(user?.role==='transportadora'){
  const aliasWhere=terms.map(()=>"(LOWER(custom_name) LIKE ? OR LOWER(address) LIKE ?)").join(' AND ');
  const [aliases]=await pool.execute('SELECT place_id,custom_name,address,latitude,longitude FROM zap_location_aliases WHERE owner_user_id=? AND '+aliasWhere+' ORDER BY updated_at DESC LIMIT 8',[user.id,...params]);
  if(aliases.length){sendJson(res,200,{source:'custom',results:aliases.map(p=>({place_id:p.place_id,name:p.custom_name,display_name:p.address,lat:Number(p.latitude),lon:Number(p.longitude)}))});return true;}
 }
 const [saved]=await pool.execute('SELECT place_id,name,address,latitude,longitude FROM zap_locations WHERE (expires_at IS NULL OR expires_at > UTC_TIMESTAMP()) AND '+where+' ORDER BY source DESC, updated_at DESC LIMIT 8',params);
 if(saved.length){
  sendJson(res,200,{source:'database',results:saved.map(p=>({place_id:p.place_id,name:p.name,display_name:p.address,lat:Number(p.latitude),lon:Number(p.longitude)}))});return true;
 }
 const key=process.env.GOOGLE_MAPS_API_KEY;
 if(!key){sendJson(res,503,{error:'Nenhum local encontrado no banco. Configure GOOGLE_MAPS_API_KEY na hospedagem.'});return true;}
 try{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  let response;
  try{response=await fetch('https://places.googleapis.com/v1/places:searchText',{
   method:'POST',signal:controller.signal,
   headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location'},
   body:JSON.stringify({textQuery:query,languageCode:'pt-BR',regionCode:'BR',pageSize:8,locationBias:{circle:{center:{latitude:-16.686,longitude:-49.265},radius:50000}}})
  });}finally{clearTimeout(timeout)}
  if(!response.ok){console.error('[MAPS] Google Places status',response.status);sendJson(res,502,{error:'Google Maps indisponível. Verifique Places API (New) e a chave.'});return true;}
  const data=await response.json();
  const results=(data.places||[]).filter(p=>p.id&&Number.isFinite(p.location?.latitude)&&Number.isFinite(p.location?.longitude)).map(p=>({
   place_id:p.id,name:p.displayName?.text||p.formattedAddress||'Local',display_name:p.formattedAddress||p.displayName?.text||'Local',
   lat:p.location.latitude,lon:p.location.longitude
  }));
  // Cada resultado retornado pela busca é salvo automaticamente no MySQL, sem precisar selecionar ou cadastrar pedido. Dados do Google permanecem em cache por até 30 dias; o place_id pode ser preservado.
  for(const p of results){
   await pool.execute("INSERT INTO zap_locations (place_id,name,address,latitude,longitude,source,expires_at) VALUES (?,?,?,?,?,'google',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY)) ON DUPLICATE KEY UPDATE name=VALUES(name),address=VALUES(address),latitude=VALUES(latitude),longitude=VALUES(longitude),source='google',expires_at=VALUES(expires_at)",[p.place_id,p.name,p.display_name,p.lat,p.lon]);
  }
  sendJson(res,200,{source:'google',results});return true;
 }catch(err){console.error('[MAPS]',err.code||err.name||'ERROR');sendJson(res,502,{error:'Não foi possível consultar o Google Maps agora.'});return true;}
}

// Chave pública restrita por HTTP referrer para o SDK Google Maps no navegador.
// Nunca reutilizar GOOGLE_MAPS_API_KEY (chave privada do servidor).
function mapsBrowserConfig(req,res,path){
 if(req.method!=='GET'||path!=='/api/maps/browser-config')return false;
 const key=process.env.GOOGLE_MAPS_BROWSER_KEY||'';
 if(!key){sendJson(res,503,{error:'Configure GOOGLE_MAPS_BROWSER_KEY e habilite Maps JavaScript API no Google Cloud.'});return true;}
 sendJson(res,200,{apiKey:key,language:'pt-BR',region:'BR'});return true;
}


const callSockets=new Map(),callQueues=new Map();
const callWss=new WebSocketServer({noServer:true});
const callVehicleLevel={moto:1,carro:2,utilitario:3};
function callSend(ws,data){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))}
const carrierAllowedCache=new Map();
async function getCarrierAllowed(ownerId){
 if(!ownerId)return null;
 const id=String(ownerId);
 if(carrierAllowedCache.has(id))return carrierAllowedCache.get(id);
 const [settings]=await pool.execute('SELECT configured FROM zap_carrier_driver_settings WHERE carrier_id=?',[id]);
 if(!settings.length){carrierAllowedCache.set(id,null);return null}
 const [rows]=await pool.execute('SELECT driver_id FROM zap_carrier_allowed_drivers WHERE carrier_id=?',[id]);
 const allowed=new Set(rows.map(row=>String(row.driver_id)));
 carrierAllowedCache.set(id,allowed);return allowed;
}
function eligibleCallDrivers(vehicle,orderId){
 const sockets=[...callSockets.entries()].filter(([,s])=>[...s].some(ws=>ws.readyState===WebSocket.OPEN&&callVehicleLevel[ws.vehicle]>=callVehicleLevel[vehicle])).map(([id])=>id);
 const q=callQueues.get(String(orderId));
 return [...new Set([...sockets,...nativePush.candidates(vehicle)])].filter(id=>(!q||q.allowedDrivers===null||q.allowedDrivers?.has(String(id)))&&![...callQueues.values()].some(other=>other.order.id!==orderId&&other.driverId===id));
}
function stopOffer(queue){if(queue.timer)clearTimeout(queue.timer);queue.timer=null;if(queue.driverId){for(const ws of callSockets.get(queue.driverId)||[])callSend(ws,{type:'call_end',orderId:queue.order.id});nativePush.send(queue.driverId,{type:'call_end',orderId:queue.order.id,offerExpiresAt:queue.offerExpiresAt},pool);}queue.driverId=null}
function dispatchWaitingOrders(){for(const queue of callQueues.values())if(!queue.driverId&&eligibleCallDrivers(queue.order.vehicle,queue.order.id).length){if(queue.timer)clearTimeout(queue.timer);queue.timer=null;nextOffer(queue)}}
async function nextOffer(queue){
 if(!callQueues.has(queue.order.id)||queue.loadingPermissions)return;
 queue.loadingPermissions=true;
 try{queue.allowedDrivers=await getCarrierAllowed(queue.order.ownerId)}catch(err){queue.loadingPermissions=false;console.error('[CALL PERMISSIONS]',err.message);queue.timer=setTimeout(()=>nextOffer(queue),3000);return}
 queue.loadingPermissions=false;
 if(!callQueues.has(queue.order.id))return;
 stopOffer(queue);
 const drivers=eligibleCallDrivers(queue.order.vehicle,queue.order.id);
 if(!drivers.length){queue.timer=setTimeout(()=>nextOffer(queue),3000);return}
 const next=drivers.find(id=>!queue.tried.has(id));
 if(!next){queue.tried.clear();queue.timer=setTimeout(()=>nextOffer(queue),1000);return}
 queue.tried.add(next);queue.driverId=next;
 const expiresAt=Date.now()+30000;queue.offerExpiresAt=expiresAt;
 nativePush.send(next,{type:'call_offer',order:queue.order,expiresAt},pool);
 for(const ws of callSockets.get(next)||[])if(ws.readyState===WebSocket.OPEN&&callVehicleLevel[ws.vehicle]>=callVehicleLevel[queue.order.vehicle])callSend(ws,{type:'call_offer',order:queue.order,expiresAt});
 queue.timer=setTimeout(()=>{nextOffer(queue);dispatchWaitingOrders()},30000);
 dispatchWaitingOrders();
}
function queueOrder(order){const id=String(order.id);if(callQueues.has(id))return;const q={order:{...order,id},driverId:null,tried:new Set(),timer:null,allowedDrivers:undefined};callQueues.set(id,q);nextOffer(q)}
async function recoverPendingCalls(){
 if(!pool||!databaseStatus.ok)return;
 const [rows]=await pool.execute("SELECT o.*,u.full_name AS carrier_name FROM zap_order_entries o JOIN app_users u ON u.id=o.owner_user_id WHERE o.status='aguardando_motorista' ORDER BY o.id ASC LIMIT 500");
 const pending=new Set(rows.map(r=>String(r.id)));
 for(const [id,q] of callQueues)if(!pending.has(id)){stopOffer(q);callQueues.delete(id)}
 for(const row of rows)queueOrder({...mapOrder(row),carrier:row.carrier_name||'Transportadora'});
}
callWss.on('connection',(ws,req,user)=>{
 ws.userId=String(user.id);ws.vehicle=null;
 const sessionToken=String(req.headers.cookie||'').match(/(?:^|;\s*)zap_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 const sessionHash=sessionToken?crypto.createHash('sha256').update(sessionToken).digest('hex'):'';let sockets=callSockets.get(ws.userId);if(!sockets){sockets=new Set();callSockets.set(ws.userId,sockets)}sockets.add(ws);
 ws.on('message',async raw=>{
  let msg;try{msg=JSON.parse(String(raw))}catch{return}
  if(msg.type==='online'&&callVehicleLevel[msg.vehicle]&&(user.role==='transportadora'?((user.vehicles||'').split(',').filter(Boolean).length?(user.vehicles||'').split(','):['moto']):(user.vehicles||'').split(',')).includes(msg.vehicle)){ws.vehicle=msg.vehicle;callSend(ws,{type:'call_ready'});for(const q of callQueues.values())if(!q.driverId){clearTimeout(q.timer);nextOffer(q)}recoverPendingCalls().catch(err=>console.error('[CALL RECOVER]',err.message));return}
  if(msg.type==='push_register'){nativePush.register(user,msg,sessionHash);return;}
  if(msg.type==='location'){
   const p=msg.position||{},lat=p.latitude,lng=p.longitude,accuracy=p.accuracy,time=p.timestamp;
   if(!ws.vehicle||![lat,lng,accuracy,time].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lng)>180||accuracy<0||accuracy>100000||Math.abs(Date.now()-time)>120000||Date.now()-(ws.lastPositionAt||0)<5000)return;
   ws.lastPositionAt=Date.now();
   try{await pool.execute('INSERT INTO zap_driver_positions (user_id,latitude,longitude,accuracy,captured_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),accuracy=VALUES(accuracy),captured_at=VALUES(captured_at)',[user.id,lat,lng,accuracy,new Date(time)]);}catch(err){console.error('[DRIVER GPS]',safeErrorCode(err));}
   return;
  }
  if(msg.type==='offline'){nativePush.remove(ws.userId);ws.vehicle=null;for(const q of callQueues.values())if(q.driverId===ws.userId)nextOffer(q);dispatchWaitingOrders();return}
  if(!['accept','reject'].includes(msg.type))return;
  const id=String(msg.orderId||''),q=callQueues.get(id);
  if(!/^\d+$/.test(id)||!q||q.driverId!==ws.userId||!ws.vehicle){callSend(ws,{type:'call_error',orderId:id,message:'Esta chamada não está mais disponível.'});return}
  if(msg.type==='reject'){nextOffer(q);dispatchWaitingOrders();return}
  try{
   const [result]=await pool.execute("UPDATE zap_order_entries SET status='aceito',driver_id=? WHERE id=? AND status='aguardando_motorista'",[user.id,id]);
   if(!result.affectedRows){callSend(ws,{type:'call_error',orderId:id,message:'Pedido já atendido.'});stopOffer(q);callQueues.delete(id);dispatchWaitingOrders();return}
   stopOffer(q);callQueues.delete(id);dispatchWaitingOrders();
   for(const socket of callSockets.get(ws.userId)||[])callSend(socket,{type:'call_accepted',order:q.order});
  }catch(err){console.error('[CALL ACCEPT]',err.message);callSend(ws,{type:'call_error',orderId:id,message:'Não foi possível aceitar o pedido.'})}
 });
 ws.on('close',()=>{sockets.delete(ws);if(!sockets.size)callSockets.delete(ws.userId);for(const q of callQueues.values())if(q.driverId===ws.userId&&!nativePush.candidates(q.order.vehicle).includes(ws.userId)&&![...sockets].some(peer=>peer.readyState===WebSocket.OPEN&&callVehicleLevel[peer.vehicle]>=callVehicleLevel[q.order.vehicle]))nextOffer(q);dispatchWaitingOrders()});
});

const server = http.createServer(async (req,res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
  if (apkDownload(req,res,path)) return;
  if ((req.method==='GET'||req.method==='HEAD')&&['/navigation.js','/location-input.js','/shared-location.js'].includes(path)) {
    const script=fs.readFileSync(pathModule.join(__dirname,path.slice(1)));
    res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:script);return;
  }
  if (path.startsWith('/api/admin/')) {if(await adminRoutes(req,res,path)) return;}
  if (mapsBrowserConfig(req,res,path)) return;
  if (await locationAliasRoutes(req,res,path)) return;
  if (await savedPlacesRoutes(req,res,path)) return;
  if (await googleAddressSearch(req,res,path)) return;
  if (await quickClientRoutes(req,res,path)) return;
  if (await carrierDriverRoutes(req,res,path)) return;
  if (path.startsWith('/api/driver/orders/') && await orderProofRoutes(req,res,path)) return;
  if (path.startsWith('/api/orders') || path==='/api/driver/orders') {if(await orderRoutes(req,res,path)) return;}
  if (path.startsWith('/api/auth/')) {
    if(await authRoutes(req,res,path)) return;
  }
  if (req.method === 'GET' && path === '/') {
    fs.readFile(pathModule.join(__dirname, 'index.html'), (err, html) => {
      if (err) { console.error('[HTML]', err.message); sendJson(res, 500, {error:'Frontend indisponível'}); return; }
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(html);
    });
    return;
  }
  if (req.method === 'GET' && path === '/status') {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(homeHtml());
    return;
  }
  if (req.method === 'GET' && path === '/health') {
    await ensureDatabase();
    if (pool && databaseStatus.ok) {
      try {await pool.query('SELECT 1')} catch(err) {
        databaseStatus={ok:false,message:'MySQL não está respondendo',checkedAt:new Date().toISOString()};
        lastDatabaseError=String(err.code||'ERRO_DESCONHECIDO');
        console.error('[HEALTH]',err.message);
      }
    }
    sendJson(res,databaseStatus.ok?200:503,{
      app:'Zap Encomendas',node:'online',database:databaseStatus.ok?'online':'offline',
      migrations:migrationStatus,checkedAt:databaseStatus.checkedAt,
      ...(!databaseStatus.ok?{diagnostic:databaseDiagnostics()}:{})
    });
    return;
  }
  sendJson(res,404,{error:'Rota não encontrada'});
  } catch(err) {
    const code=safeErrorCode(err);
    console.error('[HTTP]',code,err.message);
    if(err.code && (/^(ER_|ECONN|ENOTFOUND|ETIMEDOUT)/).test(err.code)) {
      databaseStatus={ok:false,message:'Falha ao executar operação MySQL',checkedAt:new Date().toISOString()};
      lastDatabaseError=code;
      migrationStatus=code==='ER_NO_SUCH_TABLE'?'erro':'atualizado';
    }
    if(!res.headersSent) sendJson(res,500,{error:'Falha ao processar cadastro ou login.',code,hint:dbErrorHint(code)});
  }
});
server.on('upgrade',async(req,socket,head)=>{try{if(new URL(req.url,'http://localhost').pathname!=='/ws/calls'){socket.destroy();return}const origin=req.headers.origin;const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();if(origin){let originHost='';try{originHost=new URL(origin).host}catch{}if(!originHost||originHost!==host){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return}}await ensureDatabase();const user=await getSession(req);if(!user||!['motorista','transportadora'].includes(user.role)){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();return}callWss.handleUpgrade(req,socket,head,ws=>callWss.emit('connection',ws,req,user))}catch{socket.destroy()}});
server.listen(PORT, HOST, () => {
  console.log('[ZAP] Servidor online na porta '+PORT);
  ensureDatabase(true).then(recoverPendingCalls).catch(err => console.error('[BOOT]',err.message));
  const timer=setInterval(()=>{if(!databaseStatus.ok || migrationStatus!=='atualizado') ensureDatabase().catch(err=>console.error('[RETRY]',err.message));},30000);
  timer.unref();
  const recovery=setInterval(()=>recoverPendingCalls().catch(err=>console.error('[CALL SYNC]',err.message)),30000);recovery.unref();
});
process.on('SIGTERM', async () => { server.close(); if(pool) await pool.end(); });
