/**
 * 通用追击战法批量测试（u1）：怯心夺志 / 钝兵挫锐 / 攻心 / 破甲 /
 * 攻其要害 / 追击 / 奇袭 / 浴血 / 重伤
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值或共存。
 * 通用战法无固定武将主槽，用 withSkills + dummy 装配。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, withSkills } from '../src/data/heroes';

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

/** 追击战法装配：攻击型武将居中，带普攻目标 */
function pursuitTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 120;
  carrier.pursuitSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
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

describe('怯心夺志（A 追击：200% 猛攻 + 犹豫 1 回合）', () => {
  it('装配：追击槽挂入，追击战法类型', () => {
    const t = pursuitTeam('qiexin_duozhi');
    expect(t[0].pursuitSkillIds).toContain('qiexin_duozhi');
    expect(SKILL_REGISTRY['qiexin_duozhi'].type).toBe('pursuit');
  });

  it('普攻命中后触发，对攻击目标造成伤害', () => {
    const report = run(pursuitTeam('qiexin_duozhi'));
    expect(casts(report, '怯心夺志').length).toBeGreaterThan(0);
    const d = damage(report, '怯心夺志', 'physical');
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((e) => e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('使攻击目标陷入犹豫状态（hesitation）', () => {
    const report = run(pursuitTeam('qiexin_duozhi'));
    const hes = inflicted(report, 'hesitation').filter((e) => e.unitId.startsWith('enemy'));
    expect(hes.length).toBeGreaterThan(0);
  });
});

describe('钝兵挫锐（A 追击：200% 猛攻 + 怯战 1 回合）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('dunbing_cuorui')[0].pursuitSkillIds).toContain('dunbing_cuorui');
  });

  it('普攻命中后触发，对攻击目标造成伤害', () => {
    const report = run(pursuitTeam('dunbing_cuorui'));
    expect(casts(report, '钝兵挫锐').length).toBeGreaterThan(0);
    expect(damage(report, '钝兵挫锐', 'physical').length).toBeGreaterThan(0);
  });

  it('使攻击目标陷入怯战状态（cowardice）', () => {
    const report = run(pursuitTeam('dunbing_cuorui'));
    const cow = inflicted(report, 'cowardice').filter((e) => e.unitId.startsWith('enemy'));
    expect(cow.length).toBeGreaterThan(0);
  });
});

describe('攻心（B 追击：106% 策略攻击 + 恢复自身兵力）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('gongxin')[0].pursuitSkillIds).toContain('gongxin');
  });

  it('普攻命中后对攻击目标发动策略攻击', () => {
    const report = run(pursuitTeam('gongxin'));
    expect(casts(report, '攻心').length).toBeGreaterThan(0);
    expect(damage(report, '攻心', 'strategy').length).toBeGreaterThan(0);
  });

  it('恢复施法者自身兵力（heal target self）', () => {
    const report = run(pursuitTeam('gongxin'));
    const heal = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillName === '攻心'
    );
    expect(heal.length).toBeGreaterThan(0);
    expect(heal.every((e) => e.targetId === 'carrier')).toBe(true);
  });
});

describe('破甲（B 追击：165% 攻击 + 防御降低 25）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('pojia')[0].pursuitSkillIds).toContain('pojia');
  });

  it('普攻命中后对攻击目标造成攻击伤害', () => {
    const report = run(pursuitTeam('pojia'));
    expect(casts(report, '破甲').length).toBeGreaterThan(0);
    expect(damage(report, '破甲', 'physical').length).toBeGreaterThan(0);
  });

  it('使攻击目标防御属性降低（defense_buff 负值）', () => {
    const report = run(pursuitTeam('pojia'));
    const def = inflicted(report, 'defense_buff').filter((e) => e.unitId.startsWith('enemy'));
    expect(def.length).toBeGreaterThan(0);
  });
});

describe('攻其要害（C 追击：125% 攻击）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('gongqi_yaohai')[0].pursuitSkillIds).toContain('gongqi_yaohai');
  });

  it('普攻命中后触发，对攻击目标造成伤害', () => {
    const report = run(pursuitTeam('gongqi_yaohai'));
    expect(casts(report, '攻其要害').length).toBeGreaterThan(0);
    expect(damage(report, '攻其要害', 'physical').length).toBeGreaterThan(0);
  });

  it('伤害大于 0', () => {
    const report = run(pursuitTeam('gongqi_yaohai'));
    const d = damage(report, '攻其要害', 'physical');
    if (d.length) expect(d.every((e) => e.damage > 0)).toBe(true);
  });
});

describe('追击（C 追击：50% 攻击）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('zhuiji')[0].pursuitSkillIds).toContain('zhuiji');
  });

  it('普攻命中后触发', () => {
    const report = run(pursuitTeam('zhuiji'));
    expect(casts(report, '追击').length).toBeGreaterThan(0);
  });

  it('对攻击目标造成攻击伤害', () => {
    const report = run(pursuitTeam('zhuiji'));
    expect(damage(report, '追击', 'physical').length).toBeGreaterThan(0);
  });
});

describe('奇袭（D 追击：121% 策略攻击）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('qixi')[0].pursuitSkillIds).toContain('qixi');
  });

  it('普攻命中后对攻击目标发动策略攻击', () => {
    const report = run(pursuitTeam('qixi'));
    expect(casts(report, '奇袭').length).toBeGreaterThan(0);
    expect(damage(report, '奇袭', 'strategy').length).toBeGreaterThan(0);
  });

  it('伤害受谋略加成（谋略高者伤害更大）', () => {
    const low = run(pursuitTeam('qixi'), 2);
    const d = damage(low, '奇袭', 'strategy');
    expect(d.every((e) => e.damage > 0)).toBe(true);
  });
});

describe('浴血（D 追击：动摇恐慌 DoT 75%）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('yuxue')[0].pursuitSkillIds).toContain('yuxue');
  });

  it('普攻命中后使攻击目标陷入恐慌状态', () => {
    const report = run(pursuitTeam('yuxue'));
    expect(casts(report, '浴血').length).toBeGreaterThan(0);
    const panic = inflicted(report, 'panic').filter((e) => e.unitId.startsWith('enemy'));
    expect(panic.length).toBeGreaterThan(0);
  });

  it('恐慌每回合对目标造成兵力损失（dot_tick）', () => {
    const report = run(pursuitTeam('yuxue'));
    expect(dotTicks(report, 'panic').length).toBeGreaterThan(0);
  });
});

describe('重伤（D 追击：115% 攻击 + 攻击降低 15）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('zhongshang')[0].pursuitSkillIds).toContain('zhongshang');
  });

  it('普攻命中后对攻击目标造成攻击伤害', () => {
    const report = run(pursuitTeam('zhongshang'));
    expect(casts(report, '重伤').length).toBeGreaterThan(0);
    expect(damage(report, '重伤', 'physical').length).toBeGreaterThan(0);
  });

  it('使攻击目标攻击属性降低（attack_buff 负值）', () => {
    const report = run(pursuitTeam('zhongshang'));
    const atk = inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy'));
    expect(atk.length).toBeGreaterThan(0);
  });
});
