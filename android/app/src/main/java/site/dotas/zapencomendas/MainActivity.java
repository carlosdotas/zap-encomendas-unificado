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
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;
import java.util.*;

public class MainActivity extends BridgeActivity {
    private boolean pendingStart=false, registered=false, permissionDialog=false;
    private final BroadcastReceiver events=new BroadcastReceiver(){public void onReceive(Context c,Intent i){dispatch(i.getStringExtra("type"),i.getStringExtra("data"));}};
    @Override protected void load(){
        super.load();
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
                if(type.equals("start")){pendingStart=true;prepareDriver();}
                else if(type.equals("stop")){pendingStart=false;stopService(new Intent(this,DriverService.class));}
                else if(type.equals("send")){Intent i=new Intent(this,DriverService.class).setAction("send").putExtra("data",m.getString("data"));if(DriverService.running)startService(i);}
            }catch(Exception ignored){}
        });
        try(java.io.InputStream in=getAssets().open("driver-bridge.js")){
            java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();
            byte[] bytes=new byte[4096];int count;while((count=in.read(bytes))!=-1)buffer.write(bytes,0,count);
            String js=new String(buffer.toByteArray(),java.nio.charset.StandardCharsets.UTF_8);
            if(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(),js,origins);
            bridge.getWebView().reload();
        }catch(Exception e){throw new IllegalStateException(e);}
    }
    private boolean granted(String p){return ContextCompat.checkSelfPermission(this,p)==PackageManager.PERMISSION_GRANTED;}
    private void explain(String text,Runnable next){if(permissionDialog)return;permissionDialog=true;new AlertDialog.Builder(this).setTitle("Jornada do motorista").setMessage(text).setPositiveButton("Continuar",(d,w)->{permissionDialog=false;next.run();}).setNegativeButton("Agora não",(d,w)->{permissionDialog=false;pendingStart=false;dispatch("offline","{}");}).setCancelable(false).show();}
    private void prepareDriver(){
        if(!pendingStart||isFinishing())return;
        if(!granted(Manifest.permission.ACCESS_FINE_LOCATION)){
            explain("Para ficar online, o motorista precisa compartilhar a localização precisa durante a jornada. O aplicativo mantém uma notificação visível. Ao sair da conta, o rastreamento para.",()->requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},100));return;
        }
        if(Build.VERSION.SDK_INT>=33&&!granted(Manifest.permission.POST_NOTIFICATIONS)){
            explain("Permita notificações para receber as chamadas dos pedidos.",()->requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},100));return;
        }
        LocationManager lm=(LocationManager)getSystemService(LOCATION_SERVICE);
        if(!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)){
            explain("Ative o GPS para ficar disponível para pedidos.",()->startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)));return;
        }
        if(Build.VERSION.SDK_INT>=29&&!granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)){
            explain("Nas permissões de localização, selecione ‘Permitir o tempo todo’. O GPS será usado somente enquanto sua jornada estiver ativa.",()->{
                if(Build.VERSION.SDK_INT==29)requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION},100);
                else startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));
            });return;
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
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==100){boolean all=results.length>0;for(int r:results)all&=r==PackageManager.PERMISSION_GRANTED;if(all)prepareDriver();else{pendingStart=false;dispatch("offline","{}");new AlertDialog.Builder(this).setMessage("É necessário autorizar a localização e as notificações para ficar online. Você pode ativá-las nas configurações do aplicativo.").setPositiveButton("Abrir configurações",(d,w)->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())))).setNegativeButton("Fechar",null).show();}}}
    @Override public void onStart(){super.onStart();if(!registered){ContextCompat.registerReceiver(this,events,new IntentFilter(DriverService.EVENT),ContextCompat.RECEIVER_NOT_EXPORTED);registered=true;}}
    @Override public void onResume(){super.onResume();if(bridge!=null){if(pendingStart)bridge.getWebView().postDelayed(this::prepareDriver,400);if(DriverService.connected)dispatch("open","{}");if(DriverService.running)DriverService.replay(this);}}
    @Override public void onDestroy(){if(registered)unregisterReceiver(events);super.onDestroy();}
}
