(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZapLocationInput=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const number='[+-]?\\d+(?:\\.\\d+)?';
 const pair=new RegExp('^\\s*('+number+')\\s*[,;]\\s*('+number+')(?:\\s*\\([^)]*\\))?\\s*$');
 const hosts=new Set(['maps.app.goo.gl','goo.gl','maps.google.com','maps.google.com.br','www.google.com','google.com','www.google.com.br','google.com.br','waze.com','www.waze.com','ul.waze.com']);
 const decode=value=>{try{return decodeURIComponent(value.replace(/\+/g,' '));}catch{return value;}};
 function coordinates(value,name=''){
  const m=String(value).match(pair);if(!m)return null;
  const lat=Number(m[1]),lon=Number(m[2]);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;
  const label=String(name||String(value).match(/\(([^)]+)\)\s*$/)?.[1]||'Localização compartilhada').trim().slice(0,255);
  return {kind:'coordinates',lat,lon,name:label,display_name:lat.toFixed(6)+', '+lon.toFixed(6)};
 }
 function mapsURL(value){
  const matches=String(value||'').match(/https?:\/\/[^\s<>"\]]+/gi)||[];
  for(const match of matches)try{
   let candidate=match.replace(/[.,;]+$/,'');
   while(candidate.endsWith(')')&&(candidate.match(/\(/g)||[]).length<(candidate.match(/\)/g)||[]).length)candidate=candidate.slice(0,-1);
   const url=new URL(candidate);
   if(!hosts.has(url.hostname)||url.username||url.password||(url.port&&url.port!=='443'))continue;
   if(url.hostname==='goo.gl'&&!url.pathname.startsWith('/maps'))continue;
   if(/^(www\.)?google\.com(?:\.br)?$/.test(url.hostname)&&!url.pathname.startsWith('/maps'))continue;
   if(/waze\.com$/.test(url.hostname)&&!/^\/(?:ul|live-map)(?:\/|$)/.test(url.pathname)&&url.pathname!=='/')continue;
   url.protocol='https:';return url;
  }catch{}
  return null;
 }
 function parse(value){
  const text=String(value||'').trim();if(!text||text.length>2000)return null;
  const direct=coordinates(text);if(direct)return {...direct,search:text};
  if(/^(geo|google\.navigation|waze):/i.test(text)){
   let uri;try{uri=new URL(text);}catch{return null;}
   const params=/^(?:q|ll)=/.test(uri.pathname)?new URLSearchParams(uri.pathname):uri.searchParams;
   const q=params.get('ll')||params.get('q')||'';
   if(q){const found=coordinates(q);if(found)return {...found,search:text};if(pair.test(q)||/^[\d+\-.,;\s()]+$/.test(q)||params.has('ll'))return null;return {kind:'address',query:q.slice(0,255),search:text};}
   if(uri.protocol==='geo:'){const found=coordinates(decode(uri.pathname).split(';')[0].split(',').slice(0,2).join(','));if(found)return {...found,search:text};}
   return null;
  }
  const url=mapsURL(text);if(!url)return null;
  const decoded=decode(url.href);
  const place=decoded.match(/\/maps\/place\/([^/?@]+)/)?.[1]?.replace(/\+/g,' ').trim()||'';
  for(const key of ['destination','daddr']){
   const raw=url.searchParams.get(key);if(!raw)continue;
   const found=coordinates(raw,place);if(found)return {...found,search:url.href};
   if(pair.test(raw)||/^[+\-\d.,;\s]+$/.test(raw))return null;
  }
  const dataPoints=[...decoded.matchAll(/!3d([+-]?\d+(?:\.\d+)?)!4d([+-]?\d+(?:\.\d+)?)/g)];
  const data=url.pathname.includes('/maps/dir/')?dataPoints.at(-1):dataPoints[0];
  if(data){const found=coordinates(data[1]+','+data[2],place);if(found)return {...found,search:url.href};return null;}
  for(const key of ['destination','daddr','ll','query','q','to','center']){
   const raw=url.searchParams.get(key);if(!raw)continue;
   const found=coordinates(raw.replace(/^ll\./,''),place);if(found)return {...found,search:url.href};
   if(pair.test(raw)||/^[+\-\d.,;\s]+$/.test(raw)||key==='ll')return null;
  }
  const camera=decoded.match(/@([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/);
  if(camera&&!place){const found=coordinates(camera[1]+','+camera[2]);if(found)return {...found,search:url.href};return null;}
  const term=(place||url.searchParams.get('q')||url.searchParams.get('query')||'').slice(0,180);
  return {kind:'lookup',query:url.href,term,search:url.href};
 }
 return {parse,mapsURL};
});
