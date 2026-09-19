package io.github.ybytlai78dev.stzb;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.Locale;

/**
 * 主界面：在 Capacitor WebView 上启用边到边绘制，消除系统栏与挖孔区的白边。
 *
 * 问题背景（2026-09-18 真机实测）：默认主题下真机四周有白边——
 *   左侧 135px（挖孔区未适配）、上方 135px（状态栏）、下方 56px（导航栏），
 *   因为 App 未做 edge-to-edge，系统用窗口默认浅色背景填充了这些区域。
 *
 * 方案照搬「荣誉换算器」（com.ltzb.honorcalc）的 android 工程 —— 该工程在真机实测无白边。
 * 本工程为固定深色主题，故不需要那套浅/暗切换同步原生底色的 JS 接口。
 *
 * 2026-09-18 补充：消灭白边之后暴露出第二个问题 —— 铺满 = 内容钻到系统栏底下
 * （状态栏的时钟/电量压住顶栏标题与导航，手势条压住底栏）。
 * 修法见 {@link #installSafeAreaBridge()}：原生只把真实 insets 推给网页，页面自己避让。
 */
public class MainActivity extends BridgeActivity {

    /** 网页画布色，与 web/styles.css 的 --bg 保持一致，避免露底时看见异色 */
    private static final int CANVAS_COLOR = 0xFF12100F;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyEdgeToEdge();
        applyCanvasColor(CANVAS_COLOR);
        installSafeAreaBridge();
        hideSystemBars();
    }

    /**
     * 窗口重新获得焦点时再隐一次系统栏。
     *
     * 为什么不能只在 onCreate 隐一次（也不能只靠 capacitor.config.ts 的 SystemBars.hidden）：
     *   · 沉浸式是「粘性」的 —— 手指从边缘划出会临时唤出状态栏/手势条，几秒后才自动收起；
     *   · 从后台切回来、上划进最近任务、锁屏解锁后，系统也可能把系统栏恢复显示；
     *   只在启动时 hide 一次的话，这些情况下栏就"回来了而且不再走"。
     *   所以在每次拿到焦点时重新 hide —— 这是 Android 沉浸式应用的标准做法。
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    /**
     * 沉浸式全屏：隐藏状态栏与手势条，内容吃满整屏。
     *
     * · 行为设为 BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE（沉浸式粘性，手游标准）：
     *   边缘滑一下能临时唤出系统栏，几秒后自动收起，不会永久占位；
     * · 隐藏后 insets 归零 —— installSafeAreaBridge() 读到 0 会把 --safe-area-inset-*
     *   也更新为 0，CSS 的 max(6px, var(--safe-top)) 自然回落到最小值，页面自动铺满，无需改样式；
     *   挖孔（displayCutout）即使系统栏隐藏也仍会被上报，所以横屏挖孔侧照样留出避让。
     */
    private void hideSystemBars() {
        View decor = getWindow().getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decor);
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    /**
     * 让内容绘制到状态栏、导航栏和挖孔区后面，去掉系统默认留白。
     */
    private void applyEdgeToEdge() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 内容延伸进挖孔区（横屏时挖孔侧不再留白竖条）
            WindowManager.LayoutParams params = window.getAttributes();
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(params);
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 关掉 Android 10+ 强制加在透明系统栏上的对比度遮罩
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        View decor = window.getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    /**
     * 把画布色涂到窗口、WebView 及其父布局，避免系统栏留白露出默认浅色底。
     *
     * @param color 与当前网页画布一致的 ARGB 色
     */
    private void applyCanvasColor(int color) {
        getWindow().getDecorView().setBackgroundColor(color);
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(color);
        View parent = (View) webView.getParent();
        if (parent != null) {
            parent.setBackgroundColor(color);
        }
    }

    /**
     * 把系统栏 / 挖孔区的真实边衬（insets）推给网页，让 CSS 自己决定怎么避让。
     *
     * <h3>为什么必须由原生侧推（2026-09-18 真机实测：顶栏被状态栏压住、底栏被手势条压住）</h3>
     * Capacitor 的 SystemBars 插件在 {@code insetsHandling:'disable'} 下会 <b>直接 return</b>
     * （SystemBars.java:187-189）——既不给 DecorView 加 padding，也不注入
     * {@code --safe-area-inset-*} CSS 变量。于是网页只剩浏览器原生 {@code env(safe-area-inset-*)}
     * 一条路，而 Android 官方文档《Understand window insets in WebView》写明：
     * <ul>
     *   <li>M136 起才把 {@code systemBars()} / {@code displayCutout()} 透传成 CSS safe-area-inset-*，
     *       且<b>仅在全屏 WebView 下</b>；</li>
     *   <li>M144 起才对所有 WebView 生效；</li>
     *   <li>更早的 WebView 只透传 display cutout —— 横屏时挖孔在左右侧、顶部没有 cutout，
     *       于是 {@code safe-area-inset-top} 恒为 0。</li>
     * </ul>
     * 结果：{@code --safe-top} = 0 → 顶栏只剩 6px padding，被时钟/电量压住；底部同理。
     *
     * <h3>为什么不直接改成 insetsHandling:'css'</h3>
     * Capacitor 对 WebView &lt; 140 会走 else 分支给 DecorView 加 padding
     * （SystemBars.java:194-227），把挖孔区整条吃掉（实测 innerWidth 1098 → 1020）——
     * 正是上一次的白边/变窄事故。这里改成「只推 CSS 变量、绝不 padding」，
     * 既不依赖 WebView 版本，也不损失一行画面宽度。
     *
     * <p>与 web/mobile.css 的对接：CSS 里 {@code --safe-*} 优先读 {@code --safe-area-inset-*}，
     * 读不到才退回 {@code env()}，所以纯网页版（无该变量）行为不变。
     */
    private void installSafeAreaBridge() {
        View decor = getWindow().getDecorView();

        // 旋转 / 系统栏显隐 / 挖孔变化 → insets 变化 → 重新推一次
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            pushSafeAreaCss(insets);
            // 原样下传：不 padding、不 consume。官方文档亦建议返回未修改的 insets，
            // 让 WebView 自己也能拿到完整尺寸（WebView ≥ M144 会同时把 env(safe-area-inset-*) 填对）。
            return insets;
        });

        // 页面每次加载提交后 documentElement 的内联样式会被重置 → 重新触发一次 insets 下发。
        // 与 Capacitor 自身 SystemBars 的做法一致（其 handleOnStart 挂的就是这个回调）。
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                decor.requestApplyInsets();
            }
        });
    }

    /** insets → CSS 变量（px ÷ density = dp = CSS px，与 Capacitor 的 injectSafeAreaCSS 同口径） */
    private void pushSafeAreaCss(WindowInsetsCompat insets) {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            return;
        }

        Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());

        float density = getResources().getDisplayMetrics().density;
        int top = Math.round(bars.top / density);
        int right = Math.round(bars.right / density);
        int bottom = Math.round(bars.bottom / density);
        int left = Math.round(bars.left / density);

        String script = String.format(
                Locale.US,
                """
                try {
                  const s = document.documentElement.style;
                  s.setProperty('--safe-area-inset-top', '%dpx');
                  s.setProperty('--safe-area-inset-right', '%dpx');
                  s.setProperty('--safe-area-inset-bottom', '%dpx');
                  s.setProperty('--safe-area-inset-left', '%dpx');
                } catch (e) { /* 页面尚未就绪：onPageCommitVisible 会再推一次 */ }
                """,
                top,
                right,
                bottom,
                left
        );
        webView.evaluateJavascript(script, null);
    }
}
