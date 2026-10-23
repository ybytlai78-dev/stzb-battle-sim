/**
 * 百家武将 · 词条战法（21 条）。
 *
 * 口径（用户 2026-10-20）：
 * - 只做“词条 = 普通战法”，不做副将装配；全部进通用战法背包，可装到普通战法槽。
 * - 一个词条 = 游戏内同名的一组子战法合并成 1 个 Skill；战法名沿用武将主战法名（如张恭 = 西陲立功），
 *   具体词条名（靖边/挫锐…）放 BAIJIA_SKILL_META.setName，由 UI 渲染为红色标签。
 * - 类型/距离/发动率取主战法口径：
 *   朱士行/陶渊明 = 指挥 100%，张恭 = 主动 40%（靖边 50%），麦子 = 被动 100%，九色鹿 = 主动 40%。
 * - 数值来自 tb_cfg_skill_detail（效果 = f13 + f12×属性/200），按全红/属性 80 录入；
 *   哨兵槽（f2=999999）和攻城（105）不进战斗（汪只保留占位）。
 */
import type {
  CommandSkill,
  EffectTag,
  PassiveSkill,
  SimpleActiveSkill,
  Skill,
  SkillOutput,
  TroopType,
} from '../engine/types';
import { HUGE_MODIFIER_RATE } from '../engine/formulas';

/** 百分点效果：rate 为小数，growthRate 为每点属性的百分点（减伤/增减伤口径）。 */
function pct(f12: number, f13: number): { rate: number; growthRate: number } {
  return { rate: (f13 + 0.4 * f12) / 100, growthRate: f12 / 200 };
}

/** 恢复率：rate 为百分点。 */
function healOf(f12: number, f13: number): { rate: number; growthRate: number } {
  return { rate: f13 + 0.4 * f12, growthRate: f12 / 200 };
}

/** 属性下降点数。槽位按百分之一点存储（缓师 f13=2000 → 20 点）。 */
function attrDown(f12: number, f13: number): { amount: number; growthRate: number } {
  return { amount: -((f13 + 0.4 * f12) / 100), growthRate: f12 / 100 / 200 };
}

/** 普通主动战法（瞬发）。 */
function active(s: Omit<SimpleActiveSkill, 'type' | 'prepare'>): SimpleActiveSkill {
  return { type: 'active', prepare: false, ...s };
}

/** 被动战法。 */
function passive(s: Omit<PassiveSkill, 'type'>): PassiveSkill {
  return { type: 'passive', ...s };
}

/** 一类指挥本体（type/phase/发动率固定）。 */
function prep(s: Omit<CommandSkill, 'type' | 'phase' | 'triggerRate'>): CommandSkill {
  return { type: 'command', phase: 'prep', triggerRate: 1, ...s };
}

const dmg = (
  rate: number,
  extra: Partial<Extract<SkillOutput, { kind: 'physical_damage' }>> = {}
): SkillOutput => ({ kind: 'physical_damage', rate, ...extra });

const reduce = (
  f12: number,
  f13: number,
  duration: number,
  extra: Record<string, unknown> = {}
): SkillOutput => {
  const e = pct(f12, f13);
  return {
    kind: 'inflict_status',
    status: {
      type: 'damage_reduce',
      rate: e.rate,
      growthRate: e.growthRate,
      strategyScaled: true,
      duration,
      ...extra,
    },
  } as SkillOutput;
};

/**
 * 21 个词条战法。键 = `bj_<主战法/首个子战法 id>`。
 * ⚠️ 张恭/陶渊明的“词条”是合并后的单条战法，子战法 id 不再单独出现在背包里。
 */
