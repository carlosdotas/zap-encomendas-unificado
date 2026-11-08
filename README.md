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

## Aplicativo Android (Capacitor)

O projeto Android está em `android/`, com ID `site.dotas.zapencomendas`, Android 8+
(API 26) e destino Android 15 (API 35). O aplicativo abre **https://dotas.site**;
a interface e as APIs continuam hospedadas no servidor e exigem internet.
A ponte nativa aceita mensagens somente do documento principal desse domínio.

Para compilar, use Node 20+, JDK 21 e Android SDK 35 (Build Tools 34):

```bash
npm ci
npm run android:sync
# Defina ANDROID_HOME ou android/local.properties com sdk.dir.
cd android
./gradlew assembleDebug lintDebug
```

APK de teste: `android/app/build/outputs/apk/debug/app-debug.apk`.
A assinatura debug serve para instalação direta e testes. Para distribuição,
configure uma chave de assinatura release privada e gere `assembleRelease`.
Não publique chaves de assinatura ou credenciais Firebase no Git.

### Jornada e permissões

- Ao entrar como motorista, o aplicativo explica e solicita localização precisa,
  notificações e localização em segundo plano (“Permitir o tempo todo”). A
  localização em segundo plano é solicitada separadamente pela API de permissões
  do Android, depois da localização precisa. A tela geral de configurações só
  é usada como alternativa quando o sistema bloqueia novas solicitações. O GPS
  precisa estar ligado para iniciar a jornada. Negar essas permissões impede
  ficar online, sem forçar a concessão pelo usuário.
- Durante a jornada, `DriverService` mantém uma notificação visível, GPS nativo
  (intervalo solicitado de 10 segundos / deslocamento de 10 metros) e o WebSocket
  autenticado existente `/ws/calls`, com reconexão. A frequência real depende
  do sinal, do aparelho e do Android. O serviço continua ao bloquear a tela ou
  remover a interface dos aplicativos recentes. Não há reinício silencioso no boot.
- Sair da conta ou tocar **Ficar offline** na notificação encerra o serviço,
  o GPS e a disponibilidade para chamadas. Visitar o perfil mantém a jornada.
  Desligar o GPS também encerra a jornada.
- Uma oferta gera som, vibração e notificação de categoria chamada, com uma
  atividade nativa de tela cheia e botões Aceitar/Recusar. O aceite é confirmado
  pelo servidor; ofertas expiram em 30 segundos. Ofertas duplicadas por push e
  WebSocket são conciliadas. As escolhas de volume, canal e Não Perturbe são
  respeitadas.
- Android 14+ pode exigir autorização manual para alertas em tela cheia; o
  aplicativo encaminha às configurações uma vez. Se não autorizada, o Android
  usa a notificação de alta prioridade. Com o aparelho desbloqueado, o sistema
  também pode preferir um banner. Fabricantes podem impor restrições adicionais.
- A câmera de comprovação usa a solicitação de permissão do WebView apenas
  quando aberta. Os arquivos/fotos usam o seletor Android, sem acesso amplo ao
  armazenamento. Não são solicitados microfone, contatos ou permissões de telefone.

### GPS no servidor

**Publique `server.js`, `native-push.js` e o `package-lock.json` atualizado na
hospedagem**, execute `npm ci` e reinicie o processo Node. A migração 11 cria
`zap_driver_positions`, com apenas a posição mais recente de cada motorista.
O servidor valida coordenadas, precisão, horário e perfil autenticado, e limita
as escritas por conexão a uma a cada 5 segundos. Não há histórico de trajetos.
O APK consegue receber chamadas pelo WebSocket da hospedagem atual; persistir o
GPS e usar push exigem a publicação dessas mudanças. O ajuste em `index.html`
evita tocar simultaneamente o aviso sonoro web e o toque nativo.

### Push Firebase para repouso profundo (configuração pendente)

Um WebSocket e um serviço em primeiro plano **não garantem** despertar no Doze,
após encerramento do processo, ou em aparelhos com restrições de bateria.
A integração FCM está implementada, mas o APK gerado sem configuração Firebase
usa apenas o serviço/WebSocket. Nenhum projeto Firebase é criado automaticamente.

Para ativar o FCM:

1. Crie ou selecione um projeto Firebase e registre o Android com o pacote
   `site.dotas.zapencomendas`. Salve sua configuração `google-services.json`
   em `android/app/google-services.json` e recompile o APK.
