/**
 * 拆解通用 B 级以上 · 第一阶段受击链路：
 * 回马 / 空城 / 攻其不备 / 健卒不殆 / 反击之策 / 以诱待来 / 先声夺人。
 * 每战法 3 个测试：装配挂槽与字段、机制事件、窗口或数值。
 */
import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, CommandSkill, General, PassiveSkill, Position, SkillOutput } from '../src/engine/types';
import { firstOnHurt } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';

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
    morale: 100,
  };
}

function enemyTeam(): General[] {
  const front = dummy('enemy-front', '前锋');
  front.speed = 200;
  front.attack = 180;
  return [front, dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

function commandTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '中军', 10000);
  carrier.attack = 120;
  carrier.speed = 40;
  carrier.commandSkillIds = [skillId];
  return [dummy('ally-front', '前锋', 10000), carrier, dummy('ally-back', '大营', 10000)];
}

/**
 * 一类指挥挂在前锋：受击钩子（空城）需要载体被打到。
 */
function commandFront(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 120;
  carrier.speed = 40;
  carrier.commandSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 200;
  carrier.speed = 1;
  carrier.passiveSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const damage = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.skillName === name && e.damageType === 'physical'
  );

const triggers = (report: ReturnType<typeof run>, skillId: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === skillId
  );

const heals = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillName === name
  );

/** 按 round_start 给事件打回合号（准备阶段为 0）。 */
function withRound(events: BattleEvent[]): Array<{ round: number; ev: BattleEvent }> {
  let round = 0;
  return events.map((ev) => {
    if (ev.type === 'round_start') round = ev.round;
    return { round, ev };
  });
}

function asCommand(id: string): CommandSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

function asPassive(id: string): PassiveSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'passive') throw new Error(`${id} 不是被动`);
  return s;
}

function inflictStatusOf(out: SkillOutput | undefined) {
  if (!out || out.kind !== 'inflict_status' || Array.isArray(out.status)) return undefined;
  return out.status;
}

