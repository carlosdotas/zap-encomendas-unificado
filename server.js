'use strict';

// ZAP ENCOMENDAS - servidor único Node.js + MySQL
// Configure DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME na hospedagem.
// O código nunca envia credenciais para o navegador.
const http = require('node:http');
const fs = require('node:fs');
const pathModule = require('node:path');
const mysql = require('mysql2/promise');
const crypto = require('node:crypto');

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
  ]]
];

function configured() { return Boolean(DB_CONFIG.user && DB_NAME); }
function safeErrorCode(err) { return String(err?.code || 'ERRO_DESCONHECIDO').replace(/[^A-Z0-9_]/g,'').slice(0,60); }
function dbErrorHint(code) { const hints={ER_NO_SUCH_TABLE:'Tabela de autenticação não existe. Verifique as migrações e permissões CREATE TABLE.',ER_BAD_FIELD_ERROR:'A tabela existente tem colunas incompatíveis com o cadastro.',ER_ACCESS_DENIED_ERROR:'Credenciais ou permissões MySQL incorretas.',ER_DBACCESS_DENIED_ERROR:'Usuário sem acesso ao banco configurado.',ER_TABLEACCESS_DENIED_ERROR:'Usuário sem permissão nas tabelas.',ER_BAD_DB_ERROR:'Banco DB_NAME não existe.',ECONNREFUSED:'MySQL recusou a conexão: confira DB_HOST e DB_PORT.',ENOTFOUND:'Endereço DB_HOST não encontrado.',ETIMEDOUT:'Conexão MySQL expirou.',ER_DUP_ENTRY:'Já existe cadastro com esses dados.'};return hints[code]||'Consulte o código do erro nos logs da hospedagem.'; }

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
    auth_sessions: {
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
  const [rows]=await pool.execute('SELECT u.id,u.full_name,u.phone,u.role,u.vehicles FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1',[hash]);
  return rows[0] || null;
}
function publicUser(user) {
  return {id:user.id,name:user.full_name,phone:user.phone,role:user.role,vehicles:(user.vehicles || '').split(',').filter(Boolean)};
}
async function loginSession(req,res,user) {
  const token=crypto.randomBytes(32).toString('hex');
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  await pool.execute('INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))',[tokenHash,user.id]);
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
  if(!pool || !databaseStatus.ok || migrationStatus!=='atualizado') await ensureDatabase();
  if(!pool || !databaseStatus.ok || migrationStatus!=='atualizado') {sendJson(res,503,{error:'Banco de dados indisponível',diagnostic:databaseDiagnostics()});return true;}
  if(rateLimit(req,path)) {sendJson(res,429,{error:'Muitas tentativas. Aguarde 15 minutos.'});return true;}
  let body;
  try {body=await readBody(req)} catch(err) {sendJson(res,400,{error:'Corpo da requisição inválido.'});return true;}
  if(path==='/api/auth/logout') {
    const match=String(req.headers.cookie||'').match(/(?:^|;\s*)zap_session=([a-f0-9]{64})(?:;|$)/);
    if(match) await pool.execute('DELETE FROM auth_sessions WHERE token_hash=?',[crypto.createHash('sha256').update(match[1]).digest('hex')]);
    setSessionCookie(req,res,'',0);sendJson(res,200,{ok:true});return true;
  }
  const phone=phoneDigits(body.phone), password=body.password;
  if(!/^\d{10,11}$/.test(phone) || typeof password!=='string' || password.length<10 || Buffer.byteLength(password)>256) {
    sendJson(res,400,{error:'Informe telefone com DDD e senha de pelo menos 10 caracteres.'});return true;
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

const server = http.createServer(async (req,res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
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
server.listen(PORT, HOST, () => {
  console.log('[ZAP] Servidor online na porta '+PORT);
  ensureDatabase(true).catch(err => console.error('[BOOT]',err.message));
  const timer=setInterval(()=>{if(!databaseStatus.ok || migrationStatus!=='atualizado') ensureDatabase().catch(err=>console.error('[RETRY]',err.message));},30000);
  timer.unref();
});
process.on('SIGTERM', async () => { server.close(); if(pool) await pool.end(); });
