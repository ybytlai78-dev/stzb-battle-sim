/**
 * 内置固定测试集（T1~T6）
 * 每组固定种子，供 golden test 锁定输出。
 */
import type { BattleConfig, General } from '../src/engine/types';
import { HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';

function general(partial: Partial<General>): General {
  return {
    id: partial.id ?? 'g',
    name: partial.name ?? '无名武将',
    rarity: partial.rarity ?? '5星',
    cost: partial.cost ?? 3,
    faction: partial.faction ?? '汉',
    tags: partial.tags ?? [],
    mutualExclusionGroup: partial.mutualExclusionGroup ?? null,
    troopType: partial.troopType ?? 'infantry',
    position: partial.position ?? '前锋',
    attack: partial.attack ?? 100,
    defense: partial.defense ?? 100,
    strategy: partial.strategy ?? 100,
    speed: partial.speed ?? 50,
    attackRange: partial.attackRange ?? 2,
    maxTroops: partial.maxTroops ?? 10000,
    mainSkillName: partial.mainSkillName ?? '',
    skillDesc: partial.skillDesc ?? '',
    activeSkillIds: partial.activeSkillIds ?? [],
    passiveSkillIds: partial.passiveSkillIds ?? [],
    commandSkillIds: partial.commandSkillIds ?? [],
    pursuitSkillIds: partial.pursuitSkillIds ?? [],
    morale: partial.morale ?? 100,
  };
}

function dummy(id: string, position: '前锋' | '中军' | '大营'): General {
  return general({
    id,
    name: `木桩${position}`,
    position,
    attack: 50,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 10000,
  });
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** T1 纯普攻：1 将，无战法，验证攻击基础随机 + 寻敌顺序 */
export const T1_PURE_ATTACK: BattleConfig = {
  myTeam: [
    general({
      id: 't1',
      name: '普攻测试将',
      position: '前锋',
      attack: 150,
      defense: 100,
      strategy: 80,
      speed: 60,
      attackRange: 2,
      maxTroops: 10000,
    }),
  ],
  enemyTeam: enemyTeam(),
  seed: 10001,
  maxRounds: 8,
};

/** T2 攻击伤害战法：3 将带 突进/凿穿 */
export const T2_PHYSICAL_SKILL: BattleConfig = {
  myTeam: [
    general({
      id: 't2a', name: '突进将', position: '前锋',
      attack: 160, defense: 90, strategy: 60, speed: 70, attackRange: 2, maxTroops: 10000,
      activeSkillIds: ['tujin'],
    }),
    general({
      id: 't2b', name: '凿穿将', position: '中军',
      attack: 140, defense: 100, strategy: 60, speed: 55, attackRange: 2, maxTroops: 10000,
      activeSkillIds: ['zaochuan'],
    }),
    general({
      id: 't2c', name: '无战法将', position: '大营',
      attack: 120, defense: 100, strategy: 60, speed: 40, attackRange: 3, maxTroops: 10000,
    }),
  ],
  enemyTeam: enemyTeam(),
  seed: 10002,
  maxRounds: 8,
};

/** T3 谋略战法：3 将带 夹攻（谋略群体 + 受谋略成长） */
export const T3_STRATEGY_SKILL: BattleConfig = {
  myTeam: [
    general({
      id: 't3a', name: '谋略将', position: '前锋',
      attack: 60, defense: 100, strategy: 180, speed: 45, attackRange: 2, maxTroops: 10000,
      activeSkillIds: ['jiagong'],
    }),
    general({
      id: 't3b', name: '突进将', position: '中军',
      attack: 150, defense: 100, strategy: 80, speed: 60, attackRange: 2, maxTroops: 10000,
      activeSkillIds: ['tujin'],
    }),
    general({
      id: 't3c', name: '凿穿将', position: '大营',
      attack: 130, defense: 100, strategy: 80, speed: 35, attackRange: 3, maxTroops: 10000,
      activeSkillIds: ['zaochuan'],
    }),
  ],
  enemyTeam: enemyTeam(),
  seed: 10003,
  maxRounds: 8,
};

/** T4 兵力衰减：满兵 vs 高防木桩，观察伤害随兵力下降衰减 */
export const T4_TROOP_DECAY: BattleConfig = {
  myTeam: [
    general({
      id: 't4a', name: '满兵将', position: '前锋',
      attack: 150, defense: 100, strategy: 80, speed: 50, attackRange: 2, maxTroops: 10000,
    }),
    general({
      id: 't4b', name: '中兵将', position: '中军',
      attack: 150, defense: 100, strategy: 80, speed: 45, attackRange: 2, maxTroops: 6000,
    }),
    general({
      id: 't4c', name: '低兵将', position: '大营',
      attack: 150, defense: 100, strategy: 80, speed: 40, attackRange: 3, maxTroops: 3000,
    }),
  ],
  enemyTeam: enemyTeam(),
  seed: 10004,
  maxRounds: 8,
};

/** T5 距离寻敌：攻击距离 1 / 3 / 5，验证距离不足无法普攻 + 最近优先 */
export const T5_RANGE_FIND: BattleConfig = {
  myTeam: [
    general({
      id: 't5a', name: '短距将', position: '前锋',
      attack: 150, defense: 100, strategy: 80, speed: 60, attackRange: 1, maxTroops: 10000,
    }),
    general({
      id: 't5b', name: '中距将', position: '中军',
      attack: 150, defense: 100, strategy: 80, speed: 50, attackRange: 3, maxTroops: 10000,
    }),
    general({
      id: 't5c', name: '长距将', position: '大营',
      attack: 150, defense: 100, strategy: 80, speed: 40, attackRange: 5, maxTroops: 10000,
    }),
  ],
  enemyTeam: enemyTeam(),
  seed: 10005,
  maxRounds: 8,
};

/** T6 吴国三将：太史慈(前锋)/周瑜(中军)/孙权(大营) vs 三木桩，验证追击/混乱/准备/怯战/规避 */
function buildT6(): BattleConfig {
  return {
    myTeam: [HERO_REGISTRY.taishici, HERO_REGISTRY.zhouyu, HERO_REGISTRY.sunquan],
    enemyTeam: enemyTeam(),
    seed: 10006,
    maxRounds: 8,
  };
}

/** T7 装配战法：太史慈/周瑜/孙权 各带 指挥/被动/追击 战法，验证指挥+被动管线与连击/治疗/减伤 */
function buildT7(): BattleConfig {
  return {
    myTeam: [
      withSkills(HERO_REGISTRY.taishici, {
        commandSkillIds: ['xianqu_tuji'],
        pursuitSkillIds: ['fangzhen_tuji', 'wenjiu_zhanjiang'],
      }),
      withSkills(HERO_REGISTRY.zhouyu, {
        activeSkillIds: ['xuanwu_fuliu', 'hunshui_moyu'],
        commandSkillIds: ['zhanbi_duanjin'],
      }),
      withSkills(HERO_REGISTRY.sunquan, {
        passiveSkillIds: ['bubu_weiyin', 'qingnang_miyao'],
      }),
    ],
    enemyTeam: enemyTeam(),
    seed: 10007,
    maxRounds: 8,
  };
}

/**
 * T8 吴国三将 40级：太史慈/周瑜/孙权 按成长值升至 40 级（四舍五入），
 * 自由加点各 +40（太史慈攻/周瑜谋/孙权防），兵力各 9000。带默认主战法。
 * 面板由 level40() 生成，成长值来源：MySQL heroes 表（hero_growth_verified.json 灌入）。
 */
function buildT8(): BattleConfig {
  return {
    myTeam: [
      withSkills(level40(HERO_REGISTRY.taishici, { attack: 40 }), { pursuitSkillIds: ['fangzhen_tuji'] }),
      withSkills(level40(HERO_REGISTRY.zhouyu, { strategy: 40 }), { activeSkillIds: ['xuanwu_fuliu'] }),
      withSkills(level40(HERO_REGISTRY.sunquan, { defense: 40 }), { activeSkillIds: ['jiuxi_huanglong'] }),
    ],
    enemyTeam: enemyTeam(),
    seed: 10008,
    maxRounds: 8,
  };
}

/**
 * T9 指挥一二类 40级：魏延(前锋,奇兵拒北)+吕蒙(大营,白衣渡江)+太史慈(中军,借行动高速)，各自由加点+40，兵力9000。
 * 验证：二类指挥行动时判定/借友军/按位置打大营+中军；一类指挥延迟结算/无视规避。
 */
function buildT9(): BattleConfig {
  return {
    myTeam: [
      withSkills(level40(HERO_REGISTRY.weiyan, { attack: 40 }), {}),
      withSkills(level40(HERO_REGISTRY.taishici, { attack: 40 }), { pursuitSkillIds: ['fangzhen_tuji'] }),
      withSkills(level40(HERO_REGISTRY.lvmeng, { strategy: 40 }), {}),
    ],
    enemyTeam: enemyTeam(),
    seed: 10009,
    maxRounds: 8,
  };
}

/**
 * T10 卫瓘持节镇西 40级：卫瓘(中军,持节镇西)+太史慈(前锋,方阵突击)+孙权(大营,九锡黄龙)，
 * 各自由加点+40，兵力9000。验证常驻伤害前叠层（攻击/谋略/防御各4层、每层1回合）随战斗推进累积。
 */
function buildT10(): BattleConfig {
  return {
    myTeam: [
      withSkills(level40(HERO_REGISTRY.weiguan, { defense: 40 }), {}),
      withSkills(level40(HERO_REGISTRY.taishici, { attack: 40 }), { pursuitSkillIds: ['fangzhen_tuji'] }),
      withSkills(level40(HERO_REGISTRY.sunquan, { strategy: 40 }), { activeSkillIds: ['jiuxi_huanglong'] }),
    ],
    enemyTeam: enemyTeam(),
    seed: 10010,
    maxRounds: 8,
  };
}

/**
 * 构建全部固定测试集。注意：HERO_REGISTRY 由 initHeroDB() 异步填充，
 * 必须在调用前完成初始化（CLI 已 await；golden test 在 beforeAll 中 init）。
 */
export function buildAllFixtures(): Record<string, BattleConfig> {
  return {
    T1_PURE_ATTACK,
    T2_PHYSICAL_SKILL,
    T3_STRATEGY_SKILL,
    T4_TROOP_DECAY,
    T5_RANGE_FIND,
    T6_WU_TRIO: buildT6(),
    T7_LOADOUT: buildT7(),
    T8_WU_TRIO_L40: buildT8(),
    T9_COMMAND_MECHANICS_L40: buildT9(),
    T10_WEIGUAN_STACK_L40: buildT10(),
  };
}
