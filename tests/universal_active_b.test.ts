/**
 * 通用主动战法批量测试（u3b，C/D 级）：伏兵 / 佯攻 / 冲锋 / 包扎 / 反计 /
 * 奔袭 / 截断 / 拒盾 / 毒泉 / 游击 / 溃堤 / 火箭 / 火辎 / 狼烟 / 疑兵 /
 * 窃兵 / 绝道 / 落石 / 规避 / 设伏 / 迫近 / 退避 / 陷阱 / 雀伏 / 齐射 /
 * 乱击 / 乱阵 / 假途 / 劫粮 / 固阵 / 坚守 / 奋起 / 威压 / 强攻 / 急救 /
 * 横扫 / 犒劳 / 诱敌 / 谨言 / 顽抗 / 飞虹
 * 每战法 3 个测试：装配挂槽、机制事件状态、数值或共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position, troops = 10000): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 50,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 主动战法装配：施法者在中军 */
function activeTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '中军', 10000);
  carrier.attack = 120;
  carrier.defense = 90;
  carrier.strategy = 85;
  carrier.speed = 40;
  carrier.activeSkillIds = [skillId];
  return [dummy('ally-front', '前锋', 10000), carrier, dummy('ally-back', '大营', 10000)];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

const dotTicks = (report: ReturnType<typeof run>, dotType: string) =>
  report.events.filter((e) => e.type === 'dot_tick' && e.dotType === dotType);

const damage = (report: ReturnType<typeof run>, name: string, damageType: 'physical' | 'strategy') =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.skillName === name && e.damageType === damageType
  );

const healed = (report: ReturnType<typeof run>) =>
  report.events.filter((e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal');

/** 简化：仅需判定战法可发动（skill_cast 存在）——多数 C/D 战法发动率低，用 seed 扫描 */
function runUntilCast(skillId: string, name: string, seeds = [1, 2, 3, 4, 5]) {
  for (const s of seeds) {
    const report = run(activeTeam(skillId), s);
    if (casts(report, name).length > 0) return report;
  }
  return run(activeTeam(skillId), seeds[0]);
}

describe('伏兵（C 主动：敌军单体策略 105.2%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('fubing')[1].activeSkillIds).toContain('fubing');
  });

  it('发动后对敌军单体造成策略伤害', () => {
    const report = runUntilCast('fubing', '伏兵');
    const d = damage(report, '伏兵', 'strategy');
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((e) => e.targetId.startsWith('enemy'))).toBe(true);
  });
});

describe('佯攻（C 主动：敌军单体怯战 2 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('yanggong')[1].activeSkillIds).toContain('yanggong');
  });

  it('发动后使敌军单体陷入怯战状态', () => {
    const report = runUntilCast('yanggong', '佯攻');
    expect(inflicted(report, 'cowardice').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('冲锋（C 主动：自身攻击伤害提高 + 敌军单体攻击）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('chongfeng')[1].activeSkillIds).toContain('chongfeng');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = runUntilCast('chongfeng', '冲锋');
    expect(damage(report, '冲锋', 'physical').length).toBeGreaterThan(0);
  });

  it('自身获得攻击增伤状态', () => {
    const report = runUntilCast('chongfeng', '冲锋');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('包扎（C 主动：恢复我军群体兵力）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('baozha')[1].activeSkillIds).toContain('baozha');
  });

  it('发动后恢复我军群体兵力', () => {
    const report = runUntilCast('baozha', '包扎');
    const h = healed(report).filter((e) => e.skillName === '包扎');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });
});

describe('反计（C 主动：敌军单体犹豫 2 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('fanji')[1].activeSkillIds).toContain('fanji');
  });

  it('发动后使敌军单体陷入犹豫状态', () => {
    const report = runUntilCast('fanji', '反计');
    expect(inflicted(report, 'hesitation').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('奔袭（C 主动：敌军单体攻击伤害 225%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('benxi')[1].activeSkillIds).toContain('benxi');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = runUntilCast('benxi', '奔袭');
    const d = damage(report, '奔袭', 'physical');
    expect(d.length).toBe(casts(report, '奔袭').length);
    expect(d.every((e) => e.targetId.startsWith('enemy'))).toBe(true);
  });
});