export const BAIJIA_SKILLS: Record<string, Skill> = {
  // ── 朱士行（魏·步·主 550001 奉持八戒）──
  bj_550002: prep({
    id: 'bj_550002',
    name: '慈悲',
    range: 2,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal'],
    output: [{
      kind: 'inflict_status',
      status: { type: 'rest', ...healOf(175, 50), duration: 999, startRound: 4, strategyScaled: true },
    }],
  }),
  bj_550003: passive({
    id: 'bj_550003',
    name: '调伏',
    timing: 'battle_start',
    range: 2,
    triggerRate: 1,
    targetMode: 'all',
    tags: ['heal'],
    output: [],
    onHurt: {
      victim: 'ally',
      applyTo: 'victim',
      rate: 0.5,
      startRound: 4,
      onlyIfActed: true,
      output: [{ kind: 'heal', ...healOf(225, 20), strategyScaled: true }],
    },
  }),
  bj_550004: prep({
    id: 'bj_550004',
    name: '般若',
    range: 2,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal'],
    output: [],
    afterAllyCast: {
      kinds: ['active'],
      startRound: 4,
      output: [{ kind: 'heal', ...healOf(325, 40), strategyScaled: true }],
    },
  }),
  bj_550005: prep({
    id: 'bj_550005',
    name: '禅悟',
    range: 2,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal'],
    output: [],
    afterAllyCast: {
      kinds: ['pursuit'],
      startRound: 4,
      output: [{ kind: 'heal', ...healOf(225, 50), strategyScaled: true }],
    },
  }),
  bj_550006: prep({
    id: 'bj_550006',
    name: '清净',
    range: 2,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['damage_reduce'],
    output: [],
    delayedOutputs: [{ atRound: 4, output: [reduce(60, 10, 999)] }],
  }),

  // ── 张恭（魏·骑·主 550007 西陲立功）──
  // 靖边：主战法 40% 的战法行，但用户明确“靖边*5 发动率 50%”。
  bj_550008: active({
    id: 'bj_550008',
    name: '靖边',
    range: 5,
    triggerRate: 0.5,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['immunity', 'damage_boost'],
    output: [
      { kind: 'remove_debuffs' },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.8,
          duration: 999,
          direction: 'caused',
          damageType: 'physical',
          charges: 2,
        },
      },
    ],
  }),
  bj_550010: active({
    id: 'bj_550010',
    name: '挫锐',
    range: 5,
    triggerRate: 0.4,
    targetMode: 'random_single',
    tags: ['defense_buff', 'speed_buff', 'damage'],
    output: [
      ...(['defense_buff', 'speed_buff'] as const).map((type) => ({
        kind: 'inflict_status' as const,
        status: { type, ...attrDown(5000, 1000), attackScaled: true, duration: 1 },
      })),
      dmg(80, { targetMode: 'random_single', repeats: [2, 4] }),
    ],
  }),
  bj_550012: active({
    id: 'bj_550012',
    name: '选锋',
    range: 5,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 2,
    tags: ['damage_boost', 'damage'],
    output: [
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          ...pct(25, 5),
          duration: 2,
          direction: 'taken',
          damageType: 'physical',
          attackScaled: true,
        },
      },
      dmg(120, { targetMode: 'group', groupCount: 2 }),
    ],
  }),
  bj_550014: active({
    id: 'bj_550014',
    name: '振旅',
    range: 5,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 2,
    tags: ['damage_boost', 'damage'],
    output: [
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: -pct(25, 5).rate,
          growthRate: pct(25, 5).growthRate,
          duration: 2,
          direction: 'caused',
          attackScaled: true,
        },
      },
      dmg(150, { targetPick: 'lowest_defense' }),
    ],
  }),
  bj_550016: active({
    id: 'bj_550016',
    name: '坚壁',
    range: 5,
    triggerRate: 0.4,
    targetMode: 'random_single',
    tags: ['damage_reduce', 'damage'],
    output: [
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'all',
        status: { type: 'damage_reduce', ...pct(40, 4), duration: 2, attackScaled: true },
      },
      dmg(180),
    ],
  }),

  // ── 麦子（汉·骑·主 550018 功人功狗）──
  bj_550019: passive({
    id: 'bj_550019',
    name: '汪',
    timing: 'battle_start',
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    tags: [] as EffectTag[],
    output: [],
  }),
  bj_550021: passive({
    id: 'bj_550021',
    name: '汪汪汪',
    timing: 'round_start',
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['split'],
    output: [],
    roundStartRepeat: {
      output: [{
        kind: 'inflict_status',
        chance: 0.7,
        target: 'self',
        status: { type: 'split', rate: 60, duration: 1 },
      }],
    },
  }),
  bj_550022: passive({
    id: 'bj_550022',
    name: '嗷呜',
    timing: 'round_start',
    range: 4,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage'],
    output: [],
    roundStartRepeat: {
      output: [dmg(80, { chance: 0.4, targetMode: 'random_single', range: 4 })],
    },
  }),

  // ── 九色鹿（群·骑·主 550024 临河救溺）──
  bj_550028: active({
    id: 'bj_550028',
    name: '鹿鸣',
    range: 2,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['evasion'],
    output: [{ kind: 'inflict_status', status: { type: 'evasion', stacks: 1 } }],
  }),
  bj_550029: active({
    id: 'bj_550029',
    name: '鹿踪',
    range: 2,
    triggerRate: 0.4,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal'],
    output: [{ kind: 'heal', ...healOf(160, 16), strategyScaled: true }],
  }),
  bj_550030: active({
    id: 'bj_550030',
    name: '鹿影',
    range: 2,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['damage_reduce'],
    /** 文案有持续回合，槽位无 f28。先挂到战斗结束。 */
    output: [reduce(70, 7, 999)],
  }),

  // ── 陶渊明（晋·弓·主 550031 桃源问津）──
  bj_550032: prep({
    id: 'bj_550032',
    name: '息交',
    range: 2,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['damage_reduce'],
    output: [],
    initialOutput: [reduce(50, 20, 3, { damageType: 'physical' })],
    onActSegments: [{
      startRound: 1,
      endRound: 3,
      rate: 0.45,
      output: [{
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: 2,
        // 息交2（550033 / 子战法 55103301）：effect 524、constant_param 9000、available_hit 2
        // ——「受到的前 2 次策略攻击伤害**大幅降低**」⇒「大幅度」一律取极大值哨兵（见 HUGE_MODIFIER_RATE）
        status: { type: 'damage_reduce', rate: HUGE_MODIFIER_RATE, duration: 1, damageType: 'strategy', charges: 2 },
      }],
    }],
  }),
  bj_550034: prep({
    id: 'bj_550034',
    name: '守拙',
    range: 2,
    targetMode: 'self',
    tags: ['immunity', 'evasion'],
    output: [{
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'evade_chance', rate: 0.4, charges: 8, duration: 3 },
    }],
    onActSegments: [{
      startRound: 1,
      endRound: 3,
      rate: 0.45,
      output: [{ kind: 'inflict_status', target: 'self', status: { type: 'cover', duration: 1 } }],
    }],
  }),
  bj_550036: prep({
    id: 'bj_550036',
    name: '晏如',
    range: 2,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage_reduce'],
    output: [reduce(50, 20, 4, { skillTypes: ['active'] })],
  }),
  bj_550037: prep({
    id: 'bj_550037',
    name: '结庐',
    range: 2,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage_reduce'],
    output: [reduce(50, 20, 4, { damageSource: 'basic' })],
  }),
  bj_550038: prep({
    id: 'bj_550038',
    name: '挂印',
    range: 2,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage_reduce'],
    output: [reduce(50, 20, 4, { skillTypes: ['command'] })],
  }),
};

