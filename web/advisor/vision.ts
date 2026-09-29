/**
 * AI 配将顾问 · 识图（截图 → box 原始清单）
 * ---------------------------------------------------------------------------
 * 口径（见 `docs/AI配将顾问-设计.md` §15）：
 *   · **用用户当前接入的那个模型**（设置里的 baseUrl / model / key，他自己的 ds flash，具备识图能力）；
 *     **不换模型、不加第二套配置** —— 所以这里走的就是同一条 `AdvisorTransport`；
 *   · 截图 = 他账号里的**五星武将**与**五星战法**（多张、可重复页）；模型只负责**报名字**，
 *     名字 → 库内 id 一律交给 `box.ts` 的确定性对齐（`matchRecognition`）——识别靠 AI、校验靠代码；
 *   · 走 `transport.once()`（**非流式**、不带 tools）：识图不需要工具，一次性拿完整 JSON 最省事，
 *     也和偏好抽取（`prefs.ts`）共用同一条旁路；没有 `once` 的传输层退化用 `chat` 拼文本；
 *   · 图片在前端**先压缩**（长边 1600 / JPEG 0.85）再转 data URL：原图动辄 2~4MB，base64 更大，
 *     十几张一起发既慢又容易被厂商拒；压缩在浏览器里做（有 canvas 才做，jsdom / 无 canvas 环境自动跳过）。
 */
import { AdvisorError, type AdvisorTransport } from './transport';
import type { RecognitionRaw, RecognizedHero, RecognizedSkill } from './box';

/** 每张图压缩后的长边上限（够看清武将名与战法名，又不至于把请求撑爆） */
export const IMAGE_MAX_EDGE = 1600;
/** JPEG 质量（0.85 在"字迹清晰"与体积之间） */
export const IMAGE_QUALITY = 0.85;
/** 单张原图上限（超过就明确拒绝，不静默截断） */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** 一次识别最多几张截图 */
export const MAX_IMAGES = 20;
/** 单次请求带几张图（多的分批发，进度看得见、单请求也更稳） */
export const IMAGES_PER_REQUEST = 6;

export const VISION_SYSTEM_PROMPT = `你是《率土之滨》账号截图的**读图员**。用户会发来他账号里「五星武将」与「五星战法」的截图，你要把**截图里真实出现的名字**逐条抄下来。

只输出一个 JSON（可以放在 \`\`\`json 代码块里），格式固定：
{
  "heroes": [{ "name": "曹操", "faction": "魏", "troopType": "骑" }],
  "skills": [{ "name": "大赏三军", "grade": "S" }],
  "unrecognized": ["看不清的原文片段"]
}

规矩（违反即算读错）：
1. **只报截图里真的有的**。看不清、不确定的一律**不要猜**：把原文片段放进 "unrecognized"。
2. 名字**照抄游戏里的字**，带前缀的照抄（如 "SP赵云"、"XP姜维"、"关兴＆张苞"）—— 名字不一样就是不同的将。
3. faction = 卡面左上角的阵营（汉/魏/蜀/吴/群/晋）；troopType = 卡面兵种（骑/步/弓）。看不清就填 null，**不要瞎填**。
4. 同一武将 / 同一战法在多张截图里重复出现 → **只报一次**。
5. 列表里**每一行都要报**，不要只报前几个、不要省略、不要归纳。
6. 战法截图里若同一页既有武将主战法又有可学习战法，**都照抄**（后面有程序会分辨）。
7. 除了这个 JSON 不要输出别的解释文字。`;

export const VISION_USER_PROMPT = (n: number): string =>
  `这是我账号的截图（共 ${n} 张，可能有重复页）：请找出里面**所有的五星武将**与**所有的五星战法**，按上面的 JSON 格式回给我。`;

// ─────────────────────────── 图片 → data URL（压缩，做不了就原样） ───────────────────────────

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(new AdvisorError('format', '读不出这张图片（FileReader 失败）'));
    fr.readAsDataURL(file);
  });

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });

/** 有 canvas 才压缩（jsdom / Node 环境直接跳过，返回原图 data URL）；结果缓存，避免反复探测 */
let canvasChecked: boolean | null = null;
function canResize(): boolean {
  if (canvasChecked !== null) return canvasChecked;
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    canvasChecked = false;
    return canvasChecked;
  }
  try {
    canvasChecked = Boolean(document.createElement('canvas').getContext?.('2d'));
  } catch {
    canvasChecked = false;
  }
  return canvasChecked;
}

function decode(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = dataUrl;
  });
}

