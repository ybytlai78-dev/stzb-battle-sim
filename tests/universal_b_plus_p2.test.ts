/**
 * 拆解通用 B 级以上 · 第二阶段兵种阵型：
 * 方圆 / 疏数 / 衡轭 / 锋矢 / 鱼鳞 / 鹤翼 / 白刃 / 全军突击 / 飒沓如星。
 * 每战法 3 个测试：装配挂槽与字段、机制事件/状态、窗口或兵种。
 */
import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type {
  BattleEvent,
  CommandSkill,
  General,
  Position,
  Skill,
  SkillOutput,
  TroopType,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  triggerActiveSkill,
  triggerCommandSkills,
  tickRoundStartStatuses,
  type CombatContext,
} from '../src/engine/action';
import { Rng } from '../src/engine/rng';

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
 * 一类指挥挂在前锋：受击钩子需要载体被打到。
 */
function commandFront(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 120;
  carrier.speed = 40;
  carrier.commandSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

/**
 * 主动战法挂前锋；morale 140 便于发动（装配测仍不依赖发动成功）。
 */
function activeTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.activeSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

/** 给整队设兵种（骑兵/弓兵木桩）。 */
function withTroop(team: General[], troopType: TroopType): General[] {
  for (const g of team) g.troopType = troopType;
  return team;
}

/** 按站位设三种兵种（前锋/中军/大营）。 */
function withTroops(team: General[], types: [TroopType, TroopType, TroopType]): General[] {
  team[0].troopType = types[0];
  team[1].troopType = types[1];
  team[2].troopType = types[2];
  return team;
}

function asCommand(id: string): CommandSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
}

function inflictStatusOf(out: SkillOutput | undefined) {
  if (!out || out.kind !== 'inflict_status' || Array.isArray(out.status)) return undefined;
  return out.status;
}

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

/** 按 round_start 给事件打回合号（准备阶段为 0）。 */
function withRound(events: BattleEvent[]): Array<{ round: number; ev: BattleEvent }> {
  let round = 0;
  return events.map((ev) => {
    if (ev.type === 'round_start') round = ev.round;
    return { round, ev };
  });
}

function unitFrom(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
    hasActedThisRound: false,
  };
}

function makeCtx(my: General[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: enemyTeam().map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
  };
}

/** 准备阶段释放一类指挥，返回 ctx（可查 statuses）。 */
function prepCommand(skillId: string, team: General[], seed = 1): CombatContext {
  const ctx = makeCtx(team, seed);
  const caster = ctx.myTeam.find((u) => u.general.commandSkillIds.includes(skillId));
  if (!caster) throw new Error(`无载体 ${skillId}`);
  triggerCommandSkills(ctx, caster);
  return ctx;
}

/** 多 seed 尝试发动主动，成功则返回 ctx。 */
function fireActive(skillId: string, team: General[], maxSeed = 80): CombatContext | undefined {
  const skill = SKILL_REGISTRY[skillId];
  for (let seed = 1; seed <= maxSeed; seed++) {
    const ctx = makeCtx(team, seed);
    ctx.currentRound = 1;
    const caster = ctx.myTeam.find((u) => u.general.activeSkillIds.includes(skillId));
    if (!caster) throw new Error(`无载体 ${skillId}`);
    triggerActiveSkill(ctx, caster, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    if (ctx.events.some((e) => e.type === 'skill_cast' && e.skillId === skillId)) return ctx;
  }
  return undefined;
}

describe('方圆（B 一类指挥：步兵普攻 −20%，主动/追击 +16.8%）', () => {
  it('装配：range 3 groupCount 3，两条 inflict troopTypes infantry', () => {
    expect(commandTeam('fangyuan')[1].commandSkillIds).toContain('fangyuan');
    const s = asCommand('fangyuan');
    expect(s.range).toBe(3);
    expect(s.groupCount).toBe(3);
    expect(s.output).toHaveLength(2);
    expect(s.output.every((o) => o.kind === 'inflict_status' && o.troopTypes?.[0] === 'infantry')).toBe(true);
  });

  it('机制：三步兵队伍 run 后步兵有 damageSource basic 的 caused −0.2', () => {
    const team = commandTeam('fangyuan');
    const ctx = prepCommand('fangyuan', team);
    for (const u of ctx.myTeam) {
      const basic = u.statuses.find(
        (st) => st.type === 'damage_boost' && 'damageSource' in st && st.damageSource === 'basic'
      );
      expect(basic).toBeTruthy();
      if (basic?.type === 'damage_boost') {
        expect(basic.rate).toBe(-0.2);
        expect(basic.direction).toBe('caused');
      }
    }
    const report = run(team);
    expect(inflicted(report, 'damage_boost').some((e) => e.detail.includes('降低 20%'))).toBe(true);
  });

  it('窗口：步兵主动/追击分流，skillTypes 含 pursuit', () => {
    const ctx = prepCommand('fangyuan', commandTeam('fangyuan'));
    const skillBoost = ctx.myTeam[0].statuses.find(
      (st) => st.type === 'damage_boost' && 'damageSource' in st && st.damageSource === 'skill'
    );
    expect(skillBoost).toBeTruthy();
    if (skillBoost?.type === 'damage_boost') {
      expect(skillBoost.skillTypes).toEqual(['active', 'pursuit']);
      expect(skillBoost.skillTypes).toContain('pursuit');
      expect(skillBoost.rate).toBe(0.168);
    }
  });
});

describe('疏数（B 一类指挥：仅弓+骑；弓兵防御 +50）', () => {
  it('装配：teamTroopFilter 弓+骑', () => {
    expect(commandTeam('shushu')[1].commandSkillIds).toContain('shushu');
    const s = asCommand('shushu');
    expect(s.teamTroopFilter).toEqual(['archer', 'cavalry']);
  });

  it('机制：弓+骑+步 run 无 skill_cast 疏数', () => {
    const team = withTroops(commandTeam('shushu'), ['archer', 'cavalry', 'infantry']);
    const report = run(team);
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillName === '疏数')).toBe(false);
  });

  it('窗口：弓+骑队伍弓兵 defense_buff 50', () => {
    const team = withTroops(commandTeam('shushu'), ['archer', 'cavalry', 'archer']);
    const ctx = prepCommand('shushu', team);
    const archers = ctx.myTeam.filter((u) => u.general.troopType === 'archer');
    const cavs = ctx.myTeam.filter((u) => u.general.troopType === 'cavalry');
    expect(archers.every((u) => u.statuses.some((st) => st.type === 'defense_buff' && st.amount === 50))).toBe(true);
    expect(cavs.every((u) => u.statuses.every((st) => st.type !== 'defense_buff'))).toBe(true);
  });
});

