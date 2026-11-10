# Auditoria de rotas — Hostinger e Vercel (desenvolvimento)

## Arquitetura encontrada
- `server.js`: servidor HTTP + WebSocket + MySQL, com rotas de GPS, Google Maps, comprovantes, pedidos, autenticação e financeiro.
- `api/index.js`: controlador HTTP PostgreSQL/Supabase, usado na Vercel.
- `vercel.json`: encaminhamento explícito de um subconjunto das rotas ao controlador PostgreSQL.
- **Não há paridade completa entre os dois backends.** Uma reescrita/reconciliação de rotas e SQL será necessária para assegurar comportamento idêntico.

## Ajuste experimental nesta branch
O `server.js` encaminha `/api/*` e `/health` para `api/index.js` quando `DATABASE_URL` está definida. Sem `DATABASE_URL`, conserva o backend MySQL. Essa mudança não implementa endpoints ausentes no controlador PostgreSQL.

## Rotas presentes no Node/MySQL e ausentes ou incompletas no PostgreSQL
- `/api/driver/orders` e `/api/driver/orders/:id/proofs` — pedidos do profissional e comprovantes
- `/api/driver/presence` e `/api/carrier/online-drivers` — presença e localização
- `/api/maps/search`, `/api/maps/saved`, `/api/maps/alias`, `/api/maps/browser-config` — pesquisa e cadastro de locais
- `/api/finance/*` — funções financeiras legadas
- chamadas WebSocket: não disponíveis em funções serverless da Vercel; requerem serviço persistente separado

## Próximos passos necessários antes de afirmar compatibilidade
1. Definir Supabase como banco canônico e portar consultas faltantes para PostgreSQL.
2. Centralizar o registro de rotas e criar testes HTTP por endpoint para ambos os modos.
3. Separar o serviço WebSocket do runtime serverless e disponibilizar URL configurável.
4. Validar autenticação, permissões, payloads e resposta de cada rota em ambas as hospedagens.
5. Testar deploy da branch de desenvolvimento na Hostinger e em preview da Vercel.
6. Não publicar na main sem aprovação e testes.

## Configuração
Hostinger PostgreSQL: `DATABASE_URL` com conexão Supabase e `npm start`. Vercel: `DATABASE_URL` no projeto. A variável não deve ser exposta no frontend ou versionada.
