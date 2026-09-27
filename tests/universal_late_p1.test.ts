/**
 * 拆解通用「后出 / 漏录」批次 p1（`dateyuan/通用战法待添加名单.md` §二 剩余 4 个 A/S）：
 *   ① 袭屯夺气（A 主动 200271）：策略 160%（受谋略）+ 属性下降触发的恐慌 87% × 每种属性 4 次
 *   ② 令无空悬（A 被动 200280）：每次试图发动主动 → 主动战法下一次伤害 +30%（最多 4 层）；
 *      第 1/3/5/7 回合行动时 → 本回合内造成攻击或策略伤害的主动战法发动率 +10%
 *   ③ 除恶务尽（S 指挥 200276）：前 3 回合怯战者受伤 −30%；第 4 回合起我军全体每回合 70% 连击
 *   ④ 避锐治气（S 指挥 200291）：前 4 回合我军群体受击「增减伤净幅度」每满 50% → 50% 几率
 *      恢复自身 70% + 敌军随机单体造成伤害 −10%（最多 9 层）；每回合结束额外触发一次
 * 官方数据：scripts/skill_extra.json（200271 / 200280 / 200276 / 200291）。
 */
import { describe, it, expect } from 'vitest';
import {
  actUnit,
  applyDamage,
  inflictStatus,
  triggerActiveSkill,
  triggerCommandSkills,
  triggerPreparedEffectOnAct,
  triggerRoundEndCommands,
  type CombatContext,
} from '../src/engine/action';
import type {
  BattleEvent,
  DamageModifiers,
  General,
  Position,
  Skill,
  Status,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { isLearnableSkillListed } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 20000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
    ...extra,
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动战法`);
  return s;
}

/** 直接释放（发动率固定 1、去掉准备）——沿用 universal_b_plus_p15 先例 */
function castActive(ctx: CombatContext, unit: UnitState, skillId: string): void {
  const base = asActive(skillId);
  const copy = { ...base, prepare: false, triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

const dotTicks = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter((e) => e.type === 'dot_tick' && e.skillId === skillId);

const triggers = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === skillId
  );

const heals = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter((e) => e.type === 'heal' && e.skillId === skillId);

// ═══════════════════════════════════════════════════════════════════
// 袭屯夺气
// ═══════════════════════════════════════════════════════════════════

function duoqiTeam(): { ctx: CombatContext; caster: UnitState; foes: UnitState[] } {
  const caster = dummy('caster', '前锋', { activeSkillIds: ['xitun_duoqi'] });
  const ctx = makeCtx(
    [makeUnit(caster), makeUnit(dummy('ally-mid', '中军')), makeUnit(dummy('ally-back', '大营'))],
    [makeUnit(dummy('e-front', '前锋'), 'enemy'), makeUnit(dummy('e-back', '大营'), 'enemy')]
  );
  return { ctx, caster: ctx.myTeam[0], foes: ctx.enemyTeam };
}

describe('袭屯夺气（A 主动·距离 4·35%·敌军群体）', () => {
  it('装配：主动 / 距离 4 / 35% / 敌军群体；策略 160%（受谋略，无系数）+ 属性下降触发的恐慌 87%', () => {
    const s = asActive('xitun_duoqi');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.35);
    expect(s.targetMode).toBe('group');
    expect(s.targetSide).toBe('enemy');
    expect([...s.tags].sort()).toEqual(['damage', 'panic']);
    expect(s.output.map((o) => o.kind)).toEqual(['strategy_damage', 'inflict_status']);

    const dmg = s.output[0];
    if (dmg.kind !== 'strategy_damage') throw new Error('主段应为策略伤害');
    expect(dmg.rate).toBe(160);
    expect(dmg.strategyScaled).toBe(true);
    expect(dmg.growthRate).toBeUndefined(); // 官方未给系数 → 留空（按基值）

    const dot = s.output[1];
    if (dot.kind !== 'inflict_status' || Array.isArray(dot.status)) throw new Error('次段应为状态');
    expect(dot.status).toMatchObject({
      type: 'panic',
      rate: 87,
      growthRate: 0,
      triggerOnAttrDown: true,
      chargesPerAttr: 4,
    });
  });

  it('登记下架：两段受谋略成长率均未确认 → 不在可学习战法池', () => {
    expect(isLearnableSkillListed('xitun_duoqi')).toBe(false);
  });

  it('释放：对敌军群体逐个打出策略伤害并各挂 1 个「属性下降触发」动摇', () => {
    const { ctx, caster, foes } = duoqiTeam();
    castActive(ctx, caster, 'xitun_duoqi');
    expect(ctx.events.filter((e) => e.type === 'damage' && e.skillId === 'xitun_duoqi').length).toBe(foes.length);
    for (const foe of foes) {
      const panic = foe.statuses.find(
        (s): s is Extract<Status, { type: 'panic' }> => s.type === 'panic'
      );
      expect(panic).toBeTruthy();
      expect(panic!.triggerOnAttrDown).toBe(true);
      expect(panic!.chargesPerAttr).toBe(4);
    }
  });

  it('属性下降触发：同一属性 4 次封顶，另一种属性仍可继续触发（每种属性单独计算）', () => {
    const { ctx, caster, foes } = duoqiTeam();
    castActive(ctx, caster, 'xitun_duoqi');
    const foe = foes[0];
    ctx.events.length = 0;

    // 防御下降 ×4 → 4 次跳伤
    for (let i = 0; i < 4; i += 1) {
      inflictStatus(ctx, foe, { type: 'defense_buff', amount: -50, duration: 2 }, 'active', 'probe_down', caster.general.id);
    }
    expect(dotTicks(ctx, 'xitun_duoqi').length).toBe(4);

    // 同一属性第 5 次：该属性已用尽 → 不再触发
    inflictStatus(ctx, foe, { type: 'defense_buff', amount: -50, duration: 2 }, 'active', 'probe_down', caster.general.id);
    expect(dotTicks(ctx, 'xitun_duoqi').length).toBe(4);

    // 换成攻击下降：独立计数 → 再触发 1 次
    inflictStatus(ctx, foe, { type: 'attack_buff', amount: -50, duration: 2 }, 'active', 'probe_down2', caster.general.id);
    expect(dotTicks(ctx, 'xitun_duoqi').length).toBe(5);

    // 属性**提高**不触发
    inflictStatus(ctx, foe, { type: 'speed_buff', amount: 50, duration: 2 }, 'active', 'probe_up', caster.general.id);
    expect(dotTicks(ctx, 'xitun_duoqi').length).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 令无空悬
// ═══════════════════════════════════════════════════════════════════

/** 只用于「试图发动」的试探主动（无输出、必发动），不产生伤害因而不消耗层数 */
function probeActive(): Extract<Skill, { type: 'active' }> {
  return {
    id: 'probe_active',
    name: '试探主动',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: [],
    output: [],
  };
}

describe('令无空悬（A 被动·距离 1·自己）', () => {
  it('装配：被动战斗开始 / 主动试图钩子 + 奇数回合窗口（1/3/5/7）', () => {
    const s = SKILL_REGISTRY['lingwu_kongxuan'];
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(1);
    expect(s.targetMode).toBe('self');
    expect([...s.tags].sort()).toEqual(['damage_boost', 'trigger_boost']);

    const st = s.onActiveAttempt?.output[0];
    if (!st || st.kind !== 'inflict_status' || Array.isArray(st.status)) throw new Error('缺少主动试图叠层段');
    expect(st.target).toBe('self');
    expect(st.status).toMatchObject({
      type: 'damage_boost',
      rate: 0.3,
      direction: 'caused',
      skillTypes: ['active'],
      stacks: 1,
      maxStacks: 4,
      charges: 1,
      chargesStack: true,
    });

    expect(s.roundStartRepeat?.oddRounds).toBe(true);
    const tb = s.roundStartRepeat?.output[0];
    if (!tb || tb.kind !== 'inflict_status' || Array.isArray(tb.status)) throw new Error('缺少发动率提升段');
    expect(tb.status).toMatchObject({
      type: 'trigger_boost',
      rate: 0.1,
      duration: 1,
      skillTypes: ['active'],
      damageSkillsOnly: true,
    });
  });

  it('每次试图发动主动战法 +1 层（+30%），最多 4 层 → +120%', () => {
    const carrier = dummy('carrier', '前锋', { passiveSkillIds: ['lingwu_kongxuan'] });
    const ctx = makeCtx([makeUnit(carrier)], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    const me = ctx.myTeam[0];
    const probe = probeActive();
    ctx.skills.set(probe.id, probe);

    for (let i = 0; i < 5; i += 1) {
      triggerActiveSkill(ctx, me, probe, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    }
    const buffs = me.statuses.filter(
      (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
    );
    expect(buffs.length).toBe(1);
    expect(buffs[0].stacks).toBe(4); // 封顶：maxStacks 4
    expect(buffs[0].rate).toBeCloseTo(1.2, 5);
    // 5 次试图发动各发 1 次 skill_trigger（试探主动必发动）
    expect(ctx.events.filter((e) => e.type === 'skill_trigger').length).toBeGreaterThanOrEqual(5);
  });

  it('主动战法伤害打出后整条消耗（charges:1 + chargesStack 消耗制）', () => {
    const carrier = dummy('carrier', '前锋', {
      passiveSkillIds: ['lingwu_kongxuan'],
      activeSkillIds: ['tujin'],
    });
    const ctx = makeCtx([makeUnit(carrier)], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    const me = ctx.myTeam[0];
    const probe = probeActive();
    ctx.skills.set(probe.id, probe);
    // 先试图发动两次 → 2 层（+60%）
    triggerActiveSkill(ctx, me, probe, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    triggerActiveSkill(ctx, me, probe, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    const before = me.statuses.find(
      (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
    );
    expect(before?.stacks).toBe(2);

    // 打出一次主动战法伤害（突进 115% 攻击）→ 整条消耗
    castActive(ctx, me, 'tujin');
    expect(me.statuses.some((s) => s.type === 'damage_boost')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 除恶务尽
// ═══════════════════════════════════════════════════════════════════

describe('除恶务尽（S 指挥·一类·距离 5·我军全体）', () => {
  it('装配：一类指挥 / 距离 5 / 我军全体 / 阵亡后仍生效；前 3 回合怯战条件减伤 30% + 第 4 回合起 70% 连击', () => {
    const s = SKILL_REGISTRY['chue_wujin'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.retainAfterDeath).toBe(true);
    expect([...s.tags].sort()).toEqual(['combo', 'damage_reduce']);

    expect(s.initialOutput?.[0]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'damage_reduce', rate: 0.3, duration: 3, requireSelfStatus: 'cowardice' },
    });
    expect(s.roundRepeat).toMatchObject({ startRound: 4, endRound: 8, rate: 0.7 });
    expect(s.output[0]).toMatchObject({ kind: 'inflict_status', status: { type: 'combo', duration: 1 } });
  });

  it('准备阶段释放：我军全体获得「怯战状态下受伤 −30%」（前 3 回合）', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['chue_wujin'] });
    const ctx = makeCtx(
      [makeUnit(carrier), makeUnit(dummy('ally-mid', '中军'))],
      [makeUnit(dummy('e', '前锋'), 'enemy')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    for (const u of ctx.myTeam) {
      const red = u.statuses.find(
        (s): s is Extract<Status, { type: 'damage_reduce' }> => s.type === 'damage_reduce'
      );
      expect(red).toBeTruthy();
      expect(red!.rate).toBeCloseTo(0.3, 5);
      expect(red!.requireSelfStatus).toBe('cowardice');
      expect(red!.remaining).toBe(3);
    }
  });

  it('条件减伤按携带者当前是否怯战实时判定：无怯战不吃、有怯战吃 30% 且伤害更低', () => {
    const carrier = dummy('carrier', '前锋', { commandSkillIds: ['chue_wujin'] });
    const striker = dummy('striker', '前锋', { attack: 200 });
    const ctx = makeCtx([makeUnit(carrier)], [makeUnit(striker, 'enemy')]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const victim = ctx.myTeam[0];

    actUnit(ctx, ctx.enemyTeam[0]);
    const hit1 = ctx.events.find((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit');
    expect(hit1).toBeTruthy();
    expect((hit1!.modifiers?.reduce ?? []).some((m) => m.skillId === 'chue_wujin')).toBe(false);

    ctx.events.length = 0;
    inflictStatus(ctx, victim, { type: 'cowardice', duration: 3 }, 'active', 'probe_cowardice', ctx.enemyTeam[0].general.id);
    ctx.enemyTeam[0].hasActedThisRound = false;
    ctx.currentRound = 2;
    actUnit(ctx, ctx.enemyTeam[0]);
    const hit2 = ctx.events.find((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit');
    expect(hit2).toBeTruthy();
    const entry = (hit2!.modifiers?.reduce ?? []).find((m) => m.skillId === 'chue_wujin');
    expect(entry?.rate).toBeCloseTo(0.3, 5);
    expect(hit2!.damage).toBeLessThan(hit1!.damage);
  });

  it('第 4 回合起每回合 70% 判定连击；前 3 回合不判定', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['chue_wujin'] });
    const ally = dummy('ally-front', '前锋');

    // ① 第 3 回合：不判定
    const ctx3 = makeCtx([makeUnit(ally), makeUnit(carrier)], [makeUnit(dummy('e', '前锋'), 'enemy')], 3);
    triggerCommandSkills(ctx3, ctx3.myTeam[1]);
    ctx3.currentRound = 3;
    triggerPreparedEffectOnAct(ctx3, ctx3.myTeam[0]);
    expect(triggers(ctx3, 'chue_wujin').length).toBe(0);

    // ② 第 4 回合：判定 70%（seed 搜索命中成功的样本，验证连击状态）
    let hitCtx: CombatContext | undefined;
    for (let seed = 1; seed <= 40 && !hitCtx; seed += 1) {
      const ctx = makeCtx([makeUnit(ally), makeUnit(carrier)], [makeUnit(dummy('e', '前锋'), 'enemy')], seed);
      triggerCommandSkills(ctx, ctx.myTeam[1]);
      ctx.currentRound = 4;
      triggerPreparedEffectOnAct(ctx, ctx.myTeam[0]);
      const trig = triggers(ctx, 'chue_wujin');
      expect(trig.length).toBe(1);
      expect(trig[0].baseRate).toBe(70);
      expect(trig[0].targetId).toBe('ally-front');
      if (trig[0].success) hitCtx = ctx;
    }
    expect(hitCtx).toBeTruthy();
    const combo = hitCtx!.myTeam[0].statuses.find((s) => s.type === 'combo');
    expect(combo).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 避锐治气
// ═══════════════════════════════════════════════════════════════════

function magnitudeMods(rate: number): DamageModifiers {
  return {
    caused: [{ unitId: 'e', skillId: 'probe_boost', skillName: '试探增伤', rate, direction: 'caused' }],
    taken: [],
    reduce: [],
  };
}

function biruiSetup(seed = 1) {
  const carrier = dummy('carrier', '大营', { commandSkillIds: ['birui_zhiqi'] });
  const ctx = makeCtx(
    [makeUnit(dummy('ally-front', '前锋')), makeUnit(dummy('ally-mid', '中军')), makeUnit(carrier)],
    [makeUnit(dummy('e-front', '前锋'), 'enemy'), makeUnit(dummy('e-back', '大营'), 'enemy')],
    seed
  );
  triggerCommandSkills(ctx, ctx.myTeam[2]);
  return {
    ctx,
    targets: ctx.lockedCommands[0].targets,
    foes: ctx.enemyTeam,
    striker: ctx.enemyTeam[0],
  };
}

describe('避锐治气（S 指挥·一类·距离 5·我军群体 2 目标）', () => {
  it('装配：一类指挥 / 锁定我军群体 2 目标；阈值 50 / 几率 50% / 前 4 回合 / 回合末额外触发', () => {
    const s = SKILL_REGISTRY['birui_zhiqi'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('ally');
    expect([...s.tags].sort()).toEqual(['damage_boost', 'heal']);

    const cfg = s.takenMagnitudeTrigger;
    expect(cfg).toBeTruthy();
    expect(cfg!).toMatchObject({ threshold: 50, chance: 0.5, endRound: 4, roundEndExtra: true });
    expect(cfg!.output[0]).toMatchObject({ kind: 'heal', rate: 70, strategyScaled: false, growthRate: 0, target: 'self' });
    expect(cfg!.output[1]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'enemy',
      targetMode: 'random_single',
      status: {
        type: 'damage_boost',
        rate: -0.1,
        duration: 999,
        direction: 'caused',
        stack: true,
        maxStacks: 9,
      },
    });
  });

  it('准备阶段锁定 2 名我军目标（施法者 + 前排），不含大营外目标', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['birui_zhiqi'] });
    const front = makeUnit(dummy('ally-front', '前锋'));
    const mid = makeUnit(dummy('ally-mid', '中军'));
    const back = makeUnit(carrier);
    const ctx = makeCtx([front, mid, back], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    triggerCommandSkills(ctx, back);
    expect(ctx.lockedCommands.length).toBe(1);
    expect(ctx.lockedCommands[0].targets.length).toBe(2);
  });

  it('受击净幅度满 50% → 掷一次 50%（走士气）判定', () => {
    const { ctx, targets, striker } = biruiSetup();
    const victim = targets[0];
    ctx.events.length = 0;
    applyDamage(ctx, victim, 1000, striker, 'physical', 'skill', magnitudeMods(0.6));
    const trig = triggers(ctx, 'birui_zhiqi');
    expect(trig.length).toBe(1);
    expect(trig[0].baseRate).toBe(50);
    expect(trig[0].targetId).toBe(victim.general.id);

    // 不足 50%：再受一次 30%（累计 40% < 50%）→ 不再判定
    applyDamage(ctx, victim, 1000, striker, 'physical', 'skill', magnitudeMods(0.3));
    expect(triggers(ctx, 'birui_zhiqi').length).toBe(1);

    // 再过 20%（累计 60% ≥ 50%）→ 再判定一次
    applyDamage(ctx, victim, 1000, striker, 'physical', 'skill', magnitudeMods(0.2));
    expect(triggers(ctx, 'birui_zhiqi').length).toBe(2);
  });

  it('判定命中：受击者恢复自身兵力 + 敌军随机单体造成伤害 −10%（可叠 9 层）', () => {
    let hit: ReturnType<typeof biruiSetup> | undefined;
    for (let seed = 1; seed <= 40 && !hit; seed += 1) {
      const cfg = biruiSetup(seed);
      cfg.ctx.events.length = 0;
      applyDamage(cfg.ctx, cfg.targets[0], 1000, cfg.striker, 'physical', 'skill', magnitudeMods(0.6));
      if (heals(cfg.ctx, 'birui_zhiqi').length > 0) hit = cfg;
    }
    expect(hit).toBeTruthy();
    const heal = heals(hit!.ctx, 'birui_zhiqi')[0] as Extract<BattleEvent, { type: 'heal' }>;
    expect(heal.amount).toBeGreaterThan(0);
    expect(heal.targetId).toBe(hit!.targets[0].general.id);

    const debuffs = hit!.foes.flatMap((f) =>
      f.statuses.filter(
        (s): s is Extract<Status, { type: 'damage_boost' }> =>
          s.type === 'damage_boost' && s.sourceSkillId === 'birui_zhiqi'
      )
    );
    expect(debuffs.length).toBe(1);
    expect(debuffs[0].rate).toBeCloseTo(-0.1, 5);
    expect(debuffs[0].maxStacks).toBe(9);
  });

  it('回合末额外触发一次（不掷几率）：每个锁定目标各恢复一次；第 5 回合起不再触发', () => {
    const { ctx, targets, foes } = biruiSetup();
    // 先扣兵，恢复才有实际数值（满兵时恢复 0、不产生 heal 事件）
    for (const t of targets) t.troops -= 5000;
    ctx.events.length = 0;
    triggerRoundEndCommands(ctx);
    expect(heals(ctx, 'birui_zhiqi').length).toBe(targets.length);

    // 每触发一次给敌军随机单体叠 1 层（同一敌人 → 累加）
    const stacks = foes
      .flatMap((f) => f.statuses.filter((s) => s.type === 'damage_boost' && s.sourceSkillId === 'birui_zhiqi'))
      .reduce((a, s) => a + ((s as { stacks?: number }).stacks ?? 1), 0);
    expect(stacks).toBe(targets.length);

    // 第 5 回合：超出前 4 回合窗口 → 不触发
    ctx.events.length = 0;
    ctx.currentRound = 5;
    triggerRoundEndCommands(ctx);
    expect(heals(ctx, 'birui_zhiqi').length).toBe(0);
  });
});
