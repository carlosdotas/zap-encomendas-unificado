package site.dotas.zapencomendas;

import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.graphics.Rect;
import android.os.SystemClock;
import android.content.Context;
import android.view.inputmethod.InputMethodManager;
import android.os.Build;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/** Actual Android IME + production MainActivity/WebView. APIs/CDNs are test fixtures only. */
@RunWith(AndroidJUnit4.class)
public class KeyboardViewportTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;private WebView web;
    private String read(String name)throws Exception{
        try(InputStream in=instrumentation.getContext().getAssets().open("ime-web/"+name);ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);return new String(out.toByteArray(),StandardCharsets.UTF_8);
        }
    }
    private Object js(String script)throws Exception{
        CompletableFuture<String> result=new CompletableFuture<>();instrumentation.runOnMainSync(()->web.evaluateJavascript(script,result::complete));
        String raw=result.get(20,TimeUnit.SECONDS);return new org.json.JSONTokener(raw).nextValue();
    }
    private void until(String condition)throws Exception{
        long end=SystemClock.uptimeMillis()+90000;
        while(SystemClock.uptimeMillis()<end){if(Boolean.TRUE.equals(js("Boolean("+condition+")")))return;Thread.sleep(100);}
        fail("DOM condition timed out: "+condition+"; body="+js("document.body.innerText.slice(0,1200)"));
    }
    private ActivityScenario<MainActivity> open(boolean carrier)throws Exception{
        String fixture=read("index.html");
        String setup="<script>window.ZapSharedLocation={peek:()=>null,subscribe:f=>{f(null);return()=>{}},receive:()=>false,clear:()=>{}};window.fetch=async(input,options)=>{let p=new URL(typeof input==='string'?input:input.url,'https://dotas.site/').pathname;let data={};let status=200;if(p==='/api/auth/me'){"+(carrier?"data={user:{id:1,name:'Teste IME',phone:'62999999999',role:'transportadora',vehicles:['moto']}};":"status=401;")+"}else if(p==='/api/orders')data={orders:[]};else if(p==='/api/clients')data={clients:[]};else if(p==='/api/maps/search')data={results:[{name:'Farmacia teste',display_name:'Rua Teste, 10',lat:-16.6869,lon:-49.2648}]};return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})};</script>";
        final String html=fixture.replace("<head>","<head>"+setup);
        ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class);
        scenario.onActivity(a->{activity=a;web=a.getBridge().getWebView();web.clearHistory();web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString(),file=null;
                if(url.contains("react-dom.production"))file="react-dom.js";
                else if(url.contains("react.production"))file="react.js";
                else if(url.contains("babel.min.js"))file="babel.js";
                else if(url.endsWith("leaflet.js"))file="leaflet.js";
                else if(url.endsWith("leaflet.css"))file="leaflet.css";
                else for(String name:new String[]{"navigation.js","location-input.js","shared-location.js"})if(url.endsWith('/'+name))file=name;
                try{if(file!=null)return new WebResourceResponse(file.endsWith("css")?"text/css":"application/javascript","UTF-8",instrumentation.getContext().getAssets().open("ime-web/"+file));}catch(Exception ignored){}
                return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
            }
        });web.loadDataWithBaseURL("https://dotas.site/",html,"text/html","UTF-8",null);});
        until("window.ZapViewport?.managed && document.querySelector('"+(carrier?".carrier-map-page":".role-screen")+"')");
        if(carrier){
            until("document.activeElement?.getAttribute('aria-label')==='Buscar endereço'");
            js("document.activeElement.blur()");
            instrumentation.runOnMainSync(()->((InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(),0));
            awaitIme(false);
        }
        return scenario;
    }
    private boolean imeVisible(){AtomicReference<Boolean> visible=new AtomicReference<>(false);instrumentation.runOnMainSync(()->{WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(web);visible.set(insets!=null&&insets.isVisible(WindowInsetsCompat.Type.ime()));});return visible.get();}
    private int height(){AtomicReference<Integer> value=new AtomicReference<>(0);instrumentation.runOnMainSync(()->value.set(web.getHeight()));return value.get();}
    private void tap(String selector)throws Exception{
        js("document.querySelector("+JSONObject.quote(selector)+").scrollIntoView({block:'nearest'})");
        JSONObject r=new JSONObject((String)js("JSON.stringify((()=>{const r=document.querySelector("+JSONObject.quote(selector)+").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})())"));
        int[] origin=new int[2];float[] scale=new float[1];instrumentation.runOnMainSync(()->{web.getLocationOnScreen(origin);scale[0]=web.getScale();});
        float x=origin[0]+(float)r.getDouble("x")*scale[0],y=origin[1]+(float)r.getDouble("y")*scale[0];
        long now=SystemClock.uptimeMillis();MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0);MotionEvent up=MotionEvent.obtain(now,now+80,MotionEvent.ACTION_UP,x,y,0);
        instrumentation.sendPointerSync(down);instrumentation.sendPointerSync(up);down.recycle();up.recycle();
    }
    private void awaitIme(boolean expected)throws Exception{
        long end=SystemClock.uptimeMillis()+30000;
        while(SystemClock.uptimeMillis()<end){
            AtomicReference<Boolean> settled=new AtomicReference<>(false);
            instrumentation.runOnMainSync(()->{
                WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(web);if(insets==null||insets.isVisible(WindowInsetsCompat.Type.ime())!=expected)return;
                if(Build.VERSION.SDK_INT>=30){
                    int bars=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout()).bottom;
                    int bottom=Math.max(bars,expected?insets.getInsets(WindowInsetsCompat.Type.ime()).bottom:0);
                    int[] position=new int[2];web.getLocationOnScreen(position);
                    settled.set(Math.abs(position[1]+web.getHeight()-(activity.getWindow().getDecorView().getHeight()-bottom))<=2);
                }else settled.set(true);
            });
            if(settled.get()){Thread.sleep(350);return;}Thread.sleep(100);
        }
        fail("IME did not settle with resized WebView; expected visible="+expected);
    }
    private void assertAboveKeyboard(String selector)throws Exception{
        until("(()=>{const e=document.querySelector("+JSONObject.quote(selector)+");if(!e)return false;const r=e.getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1})()");
        AtomicReference<Rect> bounds=new AtomicReference<>();AtomicReference<Integer> bottom=new AtomicReference<>();
        instrumentation.runOnMainSync(()->{int[] p=new int[2];web.getLocationOnScreen(p);bounds.set(new Rect(p[0],p[1],p[0]+web.getWidth(),p[1]+web.getHeight()));WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(web);if(Build.VERSION.SDK_INT>=30)bottom.set(activity.getWindow().getDecorView().getHeight()-insets.getInsets(WindowInsetsCompat.Type.ime()).bottom);else{Rect visible=new Rect();activity.getWindow().getDecorView().getWindowVisibleDisplayFrame(visible);bottom.set(visible.bottom);}});
        assertTrue("WebView overlaps IME: "+bounds.get()+" keyboard top="+bottom.get(),bounds.get().bottom<=bottom.get()+1);
    }
    private void hideKeyboard()throws Exception{instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);awaitIme(false);}
    @Test public void addressSearchResizesAndRestoresOnRepeatedImeCycles()throws Exception{
        try(ActivityScenario<MainActivity> ignored=open(true)){
            int full=height();
            for(int cycle=0;cycle<2;cycle++){
                tap("input[aria-label='Buscar endereço']");awaitIme(true);assertTrue("WebView did not shrink",height()<full-100);assertAboveKeyboard("input[aria-label='Buscar endereço']");
                instrumentation.sendStringSync(cycle==0?"Farmacia":" teste");
                js("document.querySelector('.carrier-search').requestSubmit()");until("document.querySelector('.carrier-address-results-scroll button')");assertAboveKeyboard(".carrier-address-results-scroll button");
                assertEquals("No duplicate keyboard bottom offset",0,((Number)js("Math.round(parseFloat(getComputedStyle(document.querySelector('.carrier-map-bottom')).bottom))")).intValue());
                hideKeyboard();assertTrue("Original WebView height not restored",Math.abs(height()-full)<=2);
            }
        }
    }
    @Test public void passwordRegistrationAndOrderNotesRemainAccessible()throws Exception{
        try(ActivityScenario<MainActivity> ignored=open(false)){
            js("document.querySelectorAll('.role-choice')[0].click()");until("document.querySelector('.auth-card input[type=password]')");
            tap(".auth-card input[type=password]");awaitIme(true);assertAboveKeyboard(".auth-card input[type=password]");hideKeyboard();
            js("document.querySelector('.auth-card .switch button').click()");until("document.querySelectorAll('.auth-card input[type=password]').length===2");
            tap(".auth-card input[autocomplete='name']");awaitIme(true);assertAboveKeyboard(".auth-card input[autocomplete='name']");
            tap(".auth-card input[autocomplete='new-password']");assertAboveKeyboard(".auth-card input[autocomplete='new-password']");hideKeyboard();
        }
        try(ActivityScenario<MainActivity> ignored=open(true)){
            js("(()=>{const f=document.querySelector('input[aria-label=\\\"Buscar endereço\\\"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(f,'Farmacia');f.dispatchEvent(new Event('input',{bubbles:true}))})()");
            js("document.querySelector('.carrier-search').requestSubmit()");until("document.querySelector('.carrier-address-results-scroll button')");js("document.querySelector('.carrier-address-results-scroll button').click()");until("document.querySelector('#carrier-driver-instructions')");
            tap("#carrier-driver-instructions");awaitIme(true);assertAboveKeyboard("#carrier-driver-instructions");instrumentation.sendStringSync("Observacao de teste");
            assertTrue(((String)js("document.querySelector('#carrier-driver-instructions').value")).contains("Observacao"));hideKeyboard();
        }
    }
}
