# Chamadas: som único e Visualizar

O serviço publicava uma notificação com som e também executava
`Ringtone.play()` com repetição. Isso iniciava dois reprodutores para a mesma
chamada. Agora somente o Android toca o som do canal `driver_calls_v1`.
`Notification.FLAG_INSISTENT` repete o mesmo alerta; cancelar a notificação interrompe
o toque. Preferências de volume/silêncio do canal e Não Perturbe permanecem sob
controle do Android. A interface web já desativa seu áudio quando usa a ponte nativa.

A tela nativa e a notificação agora oferecem **Visualizar**, abrindo diretamente
os detalhes do pedido no WebView. A notificação usa PendingIntent de Activity,
sem trampoline de serviço para navegação. A tela cheia continua disponível para
novas chamadas conforme permissões do aparelho.

`MainActivity` entrega o comando `view` ao serviço. Ele valida pedido/prazo,
cancela o alerta e mantém a oferta viva, marcada `viewed`. Esse estado acompanha
o replay para a página que ainda está carregando. A ponte sinaliza `calls_ready` para obter
um replay após sua instalação e preserva a navegação pendente até a autenticação
da página terminar; assim a abertura não para na tela de início da jornada. Uma cópia duplicada via
WebSocket/push preserva a marca e não reinicia o toque. O formulário abre os
detalhes ao receber a oferta visualizada. O botão Visualizar dentro da página
também envia esse comando e silencia a chamada nativa.

Visualizar não envia `accept` nem `reject` ao servidor. A confirmação de aceite
continua somente nos detalhes do pedido. Recusa, expiração, rastreamento e espera
em segundo plano são preservados.

Arquivos principais: `DriverService.java`, `IncomingCallActivity.java`,
`MainActivity.java`, `mobile/driver-bridge.js`, seu asset Android e `index.html`.

Validação automatizada da interface com APIs simuladas: Visualizar abre os
detalhes sem aceitar, comunica silêncio ao serviço, replay abre os detalhes sem
áudio web e Recusar mantém a decisão explícita. Compilação/lint Android e assinatura
do APK também são verificados. Não houve teste de áudio em telefone físico,
pois não há aparelho conectado neste ambiente.

No aparelho, testar uma chamada com tela ligada e outra bloqueada: deve existir
um único toque; Visualizar deve silenciar e mostrar o pedido certo; somente Aceitar
nos detalhes deve vinculá-lo. Conferir também Recusar, expiração, canal silenciado
e Não Perturbe. Usar somente pedidos de teste autorizados.

Para repetir o teste de interface, com Playwright e Chromium já disponíveis:

```bash
PLAYWRIGHT_MODULE=/caminho/para/playwright-core \
CHROMIUM_PATH=/usr/bin/chromium node scripts/test-calls-browser.cjs
```

O teste intercepta as APIs de `dotas.site` e usa somente dados fictícios.
As bibliotecas web são obtidas de `unpkg.com`, como na página do aplicativo.
