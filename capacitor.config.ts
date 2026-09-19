import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 战斗模拟器 · Android 壳（Capacitor 8）
 *
 * ⚠️ appId 一经发布不可更改 —— 改了等于换一个 App（玩家必须卸载重装、本地数据丢失）。
 * ⚠️ webDir 固定为 vite 的构建输出 `dist`，构建链：npm run web:build → npx cap sync android。
 *
 * 注：vite 的 base 保持默认 '/'（GitHub Pages 靠 gh-pages 分支根目录提供服务），
 * 在 Capacitor 的 https://localhost 下绝对路径同样成立，无需额外配置。
 */
const config: CapacitorConfig = {
  appId: 'io.github.ybytlai78dev.stzb',
  appName: '战斗模拟器',
  webDir: 'dist',
  android: {
    // 透明底色：配合 MainActivity 的 edge-to-edge，系统栏/挖孔区露出的是页面自身背景
    backgroundColor: '#00000000',
    // 允许 WebView 调试（chrome://inspect 可直接连真机/模拟器排查）
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    // Capacitor 8 内置 SystemBars（无需额外安装依赖）。
    //
    // ⚠️ 为什么用 'disable'（2026-09-18 真机白边事故的最终解法）
    //   SystemBars 决定「内容是否穿透系统栏」的条件（源码 SystemBars.java:194）：
    //     shouldPassthroughInsets = webViewMajorVersion >= 140 && hasViewportCover
    //   · WebView < 140 时无论怎么配都走 else 分支 → 给 DecorView 加 padding 避开系统栏
    //     → 状态栏/导航栏/挖孔区留白，真机表现为白边（实测：MuMu WebView 110 下
    //       innerWidth 从 1098 被压到 1020，正好少一个挖孔的 78 CSS px）。
    //   · 'disable' 让插件直接 return，不碰 DecorView 也不注入 CSS 变量
    //     → WebView 由 MainActivity 的 setDecorFitsSystemWindows(false) 保证全屏铺满。
    //
    // ⚠️ 'disable' 之后的第二个坑（2026-09-18 真机：状态栏时钟压住顶栏标题、手势条压住底栏）
    //   'disable' 连 CSS 变量都不注入 ⇒ 页面只剩 env(safe-area-inset-*) 一条路，而 Android
    //   官方《Understand window insets in WebView》写明：M136 起才透传 systemBars 数据
    //   （且仅全屏 WebView），M144 起才对所有 WebView 生效；更早只报 display cutout
    //   —— 横屏时挖孔在左右侧、顶部无 cutout ⇒ safe-area-inset-top 恒为 0。
    //   ⇒ 解法不再依赖 env()：由 MainActivity.installSafeAreaBridge() 自己监听窗口 insets，
    //     把 systemBars()|displayCutout() 写成 --safe-area-inset-*（只推变量、绝不 padding，
    //     因此既不丢挖孔区宽度、也与 WebView 版本无关）。
    //   web/mobile.css 的 var(--safe-*, env(safe-area-inset-*, 0px)) 双写正是为此：
    //   原生壳吃注入变量，纯网页版吃 env()。
    //
    //   style 'DARK' 仍然有效：它只负责系统栏图标明暗（深底配浅色图标）。
    //
    // ⚠️ 故意不在这里写 hidden:true（沉浸式全屏）
    //   配置项只能让插件在启动时 hide 一次；沉浸式是"粘性"的，用户从边缘划出会临时唤出
    //   系统栏、从后台切回来也可能被系统恢复显示，届时栏就回来了且不再走。
    //   所以隐藏逻辑放在 MainActivity（hideSystemBars + onWindowFocusChanged 重隐），
    //   行为设为 BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE（边缘滑出临时唤出、几秒自动收起）。
    //   隐藏后 insets 归零 → installSafeAreaBridge 把 --safe-area-inset-* 也更新为 0，
    //   页面自动铺满，web/mobile.css 无需任何改动。
    SystemBars: {
      insetsHandling: 'disable',
      style: 'DARK',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