2. Habilite Firebase Cloud Messaging HTTP v1. Na hospedagem, configure
   `FIREBASE_PROJECT_ID` e `GOOGLE_APPLICATION_CREDENTIALS` apontando para um
   arquivo privado de conta de serviço com permissão de envio FCM. Essa chave
   fica exclusivamente no servidor; não entra no APK ou no repositório.
3. Publique e reinicie o backend atualizado. O APK registra o token pelo
   WebSocket autenticado, junto com o veículo cadastrado. O servidor usa
   mensagens de dados Android `high`, TTL de até 30 segundos, e revalida a sessão
   antes de enviar. Logout revoga o registro; a disponibilidade push expira em
   12 horas sem renovação. A cada 5 minutos conectado, o serviço renova o registro.
4. Faça uma jornada online antes de testar. A disponibilidade push fica em
   memória no processo Node: após reiniciar o backend, os aparelhos precisam
   reconectar. Para múltiplas instâncias, mova filas/disponibilidade para um
   armazenamento compartilhado; o sistema atual usa um único processo.

O FCM pode despertar uma jornada previamente iniciada; não ativa jornada de um
motorista offline. Forçar parada do aplicativo nas configurações do Android
impede receber mensagens até reabri-lo. Telefone realmente desligado, sem bateria
ou sem rede não recebe chamadas. Nenhuma permissão contorna essas restrições.

### Verificação

```bash
npm run test:mobile
cd android && ./gradlew lintDebug
```

Para validar em aparelho: entre como motorista, conceda as permissões, bloqueie
a tela e cadastre um pedido compatível usando outra conta. Verifique toque,
tela cheia, recusa, aceite confirmado, expiração e reconexão após perda de rede.
Confira a última coordenada no banco após publicar a migração. Teste também a
câmera e o seletor de arquivos, logout e o botão Ficar offline. Com Firebase
configurado, repita em Doze (`adb shell dumpsys deviceidle force-idle`) e depois
saia do modo (`adb shell dumpsys deviceidle unforce`). Esses testes em aparelho
não foram executados nesta entrega.

### Download na página inicial e versões automáticas

A tela que escolhe Transportadora/Motorista mostra o botão **Baixar aplicativo
para Android**, a versão, o número da compilação e o tamanho. O servidor oferece:

- `GET /api/app/version`: dados da versão disponível, sem exigir login.
- `GET /downloads/zap-encomendas.apk`: URL fixa que sempre entrega o último APK.

Ambas as rotas usam `Cache-Control: no-store`. A página consulta a versão ao abrir,
ao voltar à aba e a cada minuto. Sem APK disponível, mostra uma mensagem em vez
de um link quebrado. Não depende do banco de dados.

Para gerar e disponibilizar uma atualização:

```bash
npm run android:debug
# Ou, com a assinatura release já configurada:
npm run android:release
```

A integração `android/app/apk-versioning.gradle` também roda usando
`./gradlew assembleDebug`, `assembleRelease` ou **Build APK** no Android Studio.
Cada geração bem-sucedida de APK assinado incrementa `versionCode` e produz uma
versão como `1.0.1`, `1.0.2`, `1.0.3`. O controle fica em
`mobile/version.properties`: preserve e versione esse arquivo entre compilações
e máquinas. Sync e lint não alteram o contador. Use um tipo de APK por comando.
Use sempre a mesma chave de assinatura para instalar atualizações sobre o app.

Após compilar, o Gradle coloca o APK em `downloads/` e atualiza `latest.json`.
O ponteiro só é trocado depois que o novo arquivo está completo; uma compilação
com erro ou um APK release sem assinatura não substitui o download. A URL
pública permanece a mesma. O arquivo anterior é preservado durante a troca
para permitir downloads já iniciados. Não edite `latest.json` manualmente.

**Para atualizar `dotas.site`, publique também a pasta `downloads/` inteira**,
com `index.html`, `server.js` e `apk-download.js`. Se você compilar em seu
computador, copiar o resultado para a hospedagem continua sendo necessário;
a compilação não envia arquivos ou credenciais para a Hostinger. Se o Node já
estiver executando o código atualizado, trocar os arquivos de `downloads/`
não exige reiniciar o processo. Envie o novo arquivo `.apk` antes de substituir
`latest.json`, para manter o download disponível durante o envio.
Em hospedagem com armazenamento temporário,
use um volume persistente para essa pasta ou inclua o APK em cada implantação.

### Ícone original do sistema

