'use strict';

// ZAP ENCOMENDAS - servidor único Node.js + MySQL
// Configure DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME na hospedagem.
// O código nunca envia credenciais para o navegador.
const http = require('node:http');
const mysql = require('mysql2/promise');

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

const migrations = [
  [1, [
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS carriers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS clients (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, carrier_id BIGINT UNSIGNED NOT NULL DEFAULT 1, name VARCHAR(160) NOT NULL, phone VARCHAR(30) NOT NULL, address VARCHAR(500) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_client_phone (carrier_id,phone), KEY idx_clients_name (name)) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS drivers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, carrier_id BIGINT UNSIGNED NOT NULL DEFAULT 1, name VARCHAR(160) NOT NULL, phone VARCHAR(30) NOT NULL, vehicle_type VARCHAR(30) NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_driver_phone (carrier_id,phone)) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS orders (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, carrier_id BIGINT UNSIGNED NOT NULL DEFAULT 1, client_id BIGINT UNSIGNED NULL, driver_id BIGINT UNSIGNED NULL, place VARCHAR(255) NOT NULL, address VARCHAR(600) NULL, latitude DECIMAL(10,7) NULL, longitude DECIMAL(10,7) NULL, service_type VARCHAR(40) NOT NULL DEFAULT 'coleta', vehicle_type VARCHAR(40) NOT NULL DEFAULT 'moto', instructions TEXT NULL, status VARCHAR(40) NOT NULL DEFAULT 'aguardando_motorista', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, KEY idx_orders_status (status), KEY idx_orders_client (client_id), KEY idx_orders_driver (driver_id)) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS api_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, event_type VARCHAR(100) NOT NULL, detail VARCHAR(500) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, KEY idx_events_date (created_at)) ENGINE=InnoDB"
  ]]
];

function configured() { return Boolean(DB_CONFIG.user && DB_NAME); }
async function connectAndMigrate() {
  if (!configured()) {
    databaseStatus = {ok:false, message:'Configure DB_USER e DB_NAME nas variáveis de ambiente', checkedAt:new Date().toISOString()};
    migrationStatus = 'aguardando_configuracao';
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
    await pool.query("INSERT INTO carriers (id,name) VALUES (1,'Zap Encomendas') ON DUPLICATE KEY UPDATE id=id");
    databaseStatus = {ok:true, message:'MySQL conectado e estrutura verificada', checkedAt:new Date().toISOString()};
    migrationStatus = 'atualizado';
  } catch (err) {
    databaseStatus = {ok:false, message:'Falha na conexão ou migração do MySQL', checkedAt:new Date().toISOString()};
    migrationStatus = 'erro';
    console.error('[MYSQL]', err.message);
  }
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
const server = http.createServer(async (req,res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(homeHtml());
    return;
  }
  if (req.method === 'GET' && path === '/health') {
    if (pool) {
      try {
        await pool.query('SELECT 1');
        databaseStatus = {ok:true,message:'MySQL conectado e respondendo',checkedAt:new Date().toISOString()};
      } catch (err) {
        databaseStatus = {ok:false,message:'MySQL não está respondendo',checkedAt:new Date().toISOString()};
        console.error('[HEALTH]',err.message);
      }
    }
    sendJson(res, databaseStatus.ok ? 200 : 503, {
      app:'Zap Encomendas', node:'online', database:databaseStatus.ok ? 'online':'offline',
      migrations:migrationStatus, checkedAt:databaseStatus.checkedAt
    });
    return;
  }
  sendJson(res,404,{error:'Rota não encontrada'});
});
server.listen(PORT, HOST, () => {
  console.log('[ZAP] Servidor online na porta '+PORT);
  connectAndMigrate().catch(err => console.error('[BOOT]',err.message));
});
process.on('SIGTERM', async () => { server.close(); if(pool) await pool.end(); });
