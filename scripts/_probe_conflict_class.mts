/**
 * 只读探针：验证引擎冲突判定按「同战法类型」分域的实现事实。
 * 目的 = 与包内 tb_cfg_skill_effect.replace_type（0 属性替换 / 1 不冲突 / 2·3 效果不叠加）对照。
 * 用法：npx tsx scripts/_probe_conflict_class.mts
 */
import { inflictStatus } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { CreateStatus, General, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function general(id: string): General {
  return {
    id, name: id, rarity: '5星', cost: 3, faction: '群', tags: [],
    mutualExclusionGroup: null, troopType: 'cavalry', position: '前锋',
    attack: 100, defense: 100, strategy: 100, speed: 50, attackRange: 3,
    maxTroops: 10000, mainSkillName: '', skillDesc: '',
    activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [],
    morale: 100,
  };
}

function unit(id: string, side: 'my' | 'enemy'): UnitState {
  return { general: general(id), side, troops: 10000, alive: true, wounded: 0, totalDead: 0, statuses: [], preparations: [] };
}

function ctxOf(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [],
    skills: new Map(), lockedCommands: [], stackBuffs: [], currentRound: 1,
  } as CombatContext;
}

type SkillType = 'active' | 'command' | 'passive' | 'pursuit';

function apply(
  ctx: CombatContext, caster: UnitState, target: UnitState,
  create: CreateStatus, type: SkillType, id: string,
): void {
  inflictStatus(ctx, target, create, type, id, caster.general.id);
}

function dump(label: string, target: UnitState, ctx: CombatContext, filter?: string): void {
  const rows = target.statuses
    .filter((s) => !filter || s.type === filter)
    .map((s: any) => `${s.type}(${s.sourceSkillType}:${s.sourceSkillId})` +
      (typeof s.amount === 'number' ? ` amount=${s.amount}` : '') +
      (typeof s.rate === 'number' ? ` rate=${s.rate}` : '') +
      (typeof s.remaining === 'number' ? ` rem=${s.remaining}` : ''));
  const conflicts = ctx.events.filter((e) => e.type === 'status_conflict').map((e: any) => e.detail);
  console.log(`\n— ${label}`);
  console.log(`  状态: ${rows.length ? rows.join(' | ') : '(空)'}`);
  console.log(`  冲突事件: ${conflicts.length ? conflicts.join(' ; ') : '(无)'}`);
}

function main(): void {
  // ① 控制（包内 3 类）：跨战法类型是否互斥？
  {
    const a = unit('A', 'my'); const t = unit('T', 'enemy');
    const ctx = ctxOf([a], [t]);
    apply(ctx, a, t, { type: 'confusion', duration: 2 }, 'command', 'cmd_confuse');
    apply(ctx, a, t, { type: 'confusion', duration: 2 }, 'active', 'act_confuse');
    dump('① 混乱：指挥 → 主动（跨类型）', t, ctx, 'confusion');
  }
  // ② 控制：同战法类型（包内应「先施加者生效」）
  {
    const a = unit('A', 'my'); const t = unit('T', 'enemy');
    const ctx = ctxOf([a], [t]);
    apply(ctx, a, t, { type: 'confusion', duration: 2 }, 'command', 'cmd_c1');
    apply(ctx, a, t, { type: 'confusion', duration: 2 }, 'command', 'cmd_c2');
    dump('② 混乱：指挥 → 指挥（同类型）', t, ctx, 'confusion');
  }
  // ③ 属性（包内 0 类 = 属性替换）：先 +50 再 +30（同类型不同战法）
  {
    const a = unit('A', 'my'); const t = unit('T', 'enemy');
    const ctx = ctxOf([a], [t]);
    apply(ctx, a, t, { type: 'attack_buff', amount: 50, duration: 3 }, 'passive', 'p_atk_big');
    apply(ctx, a, t, { type: 'attack_buff', amount: 30, duration: 3 }, 'passive', 'p_atk_small');
    dump('③ 攻击属性：+50 → +30（同类型，验证「替换」还是「取较高」）', t, ctx, 'attack_buff');
  }
  // ④ 属性：跨战法类型
  {
    const a = unit('A', 'my'); const t = unit('T', 'enemy');
    const ctx = ctxOf([a], [t]);
    apply(ctx, a, t, { type: 'attack_buff', amount: 50, duration: 3 }, 'passive', 'p_atk');
    apply(ctx, a, t, { type: 'attack_buff', amount: 30, duration: 3 }, 'active', 'a_atk');
    dump('④ 攻击属性：+50（被动）→ +30（主动）（跨类型）', t, ctx, 'attack_buff');
  }
  // ⑤ 增减伤（包内 2 类 = 效果不叠加）：同分类键、跨类型
  {
    const a = unit('A', 'my'); const t = unit('T', 'enemy');
    const ctx = ctxOf([a], [t]);
    apply(ctx, a, t, { type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused' }, 'command', 'cmd_boost');
    apply(ctx, a, t, { type: 'damage_boost', rate: 0.2, duration: 3, direction: 'caused' }, 'active', 'act_boost');
    dump('⑤ 造成伤害提高：0.3（指挥）→ 0.2（主动）（跨类型，同分类）', t, ctx, 'damage_boost');
  }
  // ⑥ 急救（包内 0 类）：指挥 → 被动
  {
    const a = unit('A', 'my'); const t = unit('T', 'enemy');
    const ctx = ctxOf([a], [t]);
    apply(ctx, a, t, { type: 'first_aid', rate: 60, triggerRate: 50, duration: 999, strategyScaled: true, growthRate: 0.6 } as any, 'command', 'cmd_heal');
    apply(ctx, a, t, { type: 'first_aid', rate: 40, triggerRate: 50, duration: 999, strategyScaled: true, growthRate: 0.6 } as any, 'passive', 'p_heal');
    dump('⑥ 急救：指挥 → 被动（跨类型）', t, ctx, 'first_aid');
  }
  // ⑦ 急救：指挥 → 指挥（引擎口径 = 互斥）
  {
    const a = unit('A', 'my'); const t = unit('T', 'enemy');
    const ctx = ctxOf([a], [t]);
    apply(ctx, a, t, { type: 'first_aid', rate: 60, triggerRate: 50, duration: 999, strategyScaled: true, growthRate: 0.6 } as any, 'command', 'cmd_heal1');
    apply(ctx, a, t, { type: 'first_aid', rate: 40, triggerRate: 50, duration: 999, strategyScaled: true, growthRate: 0.6 } as any, 'command', 'cmd_heal2');
    dump('⑦ 急救：指挥 → 指挥（同类型）', t, ctx, 'first_aid');
  }
}

main();