describe('衡轭（B 一类指挥：仅骑+步；骑兵谋略 +50，步兵普攻 +50%）', () => {
  it('装配：teamTroopFilter 骑+步', () => {
    expect(commandTeam('henge')[1].commandSkillIds).toContain('henge');
    expect(asCommand('henge').teamTroopFilter).toEqual(['cavalry', 'infantry']);
  });

  it('机制：骑兵 strategy_buff 50', () => {
    const team = withTroops(commandTeam('henge'), ['cavalry', 'cavalry', 'infantry']);
    const ctx = prepCommand('henge', team);
    const cavs = ctx.myTeam.filter((u) => u.general.troopType === 'cavalry');
    expect(cavs.every((u) => u.statuses.some((st) => st.type === 'strategy_buff' && st.amount === 50))).toBe(true);
  });

  it('窗口：步兵 caused basic +0.5', () => {
    const team = withTroops(commandTeam('henge'), ['cavalry', 'infantry', 'infantry']);
    const ctx = prepCommand('henge', team);
    const inf = ctx.myTeam.filter((u) => u.general.troopType === 'infantry');
    for (const u of inf) {
      const boost = u.statuses.find((st) => st.type === 'damage_boost');
      expect(boost).toBeTruthy();
      if (boost?.type === 'damage_boost') {
        expect(boost.rate).toBe(0.5);
        expect(boost.direction).toBe('caused');
        expect(boost.damageSource).toBe('basic');
      }
    }
  });
});

describe('锋矢（B 一类指挥：骑兵普攻 −25%，仅主动 +18%）', () => {
  it('装配：骑兵 basic −0.25', () => {
    const team = withTroop(commandTeam('fengshi'), 'cavalry');
    expect(team[1].commandSkillIds).toContain('fengshi');
    const st = inflictStatusOf(asCommand('fengshi').output[0]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(-0.25);
      expect(st.damageSource).toBe('basic');
      expect(st.direction).toBe('caused');
    }
    const out0 = asCommand('fengshi').output[0];
    expect(out0.kind).toBe('inflict_status');
    if (out0.kind === 'inflict_status') expect(out0.troopTypes).toEqual(['cavalry']);
    const ctx = prepCommand('fengshi', team);
    for (const u of ctx.myTeam) {
      const basic = u.statuses.find(
        (s) => s.type === 'damage_boost' && 'damageSource' in s && s.damageSource === 'basic'
      );
      expect(basic).toBeTruthy();
      if (basic?.type === 'damage_boost') expect(basic.rate).toBe(-0.25);
    }
  });

  it('机制：第二条 skillTypes 仅 active', () => {
    const st = inflictStatusOf(asCommand('fengshi').output[1]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.skillTypes).toEqual(['active']);
      expect(st.damageSource).toBe('skill');
      expect(st.rate).toBe(0.18);
    }
  });

  it('窗口：步兵队伍挂锋矢，步兵无这些 boost', () => {
    const ctx = prepCommand('fengshi', commandTeam('fengshi'));
    expect(ctx.myTeam.every((u) => u.general.troopType === 'infantry')).toBe(true);
    expect(ctx.myTeam.every((u) => u.statuses.filter((st) => st.type === 'damage_boost').length === 0)).toBe(true);
  });
});

