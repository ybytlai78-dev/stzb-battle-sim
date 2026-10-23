/**
 * Web 端数据层：加载导出的武将 JSON + SKILL_REGISTRY，构建可战斗的 General。
 * 与 Node 端 heroes.ts（MySQL）解耦；引擎纯函数（hero-utils）直接复用。
 */
import type { General, HeroRecord, TreasureLoadout } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import { isHeroListed, isLearnableSkillListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { chenshouStatPatch } from '../src/engine/chenshou';
import type { ChenshouLoadout } from '../src/data/chenshouFeatures';
import { asset } from './assets';
import heroesJson from './data/heroes.json';
import portraitsJson from './data/portraits.json';
import heroMetaJson from './data/hero_meta.json';
import skillGradesJson from './data/skill_grades.json';
import skillDescJson from './data/skill_desc.json';

/**
 * 武将 JSON 记录类型。
 *
 * ⚠️ 不要直接用 `(typeof heroesJson)[number]`：JSON 字面量推断对**数据分布**敏感 ——
 * 当数组元素的 `tags` 同时存在 `[]` 与 `["sp"]` 时，TS 可能推断出 `never[] | string[]` 联合，
 * 于是 `hero.tags.includes('sp')` 报 `Argument of type '"sp"' is not assignable to parameter of type 'never'`
 * （2026-09-16 新增 XP姜维 条目即触发，tsc 3 处红）。故把易变字段显式钉死，其余仍走推断。
 */
export type HeroJson = Omit<(typeof heroesJson)[number], 'tags' | 'mutualExclusionGroup'> & {
  tags: string[];
  mutualExclusionGroup: string | null;
};
export { isHeroListed, isLearnableSkillListed };

/** 全量五星（含暂时下架），供主战法集合与内部查找 */
export const ALL_HEROES: HeroJson[] = heroesJson;

/** 上架武将池：主战法已实现且受谋略成长率已确认 */
export const HEROES: HeroJson[] = heroesJson.filter(isHeroListed);

/** 已实现主战法的全部武将（上架 + 下架）：配将池「显示下架武将」开关打开时的池子 */
export const SLOTTED_HEROES: HeroJson[] = heroesJson.filter((h) => Boolean(h.mainSkillId));

/** 下架武将（主战法已实现、成长率未确认 → 默认不进池；开关打开可显示/选配） */
export const OFFLINE_HEROES: HeroJson[] = SLOTTED_HEROES.filter((h) => !isHeroListed(h));

/**
 * 下架原因（口径与 `src/data/listing.ts` 的 `OFFLINE_MAIN_SKILLS` 一致）；未下架返回 undefined。
 * 用于配将池下架卡的角标 tooltip。
 */
export function offlineReason(hero: { mainSkillId: string }): string | undefined {
  return hero.mainSkillId ? OFFLINE_MAIN_SKILLS[hero.mainSkillId] : undefined;
}

/** 主战法 ID 集合（战法背包不展示任何武将主战法，含下架武将的主战法） */
export const MAIN_SKILL_IDS: Set<string> = new Set(
  ALL_HEROES.map((h) => h.mainSkillId).filter((id): id is string => Boolean(id))
);

/** 是否为武将主战法（自带战法，不可作为装配战法出现在背包） */
export function isMainSkill(skillId: string): boolean {
  return MAIN_SKILL_IDS.has(skillId);
}

/** 武将画像清单（scripts/download_portraits.mjs 生成）：heroId → { portrait, avatar } */
export interface PortraitEntry {
  heroId: number;
  officialName: string;
  note: string;
  portrait: string | null;
  avatar: string | null;
}
export const PORTRAITS: Record<string, PortraitEntry> = portraitsJson as Record<string, PortraitEntry>;

/** 武将性别（网易官方数据）：heroId → 男/女 */
export const HERO_META: Record<string, '男' | '女'> = heroMetaJson as Record<string, '男' | '女'>;

/** 战法品级（网易官方战法库）：skillId → S/A/B/C/D */
export const SKILL_GRADES: Record<string, string> = skillGradesJson as Record<string, string>;

/** 战法官方描述（网易战法库）：skillId → { desc(满级), desc1(1级), targetType } */
export interface SkillDescEntry {
  name: string;
  desc: string;
  desc1: string;
  targetType: string;
  quality: string;
}
export const SKILL_DESCS: Record<string, SkillDescEntry> = skillDescJson as Record<string, SkillDescEntry>;

/** 是否为女性武将（女性武将自由属性每 10 级 15 点） */
export function isFemale(heroId: string): boolean {
  return HERO_META[heroId] === '女';
}

/**
 * 自由属性总额。满 10 级才发一档，不到档不加：男每档 10、女每档 15。
 * 41 / 45 / 49 与 40 级相同（男 40、女 60），50 级才进下一档（男 50、女 75）。
 * 红度每星另 +10（满红 +50）。
 */
export function freePointBudget(heroId: string, redness = 0, level = 40): number {
  const per = isFemale(heroId) ? 15 : 10;
  return Math.floor(Math.max(0, level) / 10) * per + Math.max(0, redness) * 10;
}

/** 截图看不到加点时，这些武将的自由属性全部加在这一项上（用户 2026-10-07）。 */
export const DEFAULT_POINT_STAT: Record<string, 'attack' | 'defense' | 'strategy' | 'speed'> = {
  h479: 'attack', // 吕布（群弓）
  taishici: 'attack', // 太史慈
  h494: 'attack', // 祝融夫人
  h29: 'speed', // 张春华
  h685: 'speed', // 乐进
  h27: 'speed', // 张辽
  h15: 'strategy', // 甄洛
  h672: 'strategy', // 曹植
  h23: 'strategy', // 曹操（魏武之世）
  h796: 'defense', // 于禁
};

/** 按 {@link DEFAULT_POINT_STAT} 把整份预算加到一项；不在名单里则四项都是 0。 */
export function defaultFreePoints(
  heroId: string,
  redness = 0,
  level = 40
): { attack: number; defense: number; strategy: number; speed: number } {
  const pts = { attack: 0, defense: 0, strategy: 0, speed: 0 };
  const stat = DEFAULT_POINT_STAT[heroId];
  if (stat) pts[stat] = freePointBudget(heroId, redness, level);
  return pts;
}

/** 武将携带兵力公式：等级×100 + 5000 + 红度×200（40 级白板 = 9000，50 级满红 = 11000） */
export function troopCapacity(level: number, redness = 0): number {
  return Math.max(0, level) * 100 + 5000 + Math.max(0, redness) * 200;
}

/** 星级串：红度 r → r 颗红星 + (5-r) 颗金星（五星底，红星表示红度）。 */
export function rednessStars(r: number): string {
  const red = '★'.repeat(Math.max(0, Math.min(5, r)));
  const gold = '★'.repeat(5 - red.length);
  return `<span class="stars-red">${red}</span><span class="stars-gold">${gold}</span>`;
}

/** 兵种 → 单字（官方卡底部兵种位；无兵种图标素材时用文字） */
export const TROOP_CHAR: Record<string, string> = { cavalry: '骑', infantry: '步', archer: '弓' };

/** 势力 → 势力图标文件名 key（官方卡左上角行书彩字：汉紫 / 魏蓝 / 蜀黄绿 / 吴红 / 群银 / 晋青） */
export const FACTION_CLASS: Record<string, string> = {
  汉: 'han', 魏: 'wei', 蜀: 'shu', 吴: 'wu', 群: 'qun', 晋: 'jin',
};

/** 武将卡框素材（五星卡框 wujiang5：画像铺满 + 左竖带/顶栏半透明遮罩 + 底部等级栏） */
export function cardFrameSrc(): string {
  return asset('/skills/card-frame-5.png');
}

/** 势力图标素材：faction-{han|wei|shu|wu|qun|jin}.png（未知势力返回空串） */
export function factionIconSrc(faction: string): string {
  const key = FACTION_CLASS[faction];
  return key ? asset(`/skills/faction-${key}.png`) : '';
}

/** 战法官方描述（满级效果），无则返回空串 */
export function skillDesc(skillId: string): string {
  return SKILL_DESCS[skillId]?.desc ?? '';
}

/** 战法品级（S=粉 / A=蓝 / B/C/D=灰绿，率土原版配色；baijia=百家词条） */
export function skillGrade(skillId: string): string {
  return SKILL_GRADES[skillId] ?? (skillId.startsWith('bj_') ? 'baijia' : 'B');
}

/** 品级显示文本：内部值 baijia → 中文「百家」 */
export function gradeLabel(grade: string): string {
  return grade.toLowerCase() === 'baijia' ? '百家' : grade;
}

/** 战法类型 → 类型图标文件名（直写类型名，不再用序号下标猜映射） */
const SKILL_TYPE_ICON: Record<string, string> = {
  command: 'skill-type-command.png',
  active: 'skill-type-active.png',
  passive: 'skill-type-passive.png',
  pursuit: 'skill-type-pursuit.png',
};

/** 战法类型图标（官方剪影）：指挥 / 主动 / 被动 / 追击 */
export function skillTypeIcon(skillId: string): string {
  const t = SKILL_REGISTRY[skillId]?.type ?? 'active';
  return asset(`/skills/${SKILL_TYPE_ICON[t] ?? SKILL_TYPE_ICON.active}`);
}

/** 品级圆环（外框）：grade-ring-{s|a|b|c|d}.png
 *  官方素材 S001/A001/B001/CD001 —— C 与 D 共用 CD001（同图，两个文件名各自独立） */
export function gradeFrame(grade: string): string {
  const g = grade.toLowerCase();
  return asset(g === 'baijia' ? '/skills/grade-ring-baijia.svg' : `/skills/grade-ring-${g}.png`);
}

/** 品级字母角标：grade-badge-{s|a|b|c|d}.png；百家用自绘红底“百”角标 */
export function gradeRibbon(grade: string): string {
  const g = grade.toLowerCase();
  return asset(g === 'baijia' ? '/skills/grade-badge-baijia.svg' : `/skills/grade-badge-${g}.png`);
}

/** 战法名背景框（官方色板素材）：S/A/B 三档 + 百家；C/D 无素材 → 空串，由 CSS 兜底半透明芯片 */
export function gradePlate(grade: string): string {
  const g = grade.toLowerCase();
  if (g === 'baijia') return asset('/skills/grade-plate-baijia.svg');
  return g === 's' || g === 'a' || g === 'b' ? asset(`/skills/grade-plate-${g}.png`) : '';
}

/** 任意等级基础面板（不含加点/红度）：属性 = 初始 + (L-1)×成长（四舍五入） */
export function baseStatsAt(rec: HeroRecord, level = 40): { attack: number; defense: number; strategy: number; speed: number } {
  return {
    attack: Math.round(rec.baseAttack + (level - 1) * rec.growthAttack),
    defense: Math.round(rec.baseDefense + (level - 1) * rec.growthDefense),
    strategy: Math.round(rec.baseStrategy + (level - 1) * rec.growthStrategy),
    speed: Math.round(rec.baseSpeed + (level - 1) * rec.growthSpeed),
  };
}

/**
 * 应用「陈寿·出师·持重」的统率 / 属性 / 成长率提升（包内表，见 `src/data/chenshouCost.ts`）。
 *
 * 返回**新对象**（不改原档案）；未使用持重、或引擎未收录该武将 → 原样返回。
 * 口径：统率取表内绝对值；攻击 / 防御 / 谋略 的 base 与 growth 各加一份增量（速度、攻城恒不变）。
 * 成长率保留 2 位小数（避免 0.82+0.12=0.9400000000000001 这类浮点噪声）。
 */
export function applyChenshouCost<T extends HeroRecord>(rec: T, chenshou?: ChenshouLoadout | null): T {
  const patch = chenshouStatPatch(rec.id, chenshou);
  if (!patch) return rec;
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  return {
    ...rec,
    cost: patch.cost,
    baseAttack: rec.baseAttack + patch.base[0],
    baseDefense: rec.baseDefense + patch.base[1],
    baseStrategy: rec.baseStrategy + patch.base[2],
    baseSpeed: rec.baseSpeed + patch.base[3],
    growthAttack: r2(rec.growthAttack + patch.grow[0]),
    growthDefense: r2(rec.growthDefense + patch.grow[1]),
    growthStrategy: r2(rec.growthStrategy + patch.grow[2]),
    growthSpeed: r2(rec.growthSpeed + patch.grow[3]),
  };
}

/** 40 级基础面板（不含加点/红度） */
export function base40Stats(rec: HeroRecord): { attack: number; defense: number; strategy: number; speed: number } {
  return baseStatsAt(rec, 40);
}

/** 伤害测试实验室侍卫（id 形如 guard-0）走官方汉·侍卫卡面 */
const GUARD_PORTRAIT = asset('/portraits/guard.jpg');
const GUARD_AVATAR = asset('/portraits/guard_s.jpg');

/**
 * 是否为实验室侍卫单位（buildGuardTeam 生成的 guard-0/1/2）。
 * @param heroId 单位 id
 */
function isGuardId(heroId: string): boolean {
  return heroId.startsWith('guard-');
}

/** 头像 src：优先官方 98×98 头图，缺失时回退到画像（CSS 圆形裁切） */
export function avatarSrc(heroId: string): string {
  if (isGuardId(heroId)) return GUARD_AVATAR;
  const p = PORTRAITS[heroId];
  return asset(p?.avatar ?? p?.portrait ?? '');
}

/** 画像 src（竖版卡面） */
export function portraitSrc(heroId: string): string {
  if (isGuardId(heroId)) return GUARD_PORTRAIT;
  return asset(PORTRAITS[heroId]?.portrait ?? '');
}

/**
 * id → HeroRecord（字段名与 DB 导出一致，已为 camelCase）。
 * 覆盖**全部已挂主战法的武将**（含下架）——「显示下架武将」开关打开后，下架武将也要能配将上阵。
 */
export const HERO_RECORDS: Record<string, HeroRecord> = {};
for (const h of SLOTTED_HEROES) {
  HERO_RECORDS[h.id] = h as unknown as HeroRecord;
}

/** id → 武将（含下架：战报/槽位卡渲染要用到全部武将的姓名与画像） */
export function getHeroById(id: string): HeroJson | undefined {
  return ALL_HEROES.find((h) => h.id === id);
}

/**
 * 展示用武将 id：红蓝两队上阵同一武将时，引擎会把第二份单位 id 改写为 `原id#2`
 * 并保留 `heroId`（见 `ensureUniqueUnitIds`）——展示层一律用本函数取真实武将 id。
 */
export function heroIdOf(g: General): string {
  return g.heroId ?? g.id;
}

/** 战法类型中文名 */
export const SKILL_TYPE_NAME: Record<string, string> = {
  passive: '被动',
  command: '指挥',
  active: '主动',
  pursuit: '追击',
};

/** 战法判定顺序：被动(1) > 指挥(2) > 主动(3) > 追击(4) */
export const SKILL_TYPE_ORDER: Record<string, number> = {
  passive: 1,
  command: 2,
  active: 3,
  pursuit: 4,
};

/** 按武将槽位把战法 id 挂入对应类型槽位（主战法已在 recordToGeneral 中挂第一位，装配战法追加在后）。
 *  百家战法（bj_*）在 `skills.ts` 里已由 `...BAIJIA_SKILLS` 并入 SKILL_REGISTRY，与普通战法同池，无需另查表。 */
export function attachSkills(g: General, skillIds: string[]): General {
  const out = { ...g, activeSkillIds: [...g.activeSkillIds], passiveSkillIds: [...g.passiveSkillIds], commandSkillIds: [...g.commandSkillIds], pursuitSkillIds: [...g.pursuitSkillIds] };
  for (const id of skillIds) {
    const s = SKILL_REGISTRY[id];
    if (!s) continue;
    switch (s.type) {
      case 'active': out.activeSkillIds.push(id); break;
      case 'passive': out.passiveSkillIds.push(id); break;
      case 'command': out.commandSkillIds.push(id); break;
      case 'pursuit': out.pursuitSkillIds.push(id); break;
    }
  }
  return out;
}

/** 构建可战斗武将：主战法 + 装配战法，自由加点，按等级/红度公式自动计算携带兵力，指定站位与士气。
 *  兵力不可手动调整：携带兵力 = 等级×100 + 5000 + 红度×200（40 级白板 9000 / 50 级满红 11000）。
 *  红度不再直接加成属性：每红 +10 自由属性点（由用户在详情页分配，freePoints 已含分配结果）。 */
export function buildGeneral(
  heroId: string,
  extraSkillIds: string[],
  freePoints: { attack?: number; defense?: number; strategy?: number; speed?: number },
  position: General['position'] = '前锋',
  redness = 0,
  level = 40,
  morale = 120,
  /** 二级兵种转换（可选）：见 docs/兵种转换调研.md */
  secondaryTroop?: General['secondaryTroop'],
  /** 已学兵系通用特性（0~2 个） */
  secondaryTraits?: General['secondaryTraits'],
  /** 佩戴的宝物（缺省不佩戴）；由武将详情「宝物」区写入 */
  treasure?: TreasureLoadout | null,
  /** 陈寿特性（缺省未使用）；由武将详情「陈寿特性」区写入，见 `src/data/chenshouFeatures.ts` */
  chenshou?: General['chenshou']
): General {
  const rec = HERO_RECORDS[heroId];
  if (!rec) throw new Error(`武将不存在：${heroId}`);
  const lv = Math.max(40, Math.min(50, Math.round(level) || 40));
  const red = Math.max(0, Math.min(5, Math.round(redness) || 0));
  const troops = troopCapacity(lv, red);
  // 【陈寿·出师·持重】统率 / 属性 / 成长率提升（包内表）：先对档案副本打补丁，再按常规链路算面板
  const rec2 = applyChenshouCost(rec, chenshou);
  const g1 = recordToGeneral(rec2); // level-1，主战法挂槽
  const leveled = leveledFromRecord(g1, rec2, lv, freePoints, troops);
  const placed = { ...leveled, position, morale, level: lv, redness: red, secondaryTroop, secondaryTraits, ...(treasure ? { treasure } : {}), ...(chenshou ? { chenshou } : {}) };
  return attachSkills(placed, extraSkillIds);
}
