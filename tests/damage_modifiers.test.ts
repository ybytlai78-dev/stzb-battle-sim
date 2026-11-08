/**
 * 增减伤归因测试（v0.10.1）
 *  战报「增减伤统计」的数据基础：每次伤害事件携带 modifiers
 *    - caused：攻击方造成伤害提高（大赏三军 / 巾帼战阵 / 血溅黄砂）
 *    - taken：受击方受到伤害提高（神兵天降）
 *    - reduce：受击方减伤（避其锋芒 / 步步为营）
 *  来源条目记录施加者（施法者 unitId）与战法（skillId/skillName），供 Web 战报按
 *  「【施法者】【战法】伤害提升 x%」展示。
 */
import { describe, it, expect } from 'vitest';
import {
  actUnit,
  triggerCommandSkills,
  triggerDelayedOutputs,
  inflictStatus,
  type CombatContext,
} from '../src/engine/action';
import type { BattleEvent, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(id: string, opts: { position?: Position; speed?: number; strategy?: number; attack?: number; defense?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '吴',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 100,
      defense: opts.defense ?? 100,
      strategy: opts.strategy ?? 100,
      speed: opts.speed ?? 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 黄盖 + 敌方 3 人（e1 前锋 / e2 中军 / e3 大营）的标准战场 */
function standardField(withLvmeng: boolean): { ctx: CombatContext; huanggai: UnitState } {
  const ctx = makeCtx();
  const huanggai = makeUnit('huanggai', { position: '前锋', attack: 150 });
  ctx.myTeam = [huanggai];
  if (withLvmeng) {
    const lvmeng = makeUnit('lvmeng', { position: '中军', strategy: 100, speed: 120 });
    lvmeng.general.commandSkillIds = ['shenbing_tianjiang', 'dashang_sanjun'];
    ctx.myTeam.push(lvmeng);
  }
  const e1 = makeUnit('e1', { position: '前锋', defense: 80 });
  const e2 = makeUnit('e2', { position: '中军' });
  const e3 = makeUnit('e3', { position: '大营' });
  for (const e of [e1, e2, e3]) e.side = 'enemy';
  ctx.enemyTeam = [e1, e2, e3];
  return { ctx, huanggai };
}

/** 吕蒙（大营·谋略 120，只有白衣渡江）+ 敌方 3 人：targetMode 'all' ⇒ 三个目标各存一份基值 */
function baiyiField(): { ctx: CombatContext; lvmeng: UnitState } {
  const ctx = makeCtx();
  const lvmeng = makeUnit('lvmeng', { position: '大营', strategy: 120 });
  lvmeng.general.commandSkillIds = ['baiyi_dujiang'];
  ctx.myTeam = [lvmeng];
  const e1 = makeUnit('e1', { position: '前锋', defense: 80 });
  const e2 = makeUnit('e2', { position: '中军' });
  const e3 = makeUnit('e3', { position: '大营' });
  for (const e of [e1, e2, e3]) e.side = 'enemy';
  ctx.enemyTeam = [e1, e2, e3];
  return { ctx, lvmeng };
}

function baiyiHits(ctx: CombatContext): DmgEvent[] {
  return ctx.events.filter((e): e is DmgEvent => e.type === 'damage' && e.skillId === 'baiyi_dujiang');
}

function totalDamage(hits: DmgEvent[]): number {
  return hits.reduce((acc, h) => acc + h.damage, 0);
}

type HitEvent = Extract<BattleEvent, { type: 'attack_hit' }>;type DmgEvent = Extract<BattleEvent, { type: 'damage' }>;
type DotEvent = Extract<BattleEvent, { type: 'dot_tick' }>;

describe('增减伤归因（伤害事件 modifiers）', () => {
  it('神兵天降 + 大赏三军（吕蒙）：普攻伤害携带造成侧/受到侧来源，各 33% → 合计提升 66%', () => {
    const { ctx, huanggai } = standardField(true);
    const lvmeng = ctx.myTeam[1];
    triggerCommandSkills(ctx, lvmeng);

    actUnit(ctx, huanggai);
    const hit = ctx.events.find((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'huanggai');
    expect(hit, '应有普攻命中事件').toBeTruthy();
    const target = ctx.enemyTeam.find((u) => u.general.id === hit!.targetId)!;
    expect(target, '命中目标应在敌方').toBeTruthy();

    const mods = hit!.modifiers!;
    // 大赏三军：施加在攻击方（黄盖）身上的造成侧增伤，施法者为吕蒙
    expect(mods.caused).toEqual([
      { unitId: 'lvmeng', skillId: 'dashang_sanjun', skillName: '大赏三军', rate: 0.33, direction: 'caused' },
    ]);
    // 神兵天降：群体随机 2 目标；命中谁就断言谁身上的受到侧增伤
    const hasTaken = target.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'shenbing_tianjiang');
    if (hasTaken) {
      expect(mods.taken).toEqual([
        { unitId: 'lvmeng', skillId: 'shenbing_tianjiang', skillName: '神兵天降', rate: 0.33, direction: 'taken' },
      ]);
    } else {
      expect(mods.taken).toEqual([]);
    }
    expect(mods.reduce).toEqual([]);
  });

  it('避其锋芒（敌军指挥减伤）：受击方带 reduce 来源，无提升', () => {
    const ctx = makeCtx();
    const huanggai = makeUnit('huanggai', { position: '前锋', attack: 150 });
    ctx.myTeam = [huanggai];
    const e1 = makeUnit('e1', { position: '前锋', defense: 80, speed: 80 });
    const e2 = makeUnit('e2', { position: '中军' });
    for (const e of [e1, e2]) e.side = 'enemy';
    e1.general.commandSkillIds = ['biqi_fengmang'];
    ctx.enemyTeam = [e1, e2];

    triggerCommandSkills(ctx, e1); // 避其锋芒：敌军群体受到伤害降低 30%
    actUnit(ctx, huanggai);

    const hit = ctx.events.find((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'huanggai');
    expect(hit).toBeTruthy();
    expect(hit!.modifiers!.caused).toEqual([]);
    expect(hit!.modifiers!.taken).toEqual([]);
    // 施法者谋略 100：30 + 0.15×20 = 33%（八舍九入）
    expect(hit!.modifiers!.reduce).toEqual([
      { unitId: 'e1', skillId: 'biqi_fengmang', skillName: '避其锋芒', rate: 0.33, direction: 'reduce' },
    ]);
  });

  it('巾帼战阵（主动 100%）：自增伤 40% + 战法伤害事件携带来源', () => {
    const ctx = makeCtx();
    const guanyinping = makeUnit('guanyinping', { position: '前锋', attack: 150 });
    guanyinping.general.activeSkillIds = ['jinguo_zhanzhen'];
    ctx.myTeam = [guanyinping];
    const e1 = makeUnit('e1', { position: '前锋', defense: 80 });
    const e2 = makeUnit('e2', { position: '中军' });
    for (const e of [e1, e2]) e.side = 'enemy';
    ctx.enemyTeam = [e1, e2];

    actUnit(ctx, guanyinping);

    const dmg = ctx.events.find((e): e is DmgEvent => e.type === 'damage' && e.sourceId === 'guanyinping');
    expect(dmg, '巾帼战阵应造成战法伤害').toBeTruthy();
    expect(dmg!.modifiers!.caused).toEqual([
      { unitId: 'guanyinping', skillId: 'jinguo_zhanzhen', skillName: '巾帼战阵', rate: 0.4, direction: 'caused' },
    ]);
    expect(dmg!.modifiers!.taken).toEqual([]);
    expect(dmg!.modifiers!.reduce).toEqual([]);
  });

  it('无任何增减伤：modifiers 为空列表', () => {
    const { ctx, huanggai } = standardField(false);
    actUnit(ctx, huanggai);
    const hit = ctx.events.find((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'huanggai');
    expect(hit).toBeTruthy();
    expect(hit!.modifiers).toEqual({ caused: [], taken: [], reduce: [] });
  });

  it('DoT 挂上时结算：减伤来源在挂上时冻结，无增伤时 caused/taken 为空', () => {
    const ctx = makeCtx();
    const huanggai = makeUnit('huanggai', { position: '前锋', defense: 80 });
    ctx.myTeam = [huanggai];
    const e1 = makeUnit('e1', { position: '前锋', defense: 80 });
    const e2 = makeUnit('e2', { position: '中军' });
    for (const e of [e1, e2]) e.side = 'enemy';
    e2.general.commandSkillIds = ['biqi_fengmang'];
    ctx.enemyTeam = [e1, e2];
    triggerCommandSkills(ctx, e2); // 避其锋芒作用于敌军（e1/e2）：减伤 30%

    // 黄盖给 e1 上燃烧（DoT）：挂上时结算，减伤来源在挂上时冻结
    inflictStatus(ctx, e1, { type: 'burning', rate: 100, duration: 3, growthRate: 0.5 }, 'active', 'test', 'huanggai');
    actUnit(ctx, e1);

    const tick = ctx.events.find((e): e is DotEvent => e.type === 'dot_tick' && e.targetId === 'e1');
    expect(tick, '应有 DoT 结算事件').toBeTruthy();
    // 无增伤提升：caused/taken 为空；减伤来源（挂上时已存在）冻结在 dot_tick
    expect(tick!.modifiers).toEqual({
      caused: [],
      taken: [],
      reduce: [{ unitId: 'e2', skillId: 'biqi_fengmang', skillName: '避其锋芒', rate: 0.33, direction: 'reduce' }],
    });
  });

  it('一类指挥延迟结算（白衣渡江）：伤害带增减伤归因，46%+46% 增伤显著提高伤害', () => {
    // 口径（用户 2026-11-08）：预存的是「乘区 = 1 的基值」，乘区在打出那一刻用当时 statuses 现算
    const plain = baiyiField();
    triggerCommandSkills(plain.ctx, plain.lvmeng);
    triggerDelayedOutputs(plain.ctx, 3);
    const plainHits = baiyiHits(plain.ctx);
    expect(plainHits, '白衣渡江 targetMode=all → 三个目标各一份').toHaveLength(3);
    for (const h of plainHits) {
      // 无任何增减伤时也必须有 modifiers：诊断账本靠这个字段把伤害纳入因果归因
      expect(h.modifiers).toEqual({ caused: [], taken: [], reduce: [] });
      expect(h.damageRate, '伤害率在准备阶段冻结：215 + 2.25 × (120 − 80)').toBe(305);
    }

    const boosted = baiyiField();
    triggerCommandSkills(boosted.ctx, boosted.lvmeng);
    // 曹操【大赏三军】→ 吕蒙造成伤害 +46%；【神兵天降】→ e1 受到伤害 +46%
    inflictStatus(
      boosted.ctx,
      boosted.lvmeng,
      { type: 'damage_boost', direction: 'caused', rate: 0.46, duration: 3 },
      'command',
      'dashang_sanjun',
      'caocao'
    );
    inflictStatus(
      boosted.ctx,
      boosted.ctx.enemyTeam[0],
      { type: 'damage_boost', direction: 'taken', rate: 0.46, duration: 3 },
      'command',
      'shenbing_tianjiang',
      'caocao'
    );
    triggerDelayedOutputs(boosted.ctx, 3);
    const boostedHits = baiyiHits(boosted.ctx);
    expect(boostedHits).toHaveLength(3);

    const plainFirst = plainHits.find((h) => h.targetId === 'e1')!;
    const first = boostedHits.find((h) => h.targetId === 'e1')!;
    expect(first.modifiers!.caused).toEqual([
      { unitId: 'caocao', skillId: 'dashang_sanjun', skillName: '大赏三军', rate: 0.46, direction: 'caused' },
    ]);
    expect(first.modifiers!.taken).toEqual([
      { unitId: 'caocao', skillId: 'shenbing_tianjiang', skillName: '神兵天降', rate: 0.46, direction: 'taken' },
    ]);
    // 兵力段是 base 段之外的部分，不吃增减伤；base / main 各乘 1 + 0.46 + 0.46 = 1.92
    expect(first.breakdown.troopBase).toBe(plainFirst.breakdown.troopBase);
    expect(first.damage).toBeGreaterThan(plainFirst.damage);
    expect(totalDamage(boostedHits)).toBeGreaterThan(totalDamage(plainHits) * 1.5);
  });

  it('一类指挥延迟结算（白衣渡江）：打出那一刻才施加的减伤同样参与结算', () => {
    const plain = baiyiField();
    triggerCommandSkills(plain.ctx, plain.lvmeng);
    triggerDelayedOutputs(plain.ctx, 3);
    const plainFirst = baiyiHits(plain.ctx).find((h) => h.targetId === 'e1')!;

    const reduced = baiyiField();
    triggerCommandSkills(reduced.ctx, reduced.lvmeng);
    // 【守城精兵】式减伤：第 3 回合才施加（准备阶段存的是乘区 = 1 的基值 ⇒ 现算才吃得到）
    inflictStatus(
      reduced.ctx,
      reduced.ctx.enemyTeam[0],
      { type: 'damage_reduce', rate: 0.3, duration: 3 },
      'command',
      'shoucheng_jingbing',
      'weiguan'
    );
    triggerDelayedOutputs(reduced.ctx, 3);
    const reducedFirst = baiyiHits(reduced.ctx).find((h) => h.targetId === 'e1')!;

    expect(reducedFirst.modifiers!.reduce).toHaveLength(1);
    expect(reducedFirst.modifiers!.reduce[0]).toMatchObject({
      unitId: 'weiguan',
      skillId: 'shoucheng_jingbing',
      rate: 0.3,
      direction: 'reduce',
    });
    expect(reducedFirst.damage).toBeLessThan(plainFirst.damage);
  });
});