describe('鱼鳞（B 一类指挥：仅步+弓；步兵防御 +50，弓兵策略 taken −35%）', () => {
  it('装配：teamTroopFilter 步+弓', () => {
    expect(commandTeam('yulin')[1].commandSkillIds).toContain('yulin');
    expect(asCommand('yulin').teamTroopFilter).toEqual(['infantry', 'archer']);
  });

  it('机制：步兵防御 +50', () => {
    const team = withTroops(commandTeam('yulin'), ['infantry', 'infantry', 'archer']);
    const ctx = prepCommand('yulin', team);
    const inf = ctx.myTeam.filter((u) => u.general.troopType === 'infantry');
    expect(inf.every((u) => u.statuses.some((st) => st.type === 'defense_buff' && st.amount === 50))).toBe(true);
  });

  it('窗口：弓兵 taken −0.35 damageType strategy', () => {
    const team = withTroops(commandTeam('yulin'), ['infantry', 'archer', 'archer']);
    const ctx = prepCommand('yulin', team);
    const archers = ctx.myTeam.filter((u) => u.general.troopType === 'archer');
    for (const u of archers) {
      const boost = u.statuses.find((st) => st.type === 'damage_boost');
      expect(boost).toBeTruthy();
      if (boost?.type === 'damage_boost') {
        expect(boost.rate).toBe(-0.35);
        expect(boost.direction).toBe('taken');
        expect(boost.damageType).toBe('strategy');
      }
    }
  });
});

describe('鹤翼（B 一类指挥：奇数回合弓兵分兵 49% 持续 1 回合）', () => {
  it('装配：oddRounds true、output 空', () => {
    expect(commandFront('heyi')[0].commandSkillIds).toContain('heyi');
    const s = asCommand('heyi');
    expect(s.output).toEqual([]);
    expect(s.roundStartRepeat?.oddRounds).toBe(true);
  });

  it('机制：run maxRounds 2，第 1 回合弓兵有 split，第 2 回合 split 已尽', () => {
    const team = withTroop(commandTeam('heyi'), 'archer');
    const tagged = withRound(run(team, 1, 2).events);
    const r1split = tagged.some(
      ({ round, ev }) => round === 1 && ev.type === 'status_inflicted' && ev.statusType === 'split'
    );
    const r2split = tagged.some(
      ({ round, ev }) => round === 2 && ev.type === 'status_inflicted' && ev.statusType === 'split'
    );
    const r2splitDmg = tagged.some(({ round, ev }) => round === 2 && ev.type === 'split_damage');
    expect(r1split).toBe(true);
    expect(r2split).toBe(false);
    expect(r2splitDmg).toBe(false);
  });

  it('窗口：骑兵挂鹤翼无 split', () => {
    const team = withTroop(commandTeam('heyi'), 'cavalry');
    const ctx = prepCommand('heyi', team);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    expect(ctx.myTeam.every((u) => u.statuses.every((st) => st.type !== 'split'))).toBe(true);
    const report = run(team, 1, 2);
    expect(inflicted(report, 'split')).toHaveLength(0);
  });
});

describe('白刃（A 一类指挥：前 3 回合策略 −35%；骑/步防 +45；第 4 回合攻 +45）', () => {
  it('装配：两段 targetSide ally/enemy all 策略 −0.35 duration 3', () => {
    expect(commandTeam('bairen')[1].commandSkillIds).toContain('bairen');
    const s = asCommand('bairen');
    expect(s.output[0].kind).toBe('inflict_status');
    expect(s.output[1].kind).toBe('inflict_status');
    if (s.output[0].kind === 'inflict_status') {
      expect(s.output[0].targetSide).toBe('ally');
      expect(s.output[0].targetMode).toBe('all');
    }
    if (s.output[1].kind === 'inflict_status') {
      expect(s.output[1].targetSide).toBe('enemy');
      expect(s.output[1].targetMode).toBe('all');
    }
    const ally = inflictStatusOf(s.output[0]);
    const enemy = inflictStatusOf(s.output[1]);
    for (const st of [ally, enemy]) {
      expect(st?.type).toBe('damage_boost');
      if (st?.type === 'damage_boost') {
        expect(st.rate).toBe(-0.35);
        expect(st.duration).toBe(3);
        expect(st.direction).toBe('caused');
        expect(st.damageType).toBe('strategy');
      }
    }
  });

  it('机制：骑/步 defense 45', () => {
    const team = withTroops(commandTeam('bairen'), ['cavalry', 'infantry', 'infantry']);
    const ctx = prepCommand('bairen', team);
    expect(
      ctx.myTeam.every((u) => u.statuses.some((st) => st.type === 'defense_buff' && st.amount === 45))
    ).toBe(true);
  });

  it('窗口：run 到第 4 回合骑/步出现 attack_buff 45', () => {
    const team = withTroops(commandTeam('bairen'), ['cavalry', 'infantry', 'infantry']);
    const tagged = withRound(run(team, 1, 4).events);
    expect(tagged.some(({ ev }) => ev.type === 'round_start' && ev.round === 4)).toBe(true);
    const atk = tagged.filter(
      ({ round, ev }) => round === 4 && ev.type === 'status_inflicted' && ev.statusType === 'attack_buff'
    );
    expect(atk.length).toBeGreaterThan(0);
    expect(
      atk.every(
        (row) => row.ev.type === 'status_inflicted' && row.ev.detail.includes('45') && !row.ev.unitId.startsWith('enemy')
      )
    ).toBe(true);
  });
});

