package site.dotas.zapencomendas;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONObject;

/** Only data messages from this application's Firebase project can reach this service. */
public class CallMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token){
        getSharedPreferences("driver",MODE_PRIVATE).edit().putString("pushToken",token).apply();
        if(DriverService.running)startService(new Intent(this,DriverService.class).setAction("push_token"));
    }
    @Override public void onMessageReceived(RemoteMessage message){
        if(!getSharedPreferences("driver",MODE_PRIVATE).getBoolean("active",false))return;
        String payload=message.getData().get("payload");if(payload==null)return;
        try{
            JSONObject data=new JSONObject(payload);
            if(!DriverService.running&&(!"call_offer".equals(data.optString("type"))||data.optLong("expiresAt")<=System.currentTimeMillis()))return;
            if(ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return;
            if(Build.VERSION.SDK_INT>=29&&ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_BACKGROUND_LOCATION)!=PackageManager.PERMISSION_GRANTED)return;
            if(!((LocationManager)getSystemService(LOCATION_SERVICE)).isProviderEnabled(LocationManager.GPS_PROVIDER))return;
            Intent intent=new Intent(this,DriverService.class).setAction("push").putExtra("payload",payload);
            ContextCompat.startForegroundService(this,intent);
        }catch(Exception e){android.util.Log.w("ZapPush","Não foi possível despertar a jornada; abra o aplicativo.");}
    }
}
