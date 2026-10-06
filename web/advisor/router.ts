/**
 * AI 配将顾问 · 工具面分档（「思考模式」路由 · 结构机制移植，见设计文档 §16）
 * ---------------------------------------------------------------------------
 * 来源：DSH 预设 `router-standard` v1.20.0 的**结构机制**（首轮锚定 / 阶段化工具面 /
 * 二级目录 / 代码侧推进），不是它的 persona 分带（那套实测只对 V4 Pro/Flash 官方端点成立）。
 *
 * 本模块只干三件事，且**全是纯函数**（零依赖、零副作用、可单测）：
 *   ① 决定**本轮**开放哪些档（`classifyTiers` 看用户消息、`tiersAfterCalls` 看真实工具调用）；
 *   ② 把档位翻译成**线上工具面**（`toolNamesFor` / `filterToolSpecs` / `isUnlocked`）；
 *   ③ 渲染二级目录（`renderCatalog` / `renderHelp`）——**与线上工具面同源**，杜绝双份漂移。
 *
 * 为什么分档（本仓库自己的实测与翻车记录，见 §16.1）：
 *   · 顾问现在每轮无条件全量发 19 个工具（14,868 字符 = 系统提示词的 5.57 倍）；
 *   · 默认档里同时摆着 `skill_detail`（188 字符）与 `optimize_winrate`（1,740 字符），
 *     模型选了便宜的那个 —— 于是退化成「人肉搜索器」（§3 实跑记录）。
 *   起作用的是**可调用的 schema 面（action space）**，不是提示词里的文字（套件 P 系列实测）。
 *
 * ⚠️ 分档只收窄**菜单**，不假装是权限：被拒的调用由 `loop.ts` 如实回灌并指向 `route_task`。
 */
import { GUIDE_TAG } from './memory';
import type { AdvisorTier } from './types';

/** 档 → 本档**独有**工具（单一真源：`toolNamesFor` / `isUnlocked` / 目录渲染都从它派生）。
 *  `base` 是默认档，刻意给足（查档案 + 单次/少量真跑 + 校验）——**欠配比超配危险**：
 *  缺了 `simulate`，"这队为什么弱"这类诊断问题会在工具面上直接卡死（实现期发现的坑，
 *  见 §16.3 的 as-built 说明）。真正收窄的是**大搜索**与**写回**两档。 */
export const TIER_TOOLS: Record<AdvisorTier, string[]> = {
  base: [
    'get_config',
    'get_my_box',
    'validate_plan',
    'search_hero',
    'hero_detail',
    'search_skill',
    'list_skills',
    'skill_detail',
    'list_opponent_pool',
    'simulate',
    'simulate_many',
    'compare_variants',
    'matchup_pool',
  ],
  search: ['optimize_winrate', 'optimize_skills', 'optimize_mates', 'optimize_both'],
  write: ['add_opponent_from_preset', 'remove_user_opponent'],
};

/** 常驻层（任何档都可调）：二级目录 + 逃生门。与 `router-standard` 的 META_TOOLS 同构。 */
export const META_TOOLS: readonly string[] = ['tools_catalog', 'tools_help', 'route_task'];

/** 全部档（顺序 = 并集优先级；`ALL_TIERS` 也是"没启用分档"时的兜底 = 全量开放）。 */
export const ALL_TIERS: AdvisorTier[] = ['base', 'search', 'write'];

/** 逃生门工具名（`loop.ts` 靠它识别"模型主动申请开档"）。 */
export const ROUTE_TOOL = 'route_task';

/** 可以被 `route_task` 申请的档（`base` 永远在；锚定档留给 S3）。 */
export const PROMOTABLE: readonly AdvisorTier[] = ['search', 'write'];

export const TIER_LABEL: Record<AdvisorTier, string> = {
  base: '基础（查档案 / 测算 / 校验）',
  search: '大搜索（optimize_*）',
  write: '写回（改对手池）',
};

/** 档的**短标签**（生产页轨迹行那种一行位置用，别塞长句） */
export const TIER_SHORT: Record<AdvisorTier, string> = {
  base: '基础',
  search: '大搜索',
  write: '写回',
};

/**
 * 一句话档位徽标（生产页轨迹行用它）：`档位 基础 · 16 个工具`。
 * 用户 2026-10-06 要求把「模型这一轮实际拿到多大工具面」暴露到生产页——它是分档/锚定/自检
 * 三个机制的**唯一可见处**（实验页有完整路由面板，生产页只留这一行）。
 */
