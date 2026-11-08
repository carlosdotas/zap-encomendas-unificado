package site.dotas.zapencomendas;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import java.util.List;
import org.json.JSONObject;

/** One owner for system-bar + IME insets. Resize the WebView itself, not a CSS overlay. */
final class WebViewViewport {
    private final View host;
    private final WebView web;
    private boolean ready,publishing,imeVisible,imeAnimating;
    private int imeBottom;
    private WindowInsetsCompat latestInsets;

    WebViewViewport(Activity activity,WebView web){
        this.web=web;host=activity.findViewById(R.id.zap_webview_container);
        int mode=activity.getWindow().getAttributes().softInputMode;
        activity.getWindow().setSoftInputMode((mode&~WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST)|WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        // API 26-29: decor fitting + adjustResize already resize the content. Do not inset twice.
        if(Build.VERSION.SDK_INT>=30){
            ViewCompat.setOnApplyWindowInsetsListener(host,(view,insets)->{
                latestInsets=insets;
                if(!imeAnimating)applyInsets(insets);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.setWindowInsetsAnimationCallback(host,new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_STOP){
                @Override public void onPrepare(@NonNull WindowInsetsAnimationCompat animation){
                    if((animation.getTypeMask()&WindowInsetsCompat.Type.ime())!=0)imeAnimating=true;
                }
                @NonNull @Override public WindowInsetsCompat onProgress(@NonNull WindowInsetsCompat insets,@NonNull List<WindowInsetsAnimationCompat> running){applyInsets(insets);return insets;}
                @Override public void onEnd(@NonNull WindowInsetsAnimationCompat animation){
                    if((animation.getTypeMask()&WindowInsetsCompat.Type.ime())!=0){imeAnimating=false;if(latestInsets!=null)applyInsets(latestInsets);}
                }
            });
        }
        web.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->publish());
        host.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){
            @Override public void onViewAttachedToWindow(View v){ViewCompat.requestApplyInsets(v);}
            @Override public void onViewDetachedFromWindow(View v){}
        });
        ViewCompat.requestApplyInsets(host);
    }
    private void applyInsets(WindowInsetsCompat insets){
        Insets bars=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout());
        Insets ime=insets.getInsets(WindowInsetsCompat.Type.ime());
        imeVisible=insets.isVisible(WindowInsetsCompat.Type.ime());imeBottom=ime.bottom;
        int bottom=Math.max(bars.bottom,ime.bottom); // IME already includes the navigation-bar region.
        ViewGroup.MarginLayoutParams p=(ViewGroup.MarginLayoutParams)web.getLayoutParams();
        if(p.leftMargin!=bars.left||p.topMargin!=bars.top||p.rightMargin!=bars.right||p.bottomMargin!=bottom){
            p.setMargins(bars.left,bars.top,bars.right,bottom);web.setLayoutParams(p);
        }
        publish();
    }
    void ready(){ready=true;publish();}
    private void publish(){
        if(!ready||publishing)return;publishing=true;
        web.postOnAnimation(()->{
            publishing=false;if(!ready||web.getWidth()<=0||web.getHeight()<=0)return;
            if(Build.VERSION.SDK_INT<30){WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(host);if(insets!=null){imeVisible=insets.isVisible(WindowInsetsCompat.Type.ime());imeBottom=insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;}}
            try{
                float density=web.getResources().getDisplayMetrics().density;
                JSONObject value=new JSONObject().put("imeVisible",imeVisible).put("imeHeight",imeBottom/density).put("width",web.getWidth()/density).put("height",web.getHeight()/density);
                web.evaluateJavascript("window.ZapViewport&&window.ZapViewport.update("+value+")",null);
            }catch(Exception ignored){}
        });
    }
}