describe('回马（B 被动：受普攻反击 60%）', () => {
  it('装配：被动槽挂入，onHurt 只吃普攻，物理 60%', () => {
    expect(passiveTeam('huima')[0].passiveSkillIds).toContain('huima');
    const s = asPassive('huima');
    const oh = firstOnHurt(s.onHurt);
    expect(oh?.damageSource).toBe('basic');
    expect(oh?.output).toEqual([{ kind: 'physical_damage', rate: 60 }]);
  });

  it('机制：多 seed 存在回马物理伤害', () => {
    let hits: ReturnType<typeof damage> = [];
    for (let seed = 1; seed <= 40 && hits.length === 0; seed++) {
      hits = damage(run(passiveTeam('huima'), seed), '回马');
    }
    expect(hits.length).toBeGreaterThan(0);
  });

  it('数值：回马伤害来自打到载体的普攻反击', () => {
    let report: ReturnType<typeof run> | undefined;
    for (let seed = 1; seed <= 40; seed++) {
      const r = run(passiveTeam('huima'), seed);
      if (damage(r, '回马').length > 0) {
        report = r;
        break;
      }
    }
    expect(report).toBeDefined();
    const hits = report!.events.filter(
      (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
        e.type === 'attack_hit' && e.targetId === 'carrier'
    );
    const huima = damage(report!, '回马');
    expect(hits.length).toBeGreaterThan(0);
    expect(huima.length).toBeGreaterThan(0);
    expect(huima.every((d) => d.sourceId === 'carrier')).toBe(true);
    expect(huima.every((d) => hits.some((h) => h.sourceId === d.targetId && h.targetId === 'carrier'))).toBe(true);
  });
});

describe('空城（B 一类指挥：前 2 回合受击 70% 规避当次）', () => {
  it('装配：prep，before_damage，endRound 2，rate 0.7', () => {
    expect(commandFront('kongcheng')[0].commandSkillIds).toContain('kongcheng');
    const s = asCommand('kongcheng');
    expect(s.phase).toBe('prep');
    const oh = firstOnHurt(s.onHurt);
    expect(oh?.timing).toBe('before_damage');
    expect(oh?.endRound).toBe(2);
    expect(oh?.rate).toBe(0.7);
  });

  it('机制：多 seed 第 1～2 回合出现 evasion_blocked', () => {
    let blocked = 0;
    for (let seed = 1; seed <= 40 && blocked === 0; seed++) {
      for (const { round, ev } of withRound(run(commandFront('kongcheng'), seed).events)) {
        if (ev.type === 'evasion_blocked' && round >= 1 && round <= 2) blocked += 1;
      }
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it('窗口：evasion_blocked 全部落在回合 ≤2', () => {
    const rounds: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      for (const { round, ev } of withRound(run(commandFront('kongcheng'), seed).events)) {
        if (ev.type === 'evasion_blocked') rounds.push(round);
      }
    }
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.every((r) => r <= 2)).toBe(true);
  });
});

describe('攻其不备（S 一类指挥：锁 2 目标，受物理伤害 taken +11.6%，最多 5 层）', () => {
  it('装配：groupCount 2，victim locked，maxStacks 5，speedScaled 无成长率', () => {
    expect(commandTeam('gongqi_bubei')[1].commandSkillIds).toContain('gongqi_bubei');
    const s = asCommand('gongqi_bubei');
    expect(s.groupCount).toBe(2);
    const oh = firstOnHurt(s.onHurt);
    expect(oh?.victim).toBe('locked');
    expect(oh?.maxStacks).toBe(5);
    const st = inflictStatusOf(oh?.output?.[0]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.speedScaled).toBe(true);
      expect(st.growthRate).toBeUndefined();
      expect(st.rate).toBe(0.116);
    }
  });

  it('机制：锁定目标叠 taken；unitId ⊆ skill_target；ally-back 不叠', () => {
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const report = run(commandTeam('gongqi_bubei'), seed);
      const targetEv = report.events.find(
        (e): e is Extract<BattleEvent, { type: 'skill_target' }> =>
          e.type === 'skill_target' && e.skillId === 'gongqi_bubei'
      );
      const boosts = inflicted(report, 'damage_boost');
      if (!targetEv || boosts.length === 0) continue;
      found = true;
      const locked = new Set(targetEv.targetIds);
      expect(boosts.every((b) => locked.has(b.unitId))).toBe(true);
      expect(boosts.some((b) => b.unitId === 'ally-back')).toBe(false);
      expect(boosts.every((b) => b.detail.includes('受到的'))).toBe(true);
    }
    expect(found).toBe(true);
  });

  it('数值：同目标叠层 ≤5；rate 为 0.116 的倍数', () => {
    let saw = false;
    for (let seed = 1; seed <= 40; seed++) {
      const report = run(commandTeam('gongqi_bubei'), seed);
      const stacks = new Map<string, number>();
      let round = 0;
      let pendingVictim: string | undefined;
      for (const ev of report.events) {
        if (ev.type === 'round_start') round = ev.round;
        if (ev.type === 'attack_hit' || (ev.type === 'damage' && ev.damageType === 'physical')) {
          pendingVictim = ev.targetId;
        }
        if (ev.type === 'skill_cast' && ev.skillName === '攻其不备' && round > 0 && pendingVictim) {
          stacks.set(pendingVictim, (stacks.get(pendingVictim) ?? 0) + 1);
        }
      }
      if (stacks.size === 0) continue;
      saw = true;
      expect([...stacks.values()].every((n) => n <= 5)).toBe(true);
      for (const b of inflicted(report, 'damage_boost')) {
        const m = b.detail.match(/(\d+)%/);
        expect(m).toBeTruthy();
        const rate = Number(m![1]) / 100;
        const layers = Math.round(rate / 0.116);
        expect(Math.abs(layers * 0.116 - rate)).toBeLessThan(0.02);
        expect(rate).toBeLessThanOrEqual(0.116 * 5 + 1e-9);
      }
    }
    expect(saw).toBe(true);
  });
});