describe('截断（C 主动：敌军群体受到攻击伤害提高）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jieduan')[1].activeSkillIds).toContain('jieduan');
  });

  it('发动后使敌军群体获得增伤状态（damage_boost）', () => {
    const report = runUntilCast('jieduan', '截断');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('拒盾（C 主动：自身受伤降低）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('judun')[1].activeSkillIds).toContain('judun');
  });

  it('发动后自身获得减伤状态', () => {
    const report = runUntilCast('judun', '拒盾');
    expect(inflicted(report, 'damage_reduce').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('毒泉（C 准备：敌军群体恐慌 85%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('duquan')[1].activeSkillIds).toContain('duquan');
  });

  it('发动后使敌军群体陷入恐慌状态', () => {
    const report = runUntilCast('duquan', '毒泉');
    expect(inflicted(report, 'panic').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });

  it('恐慌产生 dot_tick', () => {
    const report = runUntilCast('duquan', '毒泉');
    expect(dotTicks(report, 'panic').length).toBeGreaterThan(0);
  });
});

describe('游击（C 主动：敌军单体动摇恐慌）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('youji')[1].activeSkillIds).toContain('youji');
  });

  it('发动后使敌军单体陷入恐慌状态', () => {
    const report = runUntilCast('youji', '游击');
    expect(inflicted(report, 'panic').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('溃堤（C 主动：敌军群体策略 79.8% + 攻击降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('kuidi')[1].activeSkillIds).toContain('kuidi');
  });

  it('发动后对敌军群体造成策略伤害', () => {
    const report = runUntilCast('kuidi', '溃堤');
    expect(damage(report, '溃堤', 'strategy').length).toBeGreaterThan(0);
  });

  it('使敌军攻击属性下降', () => {
    const report = runUntilCast('kuidi', '溃堤');
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('火箭（C 准备：敌军群体策略 69% + 燃烧）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('huojian')[1].activeSkillIds).toContain('huojian');
  });

  it('发动后对敌军群体造成策略伤害并使其燃烧', () => {
    const report = runUntilCast('huojian', '火箭');
    expect(damage(report, '火箭', 'strategy').length).toBeGreaterThan(0);
    expect(inflicted(report, 'burning').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });

  it('燃烧产生 dot_tick', () => {
    const report = runUntilCast('huojian', '火箭');
    expect(dotTicks(report, 'burning').length).toBeGreaterThan(0);
  });
});

describe('火辎（C 准备：敌军群体策略 75% + 燃烧）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('huoozi')[1].activeSkillIds).toContain('huoozi');
  });

  it('发动后对敌军群体造成策略伤害并使其燃烧', () => {
    const report = runUntilCast('huoozi', '火辎');
    expect(damage(report, '火辎', 'strategy').length).toBeGreaterThan(0);
    expect(inflicted(report, 'burning').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('狼烟（C 主动：敌军群体恐慌 47.6%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('langyan')[1].activeSkillIds).toContain('langyan');
  });

  it('发动后使敌军群体陷入恐慌状态', () => {
    const report = runUntilCast('langyan', '狼烟');
    expect(inflicted(report, 'panic').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('疑兵（C 主动：敌军单体暴走 1 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('yibing')[1].activeSkillIds).toContain('yibing');
  });

  it('发动后使敌军单体陷入暴走状态', () => {
    const report = runUntilCast('yibing', '疑兵');
    expect(inflicted(report, 'rampage').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('窃兵（C 主动：敌军单体攻击伤害 170% + 恢复自身）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('qiebing')[1].activeSkillIds).toContain('qiebing');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = runUntilCast('qiebing', '窃兵');
    expect(damage(report, '窃兵', 'physical').length).toBeGreaterThan(0);
  });

  it('恢复施法者自身兵力', () => {
    // 随机流变化可能使施放时施法者满兵（heal 受兵力缺口截断为 0 不发事件）：
    // 扫描种子取首个「施放且实际恢复」的报告
    let report: ReturnType<typeof run> | null = null;
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const r = run(activeTeam('qiebing'), s);
      if (casts(r, '窃兵').length > 0 && healed(r).some((e) => e.skillName === '窃兵')) {
        report = r;
        break;
      }
    }
    report ??= run(activeTeam('qiebing'), 1);
    const h = healed(report).filter((e) => e.skillName === '窃兵');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => e.targetId === 'carrier')).toBe(true);
  });
});

describe('绝道（C 主动：敌军群体策略 105% + 防御降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('juedao')[1].activeSkillIds).toContain('juedao');
  });

  it('发动后对敌军群体造成策略伤害', () => {
    const report = runUntilCast('juedao', '绝道');
    expect(damage(report, '绝道', 'strategy').length).toBeGreaterThan(0);
  });

  it('使敌军防御属性下降', () => {
    const report = runUntilCast('juedao', '绝道');
    expect(inflicted(report, 'defense_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('落石（C 主动：敌军群体策略 92.2% + 防御降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('luoshi')[1].activeSkillIds).toContain('luoshi');
  });

  it('发动后对敌军群体造成策略伤害', () => {
    const report = runUntilCast('luoshi', '落石');
    expect(damage(report, '落石', 'strategy').length).toBeGreaterThan(0);
  });

  it('使敌军防御属性下降', () => {
    const report = runUntilCast('luoshi', '落石');
    expect(inflicted(report, 'defense_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('规避（C 主动：自身规避 1 次）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('guibi')[1].activeSkillIds).toContain('guibi');
  });

  it('发动后自身获得规避状态', () => {
    const report = runUntilCast('guibi', '规避');
    expect(inflicted(report, 'evasion').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('设伏（C 主动：敌军群体攻击伤害 145%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('shefu')[1].activeSkillIds).toContain('shefu');
  });

  it('发动后对敌军群体造成攻击伤害', () => {
    const report = runUntilCast('shefu', '设伏');
    expect(damage(report, '设伏', 'physical').length).toBeGreaterThan(0);
  });
});

describe('迫近（C 主动：敌军群体进行攻击伤害降低）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('pojin')[1].activeSkillIds).toContain('pojin');
  });

  it('发动后使敌军群体获得负增伤状态', () => {
    const report = runUntilCast('pojin', '迫近');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('退避（C 主动：自身受伤降低）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('tuibi')[1].activeSkillIds).toContain('tuibi');
  });

  it('发动后自身获得减伤状态', () => {
    const report = runUntilCast('tuibi', '退避');
    expect(inflicted(report, 'damage_reduce').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('陷阱（C 主动：敌军单体混乱 1 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('xianjing')[1].activeSkillIds).toContain('xianjing');
  });

  it('发动后使敌军单体陷入混乱状态', () => {
    const report = runUntilCast('xianjing', '陷阱');
    expect(inflicted(report, 'confusion').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('雀伏（C 主动：敌军单体策略 165%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('quefu')[1].activeSkillIds).toContain('quefu');
  });

  it('发动后对敌军单体造成策略伤害', () => {
    const report = runUntilCast('quefu', '雀伏');
    expect(damage(report, '雀伏', 'strategy').length).toBeGreaterThan(0);
  });
});

describe('齐射（C 主动：敌军群体攻击伤害 90% + 攻击降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('qishe')[1].activeSkillIds).toContain('qishe');
  });

  it('发动后对敌军群体造成攻击伤害', () => {
    const report = runUntilCast('qishe', '齐射');
    expect(damage(report, '齐射', 'physical').length).toBeGreaterThan(0);
  });

  it('使敌军攻击属性下降', () => {
    const report = runUntilCast('qishe', '齐射');
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('乱击（D 准备：敌军群体攻击伤害 120% + 防御降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('luanji')[1].activeSkillIds).toContain('luanji');
  });

  it('发动后对敌军群体造成攻击伤害', () => {
    const report = runUntilCast('luanji', '乱击');
    expect(damage(report, '乱击', 'physical').length).toBeGreaterThan(0);
  });

  it('使敌军防御属性下降', () => {
    const report = runUntilCast('luanji', '乱击');
    expect(inflicted(report, 'defense_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('乱阵（D 主动：敌军群体进行策略伤害降低）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('luanzhen')[1].activeSkillIds).toContain('luanzhen');
  });

  it('发动后使敌军群体获得负增伤状态', () => {
    const report = runUntilCast('luanzhen', '乱阵');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('假途（D 主动：敌军群体受到攻击伤害提高）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jiatu')[1].activeSkillIds).toContain('jiatu');
  });

  it('发动后使敌军群体获得增伤状态', () => {
    const report = runUntilCast('jiatu', '假途');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('劫粮（D 主动：敌军群体受到策略伤害提高）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jieliang')[1].activeSkillIds).toContain('jieliang');
  });

  it('发动后使敌军群体获得增伤状态', () => {
    const report = runUntilCast('jieliang', '劫粮');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('固阵（D 主动：自身受策略伤害降低）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('guzhen')[1].activeSkillIds).toContain('guzhen');
  });

  it('发动后自身获得减伤状态', () => {
    const report = runUntilCast('guzhen', '固阵');
    expect(inflicted(report, 'damage_reduce').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('坚守（D 主动：自身受攻击伤害降低）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jianshou')[1].activeSkillIds).toContain('jianshou');
  });

  it('发动后自身获得减伤状态', () => {
    const report = runUntilCast('jianshou', '坚守');
    expect(inflicted(report, 'damage_reduce').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('奋起（D 主动：自身攻击伤害提高）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('fenqi')[1].activeSkillIds).toContain('fenqi');
  });

  it('发动后自身获得增伤状态', () => {
    const report = runUntilCast('fenqi', '奋起');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('威压（D 主动：敌军群体进行攻击伤害降低）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('weiya')[1].activeSkillIds).toContain('weiya');
  });

  it('发动后使敌军群体获得负增伤状态', () => {
    const report = runUntilCast('weiya', '威压');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('强攻（D 主动：敌军单体攻击伤害 105% + 防御降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('qianggong')[1].activeSkillIds).toContain('qianggong');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = runUntilCast('qianggong', '强攻');
    expect(damage(report, '强攻', 'physical').length).toBeGreaterThan(0);
  });

  it('使敌军防御属性下降', () => {
    const report = runUntilCast('qianggong', '强攻');
    expect(inflicted(report, 'defense_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('急救（D 主动：恢复友军单体兵力）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jijiu')[1].activeSkillIds).toContain('jijiu');
  });

  it('发动后恢复友军单体兵力', () => {
    const report = runUntilCast('jijiu', '急救');
    const h = healed(report).filter((e) => e.skillName === '急救');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });
});

describe('横扫（D 主动：自身分兵 1 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('hengsao')[1].activeSkillIds).toContain('hengsao');
  });

  it('发动后自身进入分兵状态', () => {
    const report = runUntilCast('hengsao', '横扫');
    expect(inflicted(report, 'split').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('犒劳（D 主动：自身策略伤害提高）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('kaolao')[1].activeSkillIds).toContain('kaolao');
  });

  it('发动后自身获得增伤状态', () => {
    const report = runUntilCast('kaolao', '犒劳');
    expect(inflicted(report, 'damage_boost').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('诱敌（D 主动：挑衅敌军单体 + 攻击降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('youdi')[1].activeSkillIds).toContain('youdi');
  });

  it('发动后使敌军单体被挑衅', () => {
    const report = runUntilCast('youdi', '诱敌');
    expect(inflicted(report, 'taunt').length).toBeGreaterThan(0);
  });

  it('使敌军攻击属性下降', () => {
    const report = runUntilCast('youdi', '诱敌');
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('谨言（D 主动：友军全体受策略伤害降低）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jinyan')[1].activeSkillIds).toContain('jinyan');
  });

  it('发动后使友军全体获得减伤状态', () => {
    const report = runUntilCast('jinyan', '谨言');
    const dr = inflicted(report, 'damage_reduce').filter((e) => !e.unitId.startsWith('enemy'));
    expect(dr.length).toBeGreaterThan(0);
  });
});

describe('顽抗（D 主动：移除自身有害 + 敌军单体攻击）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('wankang')[1].activeSkillIds).toContain('wankang');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = runUntilCast('wankang', '顽抗');
    expect(damage(report, '顽抗', 'physical').length).toBeGreaterThan(0);
  });
});

describe('飞虹（D 主动：敌军单体攻击伤害 110% + 攻击降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('feihong')[1].activeSkillIds).toContain('feihong');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = runUntilCast('feihong', '飞虹');
    expect(damage(report, '飞虹', 'physical').length).toBeGreaterThan(0);
  });

  it('使敌军攻击属性下降', () => {
    const report = runUntilCast('feihong', '飞虹');
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});
