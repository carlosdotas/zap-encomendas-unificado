# Agenda do telefone no formulário de cliente

O botão usava somente `navigator.contacts.select`, API que não está disponível
no Android WebView. O APK agora injeta `mobile/contacts.js` e o formulário prioriza
`window.ZapContacts.select`. Em navegador comum mantém a API web existente.

`ContactPicker.java` registra um Activity Result e abre `ACTION_PICK` com
`ContactsContract.CommonDataKinds.Phone.CONTENT_URI`. O seletor do Android permite
escolher um contato/número e concede leitura apenas à URI escolhida. Não é pedida
permissão `READ_CONTACTS`, não é lida a agenda inteira e nada é salvo automaticamente.
Nome do contato e telefone voltam ao formulário; os demais campos são preservados.
Cancelar mantém o formulário. Falhas de leitura ou ausência de aplicativo de
contatos retornam mensagem e permitem tentar novamente.

A ponte também fornece `navigator.contacts.select` quando ausente, para
compatibilidade com o HTML anterior enquanto a hospedagem é atualizada.
A ponte nativa continua restrita ao frame principal de `https://dotas.site`.

Arquivos: `ContactPicker.java`, `MainActivity.java`, `mobile/contacts.js`, seu asset
Android, `index.html` e `scripts/sync-mobile.js`. Versão e arquivo de download são
atualizados pelo processo de compilação existente.

Validação: `node scripts/contacts.test.js` cobre formulário/ponte, seleção,
cancelamento/reabertura, erros, navegador e HTML anterior. Compilação e lint
Android também foram executados. Não havia aparelho conectado no ADB; a abertura
da agenda real precisa ser conferida no telefone com o novo APK instalado.

No aparelho: abrir cadastro/edição de cliente, tocar na agenda, escolher um
contato com telefone e conferir nome/telefone. Repetir cancelando; conferir que
os dados anteriores permanecem. Testar contato com mais de um número e verificar
o número escolhido no seletor. Nenhum cadastro deve ser salvo durante esse teste.