export function routeBadge(
  route: { tiers: AdvisorTier[]; toolNames: string[]; anchor?: boolean },
  selfCorrect?: string[]
): string {
  const parts = [`档位 ${route.tiers.map((t) => TIER_SHORT[t]).join('+')}`, `${route.toolNames.length} 个工具`];
  if (route.anchor) parts.push('首轮锚定');
  let out = parts.join(' · ');
  if (selfCorrect?.length) out += ` · 自检补引用 ${selfCorrect.length} 个`;
  return out;
}

/** 档 → 一句"什么时候要它"（给目录与拒绝文案用）。 */
export const TIER_HINT: Record<AdvisorTier, string> = {
  base: '查配置 / 查档案 / 单次或少量真跑 / 校验方案',
  search: '用户要"最强 / 怎么配 / 搜一遍 / 伤害期望"这类需要真跑大批量的问题',
  write: '要加入或移出对手池（改动要用户确认）',
};

/** 用户消息里出现这些词 → 开放大搜索档（"人肉搜索器"正是发生在这类问题上）。 */
const SEARCH_HINTS = [
  '最强', '最好', '最优', '最高', '最厉害', '输出最大', '伤害最高',
  '怎么配', '帮我配', '帮我搭', '配将', '配队', '搭配', '组队', '优化',
  '搜', '期望',
];

/** 出现这些词 → 开放写回档（改对手池要用户确认，所以只在话里提到时才开）。 */
const WRITE_HINTS = [
  '对手池', '加个对手', '加入对手', '加进对手', '增加对手', '添加对手',
  '移出', '移除', '删掉', '删除', '去掉',
];

const hasAny = (text: string, hints: string[]): boolean => hints.some((h) => text.includes(h));

/**
 * 本轮起始档：`base` 永远在；命中关键词才并上 `search` / `write`。
 * 关键词刻意**宽松**（多开一档只是多花 token，少开一档会让模型撞墙）——
 * 收窄阈值由 S4 的真模型记分卡决定，不靠拍脑袋。
 */
export function classifyTiers(userText: string): AdvisorTier[] {
  // ⚠️ 「配将区」是界面区域名（"我现在配将区里是哪三个人"只是读配置），不代表想搜最强配置——
  //    先抹掉它再匹配，否则读配置的提问会白白多带 6.5k 字符的 optimize_* 工具面。
  const t = String(userText ?? '').replace(/配将区/g, '');
  const tiers: AdvisorTier[] = ['base'];
  if (hasAny(t, SEARCH_HINTS)) tiers.push('search');
  if (hasAny(t, WRITE_HINTS)) tiers.push('write');
  return tiers;
}

/** 工具名 → 它属于哪一档（meta 工具与未知名字返回 null）。 */
export function tierOf(name: string): AdvisorTier | null {
  const tiers = Object.keys(TIER_TOOLS) as AdvisorTier[];
  for (const tier of tiers) if (TIER_TOOLS[tier].includes(name)) return tier;
  return null;
}

/** 档位并集 → 线上工具名（本档工具按注册顺序无关的固定序 + 常驻层）。 */
export function toolNamesFor(tiers: AdvisorTier[]): string[] {
  const out: string[] = [];
  for (const tier of Object.keys(TIER_TOOLS) as AdvisorTier[]) {
    if (!tiers.includes(tier)) continue;
    for (const name of TIER_TOOLS[tier]) if (!out.includes(name)) out.push(name);
  }
  for (const name of META_TOOLS) if (!out.includes(name)) out.push(name);
  return out;
}

/** 本轮能不能调（常驻层永远可以）。 */
export function isUnlocked(name: string, tiers: AdvisorTier[]): boolean {
  if (META_TOOLS.includes(name)) return true;
  const tier = tierOf(name);
  return tier !== null && tiers.includes(tier);
}

// ─────────────────────────── 首轮锚定（S3，见设计文档 §16.3） ───────────────────────────