describe('健卒不殆（A 被动：受普攻反击 40%；50% 本次伤害降低 50%）', () => {
  it('装配：onHurt 数组两条，basic 40 与 thisHitReduce 0.5', () => {
    expect(passiveTeam('jianzu_budai')[0].passiveSkillIds).toContain('jianzu_budai');
    const s = asPassive('jianzu_budai');
    expect(Array.isArray(s.onHurt)).toBe(true);
    const hooks = s.onHurt;
    if (!Array.isArray(hooks)) throw new Error('健卒 onHurt 应为数组');
    expect(hooks).toHaveLength(2);
    expect(hooks[0].damageSource).toBe('basic');
    expect(hooks[0].output?.[0]).toMatchObject({ kind: 'physical_damage', rate: 40 });
    expect(hooks[1].thisHitReduce).toBe(0.5);
    expect(hooks[1].rate).toBe(0.5);
  });

  it('机制：存在健卒不殆反击伤害与 skill_trigger', () => {
    let dmg: ReturnType<typeof damage> = [];
    let trig: ReturnType<typeof triggers> = [];
    for (let seed = 1; seed <= 80 && (dmg.length === 0 || trig.length === 0); seed++) {
      const report = run(passiveTeam('jianzu_budai'), seed);
      if (dmg.length === 0) dmg = damage(report, '健卒不殆');
      if (trig.length === 0) trig = triggers(report, 'jianzu_budai');
    }
    expect(dmg.length).toBeGreaterThan(0);
    expect(trig.length).toBeGreaterThan(0);
  });

  it('独立判定：某场报告可同时出现反击 damage 与减伤 skill_trigger', () => {
    let both = false;
    for (let seed = 1; seed <= 80 && !both; seed++) {
      const report = run(passiveTeam('jianzu_budai'), seed);
      both = damage(report, '健卒不殆').length > 0 && triggers(report, 'jianzu_budai').length > 0;
    }
    expect(both).toBe(true);
  });
});

describe('反击之策（B 一类指挥：前 3 回合 75% 友军反击 100%）', () => {
  it('装配：roundStartRepeat endRound 3，chance 0.75，counter.rate 100', () => {
    expect(commandTeam('fanji_zhice')[1].commandSkillIds).toContain('fanji_zhice');
    const s = asCommand('fanji_zhice');
    expect(s.roundStartRepeat?.endRound).toBe(3);
    const out = s.roundStartRepeat?.output[0];
    expect(out && 'chance' in out ? out.chance : undefined).toBe(0.75);
    const st = inflictStatusOf(out);
    expect(st?.type).toBe('counter');
    if (st?.type === 'counter') expect(st.rate).toBe(100);
  });

  it('机制：多 seed 友军出现 counter，敌军不应有', () => {
    let counters: ReturnType<typeof inflicted> = [];
    for (let seed = 1; seed <= 40 && counters.length === 0; seed++) {
      counters = inflicted(run(commandTeam('fanji_zhice'), seed), 'counter');
    }
    expect(counters.length).toBeGreaterThan(0);
    expect(counters.every((e) => !e.unitId.startsWith('enemy'))).toBe(true);
    expect(counters.every((e) => e.unitId === 'carrier' || e.unitId.startsWith('ally'))).toBe(true);
  });

  it('窗口：counter 只在回合 1～3 施加；第 4 回合起无 skill_trigger', () => {
    const infRounds: number[] = [];
    const triggerRounds: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      for (const { round, ev } of withRound(run(commandTeam('fanji_zhice'), seed).events)) {
        if (ev.type === 'status_inflicted' && ev.statusType === 'counter') infRounds.push(round);
        if (ev.type === 'skill_trigger' && ev.skillId === 'fanji_zhice') triggerRounds.push(round);
      }
    }
    expect(infRounds.length).toBeGreaterThan(0);
    expect(infRounds.every((r) => r >= 1 && r <= 3)).toBe(true);
    expect(triggerRounds.every((r) => r <= 3)).toBe(true);
  });
});

