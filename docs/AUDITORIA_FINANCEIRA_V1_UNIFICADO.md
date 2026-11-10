# Auditoria financeira V1 → Unificado (10/11/2026)

## Fontes
- V1: `server-node/src/routes/caixa.js`, `server-node/src/routes/contas.js`, `server-node/src/routes/pedidos.js`, `server-node/src/models/{Conta,CaixaTransacao}.js`.
- Unificado: `server.js`, migrações 1–17.

## Diagnóstico
1. V1 mantém `contas` (pagar/receber; vencimento; status; baixa; juros; valor pago) separadas de `caixa_transacoes` (entrada/saída; usuário; pedido; saldo).
2. No V1, criar pedido com cliente e total positivo gera débito no caixa; pagamento gera crédito; o extrato soma entradas menos saídas.
3. A rota V1 `/caixa/rebuild_from_pedidos` executa `DELETE FROM caixa_transacoes` antes de reconstruir. **Não transportar essa rotina destrutiva.**
4. A sincronização financeira do V1 ocorre depois do commit do pedido e captura erros sem falhar o pedido; isso pode deixar pedido e caixa divergentes.
5. `saldo_apos` armazenado em transações pode ficar obsoleto após edições retroativas.
6. O Unificado tem `orders` e `zap_order_entries`, mas suas migrações 1–17 não criam contas, caixa ou recebimentos; a migração de dados antigos não deve disparar lançamentos financeiros.
7. O Unificado ainda usa MySQL (`mysql2/promise`), portanto uma tabela criada isoladamente no Supabase não integra automaticamente o backend.

## Regras de compatibilidade propostas
- `contas` e `pagamentos` são entidades distintas: uma conta pode ter pagamentos parciais.
- Cada movimento de caixa é imutável; correção por estorno e novo lançamento, com referência ao original.
- Idempotência: chave única `(origem_sistema, origem_tipo, origem_id, evento)`; reprocessamento não duplica.
- Valores `NUMERIC(14,2)`, nunca `float`; validar moeda, valores positivos e arredondamento.
- Pago somente quando a soma de pagamentos confirmados alcançar o devido; pagamento parcial não é pago integral.
- Baixa, pagamento e lançamento de caixa devem ser atômicos na mesma transação.
- Ações financeiras exigem autenticação e autorização no backend; não confiar em `user_id` vindo do navegador.
- Pedidos legados: `origem_sistema='hostinger_v1'`, IDs preservados, sem cobrança automática e sem alterar estado financeiro atual.
- Não reclassificar pagamento recebido por motorista como receita da transportadora sem conciliação.
- Extrato: calcular saldo por soma dos lançamentos e saldo anterior por data, com ordenação determinística.

## Critérios mínimos antes de ativar
1. Dois envios do mesmo pagamento produzem apenas um recebimento.
2. Pedido pago permanece pago após reimportação.
3. Pagamento parcial permanece parcial; estorno reabre saldo corretamente.
4. Alteração de valor não reescreve histórico; gera ajuste auditável.
5. Falha no caixa reverte a baixa e vice-versa.
6. Importação histórica não cria cobranças nem notificações.
7. Usuário de outra empresa não visualiza nem altera contas.
8. Conciliação de totais por pedido, cliente e período com V1.

## Estado
Auditoria iniciada e riscos identificados. **Não implementado nem testado em produção**. É necessário implementar a camada financeira no backend escolhido (MySQL atual ou PostgreSQL/Supabase) e integrar as telas e endpoints antes de considerar resolvido.
