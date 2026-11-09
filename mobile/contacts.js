(function(global){
 'use strict';
 if(!global.ZapNative||global.ZapContacts)return;
 let pending=null,sequence=0;
 function select(){
  if(pending)return Promise.reject(new Error('Já existe uma seleção de contato aberta.'));
  return new Promise((resolve,reject)=>{
   const id='contact-'+Date.now()+'-'+(++sequence);
   pending={id,resolve,reject};
   try{global.ZapNative.postMessage(JSON.stringify({type:'pick_contact',id}));}
   catch(error){pending=null;reject(error);}
  });
 }
 global.ZapContacts={select,receive(result){
  if(!pending||result?.id!==pending.id)return;
  const request=pending;pending=null;
  if(result.error)request.reject(new Error(result.error));else request.resolve(result.contacts||[]);
 }};
 // Compatibility with the hosted page in older deployments.
 if(!global.navigator.contacts){
  try{Object.defineProperty(global.navigator,'contacts',{value:{select},configurable:true});}catch(_){}
 }
})(window);
