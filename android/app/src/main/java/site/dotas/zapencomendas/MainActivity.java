package site.dotas.zapencomendas;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.webkit.CookieManager;
import androidx.core.content.ContextCompat;
import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;
import java.util.*;

public class MainActivity extends BridgeActivity {
    private boolean pendingStart=false, registered=false, permissionDialog=false, permissionRequestInFlight=false;
    private WebViewViewport viewport;
    private final ContactPicker contacts=new ContactPicker(this);
    private boolean backRequestInFlight=false,shareIntentHandled=false;
    @Override protected void onCreate(Bundle saved){
        if(saved!=null&&saved.getBoolean("zap_share_intent_handled",false)){
            shareIntentHandled=true;setIntent(new Intent(this,MainActivity.class).setAction(Intent.ACTION_MAIN));
        }
        super.onCreate(saved);
    }
    @Override public void onSaveInstanceState(Bundle state){state.putBoolean("zap_share_intent_handled",shareIntentHandled);super.onSaveInstanceState(state);}
    private final BroadcastReceiver events=new BroadcastReceiver(){public void onReceive(Context c,Intent i){dispatch(i.getStringExtra("type"),i.getStringExtra("data"));}};
    @Override protected void load(){
        super.load();
        SystemBars.configureWebView(this,ContextCompat.getColor(this,R.color.zap_system_bar_surface));
        viewport=new WebViewViewport(this,bridge.getWebView());
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){
            @Override public void handleOnBackPressed(){
                if(backRequestInFlight)return;
                backRequestInFlight=true;
                bridge.getWebView().evaluateJavascript("window.ZapNavigation?window.ZapNavigation.back():'unavailable'",result->{
                    backRequestInFlight=false;
                    if("\"root\"".equals(result)){moveTaskToBack(true);return;}
                    if("\"handled\"".equals(result)||"\"wait\"".equals(result))return;
                    if(!"\"unavailable\"".equals(result))return;
                    // Compatibility while the hosted HTML is still being updated.
                    if(bridge.getWebView().canGoBack())bridge.getWebView().goBack();else moveTaskToBack(true);
                });
            }
        });
        bridge.getWebView().setDownloadListener((url,agent,disposition,mime,length)->{
            Uri target=Uri.parse(url);
            if("https".equals(target.getScheme())&&"dotas.site".equals(target.getHost())&&"/downloads/zap-encomendas.apk".equals(target.getPath())){
                try{startActivity(new Intent(Intent.ACTION_VIEW,target));}
                catch(ActivityNotFoundException e){new AlertDialog.Builder(this).setMessage("Abra dotas.site em um navegador para baixar o aplicativo.").setPositiveButton("OK",null).show();}
            }
        });
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)||!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            new AlertDialog.Builder(this).setMessage("Atualize o Android System WebView para receber chamadas neste aparelho.").setPositiveButton("OK",null).show();return;
        }
        Set<String> origins=Collections.singleton("https://dotas.site");
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))WebViewCompat.addWebMessageListener(bridge.getWebView(),"ZapNative",origins,(view,message,origin,main,reply)->{
            if(!main)return;
            try {JSONObject m=new JSONObject(message.getData());String type=m.optString("type");
                if(type.equals("pick_contact")){contacts.pick(m.optString("id"));}
                else if(type.equals("viewport_ready")){viewport.ready();}
                else if(type.equals("location_ready")){deliverSharedLocation();}
                else if(type.equals("location_ack")){
                    String stored=getSharedPreferences("shared_location",MODE_PRIVATE).getString("pending",null);
                    if(stored!=null&&new JSONObject(stored).optString("id").equals(m.optString("id")))getSharedPreferences("shared_location",MODE_PRIVATE).edit().remove("pending").apply();
                }
                else if(type.equals("start")){pendingStart=true;prepareDriver();}
                else if(type.equals("stop")){pendingStart=false;stopService(new Intent(this,DriverService.class));}
                else if(type.equals("send")){Intent i=new Intent(this,DriverService.class).setAction("send").putExtra("data",m.getString("data"));if(DriverService.running)startService(i);}
            }catch(Exception ignored){}
        });
        for(String asset:new String[]{"viewport.js","contacts.js","navigation.js","location-input.js","shared-location.js","driver-bridge.js"}){
            try(java.io.InputStream in=getAssets().open(asset)){
                java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();
                byte[] bytes=new byte[4096];int count;while((count=in.read(bytes))!=-1)buffer.write(bytes,0,count);
                String js=new String(buffer.toByteArray(),java.nio.charset.StandardCharsets.UTF_8);
                if(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(),js,origins);
            }catch(Exception e){throw new IllegalStateException(e);}
        }
        bridge.getWebView().reload();
    }
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        if(intent==null)return;
        String text=null;
        if(Intent.ACTION_SEND.equals(intent.getAction())){
            CharSequence shared=intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if(shared!=null)text=shared.toString();
        }else if(Intent.ACTION_VIEW.equals(intent.getAction())&&intent.getData()!=null){text=intent.getData().toString();}
        if(text==null||text.trim().isEmpty()||text.length()>2000)return;
        try{
            JSONObject payload=new JSONObject().put("id",UUID.randomUUID().toString()).put("text",text.trim()).put("receivedAt",System.currentTimeMillis());
            getSharedPreferences("shared_location",MODE_PRIVATE).edit().putString("pending",payload.toString()).apply();
            // Clear consumed intent data so a recreation does not create a duplicate share.
            shareIntentHandled=true;
            Intent clean=new Intent(this,MainActivity.class).setAction(Intent.ACTION_MAIN);setIntent(clean);
            deliverSharedLocation();
        }catch(Exception ignored){}
    }
    private void deliverSharedLocation(){
        if(bridge==null)return;
        String stored=getSharedPreferences("shared_location",MODE_PRIVATE).getString("pending",null);if(stored==null)return;
        try{
            JSONObject payload=new JSONObject(stored);
            if(System.currentTimeMillis()-payload.optLong("receivedAt")>2*60*60*1000L){getSharedPreferences("shared_location",MODE_PRIVATE).edit().remove("pending").apply();return;}
            String data=payload.toString();
            bridge.getWebView().evaluateJavascript("window.ZapSharedLocation&&window.ZapSharedLocation.receive("+data+")",null);
        }catch(Exception ignored){}
    }
    private boolean granted(String p){return ContextCompat.checkSelfPermission(this,p)==PackageManager.PERMISSION_GRANTED;}
    private void explain(String text,Runnable next){if(permissionDialog)return;permissionDialog=true;new AlertDialog.Builder(this).setTitle("Jornada do motorista").setMessage(text).setPositiveButton("Continuar",(d,w)->{permissionDialog=false;next.run();}).setNegativeButton("Agora não",(d,w)->{permissionDialog=false;pendingStart=false;dispatch("offline","{}");}).setCancelable(true).setOnCancelListener(d->{permissionDialog=false;pendingStart=false;dispatch("offline","{}");}).show();}
    private void requestDriverPermissions(String... permissions){
        if(permissionRequestInFlight)return;
        permissionRequestInFlight=true;
        requestPermissions(permissions,100);
    }
    private void prepareDriver(){
        if(!pendingStart||isFinishing()||permissionDialog||permissionRequestInFlight)return;
        if(!granted(Manifest.permission.ACCESS_FINE_LOCATION)){
            explain("Para ficar online, o motorista precisa compartilhar a localização precisa durante a jornada. O aplicativo mantém uma notificação visível. Ao sair da conta, o rastreamento para.",()->requestDriverPermissions(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION));return;
        }
        if(Build.VERSION.SDK_INT>=33&&!granted(Manifest.permission.POST_NOTIFICATIONS)){
            explain("Permita notificações para receber as chamadas dos pedidos.",()->requestDriverPermissions(Manifest.permission.POST_NOTIFICATIONS));return;
        }
        LocationManager lm=(LocationManager)getSystemService(LOCATION_SERVICE);
        if(!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)){
            explain("Ative o GPS para ficar disponível para pedidos.",()->startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)));return;
        }
        if(Build.VERSION.SDK_INT>=29&&!granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)){
            // Request background location separately, after precise foreground location.
            // Android's PermissionController opens its own location permission flow.
            requestDriverPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION);return;
        }
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(!nm.areNotificationsEnabled()){
            explain("Ative as notificações do aplicativo para receber pedidos.",()->startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName())));return;
        }
        NotificationChannel calls=nm.getNotificationChannel("driver_calls_v1");
        if(calls!=null&&calls.getImportance()==NotificationManager.IMPORTANCE_NONE){
            explain("Ative o canal ‘Chamadas de pedidos’ para ficar online.",()->startActivity(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,"driver_calls_v1")));return;
        }
        if(Build.VERSION.SDK_INT>=34&&!nm.canUseFullScreenIntent()&&!getPreferences(0).getBoolean("fullscreenExplained",false)){
            explain("Para mostrar pedidos como chamada na tela bloqueada, habilite ‘Permitir alertas em tela cheia’. Sem isso, o Android exibirá uma notificação de alta prioridade.",()->{
                getPreferences(0).edit().putBoolean("fullscreenExplained",true).apply();
                startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:"+getPackageName())));
            });return;
        }
        String cookie=CookieManager.getInstance().getCookie("https://dotas.site");
        if(cookie==null||!cookie.contains("zap_session=")){pendingStart=false;dispatch("offline","{}");return;}
        pendingStart=false;
        Intent service=new Intent(this,DriverService.class).setAction("connect").putExtra("cookie",cookie);
        ContextCompat.startForegroundService(this,service);
    }
    private void dispatch(String type,String data){if(bridge==null)return;String payload=data==null?"{}":data;runOnUiThread(()->bridge.getWebView().evaluateJavascript("window.__zapDispatch&&window.__zapDispatch("+JSONObject.quote(type)+","+payload+")",null));}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
        super.onRequestPermissionsResult(request,permissions,results);
        if(request!=100)return;
        permissionRequestInFlight=false;
        boolean all=results.length>0;
        for(int result:results)all&=result==PackageManager.PERMISSION_GRANTED;
        if(all){prepareDriver();return;}
        boolean canAskAgain=false,background=false;
        for(String permission:permissions){
            if(!granted(permission)&&shouldShowRequestPermissionRationale(permission))canAskAgain=true;
            if(Manifest.permission.ACCESS_BACKGROUND_LOCATION.equals(permission))background=true;
        }
        String message=background
            ? "Selecione ‘Permitir o tempo todo’ na permissão de localização para receber pedidos com o aplicativo em segundo plano. O GPS funciona apenas durante a jornada."
            : "Autorize a localização precisa e as notificações para ficar online e receber pedidos.";
        if(!canAskAgain)message+=" O Android bloqueou novas solicitações. Para liberar, altere a permissão nas configurações do aplicativo.";
        final boolean requestAgain=canAskAgain;
        permissionDialog=true;
        new AlertDialog.Builder(this).setTitle("Permissão necessária").setMessage(message)
            .setPositiveButton(requestAgain?"Solicitar permissão":"Abrir configurações",(d,w)->{
                permissionDialog=false;
                if(requestAgain)requestDriverPermissions(permissions);
                else startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));
            })
            .setNegativeButton("Agora não",(d,w)->{permissionDialog=false;pendingStart=false;dispatch("offline","{}");})
            .setCancelable(true).setOnCancelListener(d->{permissionDialog=false;pendingStart=false;dispatch("offline","{}");}).show();
    }
    @Override public void onStart(){super.onStart();if(!registered){ContextCompat.registerReceiver(this,events,new IntentFilter(DriverService.EVENT),ContextCompat.RECEIVER_NOT_EXPORTED);registered=true;}}
    @Override public void onResume(){super.onResume();if(bridge!=null){deliverSharedLocation();if(pendingStart)bridge.getWebView().postDelayed(this::prepareDriver,400);if(DriverService.connected)dispatch("open","{}");if(DriverService.running)DriverService.replay(this);}}
    @Override public void onDestroy(){if(registered)unregisterReceiver(events);super.onDestroy();}
}