/** 一名百家武将。属性是原基础值（未成长）。 */
export interface BaijiaHero {
  id: string;
  name: string;
  /** 原主战法名（用户 2026-10-20：战法名显示为“西陲立功”等，词条名单独做红标签） */
  mainSkillName: string;
  faction: string;
  troopType: TroopType;
  cost: number;
  attack: number;
  defense: number;
  strategy: number;
  speed: number;
  sets: { id: string; name: string; skillIds: string[] }[];
}

/** 五名百家。汪只有攻城，战斗侧为空。 */
export const BAIJIA_HEROES: Record<string, BaijiaHero> = {
  // 张恭排第一行：用户 2026-10-20 口径「如第一行为张恭的所有百家战法」。
  '140002': {
    id: '140002', name: '张恭', mainSkillName: '西陲立功', faction: '魏', troopType: 'cavalry', cost: 30,
    attack: 18, defense: 12, strategy: 8, speed: 9,
    sets: [
      { id: 'jingbian', name: '靖边', skillIds: ['bj_550008'] },
      { id: 'cuorui', name: '挫锐', skillIds: ['bj_550010'] },
      { id: 'xuanfeng', name: '选锋', skillIds: ['bj_550012'] },
      { id: 'zhenlv', name: '振旅', skillIds: ['bj_550014'] },
      { id: 'jianbi', name: '坚壁', skillIds: ['bj_550016'] },
    ],
  },
  '140001': {
    id: '140001', name: '朱士行', mainSkillName: '奉持八戒', faction: '魏', troopType: 'infantry', cost: 25,
    attack: 5, defense: 12, strategy: 13, speed: 6,
    sets: [
      { id: 'cibei', name: '慈悲', skillIds: ['bj_550002'] },
      { id: 'tiaofu', name: '调伏', skillIds: ['bj_550003'] },
      { id: 'bore', name: '般若', skillIds: ['bj_550004'] },
      { id: 'chanwu', name: '禅悟', skillIds: ['bj_550005'] },
      { id: 'qingjing', name: '清净', skillIds: ['bj_550006'] },
    ],
  },
  '140003': {
    id: '140003', name: '麦子', mainSkillName: '功人功狗', faction: '汉', troopType: 'cavalry', cost: 20,
    attack: 18, defense: 11, strategy: 5, speed: 23,
    sets: [
      { id: 'wang', name: '汪', skillIds: ['bj_550019'] },
      { id: 'wangwang', name: '汪汪汪', skillIds: ['bj_550021'] },
      { id: 'aowu', name: '嗷呜', skillIds: ['bj_550022'] },
    ],
  },
  '140004': {
    id: '140004', name: '九色鹿', mainSkillName: '临河救溺', faction: '群', troopType: 'cavalry', cost: 25,
    attack: 9, defense: 21, strategy: 24, speed: 30,
    sets: [
      { id: 'luming', name: '鹿鸣', skillIds: ['bj_550028'] },
      { id: 'luzong', name: '鹿踪', skillIds: ['bj_550029'] },
      { id: 'luying', name: '鹿影', skillIds: ['bj_550030'] },
    ],
  },
  '140005': {
    id: '140005', name: '陶渊明', mainSkillName: '桃源问津', faction: '晋', troopType: 'archer', cost: 30,
    attack: 7, defense: 14, strategy: 15, speed: 11,
    sets: [
      { id: 'xijiao', name: '息交', skillIds: ['bj_550032'] },
      { id: 'shouzhuo', name: '守拙', skillIds: ['bj_550034'] },
      { id: 'yanru', name: '晏如', skillIds: ['bj_550036'] },
      { id: 'jielu', name: '结庐', skillIds: ['bj_550037'] },
      { id: 'guayin', name: '挂印', skillIds: ['bj_550038'] },
    ],
  },
};

