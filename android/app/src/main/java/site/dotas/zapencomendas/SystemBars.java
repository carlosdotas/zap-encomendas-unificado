package site.dotas.zapencomendas;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.ColorUtils;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** Keep Android's bars visible and readable independently of the website's CSS. */
final class SystemBars {
    private SystemBars() {}

    @SuppressWarnings("deprecation")
    static void configure(Activity activity, int surface) {
        Window window=activity.getWindow();
        WindowCompat.setDecorFitsSystemWindows(window,true);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(surface);
        window.setNavigationBarColor(surface);
        window.getDecorView().setBackgroundColor(surface);
        activity.findViewById(android.R.id.content).setBackgroundColor(surface);
        WindowInsetsControllerCompat controller=WindowCompat.getInsetsController(window,window.getDecorView());
        boolean darkIcons=ColorUtils.calculateLuminance(surface)>0.179;
        controller.setAppearanceLightStatusBars(darkIcons);
        controller.setAppearanceLightNavigationBars(darkIcons);
        if(Build.VERSION.SDK_INT>=29){window.setStatusBarContrastEnforced(true);window.setNavigationBarContrastEnforced(true);}
    }

    /** Android 15 enforces edge-to-edge; inset the native call screen as well. */
    static void protectCallContent(View content) {
        if(Build.VERSION.SDK_INT<35)return;
        int left=content.getPaddingLeft(),top=content.getPaddingTop(),right=content.getPaddingRight(),bottom=content.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(content,(view,windowInsets)->{
            Insets bars=windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(left+bars.left,top+bars.top,right+bars.right,bottom+bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
    }
}
