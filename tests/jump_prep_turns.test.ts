/**
 * 「跳过准备回合」的粒度契约（2026-11-05 报障后建立）。
 *
 * 用户报障（原话）：「胜兵求战效果有误：实际效果应该是跳过一个准备回合，引擎侧实现的效果为跳过全部准备回合。
 *   案例：引擎内张飞携带胜兵求战时战法直接跳过了两个准备回合。」
 *
 * 口径：
 *  - `jump_prep.turns`（缺省 1）= 每次判定成功**跳过几个准备回合**，不是「跳过全部准备回合」。
 *    包内子战法 21175401（胜兵求战 effect 581「减少自带战法准备回合」）`constant_param = 1`；
 *    难知如阴 21382801 同为 1；宝物谋断文案「跳过 1 个准备回合」。
 *  - 准备槽登记 `left = prepareTurns − Σ跳过回合`：`left ≤ 0` 才当回合直接释放（旧行为，仅对 1 回合准备等价）；
 *    `left ≥ 1` 照常登记准备槽、下回合（或更后）释放。
 *  - 典型现场：张飞【长坂之吼】`prepareTurns: 2` + 胜兵求战 → 命中后仍需准备 1 回合（原先直接跳过 2 个）。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, CreateStatus, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';
import { renderEventLines } from '../src/engine/report';

function dummy(id: string, position: Position = '前锋'): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position,
    attack: 120,
    defense: 100,
    strategy: 80,
    speed: 60,
    attackRange: 5,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return { general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [] };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 11): CombatContext {
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

/** 准备主动（发动率固定 1，便于断言时序） */
function prepSkill(id: string, prepareTurns?: number): Skill {
  return {
    id,
    name: `测试准备主动${id}`,
    type: 'active',
    prepare: true,
    ...(prepareTurns != null ? { prepareTurns } : {}),
    range: 5,
    triggerRate: 1,
    targetMode: 'single',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 100 }],
  };
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 胜兵求战真实数据里的 jump_prep 配置（数据侧契约；窄化到 jump_prep 分支，避免宽联合的复合字面量检查） */
type JumpPrepStatus = Extract<CreateStatus, { type: 'jump_prep' }>;
const SBQZ_JUMP = (SKILL_REGISTRY.shengbing_qiuzhan as { output: { status: JumpPrepStatus }[] }).output[0].status;

