# Zap Encomendas — Projeto Unificado

Projeto em desenvolvimento para reunir frontend e backend Node.js/MySQL.

## Arquitetura prevista

- Um único `server.js` como ponto de entrada, com servidor HTTP, API JSON e frontend HTML incorporado.
- Banco MySQL com migrações controladas para clientes, pedidos e motoristas.
- Página inicial e rota `/health` para diagnosticar servidor e banco.
- Autenticação antes de permitir operações do frontend em produção.

## Estado atual

Repositório inicializado. A integração do frontend V15 ao servidor Node.js ainda está pendente; **não há aplicação pronta para produção neste repositório**.

## Segurança

Não publique senhas, tokens ou credenciais MySQL. Configure-as nas variáveis de ambiente da hospedagem.