describe('全军突击（A 主动 35%：驱散骑/步 + 单体攻击 145% + 下 2 次 +28%）', () => {
  it('装配：active 0.35 range 4 group 3 ally', () => {
    expect(activeTeam('quanjun_tuji')[0].activeSkillIds).toContain('quanjun_tuji');
    const s = asActive('quanjun_tuji');
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(4);
    expect(s.groupCount).toBe(3);
    expect(s.targetSide).toBe('ally');
    expect(s.prepare).toBe(false);
  });

  it('机制：output 三段 kind', () => {
    const s = asActive('quanjun_tuji');
    expect(s.output.map((o) => o.kind)).toEqual(['remove_debuffs', 'physical_damage', 'inflict_status']);
    expect(s.output[0].kind === 'remove_debuffs' && s.output[0].troopTypes).toEqual(['cavalry', 'infantry']);
    expect(s.output[1].kind === 'physical_damage' && s.output[1].rate).toBe(145);
  });

  it('窗口：骑兵 charges 2 caused 0.28', () => {
    const st = inflictStatusOf(asActive('quanjun_tuji').output[2]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.charges).toBe(2);
      expect(st.rate).toBe(0.28);
      expect(st.direction).toBe('caused');
    }
    const ctx = fireActive('quanjun_tuji', withTroop(activeTeam('quanjun_tuji'), 'cavalry'));
    expect(ctx).toBeDefined();
    const boosted = ctx!.myTeam.filter((u) =>
      u.statuses.some((s) => s.type === 'damage_boost' && 'charges' in s && s.charges === 2 && s.rate === 0.28)
    );
    expect(boosted.length).toBeGreaterThan(0);
  });
});

describe('飒沓如星（B 主动 40%：骑兵普攻 +36% 持续 2，下 2 次分兵 55%）', () => {
  it('装配：groupCount 2', () => {
    expect(activeTeam('sata_ruxing')[0].activeSkillIds).toContain('sata_ruxing');
    const s = asActive('sata_ruxing');
    expect(s.groupCount).toBe(2);
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(2);
    expect(s.targetSide).toBe('ally');
  });

  it('机制：骑兵 basic +0.36 duration 2', () => {
    const st = inflictStatusOf(asActive('sata_ruxing').output[0]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(0.36);
      expect(st.duration).toBe(2);
      expect(st.damageSource).toBe('basic');
      expect(st.direction).toBe('caused');
    }
    const ctx = fireActive('sata_ruxing', withTroop(activeTeam('sata_ruxing'), 'cavalry'));
    expect(ctx).toBeDefined();
    const boosted = ctx!.myTeam.filter((u) =>
      u.statuses.some(
        (s) => s.type === 'damage_boost' && s.damageSource === 'basic' && s.rate === 0.36 && s.remaining === 2
      )
    );
    expect(boosted.length).toBeGreaterThan(0);
  });

  it('窗口：split charges 2 rate 55', () => {
    const st = inflictStatusOf(asActive('sata_ruxing').output[1]);
    expect(st?.type).toBe('split');
    if (st?.type === 'split') {
      expect(st.charges).toBe(2);
      expect(st.rate).toBe(55);
    }
    const ctx = fireActive('sata_ruxing', withTroop(activeTeam('sata_ruxing'), 'cavalry'));
    expect(ctx).toBeDefined();
    const splitters = ctx!.myTeam.filter((u) =>
      u.statuses.some((s) => s.type === 'split' && s.charges === 2 && s.rate === 55)
    );
    expect(splitters.length).toBeGreaterThan(0);
  });
});