// 战法名沿用武将原主战法名（张恭 = 西陲立功）；具体词条名放 BAIJIA_SKILL_META.setName，
// 由背包/详情渲染成红色标签（用户 2026-10-20 口径）。
for (const hero of Object.values(BAIJIA_HEROES)) {
  for (const set of hero.sets) {
    for (const id of set.skillIds) {
      const skill = BAIJIA_SKILLS[id];
      if (skill) skill.name = hero.mainSkillName;
    }
  }
}

/** 背包“百家”分类用的分组信息。 */
export interface BaijiaSkillMeta {
  heroId: string;
  heroName: string;
  mainSkillName: string;
  setId: string;
  setName: string;
  heroOrder: number;
  setOrder: number;
}

/**
 * 百家背包显示顺序（用户 2026-10-20：张恭排第一行）。
 * ⚠️ `BAIJIA_HEROES` 的键是纯数字字符串，JS 对象会强制按数字升序枚举，
 * 不能靠对象书写顺序控制展示顺序；这里显式给顺序。
 */
const BAIJIA_HERO_ORDER = ['140002', '140001', '140003', '140004', '140005'] as const;

export const BAIJIA_SKILL_META: Record<string, BaijiaSkillMeta> = BAIJIA_HERO_ORDER
  .reduce((acc, heroId, heroOrder) => {
    const hero = BAIJIA_HEROES[heroId];
    hero.sets.forEach((set, setOrder) => {
      set.skillIds.forEach((id) => {
        acc[id] = {
          heroId: hero.id,
          heroName: hero.name,
          mainSkillName: hero.mainSkillName,
          setId: set.id,
          setName: set.name,
          heroOrder,
          setOrder,
        };
      });
    });
    return acc;
  }, {} as Record<string, BaijiaSkillMeta>);
