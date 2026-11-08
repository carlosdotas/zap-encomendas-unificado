# Zap Encomendas — Servidor Node.js + MySQL

Primeira etapa do projeto unificado. Um único arquivo `server.js` contém o servidor HTTP, página inicial, diagnóstico MySQL e migrações SQL. O `package.json` instala apenas o driver `mysql2`.

## Executar

1. Disponibilize Node.js 20+ e MySQL na hospedagem.
2. Configure as variáveis `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` e opcionalmente `PORT` (veja `.env.example`).
3. Execute `npm install` e `npm start` (ou configure o arquivo inicial `server.js` no painel da hospedagem).
4. Acesse `/` para visualizar **Servidor iniciado com sucesso!** e `/health` para verificar a conexão com MySQL.

> O Node.js não lê automaticamente arquivos `.env` nesta versão. Configure as variáveis diretamente no painel da hospedagem ou use `node --env-file=.env server.js` no Node 20.6+.

## Banco de dados

O banco `DB_NAME` precisa existir previamente, com usuário autorizado a criar tabelas. Ao iniciar, o servidor verifica e cria, se necessário, as tabelas: `schema_migrations`, `carriers`, `clients`, `drivers`, `orders` e `api_events`. Não apaga dados existentes. O status da conexão aparece na página e em `/health`.

## Situação atual

- Publicado: servidor, página de status, diagnóstico e migração inicial MySQL.
- Ainda pendente: configurar credenciais reais e confirmar conexão em hospedagem; integrar frontend V15 e rotas CRUD; autenticação e autorização antes de expor dados de clientes/pedidos.
- **Não é uma aplicação pronta para produção.** Não há rotas públicas de leitura/escrita dos dados nesta etapa.

## Segurança

Não envie senhas, tokens ou arquivos `.env` para o GitHub. Use variáveis de ambiente privadas no servidor.
