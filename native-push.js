'use strict';
// Credentials stay on the server. A websocket session must register every device.
const crypto = require('node:crypto');
const devices = new Map();
let messaging;
if (process.env.FIREBASE_PROJECT_ID && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const {initializeApp,applicationDefault}=require('firebase-admin/app');
  initializeApp({credential:applicationDefault(),projectId:process.env.FIREBASE_PROJECT_ID});
  messaging=require('firebase-admin/messaging').getMessaging();
}
const levels={moto:1,carro:2,utilitario:3};
function register(user,msg,sessionHash){
  if(!messaging||!levels[msg.vehicle]||!(user.vehicles||'').split(',').includes(msg.vehicle)||typeof msg.token!=='string'||msg.token.length<20||msg.token.length>4096||!/^[-\w:]+$/.test(msg.token))return false;
  // Only the latest device for a driver receives background calls.
  devices.set(String(user.id),{token:msg.token,vehicle:msg.vehicle,sessionHash,until:Date.now()+12*60*60*1000});return true;
}
function remove(id){devices.delete(String(id));}
function removeSession(cookie){const token=String(cookie||'').match(/(?:^|;\s*)zap_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return;const hash=crypto.createHash('sha256').update(token).digest('hex');for(const [id,d]of devices)if(d.sessionHash===hash)devices.delete(id);}
function candidates(vehicle){for(const [id,d]of devices)if(d.until<=Date.now())devices.delete(id);return [...devices].filter(([,d])=>levels[d.vehicle]>=levels[vehicle]).map(([id])=>id);}
async function send(id,message,pool){
  const d=devices.get(String(id));if(!d||!messaging||d.until<=Date.now())return;
  try{
    // Revalidate the cookie-backed session before each push.
    const [sessions]=await pool.execute('SELECT user_id FROM zap_login_sessions WHERE token_hash=? AND user_id=? AND expires_at>NOW() LIMIT 1',[d.sessionHash,id]);
    if(!sessions.length){remove(id);return;}
    await messaging.send({token:d.token,data:{payload:JSON.stringify(message)},android:{priority:'high',ttl:Math.max(0,Math.min(30000,(message.expiresAt||Date.now()+15000)-Date.now()))}});
  }catch(error){if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code))remove(id);console.error('[PUSH]',error.code||'send-failed');}
}
module.exports={register,remove,removeSession,candidates,send,enabled:!!messaging};
