/**
 * 批量20：状态机制扩展 —— 怯战免疫判定（魏武之泽 / 曹丕）
 *
 * 官方面板：「我军群体免疫怯战，普通攻击与追击战法造成的伤害提高 15%，每回合可两次普攻，持续 2 回合」
 *
 * 机制口径：
 * - 新增状态 `cowardice_immune`（免疫怯战），持续期间**只挡怯战**，不动混乱/暴走/犹豫
 *   （那 4 种是洞察 `insight` 的口径，两者互不干扰）。
 * - 判定发生在施加前：`inflictStatus` 收到 `cowardice` 时若目标持有 `cowardice_immune`
 *   → 直接返回、不写入状态，并推 `cowardice_immune_blocked` 事件（战报渲染「◈ X 免疫了怯战效果」）。
 * - 怯战的作用点不变：`canNormalAttack = !hasStatus(unit, 'cowardice')`（无法进行普通攻击）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { inflictStatus, type CombatContext } from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { initHeroDB, HERO_REGISTRY, level40, withSkills } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position): General {
  return {
    id,
    name: `木桩${id}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 150,
    defense: 120,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 15000,
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
  return [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')];
}

function makeUnit(id: string): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '魏',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: '大营',
      attack: 100,
      defense: 100,
      strategy: 120,
      speed: 50,
      attackRange: 2,
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
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(next = 0.1): CombatContext {
  return {
    rng: { next: () => next, int: () => 0, intInclusive: () => 0, chance: (p: number) => next < p } as unknown as Rng,
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

const has = (u: UnitState, type: Status['type']) => u.statuses.some((s) => s.type === type);
const pushStatus = (u: UnitState, s: Status) => u.statuses.push(s);
const IMMUNE: Status = {
  type: 'cowardice_immune',
  remaining: 2,
  appliedRound: 0,
  sourceSkillType: 'active',
  sourceSkillId: 'weiwu_zhi_ze',
};

describe('状态机制扩展：怯战免疫判定（cowardice_immune）', () => {
  it('魏武之泽已挂免疫怯战段，且从下架名单移除（曹丕上架）', () => {
    const s = SKILL_REGISTRY['weiwu_zhi_ze'];
    const immune = s.output.find(
      (o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'cowardice_immune'
    );
    expect(immune).toBeTruthy();
    if (immune?.kind === 'inflict_status' && !Array.isArray(immune.status)) {
      const st = immune.status;
      expect(st.type).toBe('cowardice_immune');
      if (st.type === 'cowardice_immune') {
        expect(st.duration).toBe(2);
      }
    }
    // 机制缺口已补 → 不再因「免疫怯战未建模」下架
    expect(OFFLINE_MAIN_SKILLS['weiwu_zhi_ze']).toBeUndefined();
    // 曹丕主战法仍在主动槽
    expect(hero('h25').activeSkillIds).toContain('weiwu_zhi_ze');
  });

  it('持有免疫怯战时：怯战被拦截，不写入状态，并推 cowardice_immune_blocked', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    pushStatus(u, { ...IMMUNE });

    inflictStatus(ctx, u, { type: 'cowardice', duration: 2 }, 'active', 'yangong', 'enemy-caster');

    expect(has(u, 'cowardice')).toBe(false);
    const blocked = ctx.events.filter((e) => e.type === 'cowardice_immune_blocked');
    expect(blocked.length).toBe(1);
    expect((blocked[0] as { unitId: string }).unitId).toBe('u');
    expect((blocked[0] as { statusType: string }).statusType).toBe('cowardice');
  });

  it('只挡怯战：同目标上的混乱/暴走/犹豫照常施加', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    pushStatus(u, { ...IMMUNE });

    inflictStatus(ctx, u, { type: 'confusion', duration: 2 }, 'active', 'qizuo_guimou', 'enemy-caster');
    inflictStatus(ctx, u, { type: 'rampage', duration: 2 }, 'active', 'qizuo_guimou', 'enemy-caster');
    inflictStatus(ctx, u, { type: 'hesitation', duration: 2 }, 'active', 'qiangshi', 'enemy-caster');

    expect(has(u, 'confusion')).toBe(true);
    expect(has(u, 'rampage')).toBe(true);
    expect(has(u, 'hesitation')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'cowardice_immune_blocked')).toBe(false);
  });

  it('两条免疫链路互不干扰：洞察仍按原口径免疫怯战（insight_blocked，非免疫怯战）', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    pushStatus(u, {
      type: 'insight',
      remaining: 2,
      appliedRound: 0,
      sourceSkillType: 'active',
      sourceSkillId: 'dongcha',
    });

    inflictStatus(ctx, u, { type: 'cowardice', duration: 2 }, 'active', 'yangong', 'enemy-caster');

    expect(has(u, 'cowardice')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'insight_blocked')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'cowardice_immune_blocked')).toBe(false);
  });

  it('无免疫时怯战照常生效（对照：拦截不是无条件放行）', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];

    inflictStatus(ctx, u, { type: 'cowardice', duration: 2 }, 'active', 'yangong', 'enemy-caster');

    expect(has(u, 'cowardice')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'cowardice_immune_blocked')).toBe(false);
  });

  it('实战回归：曹丕发动魏武之泽后，我军群体获得免疫怯战状态', () => {
    const caopi = withSkills({ ...level40(hero('h25')), position: '大营' }, { activeSkillIds: ['weiwu_zhi_ze'] });
    const myTeam = [dummy('a-front', '前锋'), dummy('a-mid', '中军'), caopi];

    const gained: string[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const report = runBattle({ seed, maxRounds: 8, myTeam, enemyTeam: enemyTeam() });
      gained.push(
        ...report.events
          .filter(
            (e): e is BattleEvent & { statusType: string; unitId: string } =>
              e.type === 'status_inflicted' && (e as { statusType?: string }).statusType === 'cowardice_immune'
          )
          .map((e) => e.unitId)
      );
    }
    expect(gained.length).toBeGreaterThan(0);
    // 施加到的是我军（自己人），不是敌军
    expect(gained.every((id) => id.startsWith('a-') || id === 'h25')).toBe(true);
  });
});
