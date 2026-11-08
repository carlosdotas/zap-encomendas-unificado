(function(global){
 'use strict';
 if(global.ZapNavigation)return;
 const handlers=new Map();let sequence=0,guardActive=false;
 function arm(){
  if(global.ZapNative||guardActive)return;
  global.history.pushState({zapBackGuard:true},'',global.location.href);guardActive=true;
 }
 function register(handler,priority=0){const id=++sequence;handlers.set(id,{handler,priority,id});return()=>handlers.delete(id);}
 function closeLegacyLayer(){
  // During a hosted-page rollout, use existing close buttons, never action buttons.
  const document=global.document;if(!document)return false;
  const visible=element=>{const r=element.getBoundingClientRect(),style=global.getComputedStyle(element);return r.width>0&&r.height>0&&style.display!=='none'&&style.visibility!=='hidden';};
  const layers=[
   ['.zap-photo-viewer','button[aria-label="Voltar para câmera"]'],
   ['.zap-camera-screen','.zap-camera-close'],
   ['.call-detail','.call-detail-close'],
   ['.job-nav-option','.job-nav-arrow[aria-expanded="true"]'],
   ['.zap-client-modal','button[aria-label="Fechar"]'],
   ['.carrier-drivers-dialog','button[aria-label="Fechar"]'],
   ['.carrier-profile-modal','.carrier-profile-close'],
   ['.carrier-places-dialog','button[aria-label="Fechar lista"]'],
   ['.carrier-order-detail','button[aria-label*="Fechar"]'],
   ['.job-modal','.job-modal-close'],
   ['.carrier-order-config','.carrier-config-close'],
   ['.carrier-drawer','button[aria-label="Fechar menu"]'],
   ['.drawer','.drawer-close'],
   ['.dialog','.dialog-close,button.cancel'],
   ['.profile-page','.profile-bar button[aria-label="Voltar"]'],
   ['.auth-card','.auth-close']
  ];
  for(const [layer,close]of layers){
   for(const node of [...document.querySelectorAll(layer)].reverse()){
    if(!visible(node))continue;const button=node.querySelector(close);
    if(button&&visible(button)){button.click();return true;}
   }
  }
  return false;
 }
 function back(){
  for(const entry of [...handlers.values()].sort((a,b)=>b.priority-a.priority||b.id-a.id)){
   const result=entry.handler();
   if(result===true||result==='handled')return 'handled';
   if(result==='root'||result==='wait')return result;
  }
  return closeLegacyLayer()?'handled':'unavailable';
 }
 global.ZapNavigation={register,back,arm};
 global.addEventListener('keydown',event=>{if(event.key==='Escape'&&back()==='handled')event.preventDefault();});
 // One browser-history guard; the native app calls back() directly instead.
 if(!global.ZapNative){
  arm();
  global.addEventListener('popstate',()=>{guardActive=false;const result=back();if(result==='handled'||result==='wait')arm();});
 }
})(window);
