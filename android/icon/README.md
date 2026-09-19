# 应用图标（Android launcher icon）

## 来源与处理

| 步骤 | 说明 |
|---|---|
| 原始素材 | `UI_stzb/应用封面.png` —— ⚠️ **实为 WebP**（magic `RIFF…WEBP`），658×648、**透明底**（四角 alpha=0） |
| `source.png` | 中心裁成 648×648 方图（透明底保留） |
| `master.png` | 垫 App 主题底色 **`#12100f`**（`web/styles.css` 的 `--bg`）+ 立绘缩到 **80%** 居中 → 不透明母图 |

> **为什么缩到 80%**：自适应图标的蒙版只保证中央 72/108 ≈ 66.7% 可见，立绘全铺会把马头 / 红底旗边裁掉；
> 80% 时仅裁掉极外圈。若要"更大更满"改成一个数即可（见下方命令里的 `scale=518:518`）。
> **为什么必须垫底色**：素材透明底，若不垫色，透明区在启动器里会显示成系统默认色，观感随机。

## 生成的资源（`android/app/src/main/res/`）

| 用途 | 文件 | 尺寸（mdpi→xxxhdpi） |
|---|---|---|
| 自适应图标背景层 | `drawable-*/ic_launcher_background.png` | 108 / 162 / 216 / 324 / 432 |
| 传统方形图标 | `mipmap-*/ic_launcher.png` | 48 / 72 / 96 / 144 / 192 |
| 传统圆形图标 | `mipmap-*/ic_launcher_round.png` | 同上（带圆形 alpha 遮罩） |

自适应图标前景 `mipmap-*/ic_launcher_foreground.png` **保持全透明**（原样），所以
`mipmap-anydpi-v26/ic_launcher.xml` 的 `background=@drawable/ic_launcher_background`
就是图标本体 —— **换图标 = 换这 5 张背景图**。

## 复现命令（ffmpeg）

```bash
FF=ffmpeg                       # 本机：Gyan.FFmpeg（winget）自带
SRC='UI_stzb/应用封面.png'
RES=android/app/src/main/res

# 1) WebP → 方形 PNG 母图（中心裁切）。注意源文件扩展名是 .png 但内容是 WebP，ffmpeg 按内容识别
"$FF" -y -i "$SRC" -vf 'crop=648:648:5:0' -pix_fmt rgba android/icon/source.png

# 2) 垫底色 + 立绘缩到 80%（518 = 648×0.8）居中 → 不透明母图
"$FF" -y -f lavfi -i 'color=c=0x12100f:s=648x648,format=rgba' -i android/icon/source.png \
  -filter_complex '[1:v]scale=518:518[art];[0:v][art]overlay=(W-w)/2:(H-h)/2' \
  -frames:v 1 android/icon/master.png

# 3) 各密度：背景(108dp) / 方形(legacy) / 圆形（geq 生成圆形 alpha 遮罩）
#    尺寸表 mdpi=108,48  hdpi=162,72  xhdpi=216,96  xxhdpi=324,144  xxxhdpi=432,192
"$FF" -y -i android/icon/master.png -vf "scale=432:432" -frames:v 1 "$RES/drawable-xxxhdpi/ic_launcher_background.png"
"$FF" -y -i android/icon/master.png -vf "scale=192:192" -frames:v 1 "$RES/mipmap-xxxhdpi/ic_launcher.png"
"$FF" -y -i android/icon/master.png \
  -vf "scale=192:192,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2-1),255,0)'" \
  -frames:v 1 "$RES/mipmap-xxxhdpi/ic_launcher_round.png"
```

## 未做（如有需要再说）

- **启动图 `drawable*/splash.png` 仍是 Capacitor 默认白底图**，与深色图标不一致；要做需同法替换各密度 splash。
- **Web/PWA 图标 `public/icons/*`** 仍是旧的率 logo；APK 图标已换，网页版与"添加到主屏"的图标未换。
