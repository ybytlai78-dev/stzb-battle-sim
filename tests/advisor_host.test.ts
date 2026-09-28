/**
 * 主站宿主适配（web/advisorHost.ts）
 * 锁：读配将区 → 方案；方案 → 配将区（换将 / 改等级 / 重设战法），失败如实回报（不静默半应用）。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createAdvisorHost } from '../web/advisorHost';
import { DEFAULT_DUMMY } from '../web/advisor/types';
import { emptySlot, type SlotState } from '../web/teamEditor';

function makeDeps(opts: { refuse?: (idx: number) => boolean } = {}) {
  const team: SlotState[] = [emptySlot(), emptySlot(), emptySlot()];
  const calls: string[] = [];
  const notices: string[] = [];
  let refreshes = 0;
  const handlers = {
    onPickHero: (_t: 'red' | 'blue', i: number, heroId: string) => {
      calls.push(`pick:${i}:${heroId}`);
      if (opts.refuse?.(i)) return; // 模拟互斥/重复被主站拦下
      team[i] = { ...emptySlot(), heroId };
    },
    onAddSkill: (_t: 'red' | 'blue', i: number, skillId: string) => {
      calls.push(`add:${i}:${skillId}`);
      team[i].extraSkillIds.push(skillId);
    },
    onRemoveSkill: (_t: 'red' | 'blue', i: number, skillId: string) => {
      calls.push(`rm:${i}:${skillId}`);
      team[i].extraSkillIds = team[i].extraSkillIds.filter((x) => x !== skillId);
    },
    onSetLevel: (_t: 'red' | 'blue', i: number, level: number) => {
      calls.push(`lv:${i}:${level}`);
      team[i].level = level;
    },
  };
  return {
    team,
    calls,
    notices,
    deps: { getTeam: () => team, handlers, refresh: () => (refreshes += 1), notify: (m: string) => notices.push(m) },
    refreshes: () => refreshes,
  };
}

const planOf = (heroIds: [string, string, string], skills: string[][] = [[], [], []], levels = [40, 40, 40]) => ({
  slots: heroIds.map((heroId, i) => ({
    position: (['大营', '中军', '前锋'] as const)[i],
    heroId,
    level: levels[i],
    skillIds: skills[i],
  })),
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
});

describe('advisorHost（主站适配）', () => {
  it('readTeam：只返回已上阵的槽位，位置按 大营→中军→前锋', () => {
    const d = makeDeps();
    d.team[0] = { ...emptySlot(), heroId: 'h1', level: 45, extraSkillIds: ['s1'] };
    d.team[2] = { ...emptySlot(), heroId: 'h2' };
    const host = createAdvisorHost(d.deps);
    const plan = host.readTeam();
    expect(plan.slots.map((s) => s.position)).toEqual(['大营', '前锋']);
    expect(plan.slots[0]).toMatchObject({ heroId: 'h1', level: 45, skillIds: ['s1'] });
    expect(host.teamLabel).toContain('红队');
  });

  it('applyPlan：换将 + 改等级 + 重设战法，并 refresh 一次', () => {
    const d = makeDeps();
    d.team[0] = { ...emptySlot(), heroId: 'oldHero', level: 40, extraSkillIds: ['oldSkill'] };
    const host = createAdvisorHost(d.deps);
    const r = host.applyPlan(planOf(['h1', 'h2', 'h3'], [['s1', 's2'], [], []], [45, 40, 40]));
    expect(r.ok).toBe(true);
    expect(d.team.map((s) => s.heroId)).toEqual(['h1', 'h2', 'h3']);
    expect(d.team[0].level).toBe(45);
    expect(d.team[0].extraSkillIds).toEqual(['s1', 's2']);
    expect(d.refreshes()).toBe(1);
    expect(d.notices.join()).toContain('已把方案写入配将区');
    expect(d.calls).toContain('pick:0:h1');
  });

  it('applyPlan：同一个武将只换战法 → 先移除旧战法再加新的（不叠加）', () => {
    const d = makeDeps();
    d.team[1] = { ...emptySlot(), heroId: 'h2', extraSkillIds: ['oldA', 'oldB'] };
    const host = createAdvisorHost(d.deps);
    const r = host.applyPlan(planOf(['h1', 'h2', 'h3'], [[], ['sNew'], []]));
    expect(r.ok).toBe(true);
    expect(d.calls).toContain('rm:1:oldA');
    expect(d.calls).toContain('rm:1:oldB');
    expect(d.team[1].extraSkillIds).toEqual(['sNew']);
  });

  it('applyPlan：主站拦下换将（互斥/重复）→ 如实回报失败，不假装成功', () => {
    const d = makeDeps({ refuse: (i) => i === 1 });
    const host = createAdvisorHost(d.deps);
    const r = host.applyPlan(planOf(['h1', 'h2', 'h3']));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('中军');
    expect(r.message).toContain('没能上阵');
    expect(d.notices.join()).toContain('部分未应用');
    expect(d.team[1].heroId).toBeNull();
    expect(d.team[0].heroId).toBe('h1'); // 其余槽位照常应用
  });

  it('applyPlan：空方案（没有任何槽位）不改动配将区', () => {
    const d = makeDeps();
    d.team[0] = { ...emptySlot(), heroId: 'keepMe' };
    const host = createAdvisorHost(d.deps);
    const r = host.applyPlan({ slots: [], coreUnitIds: [], dummy: { ...DEFAULT_DUMMY } });
    expect(r.ok).toBe(true);
    expect(d.team[0].heroId).toBe('keepMe');
  });
});
