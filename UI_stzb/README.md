# UI_stzb —— 图标与 UI 素材源目录

本目录存放**图标/素材原始文件**（此前一直未纳入版本管理，2026-09-21 入库）。
下游用途见 `android/icon/README.md`（App 图标生成流程：本目录的 `应用封面.png` → `source.png` → `master.png` → `res/` 各密度图标）。

## 内容

| 文件 | 用途 |
|------|------|
| `应用封面.png` | App 图标源图（**注意：扩展名是 .png，内容实为 WebP**，658×648、透明底；ffmpeg 按内容识别，勿按扩展名处理） |
| `魏.png` `蜀.png` `吴.png` `群.png` `汉.png` `晋.png` | 势力图标 |
| `A001.png` `A002.png` `B001.png` `B002.png` `S001.png` `S002.png` `CD001.png` | 战法品级角标（A/B/S/CD） |
| `zhudong.png` `beidong.png` `zhihui.png` `zhuiji.png` | 战法类型图标（主动 / 被动 / 指挥 / 追击） |
| `0011.png` `wujiang5.png` | 其他素材（星级 / 武将卡） |

## 约定

- 新增素材请**直接放本目录**并在上表补一行；不要在仓库根目录散落预览图（预览截图请放 `docs/screenshots/`）。
- 素材替换后，App 图标需按 `android/icon/README.md` 重新生成并 `npx cap sync android`。
