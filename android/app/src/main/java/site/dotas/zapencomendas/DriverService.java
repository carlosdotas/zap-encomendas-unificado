package site.dotas.zapencomendas;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.location.*;
import android.media.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import okhttp3.*;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;

public class DriverService extends Service implements LocationListener {
    public static final String EVENT="site.dotas.zapencomendas.DRIVER_EVENT";
    public static volatile boolean running=false;
    static volatile JSONObject offer, lastPosition, accepted;
    static volatile long expiresAt;
    static volatile boolean connected=false;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final OkHttpClient client=new OkHttpClient.Builder().pingInterval(25,TimeUnit.SECONDS).build();
    private WebSocket socket;
    private String cookie,vehicle;
    private boolean stopping=false;
    private int retries=0;
    private String pendingDecision,pendingOrder;
    private long decisionExpires;
    private String lastEndedOrder;
    private long lastEndedExpiry;
    private LocationManager locations;
    private Ringtone ringtone;
    private PowerManager.WakeLock wakeLock;
    private static final int JOURNEY=10,CALL=20;
    @Override public void onCreate(){
        super.onCreate();running=true;channels();
        ServiceCompat.startForeground(this,JOURNEY,journey("Conectando às chamadas…"),Build.VERSION.SDK_INT>=29?ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION:0);
        locations=(LocationManager)getSystemService(LOCATION_SERVICE);
        try{
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,10000,10,this);
            if(locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,15000,20,this);
        }catch(SecurityException e){stopSelf();}
        wakeLock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,getPackageName()+":driver");
        renewWakeLock();
    }
    private void renewWakeLock(){if(stopping)return;registerPush();if(wakeLock.isHeld())wakeLock.release();wakeLock.acquire(10*60*1000L);handler.postDelayed(this::renewWakeLock,5*60*1000L);}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        if("connect".equals(action)){
            cookie=intent.getStringExtra("cookie");
            getSharedPreferences("driver",MODE_PRIVATE).edit().putString("cookie",cookie).putBoolean("active",true).apply();
            if(!FirebaseApp.getApps(this).isEmpty())FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token->{getSharedPreferences("driver",MODE_PRIVATE).edit().putString("pushToken",token).apply();registerPush();});
            if(connected){emit("open",new JSONObject());replay(this);}else if(socket==null)connect();
        }else if("send".equals(action)){
            String data=intent.getStringExtra("data");
            try{JSONObject m=new JSONObject(data);if(m.optString("type").equals("online")){vehicle=m.optString("vehicle");getSharedPreferences("driver",MODE_PRIVATE).edit().putString("vehicle",vehicle).apply();registerPush();}}catch(Exception ignored){}
            if(socket!=null)socket.send(data);
            flushDecision();
        }else if("push_token".equals(action)){registerPush();
        }else if("push".equals(action)){
            cookie=getSharedPreferences("driver",MODE_PRIVATE).getString("cookie",null);
            vehicle=getSharedPreferences("driver",MODE_PRIVATE).getString("vehicle",null);
            try{handleMessage(new JSONObject(intent.getStringExtra("payload")));}catch(Exception ignored){}
            if(socket==null)connect();
        }else if("accept".equals(action)||"reject".equals(action)){
            String orderId=intent.getStringExtra("orderId");
            if(offer!=null&&System.currentTimeMillis()<expiresAt&&offer.optJSONObject("order").optString("id").equals(orderId)){
                pendingDecision=action;pendingOrder=orderId;decisionExpires=expiresAt;flushDecision();
            }
            clearOffer();
        }else if("stop".equals(action)){stopSelf();}
        return START_NOT_STICKY;
    }
    private void connect(){
        if(stopping||cookie==null)return;
        Request req=new Request.Builder().url("wss://dotas.site/ws/calls").header("Cookie",cookie).header("Origin","https://dotas.site").build();
        socket=client.newWebSocket(req,new WebSocketListener(){
            @Override public void onOpen(WebSocket ws,Response r){handler.post(()->{
                if(stopping){ws.close(1000,"offline");return;}connected=true;retries=0;updateJourney("Online • GPS e espera de pedidos ativos");
                if(vehicle!=null)try{ws.send(new JSONObject().put("type","online").put("vehicle",vehicle).toString());}catch(Exception ignored){}
                registerPush();flushDecision();emit("open",new JSONObject());if(lastPosition!=null)sendLocation(lastPosition);
            });}
            @Override public void onMessage(WebSocket ws,String raw){handler.post(()->{
                try{handleMessage(new JSONObject(raw));}catch(Exception ignored){}
            });}
            @Override public void onClosed(WebSocket ws,int code,String reason){handler.post(()->lost(false));}
            @Override public void onFailure(WebSocket ws,Throwable error,Response response){handler.post(()->lost(response!=null&&(response.code()==401||response.code()==403)));}
        });
    }
    private void flushDecision(){
        if(pendingDecision==null||!connected||vehicle==null||socket==null)return;
        if(System.currentTimeMillis()<decisionExpires)try{socket.send(new JSONObject().put("type",pendingDecision).put("orderId",pendingOrder).toString());}catch(Exception ignored){}
        pendingDecision=null;pendingOrder=null;
    }
    private void registerPush(){
        String token=getSharedPreferences("driver",MODE_PRIVATE).getString("pushToken",null);
        if(connected&&socket!=null&&vehicle!=null&&token!=null)try{socket.send(new JSONObject().put("type","push_register").put("token",token).put("vehicle",vehicle).toString());}catch(Exception ignored){}
    }
    private void handleMessage(JSONObject msg){
        String type=msg.optString("type");
        if(type.equals("call_offer")){
            if(msg.optLong("expiresAt")<=System.currentTimeMillis())return;
            JSONObject order=msg.optJSONObject("order");if(order==null)return;
            if(order.optString("id").equals(lastEndedOrder)&&msg.optLong("expiresAt")<=lastEndedExpiry)return;
            if(offer!=null&&offer.optJSONObject("order").optString("id").equals(order.optString("id"))&&msg.optLong("expiresAt")<expiresAt)return;
            boolean duplicate=offer!=null&&offer.optJSONObject("order").optString("id").equals(order.optString("id"))&&expiresAt==msg.optLong("expiresAt");
            offer=msg;accepted=null;expiresAt=msg.optLong("expiresAt");if(!duplicate)showCall();
        }else if(type.equals("call_end")){
            long ended=msg.optLong("offerExpiresAt");lastEndedOrder=msg.optString("orderId");lastEndedExpiry=Math.max(lastEndedExpiry,ended);
            if(offer!=null&&offer.optJSONObject("order").optString("id").equals(msg.optString("orderId"))&&(ended==0||ended==expiresAt))clearOffer();
        }
        else if(type.equals("call_accepted")){accepted=msg;clearOffer();}
        else if(type.equals("call_error"))clearOffer();
        emit("message",msg);
    }
    private void lost(boolean auth){
        socket=null;connected=false;clearOffer();
        if(stopping)return;
        if(auth){updateJourney("Sessão expirada. Abra o aplicativo e entre novamente.");emit("session_expired",new JSONObject());stopSelf();return;}
        updateJourney("Sem conexão • tentando reconectar");
        handler.postDelayed(()->{if(socket==null&&!stopping)connect();},Math.min(30000,1000L<<Math.min(retries++,5)));
    }
    static void broadcast(Context c,String type,JSONObject data){c.sendBroadcast(new Intent(EVENT).setPackage(c.getPackageName()).putExtra("type",type).putExtra("data",data.toString()));}
    private void emit(String type,JSONObject data){broadcast(this,type,data);}
    static void replay(Context c){
        if(lastPosition!=null)broadcast(c,"position",lastPosition);
        if(offer!=null&&System.currentTimeMillis()<expiresAt)broadcast(c,"message",offer);
        if(accepted!=null)broadcast(c,"message",accepted);
    }
    private PendingIntent app(){return PendingIntent.getActivity(this,1,new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private PendingIntent action(String action,String id,int code){return PendingIntent.getService(this,code,new Intent(this,DriverService.class).setAction(action).putExtra("orderId",id),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private Notification journey(String text){
        return new NotificationCompat.Builder(this,"journey").setSmallIcon(R.drawable.ic_zap_notification).setContentTitle("Zap Encomendas • Jornada ativa").setContentText(text).setOngoing(true).setContentIntent(app()).setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0,"Ficar offline",action("stop","",99)).build();
    }
    private void updateJourney(String text){getSystemService(NotificationManager.class).notify(JOURNEY,journey(text));}
    private void channels(){
        NotificationManager nm=getSystemService(NotificationManager.class);
        NotificationChannel journey=new NotificationChannel("journey","Jornada e localização",NotificationManager.IMPORTANCE_LOW);journey.setDescription("Visível enquanto o motorista estiver online e compartilhando GPS.");nm.createNotificationChannel(journey);
        NotificationChannel calls=new NotificationChannel("driver_calls_v1","Chamadas de pedidos",NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Alertas de pedidos com tela de chamada.");calls.enableVibration(true);calls.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        calls.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());nm.createNotificationChannel(calls);
    }
    private void showCall(){
        clearRing();
        long remaining=expiresAt-System.currentTimeMillis();if(remaining<=0){offer=null;return;}
        JSONObject order=offer.optJSONObject("order");if(order==null)return;
        String id=order.optString("id");
        PendingIntent full=PendingIntent.getActivity(this,20,new Intent(this,IncomingCallActivity.class).putExtra("orderId",id).putExtra("place",order.optString("place")).putExtra("address",order.optString("address")).putExtra("expiresAt",expiresAt).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification n=new NotificationCompat.Builder(this,"driver_calls_v1").setSmallIcon(R.drawable.ic_zap_notification).setContentTitle("Novo pedido • "+order.optString("place")).setContentText("Toque para atender a chamada").setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOngoing(true).setContentIntent(full).setFullScreenIntent(full,true).setTimeoutAfter(remaining)
            .addAction(0,"Recusar",action("reject",id,21)).addAction(0,"Aceitar",action("accept",id,22)).build();
        getSystemService(NotificationManager.class).notify(CALL,n);
        // The channel owns the sound preference. Respect muted channels and Do Not Disturb.
        NotificationChannel channel=getSystemService(NotificationManager.class).getNotificationChannel("driver_calls_v1");
        if(channel.getImportance()>=NotificationManager.IMPORTANCE_HIGH&&channel.getSound()!=null){
            ringtone=RingtoneManager.getRingtone(this,channel.getSound());
            if(ringtone!=null){ringtone.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());if(Build.VERSION.SDK_INT>=28)ringtone.setLooping(true);ringtone.play();}
        }
        final long expiry=expiresAt;
        handler.postDelayed(()->{if(offer!=null&&expiresAt==expiry&&offer.optJSONObject("order").optString("id").equals(id))clearOffer();},remaining);
    }
    private void clearRing(){if(ringtone!=null){ringtone.stop();ringtone=null;}getSystemService(NotificationManager.class).cancel(CALL);}
    private void clearOffer(){offer=null;clearRing();broadcast(this,"call_dismiss",new JSONObject());}
    @Override public void onLocationChanged(Location l){
        if(System.currentTimeMillis()-l.getTime()>60000)return;
        try{lastPosition=new JSONObject().put("latitude",l.getLatitude()).put("longitude",l.getLongitude()).put("accuracy",l.getAccuracy()).put("altitude",l.hasAltitude()?l.getAltitude():JSONObject.NULL).put("heading",l.hasBearing()?l.getBearing():JSONObject.NULL).put("speed",l.hasSpeed()?l.getSpeed():JSONObject.NULL).put("timestamp",l.getTime());emit("position",lastPosition);sendLocation(lastPosition);}catch(Exception ignored){}
    }
    private void sendLocation(JSONObject position){if(socket!=null&&connected)try{socket.send(new JSONObject().put("type","location").put("position",position).toString());}catch(Exception ignored){}}
    @Override public void onProviderDisabled(String provider){if(LocationManager.GPS_PROVIDER.equals(provider)){updateJourney("GPS desligado • jornada encerrada");stopSelf();}}
    @Override public void onProviderEnabled(String p){}
    @Override public void onStatusChanged(String p,int status,Bundle extras){}
    @Override public IBinder onBind(Intent i){return null;}
    @Override public void onTaskRemoved(Intent rootIntent){/* A jornada explicitamente iniciada continua até Ficar offline. */}
    @Override public void onDestroy(){
        emit("offline",new JSONObject());stopping=true;getSharedPreferences("driver",MODE_PRIVATE).edit().remove("cookie").putBoolean("active",false).apply();running=false;connected=false;handler.removeCallbacksAndMessages(null);clearOffer();accepted=null;lastPosition=null;
        if(socket!=null){socket.send("{\"type\":\"offline\"}");socket.close(1000,"offline");}if(locations!=null)locations.removeUpdates(this);if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();
        client.dispatcher().executorService().shutdown();client.connectionPool().evictAll();super.onDestroy();
    }
}