describe('以诱待来（A 被动：50% 挑衅来源；来源挑衅自己时恢复 150%）', () => {
  it('装配：数组两条，taunt duration 2，heal 不受谋略', () => {
    expect(passiveTeam('yiyou_dailai')[0].passiveSkillIds).toContain('yiyou_dailai');
    const s = asPassive('yiyou_dailai');
    expect(Array.isArray(s.onHurt)).toBe(true);
    const hooks = s.onHurt;
    if (!Array.isArray(hooks)) throw new Error('以诱待来 onHurt 应为数组');
    expect(hooks).toHaveLength(2);
    const taunt = inflictStatusOf(hooks[0].output?.[0]);
    expect(taunt?.type).toBe('taunt');
    if (taunt?.type === 'taunt') expect(taunt.duration).toBe(2);
    const heal = hooks[1].output?.[0];
    expect(heal?.kind).toBe('heal');
    if (heal?.kind === 'heal') {
      expect(heal.strategyScaled).toBe(false);
      expect(heal.growthRate).toBe(0);
    }
  });

  it('机制：多 seed 敌军出现 taunt，载体出现 heal', () => {
    let tauntOnEnemy = false;
    let healOnCarrier = false;
    for (let seed = 1; seed <= 80 && !(tauntOnEnemy && healOnCarrier); seed++) {
      const report = run(passiveTeam('yiyou_dailai'), seed);
      tauntOnEnemy = inflicted(report, 'taunt').some((e) => e.unitId.startsWith('enemy'));
      healOnCarrier = heals(report, '以诱待来').some((e) => e.targetId === 'carrier');
    }
    expect(tauntOnEnemy).toBe(true);
    expect(healOnCarrier).toBe(true);
  });

  it('数值：heal 事件序在 taunt 之后', () => {
    let checked = false;
    for (let seed = 1; seed <= 80; seed++) {
      const report = run(passiveTeam('yiyou_dailai'), seed);
      const tagged = withRound(report.events);
      let lastTaunt = -1;
      tagged.forEach(({ ev }, i) => {
        if (ev.type === 'status_inflicted' && ev.statusType === 'taunt') lastTaunt = i;
        if (ev.type === 'heal' && ev.skillName === '以诱待来') {
          expect(lastTaunt).toBeGreaterThanOrEqual(0);
          expect(lastTaunt).toBeLessThan(i);
          checked = true;
        }
      });
      if (checked) break;
    }
    expect(checked).toBe(true);
  });
});

describe('先声夺人（A 被动：前 3 回合行动时连击 / 分兵 / 单体攻击各 60%）', () => {
  it('装配：round_start，endRound 3，三段 chance 0.6', () => {
    expect(passiveTeam('xiansheng_duoren')[0].passiveSkillIds).toContain('xiansheng_duoren');
    const s = asPassive('xiansheng_duoren');
    expect(s.timing).toBe('round_start');
    expect(s.endRound).toBe(3);
    expect(s.output).toHaveLength(3);
    expect(s.output.every((o) => 'chance' in o && o.chance === 0.6)).toBe(true);
  });

  it('机制：多 seed 出现 combo 或 split 或先声夺人物理伤害', () => {
    let hit = false;
    for (let seed = 1; seed <= 40 && !hit; seed++) {
      const report = run(passiveTeam('xiansheng_duoren'), seed);
      hit =
        inflicted(report, 'combo').length > 0 ||
        inflicted(report, 'split').length > 0 ||
        damage(report, '先声夺人').length > 0;
    }
    expect(hit).toBe(true);
  });

  it('窗口：效果只在回合 1～3；第 4 回合无 skill_cast / skill_trigger', () => {
    const effectRounds: number[] = [];
    const lateCast: number[] = [];
    const lateTrig: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      for (const { round, ev } of withRound(run(passiveTeam('xiansheng_duoren'), seed).events)) {
        const isEffect =
          (ev.type === 'status_inflicted' && (ev.statusType === 'combo' || ev.statusType === 'split')) ||
          (ev.type === 'damage' && ev.skillName === '先声夺人') ||
          (ev.type === 'split_damage');
        if (isEffect) effectRounds.push(round);
        if (ev.type === 'skill_cast' && ev.skillName === '先声夺人' && round >= 4) lateCast.push(round);
        if (ev.type === 'skill_trigger' && ev.skillId === 'xiansheng_duoren' && round >= 4) lateTrig.push(round);
      }
    }
    expect(effectRounds.length).toBeGreaterThan(0);
    expect(effectRounds.every((r) => r >= 1 && r <= 3)).toBe(true);
    expect(lateCast).toHaveLength(0);
    expect(lateTrig).toHaveLength(0);
  });
});