O aplicativo usa os mesmos traçados e cores do SVG do componente `Logo` em
`index.html`. O arquivo vetorial extraído fica em `mobile/assets/logo.svg`.
Execute `npm run android:icons` para regenerar o vetor Android, os PNGs em todas
as densidades e as adaptações monocromáticas. `npm run android:sync` já executa
essa geração antes de sincronizar o Capacitor. O logo fica dentro da área segura
do ícone adaptativo para preservar o círculo e as setas nas máscaras do Android.
A tela de inicialização também usa esse vetor.

### Barras e teclado do Android

O contêiner do WebView respeita barras, recortes e teclado. Android 11+ usa um
único controlador nativo de insets, com fundo `max(navegação, IME)`; Android
8–10 usa decor fitting e `adjustResize`, sem compensação manual adicional.
O ajuste automático de margens do Capacitor fica desativado para evitar dois
controladores. O contraste das barras e a tela nativa de chamada são preservados.

Veja [a análise, os arquivos alterados e a validação do teclado](docs/android-keyboard.md).
O teste em aparelho físico permanece pendente nesta execução; não houve um
aparelho conectado e a emulação Android não estabilizou antes de iniciar o app.

### Fechar janelas e botão Voltar

`navigation.js` é compartilhado pelo site e pela ponte Android. O comando Voltar
fecha primeiro a camada aberta (foto ampliada, câmera, detalhes de chamada,
seletor, formulário, menu), depois retorna das telas internas, como perfil e
login. Só uma tela principal permite recolher a interface Android. Isso não faz
logout nem encerra a jornada em segundo plano. Fechar detalhes de uma chamada
não aceita nem recusa o pedido.

O navegador usa o mesmo comando no histórico e na tecla Escape. Os botões X e
Voltar das telas continuam disponíveis. Ao publicar na hospedagem, inclua também
`navigation.js` e o `server.js` atualizado; o APK inclui uma cópia da mesma ponte
para receber o botão Voltar do Android. As solicitações nativas de permissão
podem ser canceladas com Voltar, mantendo o motorista offline.

Teste da prioridade de fechamento e do histórico: `node test/navigation.test.js`.

### Receber uma localização e abrir um pedido

No Maps ou no Waze, use **Compartilhar → Zap Encomendas**. O APK recebe texto com
links de localização e também pode ser escolhido para abrir URIs `geo:`,
`google.navigation:` e `waze:`. O Android decide quais aplicativos aparecem ao
abrir links HTTPS; compartilhar o link pelo menu Android funciona sem verificar
a propriedade dos domínios Google/Waze.

Com uma conta de transportadora autenticada, o aplicativo abre o formulário de
novo pedido com o ponto no mapa, a localização selecionada e a busca preenchida.
Links curtos são resolvidos pela API existente de locais; coordenadas explícitas
são usadas diretamente. Colar coordenadas ou um link GPS na busca do site segue
o mesmo fluxo. O pedido só é criado ao tocar em **Cadastrar pedido**.

Se for necessário fazer login, o local permanece pendente e é aplicado depois
do acesso. Uma conta de motorista não é convertida em transportadora nem recebe
permissão para criar pedidos. Se já houver um pedido em edição, o novo local
fica disponível com o botão **Abrir novo pedido**, preservando o rascunho até
uma ação explícita. Fechar a pendência cancela sua aplicação, inclusive quando
uma resolução de link ainda está em andamento.

A entrada pendente expira após duas horas. O Android mantém a pendência em
armazenamento privado até a página confirmar a seleção do local; a página
preserva a entrada durante o login/recarregamento. Reentregas do mesmo evento
não abrem pedidos duplicados. URLs de outros serviços e coordenadas fora dos
limites são recusadas. Não é necessário conceder acesso ao GPS do aparelho para
importar um ponto que já foi compartilhado por outro aplicativo.

Publique também `location-input.js`, `shared-location.js`, `index.html` e
`server.js`. Os dois scripts são usados tanto pelo site quanto pela ponte do
APK. A busca de endereços sem coordenadas continua dependendo do banco/Google
Places configurados na hospedagem.

Testes: `node test/location-input.test.js`, `node test/shared-location.test.js`
e `node test/maps-redirect.test.js`. Para testar em aparelho:

```bash
adb shell am start -a android.intent.action.VIEW -d 'geo:0,0?q=-15.7942,-47.8822' -n site.dotas.zapencomendas/.MainActivity
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'https://waze.com/ul?ll=-15.7942%2C-47.8822' -n site.dotas.zapencomendas/.MainActivity
```

Repita com o app fechado, aberto e antes do login. Os testes de interface usam
compartilhamentos simulados; a recepção por outro aplicativo em um aparelho
Android físico ainda precisa ser validada.
