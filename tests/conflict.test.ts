/**
 * 效果冲突规则测试（v0.4）：先判同类型（被动/指挥/主动/追击），再判除「伤害」外标签是否冲突
 *  - 同类型同名控制不可叠加（先施加者生效，后施加者被拒）
 *  - 跨类型同名控制各自计数共存
 *  - 同类型增益替换取较高值（数值不叠加）
 *  - 伤害标签永不冲突
 * 全部通过 inflictStatus 单元测试，不依赖战法发动率 RNG。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, hasStatus, getStatus } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { CreateStatus, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function makeUnit(id: string): UnitState {
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
      position: '前锋',
      attack: 100,
      defense: 100,
      strategy: 100,
      speed: 50,
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
    rng: new Rng(1),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function countConflict(ctx: CombatContext, statusType: string): number {
  return ctx.events.filter((e) => e.type === 'status_conflict' && 'statusType' in e && e.statusType === statusType).length;
}

const cow: CreateStatus = { type: 'cowardice', duration: 3 };
const reduce30: CreateStatus = { type: 'damage_reduce', rate: 0.3, duration: 3 };
const reduce28: CreateStatus = { type: 'damage_reduce', rate: 0.28, duration: 3 };
const confuse: CreateStatus = { type: 'confusion', duration: 2 };

describe('效果冲突规则', () => {
  it('同类型不同战法的同名控制：先施加者生效，后施加者冲突被拒', () => {
    const ctx = makeCtx();
    const u = makeUnit('a');
    // 战必断金（指挥）先施加怯战
    inflictStatus(ctx, u, cow, 'command', 'zhanbi_duanjin');
    // 措手不及（同为指挥，不同战法）再施加怯战 → 冲突被拒
    inflictStatus(ctx, u, cow, 'command', 'cuoshou_buji');
    expect(hasStatus(u, 'cowardice')).toBe(true);
    // 后施加者未覆盖：仍是战必断金的怯战
    expect(getStatus(u, 'cowardice')!.sourceSkillId).toBe('zhanbi_duanjin');
    expect(countConflict(ctx, 'cowardice')).toBe(1);
  });

  it('同一战法重复触发：控制刷新剩余时间（不冲突）', () => {
    const ctx = makeCtx();
    const u = makeUnit('b');
    inflictStatus(ctx, u, cow, 'command', 'zhanbi_duanjin'); // remaining 3
    inflictStatus(ctx, u, cow, 'command', 'zhanbi_duanjin'); // 同战法刷新 → remaining 3
    expect(countConflict(ctx, 'cowardice')).toBe(0);
    expect(getStatus(u, 'cowardice')!.remaining).toBe(3);
  });

  it('跨类型同名控制各自计数共存：指挥怯战 + 主动怯战', () => {
    const ctx = makeCtx();
    const u = makeUnit('c');
    // 战必断金（指挥）怯战
    inflictStatus(ctx, u, cow, 'command', 'zhanbi_duanjin');
    // 玄武洰流（主动）怯战 → 不同战法类型，各自计数
    inflictStatus(ctx, u, cow, 'active', 'xuanwu_fuliu');
    expect(countConflict(ctx, 'cowardice')).toBe(0);
    expect(u.statuses.filter((s) => s.type === 'cowardice').length).toBe(2);
  });

  it('同类型不同战法的增益：数值替换取较高，不叠加', () => {
    const ctx = makeCtx();
    const u = makeUnit('d');
    // 共饮避世（指挥）减伤 28%
    inflictStatus(ctx, u, reduce28, 'command', 'gongyin_bishi');
    // 避其锋芒（指挥）减伤 30% → 数值更高，替换
    inflictStatus(ctx, u, reduce30, 'command', 'biqi_fengmang');
    expect(countConflict(ctx, 'damage_reduce')).toBe(1);
    expect(getStatus(u, 'damage_reduce')!.rate).toBe(0.3);
    // 反向：低值再施加不替换高值
    const ctx2 = makeCtx();
    const u2 = makeUnit('e');
    inflictStatus(ctx2, u2, reduce30, 'command', 'biqi_fengmang');
    inflictStatus(ctx2, u2, reduce28, 'command', 'gongyin_bishi');
    expect(getStatus(u2, 'damage_reduce')!.rate).toBe(0.3);
  });

  it('同类型不同战法的增减伤（damage_boost）：冲突、数值取较高替换（大赏三军 vs 奋疾先登）', () => {
    const ctx = makeCtx();
    const u = makeUnit('d2');
    // 大赏三军（指挥）造成侧增伤 30% 先施加
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused' }, 'command', 'dashang_sanjun', 'lvmeng');
    // 奋疾先登（指挥）造成侧增伤 8% → 同类型不同战法：数值取较高 → 8% < 30%，奋疾先登被拒
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.08, duration: 999, direction: 'caused' }, 'command', 'fenji_xiandeng', 'lejin');
    expect(countConflict(ctx, 'damage_boost')).toBe(1);
    expect(u.statuses.filter((s) => s.type === 'damage_boost').length).toBe(1);
    expect(getStatus(u, 'damage_boost')!.sourceSkillId).toBe('dashang_sanjun');
    expect(getStatus(u, 'damage_boost')!.rate).toBe(0.3);

    // 反向：奋疾先登先叠满（40% > 30%）→ 大赏三军被拒（奋疾先登保留）
    const ctx2 = makeCtx();
    const u2 = makeUnit('e2');
    // 同战法 5 次施加累加成 40%（奋疾先登 actLayer 带显式 `stack: true` 标记，官方可叠加）
    for (let i = 0; i < 5; i++) {
      inflictStatus(ctx2, u2, { type: 'damage_boost', rate: 0.08, duration: 999, direction: 'caused', stack: true }, 'command', 'fenji_xiandeng', 'lejin');
    }
    expect(getStatus(u2, 'damage_boost')!.rate).toBe(0.4);
    expect(countConflict(ctx2, 'damage_boost')).toBe(0);
    // 大赏三军 30% 后挂 → 30% < 40% 被拒
    inflictStatus(ctx2, u2, { type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused' }, 'command', 'dashang_sanjun', 'lvmeng');
    expect(countConflict(ctx2, 'damage_boost')).toBe(1);
    expect(u2.statuses.filter((s) => s.type === 'damage_boost').length).toBe(1);
    expect(getStatus(u2, 'damage_boost')!.sourceSkillId).toBe('fenji_xiandeng');
    expect(getStatus(u2, 'damage_boost')!.rate).toBe(0.4);
  });

  it('增减伤正负号相反不冲突（无心恋战 -30% 与奋疾先登叠层 +32% 共存，由净合计互相抵消）', () => {
    const ctx = makeCtx();
    const u = makeUnit('lejin');
    // 无心恋战（指挥）造成侧减伤 30%（负增伤）先施加
    inflictStatus(ctx, u, { type: 'damage_boost', rate: -0.3, duration: 3, direction: 'caused' }, 'command', 'wuxin_lianzhan', 'liubei');
    // 奋疾先登（指挥）造成侧增伤 8% → 正负相反：不冲突，新增独立实例共存
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.08, duration: 999, direction: 'caused', stack: true }, 'command', 'fenji_xiandeng', 'lejin');
    expect(countConflict(ctx, 'damage_boost')).toBe(0);
    expect(u.statuses.filter((s) => s.type === 'damage_boost').length).toBe(2);
    // 同战法继续叠层：累加到 32%，仍不与无心恋战冲突（无「增伤冲突」误报）
    for (let i = 1; i < 4; i++) {
      inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.08, duration: 999, direction: 'caused', stack: true }, 'command', 'fenji_xiandeng', 'lejin');
    }
    const caused = u.statuses.filter(
      (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'caused'
    );
    expect(caused.length).toBe(2);
    expect(caused.find((s) => s.sourceSkillId === 'fenji_xiandeng')!.rate).toBe(0.32);
    expect(caused.find((s) => s.sourceSkillId === 'wuxin_lianzhan')!.rate).toBe(-0.3);
    expect(countConflict(ctx, 'damage_boost')).toBe(0);
  });

  it('不同类型同名增益各自计数共存（不替换）', () => {
    const ctx = makeCtx();
    const u = makeUnit('f');
    inflictStatus(ctx, u, reduce30, 'command', 'biqi_fengmang');
    inflictStatus(ctx, u, reduce28, 'active', 'fumou_skill'); // 主动减伤，类型不同
    expect(countConflict(ctx, 'damage_reduce')).toBe(0);
    expect(u.statuses.filter((s) => s.type === 'damage_reduce').length).toBe(2);
  });

  it('伤害标签永不冲突：伤害是效果之一，与任何控制共存', () => {
    const ctx = makeCtx();
    const u = makeUnit('g');
    // 玄武洰流（主动）怯战，与战必断金（指挥）怯战跨类型共存
    inflictStatus(ctx, u, cow, 'command', 'zhanbi_duanjin');
    inflictStatus(ctx, u, cow, 'active', 'xuanwu_fuliu');
    // 混乱（主动）施加，与怯战互不冲突
    inflictStatus(ctx, u, confuse, 'active', 'hunshui_moyu');
    expect(countConflict(ctx, 'cowardice')).toBe(0);
    expect(countConflict(ctx, 'confusion')).toBe(0);
    expect(u.statuses.filter((s) => s.type === 'cowardice').length).toBe(2);
    expect(hasStatus(u, 'confusion')).toBe(true);
    // 伤害标签（damage）本身不产生任何状态冲突
    expect(ctx.events.filter((e) => e.type === 'status_conflict').length).toBe(0);
  });
});

describe('重复施加：默认刷新 / 显式叠层才累加（用户口径）', () => {
  it('同源属性增益默认刷新：数值替换为本次值、remaining 取 max、状态实例不增加', () => {
    const ctx = makeCtx();
    const u = makeUnit('r1');
    // 第一次 +10 持续 3
    inflictStatus(ctx, u, { type: 'attack_buff', amount: 10, duration: 3 }, 'active', 'test_attr');
    // 第二次 +20 持续 1：刷新（不是 +30），remaining 取较大者 3
    inflictStatus(ctx, u, { type: 'attack_buff', amount: 20, duration: 1 }, 'active', 'test_attr');
    const list = u.statuses.filter((s) => s.type === 'attack_buff');
    expect(list).toHaveLength(1);
    expect((list[0] as { amount: number }).amount).toBe(20);
    expect(list[0].remaining).toBe(3);
    // 刷新事件可见（同首次施加一样发 status_inflicted）
    const refreshed = ctx.events.filter(
      (e): e is Extract<(typeof ctx.events)[number], { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'attack_buff'
    );
    expect(refreshed).toHaveLength(2);
    expect(refreshed[1].detail).toContain('提高了20');
    expect(refreshed[1].detail).toContain('刷新');
  });

  it('同源减伤默认刷新：rate 替换（0.30 → 0.28），不累加成 0.58', () => {
    const ctx = makeCtx();
    const u = makeUnit('r2');
    inflictStatus(ctx, u, { type: 'damage_reduce', rate: 0.3, duration: 3 }, 'command', 'test_reduce');
    inflictStatus(ctx, u, { type: 'damage_reduce', rate: 0.28, duration: 1 }, 'command', 'test_reduce');
    const list = u.statuses.filter((s) => s.type === 'damage_reduce');
    expect(list).toHaveLength(1);
    expect((list[0] as { rate: number }).rate).toBe(0.28);
    expect(list[0].remaining).toBe(3);
  });

  it('带显式 stack 标记的属性类才累加（官方「可叠加」）', () => {
    const ctx = makeCtx();
    const u = makeUnit('r3');
    inflictStatus(ctx, u, { type: 'attack_buff', amount: 10, duration: 999, stack: true }, 'passive', 'test_stack_attr');
    inflictStatus(ctx, u, { type: 'attack_buff', amount: 10, duration: 999, stack: true }, 'passive', 'test_stack_attr');
    const list = u.statuses.filter((s) => s.type === 'attack_buff');
    expect(list).toHaveLength(1);
    expect((list[0] as { amount: number }).amount).toBe(20);
  });

  it('带 stack 的士气提高同源累加：8 → 16 → 24（谋议宏图口径）', () => {
    const ctx = makeCtx();
    const u = makeUnit('r4');
    for (let i = 0; i < 3; i++) {
      inflictStatus(ctx, u, { type: 'morale_boost', amount: 8, duration: 999, stack: true }, 'command', 'mouyi_hongtu');
    }
    const list = u.statuses.filter((s) => s.type === 'morale_boost');
    expect(list).toHaveLength(1);
    expect((list[0] as { amount: number }).amount).toBe(24);
  });

  it('概率规避（evade_chance）同源重挂：冲突被拒、不刷新、状态数不增加', () => {
    const ctx = makeCtx();
    const u = makeUnit('ev');
    const ev: CreateStatus = { type: 'evade_chance', rate: 0.5, charges: 3, duration: 2 };
    inflictStatus(ctx, u, ev, 'active', 'lieying_shouxian', 'jiangwei');
    // 同战法第二次释放：拒绝，不施加、不刷新 remaining
    inflictStatus(ctx, u, ev, 'active', 'lieying_shouxian', 'jiangwei');
    const list = u.statuses.filter((s) => s.type === 'evade_chance');
    expect(list).toHaveLength(1);
    expect(list[0].remaining).toBe(2);
    expect((list[0] as { charges: number }).charges).toBe(3);
    const conflicts = ctx.events.filter(
      (e) => e.type === 'status_conflict' && 'statusType' in e && e.statusType === 'evade_chance'
    );
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0] as { detail: string }).detail).toContain('先施加者生效');
  });

  it('概率规避（evade_chance）同类型不同战法：同样先施加者生效', () => {
    const ctx = makeCtx();
    const u = makeUnit('ev2');
    inflictStatus(ctx, u, { type: 'evade_chance', rate: 0.5, charges: 3, duration: 2 }, 'active', 'skill_a');
    inflictStatus(ctx, u, { type: 'evade_chance', rate: 0.6, charges: 5, duration: 3 }, 'active', 'skill_b');
    const list = u.statuses.filter((s) => s.type === 'evade_chance');
    expect(list).toHaveLength(1);
    expect((list[0] as { rate: number }).rate).toBe(0.5);
    expect(countConflict(ctx, 'evade_chance')).toBe(1);
  });

  it('规避（evasion 层数式必挡）同源加层语义不变', () => {
    const ctx = makeCtx();
    const u = makeUnit('ev3');
    inflictStatus(ctx, u, { type: 'evasion', stacks: 1 }, 'passive', 'xuefen_duanbing');
    inflictStatus(ctx, u, { type: 'evasion', stacks: 2 }, 'passive', 'xuefen_duanbing');
    const list = u.statuses.filter((s) => s.type === 'evasion');
    expect(list).toHaveLength(1);
    expect((list[0] as { stacks: number }).stacks).toBe(3);
  });

  it('同源控制类仍刷新 remaining（不叠加实例）', () => {
    const ctx = makeCtx();
    const u = makeUnit('r5');
    inflictStatus(ctx, u, { type: 'confusion', duration: 2 }, 'active', 'same_skill');
    inflictStatus(ctx, u, { type: 'confusion', duration: 3 }, 'active', 'same_skill');
    expect(u.statuses.filter((s) => s.type === 'confusion')).toHaveLength(1);
    expect(getStatus(u, 'confusion')!.remaining).toBe(3);
  });
});
