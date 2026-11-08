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
