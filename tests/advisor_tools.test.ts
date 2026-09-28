/**
 * Task 3：工具注册表 + 一期六个工具 + 预算护栏（web/advisor/tools.ts）
 * 锁：工具契约、场次上限、预算拒绝执行（不是静默截断）、关 1 的四种拒收、真表检索与详情。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { MAIN_SKILL_IDS, SLOTTED_HEROES } from '../web/heroes';
import { LEARNABLE_SKILL_IDS } from '../web/teamConfig';
import { createTools, makeCtx, runTool, SIM_RUNS_MAX } from '../web/advisor/tools';
import { BudgetExceeded, DEFAULT_DUMMY, type AdvisorPlan } from '../web/advisor/types';

/** 按武将 id 拼一个方案（位置按 大营/中军/前锋） */
function planWith(heroIds: string[], skills: string[][] = []): AdvisorPlan {
  const positions = ['大营', '中军', '前锋'] as const;
  return {
    slots: heroIds.slice(0, 3).map((heroId, i) => ({ position: positions[i], heroId, level: 40, skillIds: skills[i] ?? [] })),
    coreUnitIds: [],
    dummy: { ...DEFAULT_DUMMY },
  };
}

/** 从库里找一对「同 mutualExclusionGroup」的武将（赵云 / SP赵云 那一类） */
function findMutualPair(): [string, string] {
  const byGroup = new Map<string, string[]>();
  for (const h of SLOTTED_HEROES) {
    const g = h.mutualExclusionGroup;
    if (!g) continue;
    byGroup.set(g, [...(byGroup.get(g) ?? []), h.id]);
  }
  const first = [...byGroup.values()].find((ids) => ids.length >= 2);
  if (!first) throw new Error('库里没有互斥组（测试前置不成立）');
  return [first[0], first[1]];
}