async function resizeDataUrl(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  const img = await decode(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return dataUrl;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  if (scale >= 1 && dataUrl.length < 400_000) return dataUrl; // 本来就小，不必重编码
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/jpeg', quality);
  // 压缩反而更大（极少见）→ 用原图
  return out && out.length < dataUrl.length ? out : dataUrl;
}

/**
 * 一张截图 → data URL（长边压到 1600、JPEG 0.85）。
 * 任何一步做不了（没 canvas / 解码超时 / 非图片）都**退回原图**，绝不因为"压不了"就丢用户的图。
 */
export async function fileToDataUrl(file: Blob, opts: { maxEdge?: number; quality?: number; maxBytes?: number } = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? IMAGE_MAX_BYTES;
  if (file.size > maxBytes)
    throw new AdvisorError('format', `这张截图 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 上限——压缩一下或换张图再传`);
  const raw = await readAsDataUrl(file);
  if (!/^data:image\//.test(raw)) throw new AdvisorError('format', '这不是图片文件（只支持 png / jpg / webp 截图）');
  if (!canResize()) return raw;
  const out = await withTimeout(resizeDataUrl(raw, opts.maxEdge ?? IMAGE_MAX_EDGE, opts.quality ?? IMAGE_QUALITY), 4000);
  return out ?? raw;
}

/** 批量：多张截图 → data URL 数组（顺序保持；单张失败如实抛出，不静默丢） */
export async function filesToDataUrls(files: ArrayLike<Blob>, opts: { maxImages?: number } = {}): Promise<string[]> {
  const maxImages = opts.maxImages ?? MAX_IMAGES;
  const out: string[] = [];
  for (let i = 0; i < files.length; i += 1) {
    if (out.length >= maxImages) break;
    out.push(await fileToDataUrl(files[i]));
  }
  return out;
}

// ─────────────────────────── 返回解析（容错，但不编造） ───────────────────────────

const asText = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

const coerceHero = (v: unknown): RecognizedHero | null => {
  if (typeof v === 'string') return v.trim() ? { name: v.trim(), faction: null, troopType: null } : null;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = asText(o.name ?? o.heroName ?? o.hero);
  if (!name) return null;
  return {
    name,
    faction: asText(o.faction ?? o.camp ?? o.force) || null,
    troopType: asText(o.troopType ?? o.troop ?? o.arm) || null,
  };
};

const coerceSkill = (v: unknown): RecognizedSkill | null => {
  if (typeof v === 'string') return v.trim() ? { name: v.trim(), grade: null } : null;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = asText(o.name ?? o.skillName ?? o.skill);
  if (!name) return null;
  return { name, grade: asText(o.grade ?? o.quality) || null };
};

/** 把 `{heroes,skills,unrecognized}` 规整成干净结构（字符串数组成员也认；上限防御） */
export function normalizeRecognition(v: unknown): RecognitionRaw {
  const o = (v ?? {}) as Record<string, unknown>;
  const heroes = (Array.isArray(o.heroes) ? o.heroes : []).map(coerceHero).filter((x): x is RecognizedHero => Boolean(x));
  const skills = (Array.isArray(o.skills) ? o.skills : []).map(coerceSkill).filter((x): x is RecognizedSkill => Boolean(x));
  const unrecognized = (Array.isArray(o.unrecognized) ? o.unrecognized : [])
    .map((x) => (typeof x === 'string' ? x : asText((x as Record<string, unknown>)?.raw ?? '')))
    .filter(Boolean);
  return { heroes: heroes.slice(0, 400), skills: skills.slice(0, 600), unrecognized: unrecognized.slice(0, 100) };
}

/**
 * 从模型回复里取识别 JSON：先找 ```json 围栏，再退到「第一个 { 到最后一个 }」。
 * 都不是合法 JSON → **抛 format 错**（带着原文前 200 字）——识图结果绝不静默变空。
 */
export function parseBoxReply(text: string): RecognitionRaw {
  const src = String(text ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(src);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(src.slice(first, last + 1));
  if (!fenced && !candidates.length) candidates.push(src);
  for (const c of candidates) {
    const t = c.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as unknown;
      const norm = normalizeRecognition(parsed);
      if (norm.heroes?.length || norm.skills?.length || norm.unrecognized?.length) return norm;
    } catch {
      /* 试下一个 */
    }
  }
  throw new AdvisorError('format', `识图结果不是能认的 JSON（原文前 200 字：${asText(src).slice(0, 200)}）`);
}

// ─────────────────────────── 识图调用（同一条传输层） ───────────────────────────

export interface RecognizeProgress {
  phase: 'start' | 'batch' | 'done';
  done: number;
  total: number;
}

export interface RecognizeOpts {
  /** data URL 数组（`fileToDataUrls` 的产物） */
  images: string[];
  transport: AdvisorTransport;
  signal?: AbortSignal;
  onProgress?: (p: RecognizeProgress) => void;
  /** 每批几张（缺省 6；测试里可以设 1 来多批合并） */
  perRequest?: number;
}

export interface RecognizeResult {
  raw: RecognitionRaw;
  /** 每批的原文（排错用；界面只显示一行摘要） */
  replies: string[];
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** 一次补全：优先 `once()`，没有就用 `chat()` 把文本增量拼起来（测试的假传输两种都支持） */
async function complete(transport: AdvisorTransport, images: string[], signal?: AbortSignal): Promise<string> {
  const messages = [
    { role: 'system' as const, content: VISION_SYSTEM_PROMPT },
    { role: 'user' as const, content: VISION_USER_PROMPT(images.length), images },
  ];
  if (transport.once) return transport.once({ messages, tools: [], temperature: 0 }, signal);
  if (!transport.chat) throw new AdvisorError('format', '这个传输层既不支持 once() 也不支持 chat()，没法识图');
  let text = '';
  for await (const ev of transport.chat({ messages, tools: [] }, signal)) if (ev.type === 'text') text += ev.delta;
  return text;
}

/** 去重合并多批结果（同名只留一条，后出现的字段只补空缺） */
export function mergeRecognitions(list: RecognitionRaw[]): RecognitionRaw {
  const heroes: RecognizedHero[] = [];
  const skills: RecognizedSkill[] = [];
  const unrecognized: string[] = [];
  const heroKey = new Map<string, RecognizedHero>();
  const skillKey = new Set<string>();
  for (const r of list) {
    for (const h of r.heroes ?? []) {
      const k = h.name.replace(/\s+/g, '');
      const hit = heroKey.get(k);
      if (hit) {
        if (!hit.faction && h.faction) hit.faction = h.faction;
        if (!hit.troopType && h.troopType) hit.troopType = h.troopType;
      } else {
        const copy = { ...h };
        heroKey.set(k, copy);
        heroes.push(copy);
      }
    }
    for (const s of r.skills ?? []) {
      const k = s.name.replace(/\s+/g, '');
      if (skillKey.has(k)) continue;
      skillKey.add(k);
      skills.push({ ...s });
    }
    for (const u of r.unrecognized ?? []) if (!unrecognized.includes(u)) unrecognized.push(u);
  }
  return { heroes, skills, unrecognized };
}

/**
 * 识图主入口：多张截图 → 分批请求 → 合并 → 结构化原始清单。
 * **不做库内对齐**（那是 `box.matchRecognition` 的事）；**不写盘**（那是 view.ts 的事）。
 */
export async function recognizeBox(opts: RecognizeOpts): Promise<RecognizeResult> {
  const images = (opts.images ?? []).filter(Boolean);
  if (!images.length) throw new AdvisorError('format', '没有可识别的截图（先选图 / 拖进来 / 直接粘贴）');
  if (images.length > MAX_IMAGES) throw new AdvisorError('format', `一次最多识别 ${MAX_IMAGES} 张截图（收到 ${images.length} 张）`);
  const batches = chunk(images, Math.max(1, opts.perRequest ?? IMAGES_PER_REQUEST));
  const replies: string[] = [];
  const parsed: RecognitionRaw[] = [];
  let done = 0;
  opts.onProgress?.({ phase: 'start', done: 0, total: images.length });
  for (const batch of batches) {
    if (opts.signal?.aborted) {
      const err = new Error('已取消');
      err.name = 'AbortError';
      throw err;
    }
    const text = await complete(opts.transport, batch, opts.signal);
    replies.push(text);
    parsed.push(parseBoxReply(text));
    done += batch.length;
    opts.onProgress?.({ phase: 'batch', done, total: images.length });
  }
  opts.onProgress?.({ phase: 'done', done: images.length, total: images.length });
  return { raw: mergeRecognitions(parsed), replies };
}

// ─────────────────────────── 干跑（没 key / 勾了「干跑」时的链路演示） ───────────────────────────

/** 干跑用的示例回复（**不是真读图**：界面会明确标注，只用来验证"识别 → 对齐 → 入库 → 约束"这条链） */
export const SAMPLE_BOX_REPLY = [
  '（干跑示例：没有真的读图）',
  '```json',
  JSON.stringify(
    {
      heroes: [
        { name: '曹操', faction: '魏', troopType: '骑' },
        { name: '刘备', faction: '蜀', troopType: '步' },
        { name: '吕布', faction: '群', troopType: '弓' },
        { name: '不存在的将', faction: null, troopType: null },
      ],
      skills: [{ name: '大赏三军', grade: 'S' }, { name: '浑水摸鱼', grade: 'A' }],
      unrecognized: ['右下角那个模糊的头像'],
    },
    null,
    1
  ),
  '```',
].join('\n');
