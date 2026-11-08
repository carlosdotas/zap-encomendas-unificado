# Zap Encomendas — Node.js + MySQL

## Iniciar

Instale Node.js 20+, configure as variáveis MySQL na hospedagem conforme `.env.example` e execute:

```bash
npm install
npm start
```

- `/` abre o **frontend V15** (arquivo `index.html`).
- `/status` mostra a página de confirmação do servidor e o status do MySQL.
- `/health` retorna JSON com a saúde do servidor e banco (200 conectado, 503 desconectado).

O arquivo `package.json` já define o script `start` e a única dependência do backend: `mysql2`. O frontend V15 usa recursos CDN, então a interface exige internet no navegador.

## MySQL

Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` no ambiente da hospedagem. O banco deve existir previamente. O servidor tenta conectar e cria as tabelas `schema_migrations`, `carriers`, `clients`, `drivers`, `orders` e `api_events` quando o usuário MySQL tem permissão.

**Importante:** a conexão com o banco não foi testada na hospedagem real. O frontend V15 ainda usa armazenamento local do navegador; os cadastros e pedidos **não estão integrados ao MySQL**. Não há API CRUD nem autenticação nesta etapa. O próximo passo é implementar isso com segurança.

Não publique senhas nem arquivos `.env` no GitHub.

## Cadastro e login (etapa 2)

O frontend V15 faz cadastro, login e logout pela API Node.js. Na primeira inicialização com MySQL disponível, a migração 2 cria `app_users` e `auth_sessions`.

Rotas: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`. O cadastro pede nome completo, telefone com DDD, senha com 10 ou mais caracteres, perfil e veículo(s) para motorista. O registro autentica automaticamente. As senhas são armazenadas como hashes `scrypt` com salt individual e a sessão usa cookie HttpOnly.

**Importante:** a publicação no GitHub não prova que a hospedagem atualizou nem que o banco executou as migrações. Confirme a nova implantação e teste cadastro, logout e login. A interface de pedidos/clientes ainda usa localStorage e precisa de APIs autenticadas antes de ser usada com dados reais. O cadastro público de transportadora é provisório; antes de liberar recursos administrativos, implemente aprovação e autorização por papel no servidor.
