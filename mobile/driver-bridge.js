(() => {
  if (location.origin !== 'https://dotas.site' || window.__zapNativeInstalled) return;
  window.__zapNativeInstalled = true;
  const BrowserSocket = window.WebSocket;
  let driverSocket = null, paused=false, loggingOut=false;
  const browserFetch=window.fetch.bind(window);
  window.fetch=async function(input, options) {
    const response=await browserFetch(input,options);
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin&&url.pathname==='/api/auth/logout'&&response.ok){paused=false;loggingOut=true;post({type:'stop'});}
    return response;
  };
  const post = value => window.ZapNative.postMessage(JSON.stringify(value));
  class DriverSocket extends EventTarget {
    constructor(url, protocols) {
      super();
      const target = new URL(url, location.href);
      if (target.origin !== 'wss://dotas.site' || target.pathname !== '/ws/calls') return new BrowserSocket(url, protocols);
      this.url = target.href; this.readyState = 0; this.bufferedAmount = 0; this.protocol = ''; this.extensions = ''; this.binaryType = 'blob';
      driverSocket = this;loggingOut=false;
      if(paused)queueMicrotask(()=>window.__zapDispatch('offline',{}));else post({type:'start'});
    }
    emit(type, data) {
      const e = type === 'message' ? new MessageEvent(type, {data:JSON.stringify(data)}) : type === 'close' ? new CloseEvent(type) : new Event(type);
      this.dispatchEvent(e); this['on'+type]?.(e);
    }
    send(raw) { if (this.readyState !== 1) throw new DOMException('Socket desconectado', 'InvalidStateError'); if(JSON.parse(raw).type!=='offline')post({type:'send', data:raw}); }
    close() { this.readyState = 3; this.emit('close'); if(driverSocket===this) driverSocket=null; }
  }
  for(const [name, n] of Object.entries({CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3})) { DriverSocket[name]=n; DriverSocket.prototype[name]=n; }
  window.WebSocket = DriverSocket;
  window.__zapDispatch = (type, data) => {
    const s = driverSocket;
    if(type==='position') { window.__zapPosition=data; return; }
    if(type==='session_expired') { location.reload(); return; }
    if(type==='offline'&&loggingOut)return;
    if(type==='offline')paused=true;
    if(type==='offline' && s) {
      s.readyState=3;
      if(document.getElementById('zap-native-offline'))return;
      const overlay=document.createElement('div');overlay.id='zap-native-offline';
      overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#082621;color:white;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:24px;font:18px system-ui;text-align:center';
      const title=document.createElement('h2');title.textContent='Você está offline';overlay.append(title);
      const text=document.createElement('p');text.textContent='Jornada encerrada. A localização e a espera de chamadas estão desativadas.';overlay.append(text);
      const button=document.createElement('button');button.textContent='Voltar a ficar online';button.style.cssText='padding:18px;background:#10b981;color:white;border:0;border-radius:12px;font:inherit';button.onclick=()=>location.reload();overlay.append(button);document.body.append(overlay);return;
    }
    if(!s) return;
    if(type==='open') { if(s.readyState!==1) {s.readyState=1;s.emit('open');} }
    else if(type==='message') s.emit('message',data);
    else if(type==='close') {s.readyState=3;s.emit('close');}
  };
  let watchId=0; const watches=new Map();
  const position=()=>window.__zapPosition && ({coords:window.__zapPosition,timestamp:window.__zapPosition.timestamp});
  const geo = navigator.geolocation;
  if(geo) {
    geo.watchPosition=(ok, fail)=>{ const id=++watchId; let last=0; const tick=()=>{const p=position();if(p&&p.timestamp!==last){last=p.timestamp;ok(p)}};tick();watches.set(id,setInterval(tick,1000));return id; };
    geo.clearWatch=id=>{clearInterval(watches.get(id));watches.delete(id)};
    // Other profiles keep the browser's on-demand GPS prompt.
  }
  window.addEventListener('pagehide',()=>{for(const t of watches.values())clearInterval(t)});
})();
