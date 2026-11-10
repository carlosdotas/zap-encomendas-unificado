# Auditoria técnica — portabilidade entre domínios e hospedagens

Data: 2026-11-10. Base: branch main, inspeção estática. Não representa testes de execução.

## Conclusão
**Não existe paridade funcional entre Hostinger e Vercel.** A aplicação usa URLs relativas para grande parte das requisições, mas cada hospedagem executa um backend distinto, com esquemas e recursos diferentes. Trocar de domínio não corrige isso.

## Evidências verificadas
1. `server.js`: Node persistente, MySQL, WebSocket `/ws/calls`, rotas de GPS, mapas, comprovantes, pedidos e financeiro.
2. `api/index.js`: função serverless PostgreSQL/Supabase, subconjunto de endpoints.
3. `vercel.json`: lista fechada de rewrites para algumas rotas; não encaminha diversos endpoints usados pelo frontend.
4. `index.html`: o WebSocket é construído com protocolo e host da página (`ws(s)://<domínio>/ws/calls`). Funciona apenas onde existe um serviço compatível com upgrade WebSocket.
5. `index.html`: navegação usa `https://router.project-osrm.org/route/v1/driving/`; disponibilidade e limites do serviço são externos.
6. `server.js`: com `DATABASE_URL`, encaminha `/api/*` ao handler PostgreSQL, mas este não implementa todas as rotas do Node/MySQL. Sem `DATABASE_URL`, o backend MySQL segue separado.
7. `package.json` e `package-lock.json` não estavam sincronizados na inspeção anterior; a instalação precisa ser testada com `npm ci`.

## Matriz preliminar de rotas consumidas pelo frontend

| Rota | PostgreSQL `api/index.js` | Node/MySQL `server.js` | Observação |
| --- | --- | --- | --- |
| `/api/auth/*` | Sim | Sim | Implementações distintas |
| `/api/orders` | Sim | Sim | Dados e regras podem divergir |
| `/api/clients` | Sim | Sim | Conferir contratos |
| `/api/financeiro` | Sim | Depende de rotas financeiras | Conferir contratos |
| `/api/carrier/history` | Sim | Não confirmado | Conferir |
| `/api/carrier/pending-orders` | Sim | Não confirmado | Conferir |
| `/api/carrier/actionable-orders` | Sim | Não confirmado | Conferir |
| `/api/carrier/drivers` | Não | Sim | Ausente no PostgreSQL |
| `/api/carrier/online-drivers` | Não | Sim | Ausente no PostgreSQL |
| `/api/driver/orders` | Não | Sim | Ausente no PostgreSQL |
| `/api/driver/presence` | Não | Sim | Ausente no PostgreSQL |
| `/api/maps/search` | Não | Sim | Ausente no PostgreSQL |
| `/api/maps/saved` | Não | Sim | Ausente no PostgreSQL |
| `/api/maps/alias` | Não | Sim | Ausente no PostgreSQL |
| `/api/app/version` | Não | Verificar | Ausente no PostgreSQL |
| `/api/driver/orders/:id/*` | Não | Sim | Comprovantes e ações |
| `/ws/calls` | Não (serverless) | Sim | Precisa serviço WebSocket persistente |

As indicações “Sim” são apenas de existência de implementação, não de compatibilidade comprovada.

## Arquitetura-alvo para funcionar em qualquer domínio
- Uma única API PostgreSQL/Supabase, com um registro central de rotas e contratos de resposta idênticos.
- Adaptadores de execução: Node HTTP na Hostinger e handler serverless na Vercel, chamando os mesmos módulos de negócio.
- Configuração de origem baseada em URLs relativas para HTTP; `PUBLIC_API_BASE_URL` opcional quando frontend/API estiverem em domínios distintos.
- `PUBLIC_WS_URL` para serviço persistente de chamadas, sem pressupor que o domínio da Vercel suporte WebSocket.
- CORS por lista explícita de origens confiáveis quando necessário; não liberar indiscriminadamente cookies para qualquer origem.
- Sessões e autenticação compartilhadas no mesmo banco; avaliar domínio de cookie e política SameSite quando a API for separada.
- Serviço de rotas com fallback, tratamento de indisponibilidade e limites; não depender exclusivamente do OSRM público.
- Testes de contrato para todos os endpoints, testes de sessão, GPS, mapas, chamadas e comprovantes.
- Testes em domínios de preview e produção antes de promover.

## Critérios de aceite
1. Mesmo usuário e banco apresentam os mesmos pedidos, permissões e locais nas duas hospedagens.
2. Todos os endpoints consumidos pelo frontend respondem com contrato idêntico, inclusive erros.
3. GPS, notificações e chamadas funcionam em Hostinger e Vercel via serviço persistente.
4. Nenhuma URL de API, autenticação ou WebSocket depende de domínio fixo no código.
5. Os testes automatizados passam e os deployments de preview são verificados.

## Estado
**Auditoria estática realizada; paridade não implementada nem testada.** Não promover alterações estruturais sem testes de banco, rotas e autenticação.
