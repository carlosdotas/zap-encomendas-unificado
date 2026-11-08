(function(global){
 'use strict';
 if(global.ZapSharedLocation)return;
 const key='zap_shared_location',ackKey=key+'_ack',listeners=new Set(),maxAge=2*60*60*1000;
 let pending=null,lastAck='';
 try{pending=JSON.parse(global.sessionStorage.getItem(key)||'null');lastAck=global.sessionStorage.getItem(ackKey)||'';}catch{}
 const native=message=>{if(global.ZapNative)global.ZapNative.postMessage(JSON.stringify(message));};
 function peek(){
  if(pending&&(Date.now()-pending.receivedAt>maxAge||pending.receivedAt>Date.now()+60000)){pending=null;try{global.sessionStorage.removeItem(key);}catch{}}
  return pending;
 }
 function notify(){for(const listener of listeners)listener(peek());}
 function receive(payload){
  if(!payload||typeof payload.id!=='string'||!/^[-\w]{1,80}$/.test(payload.id)||typeof payload.text!=='string'||payload.text.length>2000||!Number.isFinite(payload.receivedAt)||Date.now()-payload.receivedAt>maxAge||payload.receivedAt>Date.now()+60000)return false;
  if(payload.id===lastAck){native({type:'location_ack',id:payload.id});return true;}
  if(peek()?.id===payload.id)return true;
  pending={id:payload.id,text:payload.text,receivedAt:payload.receivedAt};
  try{global.sessionStorage.setItem(key,JSON.stringify(pending));}catch{}
  notify();return true;
 }
 function clear(id){
  if(peek()?.id!==id)return;
  lastAck=id;pending=null;
  try{global.sessionStorage.removeItem(key);global.sessionStorage.setItem(ackKey,id);}catch{}
  native({type:'location_ack',id});notify();
 }
 global.ZapSharedLocation={peek,receive,clear,subscribe(listener){listeners.add(listener);listener(peek());return()=>listeners.delete(listener);}};
 native({type:'location_ready'});
})(window);
