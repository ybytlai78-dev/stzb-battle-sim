/**
 * 预设识图 · 读图（游戏「阵容详情」截图 → 识别 JSON）
 * ---------------------------------------------------------------------------
 * 与 `web/advisor/vision.ts`（我的 box 识图）**同一条传输层、同一套设置**：
 *   · 用用户在 ⚙ 设置里接入的那个模型（baseUrl / model / key），**不新增第二套配置**；
 *   · 走 `transport.once()`（非流式、不带 tools）——读图不需要工具，一次拿完整 JSON 最省事；
 *   · 图片在前端先压（长边 1600 / JPEG 0.85）再转 data URL，直接复用 `fileToDataUrl`。
 *
 * 分工：模型**只负责报名字**（武将名 / 战法名 / 星数），名字 → 库内 id 一律交给
 * `web/presetScan.ts` 的 `matchTeamScan` 做确定性对齐（识别靠 AI、校验靠代码）。
 */
import { AdvisorError, type AdvisorTransport } from './advisor/transport';
import { fileToDataUrl } from './advisor/vision';
import { parseTeamScanReply, type TeamScanJson } from './presetScan';

/** 单张原图上限（超过就明确拒绝，不静默截断） */
export const SCAN_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const SCAN_VISION_SYSTEM_PROMPT = `你是《率土之滨》截图里的**阵容读图员**。用户会发来游戏「阵容详情」界面的截图：左边一列竖排写着营位，上面三行分别是 大营 / 中军 / 前锋，每行有一个武将卡（名字 + 等级 + 一排星星）和三个圆形战法图标（图标下面是战法名）。

把每一行照抄下来，只输出一个 JSON（可以放在 \`\`\`json 代码块里）：
{
  "side": "我方",
  "slots": [
    { "position": "大营", "heroName": "司马炎", "redness": 5, "level": 50, "faction": "晋", "troopType": "步", "skillNames": ["谋议宏图", "白刃", "兵无常势"] },
    { "position": "中军", "heroName": "乐进", "redness": 5, "level": 50, "faction": "魏", "troopType": "步", "skillNames": ["奋疾先登", "百战无怯", "击势"] },
    { "position": "前锋", "heroName": "于禁", "redness": 5, "level": 50, "faction": "魏", "troopType": "步", "skillNames": ["当敌制决", "以诱待来", "胜敌益强"] }
  ],
  "unrecognized": []
}

规矩（违反即算读错）：
1. **slots 一定有 3 条**，position 分别是 大营 / 中军 / 前锋（从上到下的顺序；左侧竖排标签也这么写）。哪一行完全看不清，就把那条的 heroName 填 "" 并写进 unrecognized，**不要编**。
2. heroName **照抄卡面上的字**，带前缀的照抄（"SP赵云"、"XP程昱"、"关兴＆张苞"）—— 名字不一样就是不同的将。
3. redness = **只数红色的星星**（红度）。卡面右上角那一排永远是 5 颗：**红**的 = 已经进的阶（红度），**金/黄**的 = 还没进的空位。所以 5 红 = 5、1 红 4 金 = 1、全金 = 0。紧挨着星星的那个金色菱形「極」字标**不是星星**，别数进去。看不清就填 null，**不要瞎猜**（红度会直接影响兵力与自由点数）。
4. skillNames = 那一行**三个圆形战法图标下面的名字**，按**左 → 右**顺序，一共 3 个，**第 1 个是主战法**。
5. **只抄名字**：图标角上的 S / A / B 品级小标、以及 "S2" 这种赛季标**都不是名字的一部分**，不要一起抄。
6. faction = 卡面阵营（汉/魏/蜀/吴/群/晋），troopType = 卡面兵种（骑/步/弓）。看不清填 null，**不要瞎填**。
7. 看不懂、被遮挡、糊掉的文字片段一律放进 "unrecognized"，**不许猜、不许省略中间那一行**。
8. level 照抄截图上的等级（看不清填 null）—— 引擎侧不按它算，只是留个痕。
9. 除了这个 JSON 不要输出任何解释文字。`;