/**
 * 首轮锚定：**会话还没有任何成功工具调用时**，第一次请求只发这一个业务工具（+ 常驻层）。
 *
 * 依据（套件 V4 Pro 实测）：**首轮请求结构决定整条会话的策略轨迹**——窄工具面开局
 * （minimal 2 工具 99/96）比一上来摊开 25 个工具（91）好，且"先窄后宽"能力不损。
 * 顾问的"第一步"就是它的第一条硬规则：**先 get_config 看清当前配置，别凭记忆猜**。
 *
 * 与套件的差别（有意）：那边首轮只留一个"开始"用的小工具；顾问多留 3 个常驻层——
 * 它们合计 889 字符，却能让模型在首轮就能查目录 / 请求开档，不至于撞墙无路可走。
 */
export const ANCHOR_TOOL = 'get_config';

/** 锚定轮的工具面（业务工具 1 个 + 常驻层）。 */
export function anchorToolNames(): string[] {
  return [ANCHOR_TOOL, ...META_TOOLS];
}

/** **线上工具面**（唯一出口）：锚定轮只发锚定面，否则按档并集。 */
export function wireToolNames(tiers: AdvisorTier[], anchor = false): string[] {
  return anchor ? anchorToolNames() : toolNamesFor(tiers);
}

/** **线上可调判定**（与 `wireToolNames` 同源）：锚定轮里没进锚定面的，调了会被拒。 */
export function wireUnlocked(name: string, tiers: AdvisorTier[], anchor = false): boolean {
  return isUnlocked(name, tiers) && (!anchor || anchorToolNames().includes(name));
}

/** 代码侧推进：本轮**真实执行过**的工具 → 它的档位并进会话档位（不问模型"你在哪个阶段"）。 */
export function tiersAfterCalls(tiers: AdvisorTier[], calledNames: string[]): AdvisorTier[] {
  const out = [...tiers];
  for (const name of calledNames) {
    const tier = tierOf(name);
    if (tier && !out.includes(tier)) out.push(tier);
  }
  return out;
}

/** 按名字裁剪工具面（**保持注册顺序**：线上 payload 的顺序稳定才好比缓存）。 */
export function filterToolSpecs<T extends { name: string }>(all: T[], names: string[]): T[] {
  return all.filter((t) => names.includes(t.name));
}

/**
 * 线上工具面字符数——**面板与测试共用这一个口径**：把 `tools` 那段按线上 payload 形状
 * （`{type,function:{name,description,parameters}}`）序列化后量长度。分档省了多少，就看它。
 */
export function toolSurfaceChars(all: ToolLike[], names: string[]): number {
  return JSON.stringify(
    filterToolSpecs(all, names).map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema },
    }))
  ).length;
}

// ─────────────────────────── 二级目录（与线上工具面同源） ───────────────────────────

export interface ToolLike {
  name: string;
  description: string;
  schema: unknown;
}

/** 参数名（给目录一行显示，省得模型为了看参数去查 help）。 */
export function paramNames(schema: unknown): string[] {
  const props = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  return props && typeof props === 'object' ? Object.keys(props) : [];
}

/** 一级索引：**只列本轮开放的**工具 + 未开放档位的一句话（不点名未开放的工具）。 */
export function renderCatalog(all: ToolLike[], tiers: AdvisorTier[], anchor = false): string {
  const openNames = wireToolNames(tiers, anchor);
  const open = filterToolSpecs(all, openNames);
  const lines = open.map((t) => {
    const params = paramNames(t.schema);
    const head = params.length ? `${t.name}(${params.join(', ')})` : `${t.name}()`;
    return `- ${head}：${t.description.split('\n')[0]}`;
  });
  const head = anchor
    ? `本轮工具面：${open.length} 个（**首轮锚定**：会话第一个请求只开 ${ANCHOR_TOOL}；任何一个工具调用成功后立刻放开）。`
    : `本轮工具面：${open.length} 个（档：${tiers.join(' + ')}）。`;
  const locked = (Object.keys(TIER_TOOLS) as AdvisorTier[]).filter((t) => !tiers.includes(t));
  const lockedLine =
    anchor || locked.length
      ? `未开放的档：${locked.map((t) => `${t}（${TIER_HINT[t]}）`).join('；')}${anchor ? `；锚定档会自己放开（先调一次工具）` : ''}。确实需要就跑 ${ROUTE_TOOL}(tier, why) 说明理由。`
      : '所有档都已开放。';
  return [head, ...lines, lockedLine].join('\n');
}

