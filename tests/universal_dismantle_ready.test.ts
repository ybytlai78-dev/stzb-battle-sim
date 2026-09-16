/**
 * 拆解通用战法：现有引擎可直接实装（不含受谋略缩放）。
 * 穷追猛打 / 激昂 / 疾击其后 / 扬威。
 * 每战法 3 个测试：装配挂槽、机制事件状态、数值或窗口。
 */
import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill } from '../src/engine/types';
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

function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 200;
  carrier.speed = 1;
  carrier.passiveSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function pursuitTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 200;
  carrier.speed = 80;
  carrier.attackRange = 5;
  carrier.pursuitSkillIds = [skillId];
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

describe('穷追猛打（B 一类指挥：第 4~7 回合 60% 我军群体连击）', () => {
  it('装配：指挥槽挂入，prep 阶段，roundRepeat 窗口 4~7', () => {
    const t = commandTeam('qiongzui_mengda');
    expect(t[1].commandSkillIds).toContain('qiongzui_mengda');
    const s = SKILL_REGISTRY['qiongzui_mengda'] as Extract<Skill, { type: 'command' }>;
    expect(s.type).toBe('command');
    expect(s.phase).toBe('prep');
    expect(s.roundRepeat).toEqual({ startRound: 4, endRound: 7, rate: 0.6 });
  });

  it('连击只打友军，不打敌军', () => {
    let combo: ReturnType<typeof inflicted> = [];
    for (let seed = 1; seed <= 40 && combo.length === 0; seed++) {
      combo = inflicted(run(commandTeam('qiongzui_mengda'), seed), 'combo');
    }
    expect(combo.length).toBeGreaterThan(0);
    expect(combo.every((e) => !e.unitId.startsWith('enemy'))).toBe(true);
  });

  it('连击只出现在第 4~7 回合', () => {
    const comboRounds: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      let round = 0;
      for (const ev of run(commandTeam('qiongzui_mengda'), seed).events) {
        if (ev.type === 'round_start') round = ev.round;
        if (ev.type === 'status_inflicted' && ev.statusType === 'combo') comboRounds.push(round);
      }
    }
    expect(comboRounds.length).toBeGreaterThan(0);
    expect(comboRounds.every((r) => r >= 4 && r <= 7)).toBe(true);
  });
});

describe('激昂（C 被动：每回合 30% 造成伤害提高 60%，持续 1 回合）', () => {
  it('装配：被动槽挂入，round_start', () => {
    expect(passiveTeam('ji_ang')[0].passiveSkillIds).toContain('ji_ang');
    const s = SKILL_REGISTRY['ji_ang'];
    expect(s.type === 'passive' && s.timing === 'round_start').toBe(true);
  });

  it('判定成功时施加造成侧增伤 60%', () => {
    let boost: ReturnType<typeof inflicted>[number] | undefined;
    for (let seed = 1; seed <= 80 && !boost; seed++) {
      boost = inflicted(run(passiveTeam('ji_ang'), seed), 'damage_boost').find((e) => e.unitId === 'carrier');
    }
    expect(boost).toBeDefined();
    expect(boost?.detail).toMatch(/60%/);
  });

  it('发动率基数 30%，会出现成功与失败', () => {
    const outcomes = new Set<boolean>();
    for (let seed = 1; seed <= 60 && outcomes.size < 2; seed++) {
      const triggers = run(passiveTeam('ji_ang'), seed, 4).events.filter(
        (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
          e.type === 'skill_trigger' && e.skillId === 'ji_ang'
      );
      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0].baseRate).toBe(30);
      for (const t of triggers) outcomes.add(t.success);
    }
    expect(outcomes.has(true) && outcomes.has(false)).toBe(true);
  });
});

describe('疾击其后（A 追击：随机单体 2 次，伤害率 80%~140% 独立判定）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('jiji_qihou')[0].pursuitSkillIds).toContain('jiji_qihou');
    expect(SKILL_REGISTRY['jiji_qihou'].type).toBe('pursuit');
    expect(SKILL_REGISTRY['jiji_qihou'].triggerRate).toBe(0.35);
  });

  it('每次发动打出 2 段攻击伤害', () => {
    let found = false;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const report = run(pursuitTeam('jiji_qihou'), seed);
      const n = casts(report, '疾击其后').length;
      const d = damage(report, '疾击其后');
      if (n > 0) {
        expect(d.length).toBe(n * 2);
        expect(d.every((e) => e.damage > 0)).toBe(true);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('两段目标可不同（独立选敌）', () => {
    let foundSplit = false;
    for (let seed = 1; seed <= 120 && !foundSplit; seed++) {
      const report = run(pursuitTeam('jiji_qihou'), seed);
      const d = damage(report, '疾击其后');
      for (let i = 0; i + 1 < d.length; i += 2) {
        if (d[i].targetId !== d[i + 1].targetId) foundSplit = true;
      }
    }
    expect(foundSplit).toBe(true);
  });
});

describe('扬威（B 追击：160% 猛攻 + 自身下一次攻击伤害 +20%）', () => {
  it('装配：追击槽挂入', () => {
    expect(pursuitTeam('yangwei')[0].pursuitSkillIds).toContain('yangwei');
    expect(SKILL_REGISTRY['yangwei'].type).toBe('pursuit');
  });

  it('发动后对攻击目标造成攻击伤害', () => {
    let found = false;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const report = run(pursuitTeam('yangwei'), seed);
      if (casts(report, '扬威').length > 0) {
        expect(damage(report, '扬威').length).toBeGreaterThan(0);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('发动后给自身施加下一次攻击增伤 20%', () => {
    let boost: ReturnType<typeof inflicted>[number] | undefined;
    for (let seed = 1; seed <= 80 && !boost; seed++) {
      boost = inflicted(run(pursuitTeam('yangwei'), seed), 'damage_boost').find((e) => e.unitId === 'carrier');
    }
    expect(boost).toBeDefined();
    expect(boost?.detail).toMatch(/20%/);
  });
});
