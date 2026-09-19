/**
 * 拆解通用 B+ 第十四阶段 · 指挥时机（S 级 2 个）：
 * 众谋不懈（试图发动主动/追击前 40% → 距离 5 内敌军单体策略 194%）、
 * 反计之策（前 3 回合敌军主动伤害降至下限 10% + 首回合犹豫）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  actUnit,
  applyDamage,
  inflictStatus,
  triggerActiveSkill,
  triggerBeforeActiveCommands,
  triggerCommandSkills,
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
    morale: 140,
  };
}

function enemyTeam(): General[] {
  const front = dummy('enemy-front', '前锋');
  front.speed = 200;
  front.attack = 180;
  return [front, dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function commandTeam(skillId: string, position: Position = '中军'): General[] {
  const carrier = dummy('carrier', position, 10000);
  carrier.commandSkillIds = [skillId];
  return [dummy('ally-front', '前锋', 10000), carrier, dummy('ally-back', '大营', 10000)];
}

function asCommand(id: string): Extract<Skill, { type: 'command' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
}

function asPursuit(id: string): Extract<Skill, { type: 'pursuit' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'pursuit') throw new Error(`${id} 不是追击`);
  return s;
}

function inflictStatusOf(out: SkillOutput | undefined) {
  if (!out || out.kind !== 'inflict_status' || Array.isArray(out.status)) return undefined;
  return out.status;
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
    isPreparing: false,
    preparingSkillId: null,
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
    currentRound: 1,
  };
}

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

const hasStatus = (u: UnitState, type: string) => u.statuses.some((s) => s.type === type);
const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);

describe('众谋不懈（S 指挥：试图发动主动/追击前 40% → 距离 5 内敌军单体策略 194%）', () => {
  it('装配：二类指挥 before_active、random_single、range 5；主动段 chance 0.4、追击段 chance_group 0.4', () => {
    const s = asCommand('zhongmou_buxie');
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('before_active');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('random_single');
    const dmg = s.output[0];
    expect(dmg.kind).toBe('strategy_damage');
    if (dmg.kind === 'strategy_damage') {
      expect(dmg.rate).toBe(194);
      expect(dmg.strategyScaled).toBe(true);
      expect(dmg.growthRate).toBeUndefined();
      expect(dmg.chance).toBe(0.4);
      expect(dmg.targetMode).toBe('random_single');
    }
    const pursuitOut = s.onPursuitAttempt?.output[0];
    expect(pursuitOut?.kind).toBe('chance_group');
    if (pursuitOut?.kind === 'chance_group') {
      expect(pursuitOut.chance).toBe(0.4);
      expect(pursuitOut.outputs[0].kind).toBe('strategy_damage');
    }
  });

  it('窗口（主动侧）：before_active 判定成功 → 打出一次策略伤害（40% 几率）', () => {
    const ctx = makeCtx(commandTeam('zhongmou_buxie'));
    const carrier = ctx.myTeam[1];
    const s = asCommand('zhongmou_buxie');
    // 把主动段 chance 改 1 / 0 验证闸门
    ctx.skills.set('zhongmou_buxie', {
      ...s,
      output: [{ kind: 'strategy_damage', rate: 194, strategyScaled: true, chance: 1, targetMode: 'random_single' }],
    });
    triggerBeforeActiveCommands(ctx, carrier);
    const hits = damageEvents(ctx, 'zhongmou_buxie');
    expect(hits).toHaveLength(1);
    expect(hits[0].damageType).toBe('strategy');

    const ctx0 = makeCtx(commandTeam('zhongmou_buxie'));
    ctx0.skills.set('zhongmou_buxie', {
      ...s,
      output: [{ kind: 'strategy_damage', rate: 194, strategyScaled: true, chance: 0, targetMode: 'random_single' }],
    });
    triggerBeforeActiveCommands(ctx0, ctx0.myTeam[1]);
    expect(damageEvents(ctx0, 'zhongmou_buxie')).toHaveLength(0);
  });

  it('窗口（追击侧）：「试图发动追击战法」即判定（追击未发动也触发 40% 段）', () => {
    const team = commandTeam('zhongmou_buxie');
    team[1].pursuitSkillIds = ['quzhu'];
    const ctx = makeCtx(team);
    const carrier = ctx.myTeam[1];
    const s = asCommand('zhongmou_buxie');
    ctx.skills.set('zhongmou_buxie', {
      ...s,
      onPursuitAttempt: {
        output: [{ kind: 'chance_group', chance: 1, outputs: [{ kind: 'strategy_damage', rate: 194, strategyScaled: true, targetMode: 'random_single' }] }],
      },
    });
    // 追击发动率 0：只「试图发动」，众谋不懈仍应打出策略伤害
    ctx.skills.set('quzhu', { ...asPursuit('quzhu'), triggerRate: 0 });
    ctx.currentRound = 1;
    actUnit(ctx, carrier);
    expect(damageEvents(ctx, 'zhongmou_buxie').length).toBeGreaterThan(0);
    expect(damageEvents(ctx, 'quzhu')).toHaveLength(0);
  });
});

describe('反计之策（S 指挥：前 3 回合敌军主动伤害降至下限 10% + 首回合犹豫）', () => {
  it('装配：prep、敌群体 2；主动伤害 caused −99.99（skillTypes active，duration 3）+ 犹豫 duration 1', () => {
    const s = asCommand('fanji_zhence');
    expect(s.phase).toBe('prep');
    expect(s.targetSide).toBe('enemy');
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    const debuff = inflictStatusOf(s.output[0]);
    expect(debuff?.type).toBe('damage_boost');
    if (debuff?.type === 'damage_boost') {
      expect(debuff.rate).toBe(-99.99);
      expect(debuff.direction).toBe('caused');
      expect(debuff.skillTypes).toEqual(['active']);
      expect(debuff.duration).toBe(3);
    }
    const hes = inflictStatusOf(s.output[1]);
    expect(hes?.type).toBe('hesitation');
    if (hes?.type === 'hesitation') expect(hes.duration).toBe(1);
  });

  it('窗口：准备阶段给 2 名敌军挂减伤 + 首回合犹豫', () => {
    const ctx = makeCtx(commandTeam('fanji_zhence'));
    triggerCommandSkills(ctx, ctx.myTeam[1]);
    const debuffed = ctx.enemyTeam.filter((u) => hasStatus(u, 'damage_boost'));
    const dazed = ctx.enemyTeam.filter((u) => hasStatus(u, 'hesitation'));
    expect(debuffed).toHaveLength(2);
    expect(dazed).toHaveLength(2);
  });

  it('机制：主动战法伤害被压到「兵力基础 + 其余 ×10%」（buffMult 下限）', () => {
    const castEnemy = (withDebuff: boolean) => {
      const ctx = makeCtx(commandTeam('fanji_zhence'), 7);
      const foe = ctx.enemyTeam[0];
      if (withDebuff) {
        inflictStatus(
          ctx,
          foe,
          {
            type: 'damage_boost',
            rate: -99.99,
            duration: 3,
            direction: 'caused',
            skillTypes: ['active'],
          },
          'command',
          'fanji_zhence'
        );
      }
      const copy = { ...asActive('jingong'), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
      ctx.skills.set('jingong', copy);
      ctx.enemyTeam.forEach((u) => {
        u.general.activeSkillIds = ['jingong'];
      });
      triggerActiveSkill(ctx, foe, copy, ctx.myTeam, ctx.enemyTeam, ctx.myTeam);
      const hit = damageEvents(ctx, 'jingong')[0];
      if (!hit) throw new Error('无伤害');
      return hit;
    };
    const baseline = castEnemy(false);
    const buffed = castEnemy(true);
    const troopBase = baseline.breakdown.troopBase;
    const expected = Math.round(troopBase + (baseline.damage - troopBase) * 0.1);
    expect(Math.abs(buffed.damage - expected)).toBeLessThanOrEqual(1);
  });
});
