const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=require('node:path').resolve(__dirname,'..');
const order={id:'42',place:'Loja de teste',address:'Rua Teste, 100',lat:-16.686,lng:-49.264,carrier:'Transportadora teste',client:'Cliente teste',clientPhone:'62999999999',vehicle:'moto',type:'coleta',status:'aceito',driverId:'1',instructions:'Retirar na recepção'};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox'],proxy:{server:process.env.HTTPS_PROXY}});
 const checks=[];let currentPage;
 async function open(role,native=true,cold=false){
  const page=await browser.newPage({viewport:{width:412,height:915}});currentPage=page;
  page.errors=[];page.writes=[];page.on('pageerror',e=>page.errors.push(e.message));
  await page.addInitScript(({native,cold,order})=>{
   window.nativePosts=[];window.audioStarts=0;if(native){window.__zapNativeInstalled=!cold;window.ZapNative={postMessage(raw){const msg=JSON.parse(raw);window.nativePosts.push(msg);if(cold)queueMicrotask(()=>{const offer={type:"call_offer",order:{...order,id:"cold-42"},viewed:true,activeVehicle:"moto",expiresAt:Date.now()+60000};if(msg.type==="calls_ready")window.__zapDispatch("message",offer);if(msg.type==="start"){window.__zapDispatch("open",{});window.__zapDispatch("message",{type:"call_ready"});window.__zapDispatch("message",offer);}})}};}const BaseAudio=window.AudioContext;if(BaseAudio)window.AudioContext=class extends BaseAudio{constructor(){super();window.audioStarts++;}};
   window.sent=[];window.sockets=[];window.mediaStops=0;
   class Socket {constructor(){this.readyState=0;window.sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.()})}send(raw){const msg=JSON.parse(raw);window.sent.push(msg);if(msg.type==='online')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'call_ready'})}));}close(){this.readyState=3;this.onclose?.()}}
   Socket.OPEN=1;window.WebSocket=Socket;
   navigator.geolocation.watchPosition=(ok)=>{const timer=setTimeout(()=>ok({coords:{latitude:-16.6869,longitude:-49.2648,accuracy:5},timestamp:Date.now()}),10);return timer};
   navigator.geolocation.clearWatch=timer=>clearTimeout(timer);
   navigator.geolocation.getCurrentPosition=ok=>ok({coords:{latitude:-16.6869,longitude:-49.2648,accuracy:5},timestamp:Date.now()});
   navigator.mediaDevices.getUserMedia=async()=>{const stream=new MediaStream();stream.getTracks=()=>[{stop(){window.mediaStops++}}];return stream};
  },{native,cold,order});
  if(cold)await page.addInitScript(fs.readFileSync(root+'/mobile/driver-bridge.js','utf8'));

  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin==='https://dotas.site'){
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(root+'/index.html')});
    if(['/navigation.js','/location-input.js','/shared-location.js'].includes(url.pathname))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(root+url.pathname)});
    if(!['GET','HEAD'].includes(route.request().method()))page.writes.push(url.pathname);
    let data={};let status=200;
    if(url.pathname==='/api/auth/me'){if(!role){status=401;data={error:'Sem sessão'}}else data={user:{id:1,name:'Usuário teste',phone:'62999999999',role,vehicles:['moto']}};}
    else if(url.pathname==='/api/app/version')data={available:true,version:'1.0.7',versionCode:8,bytes:5000000};
    else if(url.pathname==='/api/orders'||url.pathname==='/api/driver/orders')data={orders:[order]};
    else if(url.pathname==='/api/clients')data={clients:[{id:'1',name:'Cliente teste',phone:'62999999999',address:'Rua teste'}]};
    else if(url.pathname==='/api/maps/saved')data={results:[{name:'Local salvo',display_name:'Rua Teste, 100',lat:-16.686,lng:-49.264,lon:-49.264,place_id:'local'}]};
    else if(url.pathname==='/api/maps/search')data={results:[{name:'Local encontrado',display_name:'Rua Teste, 100',lat:-16.686,lng:-49.264,lon:-49.264,place_id:'local'}]};
    else if(url.pathname==='/api/carrier/drivers')data={drivers:[{id:'1',name:'Motorista teste',vehicles:['moto'],allowed:true}]};
    else if(url.pathname==='/api/admin/overview')data={totals:{},orders:[],orderStatuses:[]};
    else if(url.pathname.startsWith('/api/admin/'))data={items:[],total:0,limit:25};
    return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   }
   if(url.hostname==='unpkg.com')return route.continue();
   if(url.hostname==='router.project-osrm.org')return route.fulfill({contentType:'application/json',body:JSON.stringify({routes:[]})});
   if(url.pathname.includes('tile'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
   return route.fulfill({contentType:'application/json',body:'{}'});
  });
  await page.goto('https://dotas.site',{waitUntil:'domcontentloaded'});
  if(role==='motorista'&&!cold){await page.locator('.slider-wrap').waitFor();await page.locator('.slider-wrap').focus();for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');}
  await page.waitForSelector(role==='motorista'?'.map-page':role==='transportadora'?'.carrier-map-page':role==='administrador'?'.zap-admin-top':'.role-screen',{timeout:20000}).catch(async error=>{console.log('DEBUG',page.errors,await page.locator('body').innerText());throw error});
  return page;
 }
 try{
  const page=await open('motorista');
  await page.waitForFunction(()=>window.sockets.some(s=>s.onmessage));
  const offer={type:'call_offer',order:{...order,id:'call-42',status:'pendente'},expiresAt:Date.now()+60000};
  async function emit(message){await page.evaluate(msg=>window.sockets.at(-1).onmessage({data:JSON.stringify(msg)}),message);}
  await emit(offer);await page.locator('.call-banner').waitFor();
  assert.equal(await page.evaluate(()=>window.audioStarts),0);
  await page.locator('.call-banner button').click();await page.locator('.call-detail').waitFor();
  assert.equal(await page.locator('.call-detail h2').textContent(),'Loja de teste');
  assert.deepEqual(await page.evaluate(()=>window.nativePosts.filter(m=>m.type==='call_view')),[{type:'call_view',orderId:'call-42'}]);
  assert.equal(await page.evaluate(()=>window.sent.filter(m=>m.type==='accept'||m.type==='reject').length),0);
  checks.push('Visualizar abre os detalhes, comunica silêncio ao nativo e não aceita o pedido');
  await emit({type:'call_end',orderId:'call-42'});await page.locator('.call-detail').waitFor({state:'hidden'});
  await emit({...offer,viewed:true});await page.locator('.call-detail').waitFor();
  assert.equal(await page.locator('.call-banner').count(),0);assert.equal(await page.evaluate(()=>window.audioStarts),0);
  checks.push('replay de chamada visualizada abre detalhes sem áudio web duplicado');
  await page.locator('.call-reject').click();assert.equal(await page.evaluate(()=>window.sent.at(-1).type),'reject');
  checks.push('Recusar continua enviando a decisão ao servidor');
  await emit({...offer,order:{...offer.order,id:'accept-42'},viewed:true});await page.locator('.call-detail').waitFor();
  await page.locator('.call-accept').click();assert.deepEqual(await page.evaluate(()=>window.sent.at(-1)),{type:'accept',orderId:'accept-42'});
  await emit({type:'call_accepted',order:{...offer.order,id:'accept-42'}});await page.locator('.call-detail').waitFor({state:'hidden'});
  checks.push('Aceitar nos detalhes continua exigindo confirmação explícita e resposta do servidor');
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.writes.filter(path=>path!=='/api/driver/presence'),[]);
  await page.close();
  const coldPage=await open('motorista',true,true);await coldPage.locator('.call-detail').waitFor();
  assert.equal(await coldPage.locator('.call-detail h2').textContent(),'Loja de teste');
  assert.equal(await coldPage.evaluate(()=>window.nativePosts.some(m=>m.type==='send'&&JSON.parse(m.data).type==='accept')),false);
  assert.equal(await coldPage.evaluate(()=>window.audioStarts),0);assert.deepEqual(coldPage.errors,[]);
  checks.push('página recém-carregada recebe replay nativo e abre diretamente o pedido sem aceite');
  await coldPage.close();console.log(JSON.stringify({passed:checks},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
