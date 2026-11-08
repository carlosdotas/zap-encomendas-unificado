(function(global){
 'use strict';
 if(!global.ZapNative||global.ZapViewport)return;
 const document=global.document;
 let frame=0,focusFrame=0,state={imeVisible:false},installed=false;
 function ensureFocusedVisible(){
  cancelAnimationFrame(focusFrame);
  focusFrame=requestAnimationFrame(()=>{
   const field=document.activeElement;
   if(!field?.matches('input,textarea,select,[contenteditable="true"]'))return;
   const height=global.innerHeight,panel=field.closest('.carrier-map-bottom');
   let rect=field.getBoundingClientRect();
   if(panel){
    const bounds=panel.getBoundingClientRect(),save=panel.querySelector('.carrier-config-save');
    const button=save?.getBoundingClientRect();
    const bottom=Math.min(height-16,bounds.bottom-12,button&&button.width>0?button.top-12:height);
    if(rect.bottom>bottom)panel.scrollTop+=rect.bottom-bottom;
    else if(rect.top<Math.max(12,bounds.top+12))panel.scrollTop-=Math.max(12,bounds.top+12)-rect.top;
    rect=field.getBoundingClientRect();
   }
   if(rect.top<12||rect.bottom>height-16)field.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
  });
 }
 function layout(){
  frame=0;const root=document.documentElement;if(!root)return;
  root.dataset.zapNativeResize='true';root.dataset.zapImeOpen=String(Boolean(state.imeVisible));
  root.style.setProperty('--zap-native-viewport-height',global.innerHeight+'px');
  root.style.setProperty('--zap-native-panel-height',Math.max(60,Math.min(state.imeVisible?global.innerHeight-12:global.innerHeight*.88,720))+'px');
  ensureFocusedVisible();global.dispatchEvent(new CustomEvent('zap:viewport',{detail:state}));
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(layout);}
 function install(){
  if(installed)return;installed=true;
  const style=document.createElement('style');style.id='zap-native-viewport-style';
  style.textContent=`
   html[data-zap-native-resize="true"],html[data-zap-native-resize="true"] body,html[data-zap-native-resize="true"] #root{height:100%!important;min-height:0!important}
   html[data-zap-native-resize="true"] #root .carrier-map-page,html[data-zap-native-resize="true"] #root .map-page{height:100%!important;min-height:0!important}
   html[data-zap-native-resize="true"] #root .carrier-map-page .carrier-map-bottom{position:absolute!important;bottom:0!important;top:auto!important;left:0!important;right:0!important;max-height:var(--zap-native-panel-height)!important;overflow-y:auto!important}
   html[data-zap-native-resize="true"] #root .carrier-map-page:not(.carrier-config-open) .carrier-map-bottom{display:flex;flex-direction:column;max-height:calc(var(--zap-native-viewport-height) - 12px)!important;overflow:hidden!important}
   html[data-zap-native-resize="true"] #root .carrier-search{position:sticky!important;top:0!important;flex-shrink:0;z-index:5;background:#fff}
   html[data-zap-native-resize="true"] #root .carrier-address-results-scroll{min-height:0;overflow-y:auto!important;max-height:calc(var(--zap-native-viewport-height) - 96px)!important}
   html[data-zap-native-resize="true"] #root input,html[data-zap-native-resize="true"] #root textarea,html[data-zap-native-resize="true"] #root select{scroll-margin:12px!important}
   html[data-zap-native-resize="true"] #root .auth-screen,html[data-zap-native-resize="true"] #root .carrier-map-bottom{scroll-padding:12px!important}
   html[data-zap-native-resize="true"] #root .auth-screen{height:100%!important;min-height:0!important;box-sizing:border-box;overflow-y:auto;align-items:safe center!important;justify-content:safe center!important}
   html[data-zap-native-resize="true"] #root .auth-screen .auth-card{margin:auto!important;flex-shrink:0}
   html[data-zap-native-resize="true"][data-zap-ime-open="true"] #root .auth-screen{align-items:flex-start!important;justify-content:flex-start!important}
   html[data-zap-native-resize="true"][data-zap-ime-open="true"] #root .auth-screen .auth-card{margin-top:0!important;margin-bottom:12px!important}
   html[data-zap-native-resize="true"][data-zap-ime-open="true"] #root .zap-web-version{display:none!important}
   html[data-zap-native-resize="true"] #root .profile-page{height:100%;overflow-y:auto}
  `;
  document.head.append(style);schedule();
 }
 global.ZapViewport={managed:true,update(value){state=value||state;schedule();},ensureFocusedVisible};
 if(document.documentElement)document.documentElement.dataset.zapNativeResize='true';
 document.addEventListener('focusin',ensureFocusedVisible);
 global.addEventListener('resize',schedule);
 global.visualViewport?.addEventListener('resize',schedule);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
 global.ZapNative.postMessage(JSON.stringify({type:'viewport_ready'}));
})(window);