describe('跳过准备回合的粒度：跳 1 回合 ≠ 跳过全部', () => {
  it('2 回合准备（长坂之吼）+ 胜兵求战：只跳过 1 回合，仍需准备 1 回合', () => {
    const zhangfei = makeUnit(dummy('zhangfei'));
    zhangfei.general.activeSkillIds = ['changban_zhihou'];
    zhangfei.general.mainSkillId = 'changban_zhihou';
    const enemy = makeUnit(dummy('e1'), 'enemy');
    const ctx = makeCtx([zhangfei], [enemy]);
    ctx.skills.set('changban_zhihou', { ...(SKILL_REGISTRY.changban_zhihou as Skill), triggerRate: 1 });
    inflictStatus(ctx, zhangfei, { ...SBQZ_JUMP, rate: 1 }, 'command', 'shengbing_qiuzhan', zhangfei.general.id);

    actUnit(ctx, zhangfei);

    // 没有直接释放：仍登记准备槽，且只少要 1 回合
    expect(eventsOf(ctx, 'prepare_skip')).toHaveLength(0);
    expect(zhangfei.preparations).toEqual([{ skillId: 'changban_zhihou', left: 1 }]);
    const start = eventsOf(ctx, 'prepare_start')[0];
    expect(start).toMatchObject({ skillId: 'changban_zhihou', skippedTurns: 1, remaining: 1 });
    expect(eventsOf(ctx, 'damage').filter((e) => e.skillId === 'changban_zhihou')).toHaveLength(0);

    // 下一次行动：释放（原先的实现把它在第一回合就直放掉了）
    ctx.events.length = 0;
    ctx.currentRound = 2;
    actUnit(ctx, zhangfei);
    expect(eventsOf(ctx, 'prepare_end').filter((e) => e.success).map((e) => e.skillId)).toEqual(['changban_zhihou']);
    expect(eventsOf(ctx, 'damage').filter((e) => e.skillId === 'changban_zhihou').length).toBeGreaterThan(0);
  });

  it('1 回合准备战法 + 跳过 1 回合：仍当回合直接释放（旧行为对 1 回合准备等价）', () => {
    const u = makeUnit(dummy('u'));
    u.general.activeSkillIds = ['prep1'];
    u.general.mainSkillId = 'prep1';
    const enemy = makeUnit(dummy('e1'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('prep1', prepSkill('prep1'));
    inflictStatus(ctx, u, { ...SBQZ_JUMP, rate: 1 }, 'command', 'shengbing_qiuzhan', u.general.id);

    actUnit(ctx, u);

    expect(eventsOf(ctx, 'prepare_start')).toHaveLength(0);
    expect(u.preparations).toHaveLength(0);
    expect(eventsOf(ctx, 'prepare_skip')[0]).toMatchObject({ skillId: 'prep1', turns: 1 });
    expect(eventsOf(ctx, 'damage').filter((e) => e.skillId === 'prep1').length).toBeGreaterThan(0);
  });

  it('turns 缺省 = 1：2 回合准备仍留 1 回合（不因字段缺失退回「跳过全部」）', () => {
    const u = makeUnit(dummy('u'));
    u.general.activeSkillIds = ['prep2'];
    u.general.mainSkillId = 'prep2';
    const ctx = makeCtx([u], [makeUnit(dummy('e1'), 'enemy')]);
    ctx.skills.set('prep2', prepSkill('prep2', 2));
    inflictStatus(ctx, u, { type: 'jump_prep', rate: 1, duration: 999, mainSkillOnly: true }, 'command', 'nanzhi_ruyin', u.general.id);

    actUnit(ctx, u);

    expect(u.preparations).toEqual([{ skillId: 'prep2', left: 1 }]);
    expect(eventsOf(ctx, 'prepare_skip')).toHaveLength(0);
  });

  it('多条跳过准备来源各自判 1 回合、累计生效（2 回合准备被两条同时跳完 → 直放）', () => {
    const u = makeUnit(dummy('u'));
    u.general.activeSkillIds = ['prep2'];
    u.general.mainSkillId = 'prep2';
    const ctx = makeCtx([u], [makeUnit(dummy('e1'), 'enemy')]);
    ctx.skills.set('prep2', prepSkill('prep2', 2));
    inflictStatus(ctx, u, { type: 'jump_prep', rate: 1, duration: 999, turns: 1, mainSkillOnly: true }, 'command', 'shengbing_qiuzhan', u.general.id);
    inflictStatus(ctx, u, { type: 'jump_prep', rate: 1, duration: 1, turns: 1, mainSkillOnly: true }, 'passive', 'treasure:mouduan', u.general.id);

    actUnit(ctx, u);

    expect(u.preparations).toHaveLength(0);
    expect(eventsOf(ctx, 'prepare_skip')[0]).toMatchObject({ skillId: 'prep2', turns: 2 });
    expect(eventsOf(ctx, 'damage').filter((e) => e.skillId === 'prep2').length).toBeGreaterThan(0);
  });

  it('mainSkillOnly：装配的准备主动战法不吃跳过（2 回合准备保持 2 回合）', () => {
    const u = makeUnit(dummy('u'));
    u.general.activeSkillIds = ['equipped_prep2'];
    u.general.mainSkillId = 'main_other';
    const ctx = makeCtx([u], [makeUnit(dummy('e1'), 'enemy')]);
    ctx.skills.set('equipped_prep2', prepSkill('equipped_prep2', 2));
    inflictStatus(ctx, u, { ...SBQZ_JUMP, rate: 1 }, 'command', 'shengbing_qiuzhan', u.general.id);

    actUnit(ctx, u);

    expect(u.preparations).toEqual([{ skillId: 'equipped_prep2', left: 2 }]);
    expect(eventsOf(ctx, 'prepare_start')[0]).not.toHaveProperty('skippedTurns');
  });

  it('数据侧：胜兵求战 / 难知如阴的 jump_prep 都是 turns=1', () => {
    expect(SBQZ_JUMP).toMatchObject({ type: 'jump_prep', turns: 1, mainSkillOnly: true });
    const nanzhi = SKILL_REGISTRY.nanzhi_ruyin as { output: { status: CreateStatus }[] };
    const nanzhiJump = nanzhi.output.find((o) => o.status.type === 'jump_prep');
    expect(nanzhiJump?.status).toMatchObject({ type: 'jump_prep', turns: 1, mainSkillOnly: true });
  });

  it('战报文案：跳过 1 回合准备与仍需准备回合数都要可见', () => {
    expect(
      renderEventLines({ type: 'prepare_start', unitId: '张飞', skillId: 'changban_zhihou', skillName: '长坂之吼', skippedTurns: 1, remaining: 1 })
    ).toEqual(['  ⏳ 张飞 开始准备「长坂之吼」（跳过 1 回合准备，仍需 1 回合）']);
    expect(
      renderEventLines({ type: 'prepare_skip', unitId: '张飞', skillId: 'changban_zhihou', skillName: '长坂之吼', turns: 1 })
    ).toEqual(['  ✦ 张飞 跳过 1 回合准备，直接发动「长坂之吼」']);
    // 无字段时保持旧文案（不带 turns 的旧事件仍然可读）
    expect(
      renderEventLines({ type: 'prepare_skip', unitId: '张飞', skillId: 'changban_zhihou', skillName: '长坂之吼' })
    ).toEqual(['  ✦ 张飞 跳过准备，直接发动「长坂之吼」']);
  });
});
