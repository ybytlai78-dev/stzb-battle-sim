/**
 * Web 端数据层：加载导出的武将 JSON + SKILL_REGISTRY，构建可战斗的 General。
 * 与 Node 端 heroes.ts（MySQL）解耦；引擎纯函数（hero-utils）直接复用。
 */
import type { General, HeroRecord } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import { isHeroListed, isLearnableSkillListed } from '../src/data/listing';
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

/** 自由属性总额：男性每 10 级 10 点、女性每 10 级 15 点（40 级 = 40/60）+ 红度 ×10（每红多 10 点，满红 +50） */
export function freePointBudget(heroId: string, redness = 0, level = 40): number {
  return Math.round((isFemale(heroId) ? 1.5 : 1) * level) + Math.max(0, redness) * 10;
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

/** 势力 → 势力字配色类（官方卡左上角势力字：魏蓝 / 蜀绿 / 吴红 / 群紫 / 汉金 / 晋黄绿） */
export const FACTION_CLASS: Record<string, string> = {
  汉: 'han', 魏: 'wei', 蜀: 'shu', 吴: 'wu', 群: 'qun', 晋: 'jin',
};

/** 武将卡框素材（五星卡框 wujiang5：画像铺满 + 左竖带/顶栏半透明遮罩 + 底部等级栏） */
export function cardFrameSrc(): string {
  return asset('/skills/card-frame-5.png');
}

/** 战法官方描述（满级效果），无则返回空串 */
export function skillDesc(skillId: string): string {
  return SKILL_DESCS[skillId]?.desc ?? '';
}

/** 战法品级（S=粉 / A=蓝 / B/C/D=灰绿，率土原版配色） */
export function skillGrade(skillId: string): string {
  return SKILL_GRADES[skillId] ?? 'B';
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
  return asset(`/skills/grade-ring-${grade.toLowerCase()}.png`);
}

/** 品级字母角标：grade-badge-{s|a|b|c|d}.png */
export function gradeRibbon(grade: string): string {
  return asset(`/skills/grade-badge-${grade.toLowerCase()}.png`);
}

/** 战法名背景框（官方色板素材）：目前只有 S/A/B 三档；C/D 无素材 → 返回空串，由 CSS 兜底半透明芯片 */
export function gradePlate(grade: string): string {
  const g = grade.toLowerCase();
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

/** id → HeroRecord（字段名与 DB 导出一致，已为 camelCase） */
export const HERO_RECORDS: Record<string, HeroRecord> = {};
for (const h of HEROES) {
  HERO_RECORDS[h.id] = h as unknown as HeroRecord;
}

export function getHeroById(id: string): HeroJson | undefined {
  return HEROES.find((h) => h.id === id);
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

/** 按武将槽位把战法 id 挂入对应类型槽位（主战法已在 recordToGeneral 中挂第一位，装配战法追加在后） */
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
  morale = 120
): General {
  const rec = HERO_RECORDS[heroId];
  if (!rec) throw new Error(`武将不存在：${heroId}`);
  const lv = Math.max(40, Math.min(50, Math.round(level) || 40));
  const red = Math.max(0, Math.min(5, Math.round(redness) || 0));
  const troops = troopCapacity(lv, red);
  const g1 = recordToGeneral(rec); // level-1，主战法挂槽
  const leveled = leveledFromRecord(g1, rec, lv, freePoints, troops);
  const placed = { ...leveled, position, morale, level: lv, redness: red };
  return attachSkills(placed, extraSkillIds);
}