export const SCAN_VISION_USER_PROMPT =
  '这是我的一支队伍的「阵容详情」截图。请按上面的 JSON 格式，把三行（大营 / 中军 / 前锋）的武将名、星星数、三个战法名照抄给我。';

// ─────────────────────────── 图片 → data URL ───────────────────────────

/**
 * 一张截图 → data URL（长边压到 1600、JPEG 0.85，压缩逻辑复用 box 识图那一份）。
 * 非图片 / 超限 → `AdvisorError('format')`，文案直接给用户看。
 */
export async function scanImageToDataUrl(file: Blob): Promise<string> {
  if (file.size > SCAN_IMAGE_MAX_BYTES) {
    throw new AdvisorError('format', `这张截图 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 ${SCAN_IMAGE_MAX_BYTES / 1024 / 1024}MB 上限——压一下或换张图再传`);
  }
  return fileToDataUrl(file, { maxBytes: SCAN_IMAGE_MAX_BYTES });
}

// ─────────────────────────── 识图调用 ───────────────────────────

export interface RecognizeTeamOpts {
  /** 一张图的 data URL（`scanImageToDataUrl` 的产物） */
  image: string;
  transport: AdvisorTransport;
  signal?: AbortSignal;
}

export interface RecognizeTeamResult {
  raw: TeamScanJson;
  /** 模型原文（排错用；界面只显示摘要） */
  reply: string;
}

/** 一次补全：优先 `once()`，没有就用 `chat()` 把文本增量拼起来（与 box 识图同口径） */
async function complete(transport: AdvisorTransport, image: string, signal?: AbortSignal): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SCAN_VISION_SYSTEM_PROMPT },
    { role: 'user' as const, content: SCAN_VISION_USER_PROMPT, images: [image] },
  ];
  if (transport.once) return transport.once({ messages, tools: [], temperature: 0 }, signal);
  if (!transport.chat) throw new AdvisorError('format', '这个传输层既不支持 once() 也不支持 chat()，没法识图');
  let text = '';
  for await (const ev of transport.chat({ messages, tools: [] }, signal)) if (ev.type === 'text') text += ev.delta;
  return text;
}

/**
 * 识图主入口：一张「阵容详情」截图 → 识别 JSON。
 * **不做库内对齐**（那是 `matchTeamScan`）；**不写盘**（那是上传弹窗的事）。
 */
export async function recognizeTeam(opts: RecognizeTeamOpts): Promise<RecognizeTeamResult> {
  if (!opts.image) throw new AdvisorError('format', '还没有截图——先选一张「阵容详情」图');
  const reply = await complete(opts.transport, opts.image, opts.signal);
  return { raw: parseTeamScanReply(reply), reply };
}

// ─────────────────────────── 干跑示例（没配模型时的链路演示） ───────────────────────────

/**
 * 干跑示例回复（**不是真读图**：界面必须明确标注，只用来验证「识别 → 对齐 → 确认卡 → 落库」这条链）。
 * 内容取自真实截图口径（我方·司马炎队），方便一眼看出对齐结果对不对。
 */
export const SAMPLE_TEAM_REPLY = [
  '（干跑示例：没有真的读图）',
  '```json',
  JSON.stringify(
    {
      side: '我方',
      slots: [
        { position: '大营', heroName: '司马炎', redness: 5, level: 50, faction: '晋', troopType: '步', skillNames: ['谋议宏图', '白刃', '兵无常势'] },
        { position: '中军', heroName: '乐进', redness: 5, level: 50, faction: '魏', troopType: '步', skillNames: ['奋疾先登', '百战无怯', '击势'] },
        { position: '前锋', heroName: '于禁', redness: 5, level: 50, faction: '魏', troopType: '步', skillNames: ['当敌制决', '以诱待来', '胜敌益强'] },
      ],
      unrecognized: ['（示例里没有读不清的内容）'],
    },
    null,
    1
  ),
  '```',
].join('\n');
