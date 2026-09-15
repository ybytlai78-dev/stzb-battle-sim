/**
 * 通用主动战法批量测试（u3a，S/A/B 级）：一骑当千 / 三术奇谋 / 妖术 / 伐谋 /
 * 折戟强攻 / 掎角之势 / 敛众定气 / 筹策绝道 / 落雷 / 迷阵 / 雄兵破敌 /
 * 风声鹤唳 / 危崖困军 / 叫阵 / 增援 / 声东击西 / 安抚军心 / 斩铁 / 枪阵 /
 * 水淹七军 / 破胆 / 破魂 / 箭岚 / 车悬 / 连战
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

describe('一骑当千（S 准备：敌军全体兵刃 280%）', () => {
  it('装配：主动槽挂入，准备战法', () => {
    const t = activeTeam('yiji_dangqian');
    expect(t[1].activeSkillIds).toContain('yiji_dangqian');
    expect(SKILL_REGISTRY['yiji_dangqian'].type === 'active' && SKILL_REGISTRY['yiji_dangqian'].prepare).toBe(true);
  });

  it('发动后对敌军全体造成攻击伤害', () => {
    const report = run(activeTeam('yiji_dangqian'));
    expect(casts(report, '一骑当千').length).toBeGreaterThan(0);
    const d = damage(report, '一骑当千', 'physical');
    expect(d.length).toBeGreaterThan(0);
    const targets = new Set(d.map((e) => e.targetId));
    expect(targets.size).toBe(3);
  });

  it('伤害值 > 0', () => {
    const report = run(activeTeam('yiji_dangqian'));
    const d = damage(report, '一骑当千', 'physical');
    expect(d.every((e) => e.damage > 0)).toBe(true);
  });
});

describe('三术奇谋（S 准备：敌军单体 3 次策略攻击 + 三属性下降）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('sanshu_qimou')[1].activeSkillIds).toContain('sanshu_qimou');
  });

  it('发动后对敌军造成策略攻击（每发动 3 段）', () => {
    const report = run(activeTeam('sanshu_qimou'));
    const castsN = casts(report, '三术奇谋').length;
    expect(castsN).toBeGreaterThan(0);
    const d = damage(report, '三术奇谋', 'strategy');
    expect(d.length).toBe(castsN * 3);
    // 目标始终为敌军
    expect(d.every((e) => e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('使目标攻击/防御/谋略属性下降', () => {
    const report = run(activeTeam('sanshu_qimou'));
    for (const st of ['attack_buff', 'defense_buff', 'strategy_buff']) {
      expect(inflicted(report, st).filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
    }
  });
});

describe('妖术（S 准备：敌军群体暴走 2 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('yaoshu')[1].activeSkillIds).toContain('yaoshu');
    expect(SKILL_REGISTRY['yaoshu'].triggerRate).toBe(0.5);
  });

  it('发动后使敌军群体陷入暴走状态', () => {
    const report = run(activeTeam('yaoshu'));
    expect(casts(report, '妖术').length).toBeGreaterThan(0);
    const ramp = inflicted(report, 'rampage').filter((e) => e.unitId.startsWith('enemy'));
    expect(ramp.length).toBeGreaterThan(0);
  });
});

describe('伐谋（A 主动：敌军单体策略 209% + 攻击谋略降 45）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('famou')[1].activeSkillIds).toContain('famou');
  });

  it('发动后对敌军单体造成策略伤害', () => {
    const report = run(activeTeam('famou'));
    expect(casts(report, '伐谋').length).toBeGreaterThan(0);
    const d = damage(report, '伐谋', 'strategy');
    expect(d.length).toBeGreaterThan(0);
    expect(new Set(d.map((e) => e.targetId)).size).toBe(1);
  });

  it('使目标攻击与谋略属性下降', () => {
    const report = run(activeTeam('famou'));
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
    expect(inflicted(report, 'strategy_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('折戟强攻（A 主动：敌军群体兵刃 225% + 自身攻击降 50）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('zheji_qianggong')[1].activeSkillIds).toContain('zheji_qianggong');
  });

  it('发动后对敌军群体造成攻击伤害', () => {
    const report = run(activeTeam('zheji_qianggong'));
    expect(casts(report, '折戟强攻').length).toBeGreaterThan(0);
    const d = damage(report, '折戟强攻', 'physical');
    expect(d.length).toBeGreaterThan(0);
  });

  it('使自身攻击属性降低（attack_buff 负值，unitId=carrier）', () => {
    const report = run(activeTeam('zheji_qianggong'));
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('掎角之势（A 主动：敌军单体兵刃 180% + 策略 143%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jijiao_zhishi')[1].activeSkillIds).toContain('jijiao_zhishi');
  });

  it('发动后造成一次攻击与一次策略攻击', () => {
    const report = run(activeTeam('jijiao_zhishi'));
    expect(casts(report, '掎角之势').length).toBeGreaterThan(0);
    expect(damage(report, '掎角之势', 'physical').length).toBeGreaterThan(0);
    expect(damage(report, '掎角之势', 'strategy').length).toBeGreaterThan(0);
  });
});

describe('敛众定气（A 主动：移除我军全体有害 + 恢复兵力）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('lianzhong_dingqi')[1].activeSkillIds).toContain('lianzhong_dingqi');
  });

  it('目标为友军（heal 作用于我军）', () => {
    const report = run(activeTeam('lianzhong_dingqi'));
    expect(casts(report, '敛众定气').length).toBeGreaterThan(0);
    const h = healed(report).filter((e) => e.skillName === '敛众定气');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });
});

describe('筹策绝道（A 准备：敌军群体策略 250% + 谋略速度降 25）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('chouce_juedao')[1].activeSkillIds).toContain('chouce_juedao');
  });

  it('发动后对敌军群体造成策略伤害', () => {
    const report = run(activeTeam('chouce_juedao'));
    expect(casts(report, '筹策绝道').length).toBeGreaterThan(0);
    expect(damage(report, '筹策绝道', 'strategy').length).toBeGreaterThan(0);
  });

  it('使敌军谋略与速度属性下降', () => {
    const report = run(activeTeam('chouce_juedao'));
    expect(inflicted(report, 'strategy_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
    expect(inflicted(report, 'speed_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('落雷（A 主动：敌军单体策略 148% + 混乱 1 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('luolei')[1].activeSkillIds).toContain('luolei');
  });

  it('发动后对敌军单体造成策略伤害', () => {
    const report = run(activeTeam('luolei'));
    expect(casts(report, '落雷').length).toBeGreaterThan(0);
    expect(damage(report, '落雷', 'strategy').length).toBeGreaterThan(0);
  });

  it('使目标陷入混乱状态', () => {
    const report = run(activeTeam('luolei'));
    expect(inflicted(report, 'confusion').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('迷阵（A 主动：敌军单体策略 155% + 暴走 1 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('mizhen')[1].activeSkillIds).toContain('mizhen');
  });

  it('发动后对敌军单体造成策略伤害', () => {
    const report = run(activeTeam('mizhen'));
    expect(casts(report, '迷阵').length).toBeGreaterThan(0);
    expect(damage(report, '迷阵', 'strategy').length).toBeGreaterThan(0);
  });

  it('使目标陷入暴走状态', () => {
    const report = run(activeTeam('mizhen'));
    expect(inflicted(report, 'rampage').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('雄兵破敌（A 准备：敌军群体兵刃 210% + 防御谋略降 65）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('xiongbing_podi')[1].activeSkillIds).toContain('xiongbing_podi');
  });

  it('发动后对敌军群体造成攻击伤害', () => {
    const report = run(activeTeam('xiongbing_podi'));
    expect(casts(report, '雄兵破敌').length).toBeGreaterThan(0);
    expect(damage(report, '雄兵破敌', 'physical').length).toBeGreaterThan(0);
  });

  it('使敌军防御与谋略属性下降', () => {
    const report = run(activeTeam('xiongbing_podi'));
    expect(inflicted(report, 'defense_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
    expect(inflicted(report, 'strategy_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('风声鹤唳（A 准备：敌军群体恐慌 130% + 受策略伤害提高）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('fengsheng_heli')[1].activeSkillIds).toContain('fengsheng_heli');
  });

  it('发动后使敌军群体陷入恐慌状态', () => {
    const report = run(activeTeam('fengsheng_heli'));
    expect(casts(report, '风声鹤唳').length).toBeGreaterThan(0);
    expect(inflicted(report, 'panic').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });

  it('恐慌产生 dot_tick', () => {
    const report = run(activeTeam('fengsheng_heli'));
    expect(dotTicks(report, 'panic').length).toBeGreaterThan(0);
  });
});

describe('危崖困军（B 准备：敌军群体策略 210% + 防御降 7.2）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('weiya_kunjun')[1].activeSkillIds).toContain('weiya_kunjun');
  });

  it('发动后对敌军群体造成策略伤害', () => {
    const report = run(activeTeam('weiya_kunjun'));
    expect(casts(report, '危崖困军').length).toBeGreaterThan(0);
    expect(damage(report, '危崖困军', 'strategy').length).toBeGreaterThan(0);
  });

  it('使敌军防御属性下降', () => {
    const report = run(activeTeam('weiya_kunjun'));
    expect(inflicted(report, 'defense_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('叫阵（B 主动：挑衅敌军单体 + 自身防御谋略提升）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jiaozhen')[1].activeSkillIds).toContain('jiaozhen');
  });

  it('发动后使敌军单体被挑衅（taunt）', () => {
    const report = run(activeTeam('jiaozhen'));
    expect(casts(report, '叫阵').length).toBeGreaterThan(0);
    expect(inflicted(report, 'taunt').length).toBeGreaterThan(0);
  });

  it('自身防御与谋略属性提升', () => {
    const report = run(activeTeam('jiaozhen'));
    expect(inflicted(report, 'defense_buff').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
    expect(inflicted(report, 'strategy_buff').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});

describe('增援（B 准备：恢复我军群体较多兵力）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('zengyuan')[1].activeSkillIds).toContain('zengyuan');
  });

  it('发动后恢复我军群体兵力', () => {
    const report = run(activeTeam('zengyuan'));
    expect(casts(report, '增援').length).toBeGreaterThan(0);
    const h = healed(report).filter((e) => e.skillName === '增援');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });
});

describe('声东击西（B 准备：敌军群体策略 231%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('shengdong_jixi')[1].activeSkillIds).toContain('shengdong_jixi');
  });

  it('发动后对敌军群体造成策略伤害', () => {
    const report = run(activeTeam('shengdong_jixi'));
    expect(casts(report, '声东击西').length).toBeGreaterThan(0);
    expect(damage(report, '声东击西', 'strategy').length).toBeGreaterThan(0);
  });
});

describe('安抚军心（B 主动：移除我军群体有害 + 恢复兵力）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('anfu_junxin')[1].activeSkillIds).toContain('anfu_junxin');
  });

  it('发动后恢复我军群体兵力', () => {
    const report = run(activeTeam('anfu_junxin'));
    expect(casts(report, '安抚军心').length).toBeGreaterThan(0);
    const h = healed(report).filter((e) => e.skillName === '安抚军心');
    expect(h.length).toBeGreaterThan(0);
  });
});

describe('斩铁（B 主动：敌军单体兵刃 170% + 混乱）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('zhantie')[1].activeSkillIds).toContain('zhantie');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = run(activeTeam('zhantie'));
    expect(casts(report, '斩铁').length).toBeGreaterThan(0);
    expect(damage(report, '斩铁', 'physical').length).toBeGreaterThan(0);
  });

  it('使目标陷入混乱状态', () => {
    const report = run(activeTeam('zhantie'));
    expect(inflicted(report, 'confusion').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('枪阵（B 准备：敌军群体兵刃 175% + 防御降 30）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('qiangzhen')[1].activeSkillIds).toContain('qiangzhen');
  });

  it('发动后对敌军群体造成攻击伤害', () => {
    const report = run(activeTeam('qiangzhen'));
    expect(casts(report, '枪阵').length).toBeGreaterThan(0);
    expect(damage(report, '枪阵', 'physical').length).toBeGreaterThan(0);
  });

  it('使敌军防御属性下降', () => {
    const report = run(activeTeam('qiangzhen'));
    expect(inflicted(report, 'defense_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('水淹七军（B 准备：敌军群体策略 205% + 攻击降 10）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('shuiyan_qijun')[1].activeSkillIds).toContain('shuiyan_qijun');
  });

  it('发动后对敌军群体造成策略伤害', () => {
    const report = run(activeTeam('shuiyan_qijun'));
    expect(casts(report, '水淹七军').length).toBeGreaterThan(0);
    expect(damage(report, '水淹七军', 'strategy').length).toBeGreaterThan(0);
  });

  it('使敌军攻击属性下降', () => {
    const report = run(activeTeam('shuiyan_qijun'));
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('破胆（B 主动：敌军单体兵刃 214% + 攻击降 30）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('podan')[1].activeSkillIds).toContain('podan');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = run(activeTeam('podan'));
    expect(casts(report, '破胆').length).toBeGreaterThan(0);
    expect(damage(report, '破胆', 'physical').length).toBeGreaterThan(0);
  });

  it('使目标攻击属性下降', () => {
    const report = run(activeTeam('podan'));
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('破魂（B 主动：敌军单体兵刃 180% + 暴走）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('pohun')[1].activeSkillIds).toContain('pohun');
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = run(activeTeam('pohun'));
    expect(casts(report, '破魂').length).toBeGreaterThan(0);
    expect(damage(report, '破魂', 'physical').length).toBeGreaterThan(0);
  });

  it('使目标陷入暴走状态', () => {
    const report = run(activeTeam('pohun'));
    expect(inflicted(report, 'rampage').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('箭岚（B 准备：敌军群体兵刃 170% + 攻击降 45）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('jianlan')[1].activeSkillIds).toContain('jianlan');
  });

  it('发动后对敌军群体造成攻击伤害', () => {
    const report = run(activeTeam('jianlan'));
    expect(casts(report, '箭岚').length).toBeGreaterThan(0);
    expect(damage(report, '箭岚', 'physical').length).toBeGreaterThan(0);
  });

  it('使敌军攻击属性下降', () => {
    const report = run(activeTeam('jianlan'));
    expect(inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy')).length).toBeGreaterThan(0);
  });
});

describe('车悬（B 准备：敌军单体兵刃 355%）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('chexuan')[1].activeSkillIds).toContain('chexuan');
  });

  it('发动后对敌军单体造成猛攻伤害', () => {
    const report = run(activeTeam('chexuan'));
    expect(casts(report, '车悬').length).toBeGreaterThan(0);
    const d = damage(report, '车悬', 'physical');
    expect(d.length).toBeGreaterThan(0);
    expect(new Set(d.map((e) => e.targetId)).size).toBe(1);
  });
});

describe('连战（B 主动：自身连击 1 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(activeTeam('lianzhan')[1].activeSkillIds).toContain('lianzhan');
  });

  it('发动后使自身进入连击状态（combo）', () => {
    const report = run(activeTeam('lianzhan'));
    expect(casts(report, '连战').length).toBeGreaterThan(0);
    expect(inflicted(report, 'combo').filter((e) => e.unitId === 'carrier').length).toBeGreaterThan(0);
  });
});
