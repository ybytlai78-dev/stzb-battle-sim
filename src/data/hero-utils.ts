/**
 * 武将纯函数工具（无任何 Node/MySQL 依赖，浏览器可直接打包）
 * 与 heroes.ts（MySQL 加载器）解耦：引擎/Web 端只依赖本文件。
 */
import type { General, HeroRecord, TroopType } from '../engine/types';
import { SKILL_REGISTRY } from './skills';

/** 自由加点（每 10 级 10 点，40 级共 40 点） */
export type StatPatch = Partial<Pick<General, 'attack' | 'defense' | 'strategy' | 'speed'>>;

/** 主战法 ID → 所属槽位（依据 SKILL_REGISTRY 中的战法类型） */
export function mainSkillSlot(
  mainSkillId: string
): keyof Pick<General, 'activeSkillIds' | 'passiveSkillIds' | 'commandSkillIds' | 'pursuitSkillIds'> | null {
  const skill = SKILL_REGISTRY[mainSkillId];
  if (!skill) return null;
  switch (skill.type) {
    case 'active': return 'activeSkillIds';
    case 'passive': return 'passiveSkillIds';
    case 'command': return 'commandSkillIds';
    case 'pursuit': return 'pursuitSkillIds';
  }
}

/** HeroRecord → level-1 General（base 属性；主战法挂入对应槽位） */
export function recordToGeneral(rec: HeroRecord): General {
  const slot = mainSkillSlot(rec.mainSkillId);
  const g: General = {
    id: rec.id,
    name: rec.name,
    rarity: rec.rarity,
    cost: rec.cost,
    faction: rec.faction,
    gender: rec.gender,
    tags: [...rec.tags],
    mutualExclusionGroup: rec.mutualExclusionGroup,
    troopType: rec.troopType,
    position: '前锋',
    attack: rec.baseAttack,
    defense: rec.baseDefense,
    strategy: rec.baseStrategy,
    speed: rec.baseSpeed,
    attackRange: rec.attackRange,
    maxTroops: 10000,
    mainSkillName: rec.mainSkillName,
    mainSkillId: rec.mainSkillId,
    skillDesc: rec.skillDesc,
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
  if (slot) g[slot].push(rec.mainSkillId);
  return g;
}

/** 纯函数版任意等级面板：属性 = 初始 + (L-1)×成长（四舍五入）+ 自由加点 */
export function leveledFromRecord(g: General, rec: HeroRecord, level: number, free: StatPatch = {}, troops = 9000): General {
  const stat = (key: 'attack' | 'defense' | 'strategy' | 'speed') => {
    const growthKey = ({ attack: 'growthAttack', defense: 'growthDefense', strategy: 'growthStrategy', speed: 'growthSpeed' } as const)[key];
    return Math.round(g[key] + (level - 1) * rec[growthKey]) + (free[key] ?? 0);
  };
  return {
    ...g,
    maxTroops: troops,
    attack: stat('attack'),
    defense: stat('defense'),
    strategy: stat('strategy'),
    speed: stat('speed'),
  };
}

/** 纯函数版 40 级面板（leveledFromRecord 的 level=40 特例，保持既有调用方不变） */
export function level40FromRecord(g: General, rec: HeroRecord, free: StatPatch = {}, troops = 9000): General {
  return leveledFromRecord(g, rec, 40, free, troops);
}

/** 浅拷贝武将并覆盖指定槽位（供装配战法） */
export function withSkills(
  g: General,
  patch: Partial<Pick<General, 'activeSkillIds' | 'passiveSkillIds' | 'commandSkillIds' | 'pursuitSkillIds'>>
): General {
  return { ...g, ...patch };
}

/**
 * 同队互斥校验：同 mutualExclusionGroup 的武将不可同队（SP 与普通重名武将）。
 * 返回错误信息；队伍合法返回 null。
 */
export function validateMutualExclusion(team: General[]): string | null {
  const seen = new Map<string, string>(); // group -> 先出现武将名
  for (const g of team) {
    if (!g.mutualExclusionGroup) continue;
    const existing = seen.get(g.mutualExclusionGroup);
    if (existing) {
      return `互斥冲突：「${existing}」与「${g.name}」不能在同一队伍`;
    }
    seen.set(g.mutualExclusionGroup, g.name);
  }
  return null;
}

/** 武将面板 40 级成长计算（供 web/测试展示用） */
export function growthStat(base: number, growth: number, level = 40, free = 0): number {
  return Math.round(base + (level - 1) * growth) + free;
}

export type { TroopType };