describe('advisor tools', () => {
  it('八个工具都在注册表里，且各有 name/description/schema/cost', () => {
    const tools = createTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_config',
      'hero_detail',
      'list_skills',
      'search_hero',
      'search_skill',
      'simulate',
      'skill_detail',
      'validate_plan',
    ]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.schema).toBeTruthy();
      expect(t.cost).toBeTruthy();
    }
  });

  it('get_config 返回当前配置的方案形状（三槽 + 靶子）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const r = await runTool('get_config', {}, ctx);
    const data = r.data as { plan: AdvisorPlan; morale: number; rounds: number };
    expect(data.plan.slots).toHaveLength(3);
    expect(data.plan.dummy).toMatchObject(DEFAULT_DUMMY);
    expect(r.summary).toContain('当前配置');
  });

  it('simulate：runs 超上限直接拒绝', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    await expect(runTool('simulate', { plan: ctx.deps.__plan, runs: SIM_RUNS_MAX + 1 }, ctx)).rejects.toThrow(/runs/);
  });

  it('预算超限 → BudgetExceeded（拒绝执行，不是静默截断）', async () => {
    const ctx = makeCtx({ fakeRuns: true, budget: { maxBattles: 10 } });
    await expect(runTool('simulate', { plan: ctx.deps.__plan, runs: 20 }, ctx)).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it('预算按实参场次计费：跑 20 场只扣 20（而不是固定上限）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    await runTool('simulate', { plan: ctx.deps.__plan, runs: 20 }, ctx);
    expect(ctx.budget.battles).toBe(20);
    await runTool('simulate', { plan: ctx.deps.__plan, runs: 5 }, ctx);
    expect(ctx.budget.battles).toBe(25);
    expect(ctx.budget.calls).toBe(2);
  });

  it('simulate：返回 PlanSummary 口径字段 + evidenceId + stats.battles = 实跑场次', async () => {
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 26500 });
    const r = await runTool('simulate', { plan: ctx.deps.__plan, runs: 20 }, ctx);
    const data = r.data as { mean: number; runs: number; halfWidth: number; byUnit: unknown[]; wipedRuns: number };
    expect(data.runs).toBe(20);
    expect(data.mean).toBe(26500);
    expect(data.halfWidth).toBe(0);
    expect(data.byUnit).toHaveLength(3);
    expect(data.wipedRuns).toBe(0);
    expect(r.evidenceId).toMatch(/^ev-\d+-simulate$/);
    expect(r.stats.battles).toBe(20);
  });

  it('evidenceId 每次调用都不同（关 2 溯源的前提）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const a = await runTool('get_config', {}, ctx);
    const b = await runTool('get_config', {}, ctx);
    expect(a.evidenceId).not.toBe(b.evidenceId);
  });

  it('validate_plan：合法方案（真表）→ ok', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    // 注意：用**上架池**的武将（L2 默认配置的 h3/h5/h16 有未实现主战法的，不在配将池里）
    const ids = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    const r = await runTool('validate_plan', { plan: planWith(ids) }, ctx);
    const data = r.data as { ok: boolean; errors: Array<{ code: string; message: string }> };
    expect(data.errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
    expect(data.ok).toBe(true);
  });

  it('validate_plan 拒收：同队互斥', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const [a, b] = findMutualPair();
    const r = await runTool('validate_plan', { plan: planWith([a, b, SLOTTED_HEROES[0].id]) }, ctx);
    const data = r.data as { ok: boolean; errors: Array<{ code: string }> };
    expect(data.ok).toBe(false);
    expect(data.errors.map((e) => e.code)).toContain('mutual_exclusion');
  });

  it('validate_plan 拒收：全队战法重复', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const skill = LEARNABLE_SKILL_IDS[0];
    const r = await runTool(
      'validate_plan',
      { plan: planWith([SLOTTED_HEROES[0].id, SLOTTED_HEROES[1].id, SLOTTED_HEROES[2].id], [[skill], [skill]]) },
      ctx
    );
    const data = r.data as { ok: boolean; errors: Array<{ code: string }> };
    expect(data.ok).toBe(false);
    expect(data.errors.map((e) => e.code)).toContain('duplicate_skill');
  });

  it('validate_plan 拒收：主战法放进可学槽', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const mainSkill = [...MAIN_SKILL_IDS][0];
    const r = await runTool('validate_plan', { plan: planWith([SLOTTED_HEROES[0].id], [[mainSkill]]) }, ctx);
    const data = r.data as { ok: boolean; errors: Array<{ code: string }> };
    expect(data.ok).toBe(false);
    expect(data.errors.map((e) => e.code)).toContain('main_skill_in_slot');
  });

  it('validate_plan：plan 结构不对 → 抛错（暴露给 loop 回灌，不静默放过）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    await expect(runTool('validate_plan', { plan: { slots: 'bad' } }, ctx)).rejects.toThrow(/plan 结构不对/);
  });

  it('search_skill / search_hero 走真表且分词匹配', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const s = await runTool('search_skill', { q: '击势' }, ctx);
    expect((s.data as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
    const h = await runTool('search_hero', { q: '赵云' }, ctx);
    expect((h.data as { hits: Array<{ name: string }> }).hits.some((x) => x.name.includes('赵云'))).toBe(true);
  });

  it('检索扩面（2026-09-29）：描述/标签词也能命中，「骑兵」不再 0 命中', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const byDesc = await runTool('search_skill', { q: '骑兵' }, ctx);
    expect((byDesc.data as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
    // 主战法名也能搜到武将（曹纯的虎豹督军）
    const byMain = await runTool('search_hero', { q: '虎豹督军' }, ctx);
    expect((byMain.data as { hits: Array<{ name: string }> }).hits.some((x) => x.name === '曹纯')).toBe(true);
  });

  it('检索 0 命中时给换词提示（brief 不为空），模型不必反复重试同一个词', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const r = await runTool('search_skill', { q: 'zzz不存在的词' }, ctx);
    expect((r.data as { hits: unknown[] }).hits).toHaveLength(0);
    expect(r.brief).toContain('出手位');
  });

  it('hero_detail：曹纯带出主战法 / 兵种 / 40 级四维（它此前只能拿到 id）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const r = await runTool('hero_detail', { id: 'h498' }, ctx);
    const d = r.data as { found: boolean; name: string; troopType: string; mainSkillName: string; stats40: { attack: number } };
    expect(d.found).toBe(true);
    expect(d.name).toBe('曹纯');
    expect(d.troopType).toBe('骑');
    expect(d.mainSkillName).toBe('虎豹督军');
    expect(d.stats40.attack).toBeGreaterThan(100);
    expect(r.brief).toContain('虎豹督军');
    const no = await runTool('hero_detail', { id: 'nope' }, ctx);
    expect((no.data as { found: boolean }).found).toBe(false);
  });

  it('list_skills：按出手位批量拉池子（分页 + 还有多少的提示）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const r = await runTool('list_skills', { slot: '被动', limit: 5 }, ctx);
    const d = r.data as { total: number; rows: Array<{ id: string; name: string; slot: string }> };
    expect(d.total).toBeGreaterThan(5);
    expect(d.rows).toHaveLength(5);
    expect(d.rows.every((x) => x.slot.includes('被动'))).toBe(true);
    expect(r.brief).toContain('offset=');
  });

  it('simulate 带 brief：每将 / 每战法的紧凑明细也进上下文（用户 2026-09-29 口径）', async () => {
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 26500 });
    const r = await runTool('simulate', { plan: ctx.deps.__plan, runs: 20 }, ctx);
    expect(r.brief).toContain('每将（场均伤害）');
    expect(r.brief).toContain('★');
    expect(r.brief).toContain('26500');
  });

  it('skill_detail：在库返回详情，不在库返回 found:false（不编造）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const ok = await runTool('skill_detail', { id: LEARNABLE_SKILL_IDS[0] }, ctx);
    expect((ok.data as { found: boolean }).found).toBe(true);
    const no = await runTool('skill_detail', { id: 'no_such_skill' }, ctx);
    expect((no.data as { found: boolean }).found).toBe(false);
  });

  it('runTool 未知工具名 → 抛错', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    await expect(runTool('nope', {}, ctx)).rejects.toThrow(/未知工具/);
  });
});
