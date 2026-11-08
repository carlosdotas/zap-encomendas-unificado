# Teclado Android: correção e validação

## Arquitetura e causa encontrada

O aplicativo usa Capacitor 7 (`BridgeActivity` + `CapacitorWebView`), carregando
`https://dotas.site`. Não é Cordova nem Trusted Web Activity.

A Activity principal não declarava `windowSoftInputMode`. O ajuste anterior
`android.adjustMarginsForEdgeToEdge: auto` do Capacitor aplicava margens de
`systemBars() | displayCutout()` e retornava `WindowInsetsCompat.CONSUMED`.
O inset `Type.ime()` não era aplicado antes desse consumo. Assim, no caminho
edge-to-edge, o WebView podia continuar com a altura anterior à abertura do
teclado. Mover um painel usando apenas `visualViewport` não corrige a altura
nativa disponível e ainda pode somar deslocamentos quando o resize funciona.

Também foi confirmado que `android/app/src/main/res/layout/activity_main.xml`
não é o layout usado pela `BridgeActivity`. O recurso efetivo é
`capacitor_bridge_layout_main.xml` da biblioteca, agora sobrescrito no app.

## Implementação

| Arquivo | Mudança |
| --- | --- |
| `android/app/src/main/AndroidManifest.xml` | `MainActivity` declara `android:windowSoftInputMode="adjustResize"`. |
| `capacitor.config.json` | Desativa `adjustMarginsForEdgeToEdge` do Capacitor para não competir com o controlador próprio. |
| `android/app/src/main/res/layout/capacitor_bridge_layout_main.xml` | Contêiner `FrameLayout` real e `CapacitorWebView` com altura/largura `match_parent`. |
| `android/app/src/main/java/site/dotas/zapencomendas/WebViewViewport.java` | Controla a área útil do WebView. Em API 30+, aplica topo/laterais de barras/recortes e `max(barra inferior, IME)` no fundo. A altura do WebView muda de fato. Trata animação e restauração. |
| `android/app/src/main/java/site/dotas/zapencomendas/SystemBars.java` | Separa a janela web da janela nativa de chamada. Em API 26–29 mantém decor fitting e resize do sistema; em API 30+ usa edge-to-edge com insets explícitos. Preserva contraste das barras. |
| `android/app/src/main/java/site/dotas/zapencomendas/MainActivity.java` | Instala o controlador e a ponte `viewport_ready`. Mantém compartilhamento GPS, serviços, permissões e comando Voltar. |
| `mobile/viewport.js` | Ponte exclusiva do APK. Usa a altura já redimensionada, sem subtrair o teclado outra vez. Limita painéis, preserva busca/resultados e rola campos focados para a área visível. Neutraliza offsets e margens de rolagem antigas; mantém o campo acima do botão fixo de cadastrar e oculta o rodapé de versão durante a digitação. |
| `scripts/sync-mobile.js` | Copia a ponte para os assets Android. |
| `index.html` | Mantém as correções web para navegadores comuns, mas deixa o APK novo usar seu redimensionamento nativo. Preserva mostrar senha, avanço do telefone, formulários e autofocus das observações. |

Os insets são consumidos **depois** de aplicados ao contêiner no Android moderno.
Não se soma a barra de navegação à altura do IME: ele já cobre essa região.
Nas versões antigas, não se reaplica o IME manualmente depois do `adjustResize`.
A tela nativa de chamada continua com seu tratamento próprio de barras.

A ponte também protege o APK durante a atualização da hospedagem: seu CSS
nativo impede que os offsets antigos do HTML movam novamente o painel. A cópia
web do HTML deve ser publicada para dispensar os listeners compensatórios.
O frontend completo continua vindo da internet; não foi empacotado no APK.

## O que foi verificado nesta execução

- Compilação do APK e do pacote de testes instrumentados: passou.
- Android lint do módulo `app`: passou sem erros (avisos existentes permanecem).
- Testes no Chromium com o frontend real e APIs simuladas: busca e primeiro
  resultado visíveis em viewport reduzido; offsets antigos de 300 px não
  deslocam o painel; observações, login, senha e cadastro acessíveis; altura
  original restaurada e texto preservado ao fechar o teclado simulado.
- Aparelho físico: **não executado**. O ADB não encontrou aparelho físico.
- IME emulado: **não validado**. Android 15 em emulação de software iniciou ADB,
  mas reiniciou serviços do sistema durante o boot (`DeadSystemException`). A
  instalação retornou `Failure calling service package: Broken pipe (32)` e
  depois `Can't find service: package`, antes de executar o aplicativo.

Os testes de navegador não substituem o teste do IME em Android. Portanto, a
correção não é declarada validada em aparelho físico nesta entrega.

## Teste instrumentado em Android conectado

Use um aparelho de testes, sem jornada ativa. Não é necessária conta de produção:
o teste carrega o HTML real com APIs simuladas e cópias locais das bibliotecas.
Os fixtures ficam exclusivamente no APK de testes; não entram no APK público.
Use teclado convencional aberto na tela (não modo flutuante).

```bash
npm ci
npm run android:sync
npm run android:test:prepare
adb devices -l
cd android
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=site.dotas.zapencomendas.KeyboardViewportTest
```

JDK 21 e Android SDK são necessários. Os testes medem os limites físicos do
WebView e `WindowInsetsCompat.Type.ime()`, tocam nos campos para abrir o teclado,
digitam, verificam busca/resultados e repetem abrir/fechar. Também verificam
senha, cadastro e observações. Ao fechar o teclado, a altura deve voltar à inicial
com tolerância de dois pixels. As solicitações de rede são interceptadas; não
são criados pedidos ou cadastros reais.

Os comandos usam `:app:` para não construir testes dos módulos de terceiros
Capacitor/Cordova, que não fazem parte desta validação.

## Checklist manual antes de considerar a correção encerrada no aparelho

1. Transportadora: tocar na busca inferior, digitar endereço, visualizar e
   selecionar resultados sem fechar o teclado à força.
2. Abrir/fechar o teclado pelo menos três vezes; verificar que o mapa volta ao
   tamanho original e não sobra uma faixa vazia acima da navegação.
3. Login: testar telefone, avanço para senha, mostrar/ocultar senha e botão Entrar.
4. Cadastro: testar nome, telefone, senha e confirmação, com rolagem normal.
5. Pedido: editar observações, trocar de campo, fechar o teclado e salvar
   **somente um pedido de teste autorizado**.
6. Conferir barras de status/navegação, botão Voltar, câmera, compartilhamento
   de GPS e serviço de jornada para detectar regressões.
7. Registrar Android, modelo, WebView e teclado usados, incluindo navegação por
   gestos ou três botões. Repetir em orientação paisagem se esse uso for necessário.
