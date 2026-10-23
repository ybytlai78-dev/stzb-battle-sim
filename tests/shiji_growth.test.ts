/**
 * 始计（shiji）成长率回归：两段 damage_boost 必须带 `strategyScaled` + `growthRate`，
 * 数值随施法者生效谋略增长（权威值 20.0/30.0 → 成长率 0.15/0.25，
 * 见 dateyuan/谋略战法受谋略成长调研.md）。
 *
 * 报障（2026-10-23）：始计数值恒为 +20% / −30% 不增长 —— 根因是两段 status 只写了
 * `strategyScaled` 却漏了 `growthRate`，`executeSkillOutputs` 的缩放分支
 * （`create.type === 'damage_boost' && create.strategyScaled && create.growthRate !== undefined`）
 * 因此不进入，直接用了基值。
 */
import { describe, expect, it } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';

function gen(p: Partial<General> & { id: string; position: General['position'] }): General {
  return {
    name: p.id,
    rarity: '5星',
    cost: 3,
    faction: '蜀',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    attack: 120,
    defense: 120,
    strategy: 100,
    speed: 50,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...p,
  };
}

/** 让中军带始计、按给定谋略跑 4 回合，返回两段增/减伤的 detail 文案（按出现顺序去重） */
function shijiDetails(strategy: number): { up: string[]; down: string[] } {
  const my = [
    gen({ id: 'a0', position: '前锋', attack: 100, speed: 60 }),
    gen({ id: 'a1', position: '中军', attack: 100, speed: 60, strategy }),
    gen({ id: 'a2', position: '大营', attack: 100, speed: 60 }),
  ];
  my[1].commandSkillIds = ['shiji'];
  const ef = ([0, 1, 2] as const).map((i) =>
    gen({
      id: 'e' + i,
      position: (['前锋', '中军', '大营'] as const)[i],
      attack: 200,
      defense: 100,
      strategy: 100,
      speed: 30,
    })
  );
  const rep = runBattle({ myTeam: my, enemyTeam: ef, seed: 7, maxRounds: 4 });
  const up: string[] = [];
  const down: string[] = [];
  for (const ev of rep.events as BattleEvent[]) {
    if (ev.type !== 'status_inflicted' || ev.statusType !== 'damage_boost') continue;
    if (ev.detail?.includes('提高')) up.push(ev.detail);
    else if (ev.detail?.includes('降低')) down.push(ev.detail);
  }
  return { up: [...new Set(up)], down: [...new Set(down)] };
}

/** 从「下一次造成的伤害提高 24%」里取百分数 */
function pct(detail: string): number {
  const m = detail.match(/(-?\d+(?:\.\d+)?)%/);
  expect(m, `无法从 detail 解析百分数：${detail}`).not.toBeNull();
  return Number(m![1]);
}

describe('始计 · 成长率配置', () => {
  it('两段 damage_boost 都带 strategyScaled + growthRate（0.15 / 0.25）', () => {
    const shiji = SKILL_REGISTRY.shiji as unknown as {
      onActSegments?: Array<{ output?: Array<{ status?: { type?: string; growthRate?: number; strategyScaled?: boolean; rate?: number } }> }>;
    };
    const statuses = (shiji.onActSegments ?? [])
      .flatMap((seg) => seg.output ?? [])
      .map((out) => out.status)
      .filter((s): s is NonNullable<typeof s> => s?.type === 'damage_boost');
    expect(statuses).toHaveLength(2);
    for (const s of statuses) {
      expect(s.strategyScaled, '必须标 strategyScaled，否则不受谋略缩放').toBe(true);
      expect(s.growthRate, '漏 growthRate = 数值恒定（本次报障根因）').toBeTypeOf('number');
    }
    expect(statuses.map((s) => s.growthRate)).toEqual([0.15, 0.25]);
  });

  it('数值随谋略增长：提高侧与降低侧的百分数都单调上升', () => {
    const low = shijiDetails(100);
    const high = shijiDetails(250);
    expect(low.up.length, '谋略 100 未产生增伤状态').toBeGreaterThan(0);
    expect(low.down.length, '谋略 100 未产生减伤状态').toBeGreaterThan(0);
    expect(high.up.length).toBeGreaterThan(0);
    expect(high.down.length).toBeGreaterThan(0);
    // 提高侧
    expect(pct(low.up[0])).toBeLessThan(pct(high.up[0]));
    // 降低侧（detail 里是正数百分数，越大 = 降得越多）
    expect(pct(low.down[0])).toBeLessThan(pct(high.down[0]));
    // 低谋略已高于基值 20 / 30（说明缩放已生效，不再是恒定基值）
    expect(pct(low.up[0])).toBeGreaterThan(20);
    expect(pct(low.down[0])).toBeGreaterThan(30);
  });
});
