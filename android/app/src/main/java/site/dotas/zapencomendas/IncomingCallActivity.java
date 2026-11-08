package site.dotas.zapencomendas;

import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.view.*;
import android.widget.*;
import androidx.core.content.ContextCompat;

public class IncomingCallActivity extends Activity {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean registered=false;
    private final BroadcastReceiver receiver=new BroadcastReceiver(){public void onReceive(Context c,Intent i){if("call_dismiss".equals(i.getStringExtra("type")))finish();}};
    @Override public void onCreate(Bundle state){super.onCreate(state);
        SystemBars.configure(this,ContextCompat.getColor(this,R.color.zap_call_surface));
        if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);render();
        ContextCompat.registerReceiver(this,receiver,new IntentFilter(DriverService.EVENT),ContextCompat.RECEIVER_NOT_EXPORTED);registered=true;
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);render();}
    private void render(){
        handler.removeCallbacksAndMessages(null);
        long remaining=getIntent().getLongExtra("expiresAt",0)-System.currentTimeMillis();
        if(remaining<=0||DriverService.offer==null){finish();return;}
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setGravity(Gravity.CENTER);layout.setPadding(36,48,36,48);layout.setBackgroundColor(ContextCompat.getColor(this,R.color.zap_call_surface));
        addText(layout,"ZAP ENCOMENDAS",18);addText(layout,"Novo pedido",32);addText(layout,getIntent().getStringExtra("place"),25);addText(layout,getIntent().getStringExtra("address"),18);
        TextView countdown=addText(layout,"",18);
        Runnable clock=new Runnable(){public void run(){long seconds=(getIntent().getLongExtra("expiresAt",0)-System.currentTimeMillis()+999)/1000;if(seconds<=0){finish();return;}countdown.setText("Atenda em "+seconds+" segundos");handler.postDelayed(this,1000);}};clock.run();
        Button accept=new Button(this);accept.setText("Aceitar pedido");accept.setTextColor(Color.WHITE);accept.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(5,145,90)));layout.addView(accept,new LinearLayout.LayoutParams(-1,140));accept.setOnClickListener(v->decide("accept"));
        Button reject=new Button(this);reject.setText("Recusar");layout.addView(reject,new LinearLayout.LayoutParams(-1,140));reject.setOnClickListener(v->decide("reject"));setContentView(layout);SystemBars.protectCallContent(layout);
    }
    private TextView addText(LinearLayout l,String text,int size){TextView t=new TextView(this);t.setText(text);t.setTextSize(size);t.setTextColor(Color.WHITE);t.setGravity(Gravity.CENTER);t.setPadding(0,18,0,18);l.addView(t);return t;}
    private void decide(String action){startService(new Intent(this,DriverService.class).setAction(action).putExtra("orderId",getIntent().getStringExtra("orderId")));if(action.equals("accept"))startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP));finish();}
    @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(registered)unregisterReceiver(receiver);super.onDestroy();}
}