/** 二级索引：单个工具的完整说明 + 参数 + **当前是否开放**（查得到、但没开放就调不动）。 */
export function renderHelp(all: ToolLike[], tiers: AdvisorTier[], name: string, anchor = false): string {
  const t = all.find((x) => x.name === name);
  if (!t) return `没有叫「${name}」的工具；用 tools_catalog 看本轮开放了哪些。`;
  const open = wireUnlocked(name, tiers, anchor);
  const tier = tierOf(name);
  const where = tier ? `所属档：${tier}（${TIER_LABEL[tier]}）` : '常驻工具（任何档都可调）';
  const state = open
    ? '当前**开放**，可以直接调。'
    : anchor
      ? `当前**未开放**：这是本次会话的第一个请求（**首轮锚定**，只开 ${ANCHOR_TOOL}）——先调一次工具就会放开。`
      : `当前**未开放**：要调它，先跑 ${ROUTE_TOOL}(${JSON.stringify(tier)}, why) 说明理由。`;
  return [
    `${t.name}(${paramNames(t.schema).join(', ')})`,
    where,
    state,
    `说明：${t.description}`,
    `参数 schema：${JSON.stringify(t.schema)}`,
  ].join('\n');
}

// ─────────────────────────── 近距离引导（S2，见设计文档 §16.5） ───────────────────────────

/**
 * 本轮**近距离引导**：贴在本轮提问**之后**（同一个请求、缓存中性）。
 *
 * 为什么不在系统提示词里说：套件 P13/P14/P16/P20 实测——**同一条指令放 system（远距离）
 * 会衰减甚至反向，放在用户消息之后（近距离）零衰减**。所以这里只重复"这一问必须做到"的
 * 那几条，不搬第二份系统提示词（长了反而稀释）。
 *
 * 短、按档变化、纯函数（可单测）：`loop.ts` 只负责把它摆到用户消息后面。
 * 标签定义在 `memory.ts`（注入标签的唯一住处，`stripInjected` 按它剥离）。
 */
export function renderTurnGuide(tiers: AdvisorTier[], _userText = '', opts: { anchor?: boolean } = {}): string {
  const lines: string[] = [`<${GUIDE_TAG}>`, `【本轮路由】档位：${tiers.join(' + ')}（当轮工具面见 tools_catalog）。`];
  if (opts.anchor) {
    lines.push(
      `**首轮锚定**：这是本次会话的第一个请求，只开了 ${ANCHOR_TOOL}（+ 三个常驻工具）。` +
        `先调 ${ANCHOR_TOOL} 看清当前配置——**任何一个工具调用成功后，默认档立刻放开**（缺什么也可以直接 route_task）。`
    );
  }
  if (tiers.includes('search')) {
    lines.push(
      '这一问要**真跑搜索**：list_opponent_pool 看当前池（用户没说改池子就不要问加减）。' +
        '点名了核心就 optimize_winrate 传 coreUnit，一次跑完「队友 → 队友战法 → 核心战法」。阵营只认卡（群吕布≠汉吕布），不要为凑同阵营三人去筛队友。只补战法槽才用 matchSlotKeys。' +
        '分对手胜率用返回里的分对手，不要再开一轮 matchup_pool。不要逐个 skill_detail 翻战法。'
    );
  } else if (tiers.includes('write')) {
    lines.push('这一问要动**对手池**：加入 / 移出会弹确认，等用户点了再继续；固定测试集删不掉。');
  } else {
    lines.push(
      '这一问按**默认档**走：查配置 / 查档案 / 单次或少量试跑 / 前后对比 / 校验方案都在手上。' +
        '确实需要跑大批量搜索（最强、怎么配、搜一遍、伤害期望）就调 route_task 开 search 档，别硬凑。'
    );
  }
  lines.push(
    '数字只来自工具返回且要带 evidenceId —— **表格里的数字也要能对上引用**' +
      '（同一个数值带过一次就行，但不能一次都不带；例：`| 1 | 某搭配 | 106206[[ev-8-optimize_skills]] |`）；' +
      '没跑过就说没跑过。**两条边界必须当场说**：查到的将若**已下架**，说「已下架 / 数值仅供看方向」；' +
      '**控制 / 防御型队友的价值在木桩口径下量不出来**，要把这句话说白。提方案前先 validate_plan，正文里放围栏 json 出口。'
  );
  lines.push(`</${GUIDE_TAG}>`);
  return lines.join('\n');
}
