/**
 * Task 3：工具注册表 + 一期六个工具 + 预算护栏（web/advisor/tools.ts）
 * 锁：工具契约、场次上限、预算拒绝执行（不是静默截断）、关 1 的四种拒收、真表检索与详情。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ALL_HEROES, getHeroById, HEROES, MAIN_SKILL_IDS, SLOTTED_HEROES } from '../web/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { LEARNABLE_SKILL_IDS } from '../web/teamConfig';
import { createTools, makeCtx, runTool, SIM_RUNS_MAX } from '../web/advisor/tools';
import type { BoxView } from '../web/advisor/box';
import { BudgetExceeded, DEFAULT_DUMMY, type AdvisorPlan } from '../web/advisor/types';
import { loadBenchmark } from '../web/opponentPool';
import type { PoolMatchup } from '../web/poolMatchup';

const heroNameOf = (id: string): string => getHeroById(id)?.name ?? id;
const skillNameOf = (id: string): string => SKILL_REGISTRY[id]?.name ?? id;

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
  it('二十二个工具都在注册表里（19 业务 + 3 常驻），且各有 name/description/schema/cost', () => {
    const tools = createTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_opponent_from_preset',
      'compare_variants',
      'get_config',
      'get_my_box',
      'hero_detail',
      'list_opponent_pool',
      'list_skills',
      'matchup_pool',
      'optimize_both',
      'optimize_mates',
      'optimize_skills',
      'optimize_winrate',
      'remove_user_opponent',
      'route_task',
      'search_hero',
      'search_skill',
      'simulate',
      'simulate_many',
      'skill_detail',
      'tools_catalog',
      'tools_help',
      'validate_plan',
    ]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.schema).toBeTruthy();
      expect(t.cost).toBeTruthy();
    }
  });

  it('optimize_both：队友 ↔ 战法交替两轮（先搜队友→逐套搜战法→回头再搜队友）', async () => {
    const order: string[] = [];
    let skillRound = 0;
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        estimateMateBattles: () => 900,
        estimateSkillBattles: () => 2500,
        applyCombo: (cfg, picks, clear) => {
          const out = { ...cfg, slots: cfg.slots.map((s) => ({ ...s, skillIds: [...s.skillIds] })) };
          for (const p of picks) out.slots[p.unit] = { ...out.slots[p.unit], heroId: p.heroId, ...(clear ? { skillIds: [] } : {}) };
          return out;
        },
        optimizeMates: async (cfg) => {
          order.push(`mates:${cfg.slots[1].heroId}`);
          return {
            battles: 900,
            ms: 2700,
            matchLabel: '中军 / 前锋',
            coreLabel: '核心将',
            candidateCount: 40,
            baseline: { runs: 20, mean: 5000, meanTotal: 20000, damages: [] },
            options: { slotSkills: 'keep' },
            finals: [
              { rank: 1, label: '田丰 + 袁绍', mean: 7000, halfWidth: 300, runs: 20, meanTotal: 20000, wipedRuns: 0, picks: [{ unit: 1, unitName: '中军', heroId: 'h1', heroName: '田丰' }], byUnit: [] },
              { rank: 2, label: '张辽 + 乐进', mean: 6500, halfWidth: 300, runs: 20, meanTotal: 19000, wipedRuns: 0, picks: [{ unit: 1, unitName: '中军', heroId: 'h2', heroName: '张辽' }], byUnit: [] },
            ],
          } as never;
        },
        optimizeSkills: async (cfg) => {
          skillRound += 1;
          // 记录「中军是谁」+「核心将已配几个战法」：第 2 轮应当带着第 1 轮搜到的战法(_1_)再搜
          order.push(`skills:${cfg.slots[1].heroId}:${cfg.slots[0].skillIds.filter(Boolean).length}`);
          // 第 2 轮（队友换成 h1 之后）给更高的期望 → 验证「榜单会收录更优的第 2 轮结果」
          const mean = cfg.slots[1].heroId === 'h1' ? 7317 : 6000;
          return {
            battles: 2500,
            ms: 20000,
            tiesWithBest: 0,
            rankAgreement: 1,
            wipedCombos: 0,
            candidateCount: 20,
            candidateSkipped: 0,
            matchLabel: '核心将',
            coreLabel: '核心将',
            noEmptySlot: false,
            combosCapped: false,
            finals: [
              {
                rank: 1,
                label: '危崖困军 + 计险远近',
                mean,
                halfWidth: 300,
                runs: 20,
                meanTotal: 15000,
                tieWithBest: false,
                wipedRuns: 0,
                picks: [{ unit: 0, slot: 1, unitName: '核心将', skillId: 's1', skillName: '危崖困军' }],
                byUnit: [{ unit: 0, name: '核心将', mean, core: true }],
              },
            ],
          } as never;
        },
      },
    });
    const r = await runTool('optimize_both', { rounds: 2, mateTop: 2, finalRuns: 20 }, ctx);
    const d = r.data as { rows: Array<{ stage: string; mean: number; heroIds: string[] }>; plan: { slots: Array<{ heroId: string; skillIds: string[] }> } };
    // 调用顺序：队友 → 两套战法 → 再队友 → 再战法（首轮队友位是面板原配置的中军）
    expect(order.join(' | ')).toBe('mates:h5 | skills:h1:0 | skills:h2:0 | mates:h1 | skills:h1:1');
    expect(skillRound).toBe(3);
    // 第 2 轮更高分被收录并排到第一
    expect(d.rows[0].mean).toBe(7317);
    expect(d.rows[0].stage).toBe('第 2 轮');
    expect(d.rows.length).toBeGreaterThanOrEqual(2);
    // 返回的 plan 是可直接应用的三将三战法（战法槽按位写，空槽为 ''）
    expect(d.plan.slots[1].heroId).toBe('h1');
    expect(d.plan.slots[0].skillIds.filter(Boolean)).toEqual(['s1']);
    expect(r.stats.battles).toBe(900 + 2500 * 2 + 900 + 2500); // 本工具自己真跑的场次
    expect(r.brief).toContain('整体搜索');
    expect(r.brief).toContain('第 2 轮');
  });

  it('optimize_both：预估场次超预算 → 拒绝执行并给出调小建议', async () => {
    const ctx = makeCtx({
      fakeRuns: true,
      budget: { maxBattles: 1000 },
      deps: { estimateMateBattles: () => 900, estimateSkillBattles: () => 2500 },
    });
    await expect(runTool('optimize_both', { mateTop: 3, rounds: 2 }, ctx)).rejects.toThrow(/预计 \d+ 场/);
  });

  it('optimize_skills：把 L2 搜索当工具调（注入假搜索，验证榜单/预算/进度）', async () => {
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        estimateSkillBattles: () => 8062,
        optimizeSkills: async (_cfg, _opts, onProgress) => {
          onProgress?.(4000, 8062);
          onProgress?.(8062, 8062);
          return {
            battles: 8062,
            ms: 57000,
            tiesWithBest: 1,
            rankAgreement: 0.73,
            wipedCombos: 0,
            candidateCount: 92,
            candidateSkipped: 3,
            matchLabel: '文鸯',
            coreLabel: '文鸯',
            noEmptySlot: false,
            combosCapped: false,
            finals: [
              { rank: 1, label: '危崖困军 + 计险远近', mean: 26500, halfWidth: 1675, runs: 20, meanTotal: 74636, tieWithBest: false, wipedRuns: 0, picks: [{ unit: 0, slot: 1, unitName: '文鸯', skillId: 'a', skillName: '危崖困军' }], byUnit: [{ unit: 0, name: '文鸯', mean: 26500, core: true }] },
              { rank: 2, label: '三术奇谋 + 深谋远虑', mean: 26000, halfWidth: 1500, runs: 20, meanTotal: 73000, tieWithBest: true, wipedRuns: 0, picks: [], byUnit: [] },
            ],
          } as never;
        },
      },
    });
    const events: string[] = [];
    ctx.onProgress = (e) => events.push(`${e.name}:${e.done}/${e.total}`);
    const r = await runTool('optimize_skills', {}, ctx);
    const rows = (r.data as { rows: Array<{ mean: number; label: string }> }).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].mean).toBe(26500);
    expect(r.brief).toContain('第 1 名'.slice(0, 3) === '第 1' ? '危崖困军' : '');
    expect(r.brief).toContain('分不出来'); // 差距 500 < 半宽之和 3175
    expect(r.stats.battles).toBe(8062);
    expect(events).toEqual(['optimize_skills:4000/8062', 'optimize_skills:8062/8062']);
  });

  it('optimize_skills：预估场次超预算 → 拒绝执行，且把账算给模型看（可调小规模）', async () => {
    const ctx = makeCtx({
      fakeRuns: true,
      budget: { maxBattles: 5000 },
      deps: { estimateSkillBattles: () => 8062, optimizeSkills: async () => ({ finals: [] }) as never },
    });
    await expect(runTool('optimize_skills', {}, ctx)).rejects.toThrow(/预计 8062 场.*已用 0\/5000 场/s);
  });

  it('optimize_skills：预估场次就是计费依据（真实跑完后 budget.battles 记的是实跑数）', async () => {
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        estimateSkillBattles: () => 900,
        optimizeSkills: async () => ({ battles: 880, ms: 3000, finals: [{ rank: 1, label: 'X', mean: 100, halfWidth: 10, runs: 20, meanTotal: 300, tieWithBest: false, wipedRuns: 0, picks: [], byUnit: [] }], tiesWithBest: 0, rankAgreement: 1, wipedCombos: 0, candidateCount: 1, candidateSkipped: 0, matchLabel: 'm', coreLabel: 'c', noEmptySlot: false, combosCapped: false }) as never,
      },
    });
    await runTool('optimize_skills', {}, ctx);
    expect(ctx.budget.battles).toBe(900); // 计费按预估
  });

  it('optimize_mates：把 L3 搜索当工具调（含与当前队友的对照基线）', async () => {
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        estimateMateBattles: () => 889,
        optimizeMates: async () =>
          ({
            battles: 889,
            ms: 2700,
            baseline: { runs: 20, mean: 7000, meanTotal: 20000, damages: [] },
            candidateCount: 40,
            candidateSkipped: 3,
            poolSkippedMutual: 1,
            matchLabel: '中军 / 前锋',
            coreLabel: '文鸯',
            poolLabel: '上架武将',
            noMatchSlot: false,
            baselineIllegal: false,
            options: { slotSkills: 'keep' },
            finals: [{ rank: 1, label: '田丰 + 袁绍', mean: 7317, halfWidth: 651, runs: 20, meanTotal: 15503, wipedRuns: 0, picks: [{ unit: 1, unitName: '中军', heroId: 'h1', heroName: '田丰' }], byUnit: [] }],
          }) as never,
      },
    });
    const r = await runTool('optimize_mates', {}, ctx);
    expect(r.summary).toContain('高 317');
    expect(r.brief).toContain('对照基线');
    expect(r.brief).toContain('控制型队友');
  });

  it('槽位缺 skillIds 不再崩（2026-09-29 实跑：模型给的方案缺字段 → 深处 undefined.filter）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const loose = { slots: [{ position: '大营', heroId: 'h498' }, { position: '中军', heroId: 'h27' }, { position: '前锋', heroId: 'h672' }] };
    const r = await runTool('simulate', { plan: loose, runs: 5 }, ctx);
    expect((r.data as { runs: number }).runs).toBe(5);
    // level 补 40、skillIds 补空数组
    const normalized = (r.data as { plan: { slots: Array<{ level: number; skillIds: string[] }> } }).plan;
    expect(normalized.slots[0].level).toBe(40);
    expect(normalized.slots[0].skillIds).toEqual([]);
  });

  it('skillIds 不是数组 → 报错信息直接点名字段（模型能一次改对，不必盲试）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    await expect(
      runTool('simulate', { plan: { slots: [{ position: '大营', heroId: 'h498', skillIds: 'jishi' }] } }, ctx)
    ).rejects.toThrow(/skillIds 必须是字符串数组/);
    await expect(runTool('simulate', { plan: { slots: [{ position: '大营' }] } }, ctx)).rejects.toThrow(/heroId 缺失/);
  });

  it('simulate_many：一次对拍多套并按期望排序（省调用次数）', async () => {
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 26500 });
    const plan = ctx.deps.__plan;
    const r = await runTool('simulate_many', { plans: [{ label: 'A', plan }, { label: 'B', plan }], runs: 20 }, ctx);
    const d = r.data as { runs: number; rows: Array<{ label: string; mean: number }>; rankedLabels: string[] };
    expect(d.rows).toHaveLength(2);
    expect(d.runs).toBe(20);
    expect(r.stats.battles).toBe(40); // 2 套 × 20 场
    expect(r.brief).toContain('排序');
    expect(r.brief).toContain('分不出来');
    await expect(runTool('simulate_many', { plans: [] }, ctx)).rejects.toThrow(/plans 不能为空/);
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

  it('毫秒预算只计工具耗时：开跑前空等不拒绝', async () => {
    const ctx = makeCtx({ fakeRuns: true, budget: { maxMs: 5 } });
    await new Promise((r) => setTimeout(r, 30));
    await runTool('get_config', {}, ctx);
    expect(ctx.budget.calls).toBe(1);
  });

  it('工具耗时已经用尽 → 拒绝下一次（ms）', async () => {
    const ctx = makeCtx({ fakeRuns: true, budget: { maxMs: 1000 } });
    ctx.budget.ms = 1001;
    await expect(runTool('get_config', {}, ctx)).rejects.toMatchObject({ why: 'ms' });
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

  it('validate_plan：同名武将按 heroId 通过（群吕布 h479）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const others = SLOTTED_HEROES.filter((h) => !h.mutualExclusionGroup && h.id !== 'h479').slice(0, 2).map((h) => h.id);
    const r = await runTool('validate_plan', { plan: planWith(['h479', ...others]) }, ctx);
    const data = r.data as { ok: boolean; errors: Array<{ message: string }> };
    expect(data.errors.map((e) => e.message)).toEqual([]);
    expect(data.ok).toBe(true);
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

  it('hero_detail：下架武将（文鸯 h704）必须带「已下架」告警 —— 成长率未确认，数值偏低', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const r = await runTool('hero_detail', { id: 'h704' }, ctx);
    const d = r.data as { found: boolean; name: string; listed: boolean; mainSkillName: string };
    expect(d.found).toBe(true);
    expect(d.name).toBe('文鸯');
    expect(d.mainSkillName).toBe('盛气横凌');
    if (!d.listed) {
      expect(r.summary).toContain('已下架');
      expect(r.brief).toContain('已下架');
      expect(r.brief).toContain('偏低');
    }
  });

  it('optimize_skills（真接线）：小范围真跑一次 L2 搜索，出榜单', async () => {
    const heros = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    const plan: AdvisorPlan = {
      slots: heros.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 40, skillIds: [] })),
      coreUnitIds: [],
      dummy: { ...DEFAULT_DUMMY },
    };
    const ctx = makeCtx({ fakeRuns: true }); // 只把单方案测评换成假的；搜索走真 L2
    const r = await runTool(
      'optimize_skills',
      { plan, candidateSkillIds: [LEARNABLE_SKILL_IDS[0]], coarseRuns: 1, finalRuns: 20, coarseTop: 2, matchSlotKeys: ['0-1'] },
      ctx
    );
    const d = r.data as { rows: Array<{ mean: number; runs: number }>; meta: { battles: number; candidateCount: number } };
    expect(d.rows.length).toBeGreaterThan(0);
    expect(d.rows[0].runs).toBeGreaterThanOrEqual(20);
    expect(d.meta.battles).toBeGreaterThan(0);
    expect(r.stats.battles).toBe(d.meta.battles);
    expect(r.brief).toContain('排序口径');
  });

  it('optimize_both（真接线）：极小范围真跑一轮「队友 → 战法」，出榜单', async () => {
    const heros = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    const plan: AdvisorPlan = {
      slots: heros.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 40, skillIds: [] })),
      coreUnitIds: [],
      dummy: { ...DEFAULT_DUMMY },
    };
    const other = SLOTTED_HEROES[3]?.id ?? heros[2];
    const ctx = makeCtx({ fakeRuns: true }); // 单方案测评换假的；两套搜索走真实现
    const r = await runTool(
      'optimize_both',
      {
        plan,
        rounds: 1,
        mateTop: 1,
        coarseRuns: 1,
        finalRuns: 20,
        coarseTop: 2,
        matchUnits: [1],
        candidateHeroIds: [other],
        candidateSkillIds: [LEARNABLE_SKILL_IDS[0]],
      },
      ctx
    );
    const d = r.data as { rows: Array<{ mean: number; heroIds: string[] }>; plan: AdvisorPlan; meta: { estimate: number } };
    expect(d.rows.length).toBeGreaterThan(0);
    expect(d.plan.slots).toHaveLength(3);
    expect(r.stats.battles).toBeGreaterThan(0);
    expect(r.brief).toContain('整体搜索');
  });

  it('报价 + 确认：用户点「不跑」→ 工具拒绝执行、**没真跑**、额度退回', async () => {
    let ran = 0;
    const asked: Array<{ battles: number; label: string }> = [];
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        estimateSkillBattles: () => 8000,
        optimizeSkills: async () => {
          ran += 1;
          return { finals: [] } as never;
        },
      },
    });
    ctx.confirm = async (q) => {
      asked.push({ battles: q.battles, label: q.label });
      return false;
    };
    await expect(runTool('optimize_skills', {}, ctx)).rejects.toThrow(/用户拒绝了这次搜索/);
    expect(asked).toHaveLength(1);
    expect(asked[0].battles).toBe(8000);
    expect(asked[0].label).toContain('搜战法');
    expect(asked[0].label).toContain('约');
    expect(ran).toBe(0); // 一次都没跑
    expect(ctx.budget.battles).toBe(0); // 额度退回
    expect(ctx.budget.calls).toBe(0);
  });

  it('报价 + 确认：用户点「开始」→ 照常跑；低于阈值不问', async () => {
    const asked: string[] = [];
    const ctx = makeCtx({ fakeRuns: true, deps: { estimateSkillBattles: () => 8000, optimizeSkills: async () => ({ battles: 8000, ms: 1000, finals: [] }) as never } });
    ctx.confirm = async (q) => {
      asked.push(q.label);
      return true;
    };
    await runTool('optimize_skills', {}, ctx);
    expect(asked).toHaveLength(1); // 贵 → 问了
    expect(ctx.budget.battles).toBe(8000);
    // simulate 默认 20 场，低于 2000 → 不打扰用户
    const ctx2 = makeCtx({ fakeRuns: true });
    let asked2 = 0;
    ctx2.confirm = async () => {
      asked2 += 1;
      return true;
    };
    await runTool('simulate', { plan: ctx2.deps.__plan, runs: 20 }, ctx2);
    expect(asked2).toBe(0);
  });

  it('报价 + 确认：阈值可调（confirmFrom = 1 → 20 场也问）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    ctx.confirmFrom = 1;
    let asked = 0;
    ctx.confirm = async () => {
      asked += 1;
      return true;
    };
    await runTool('simulate', { plan: ctx.deps.__plan, runs: 20 }, ctx);
    expect(asked).toBe(1);
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

  it('simulate / simulate_many：给出**八回合全队总伤**与**前三回合爆发**（比较类问题要的两个数）', async () => {
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 26500 });
    const one = await runTool('simulate', { plan: ctx.deps.__plan, runs: 20 }, ctx);
    expect(one.summary).toContain('八回合全队总伤');
    expect(one.summary).toContain('前三回合爆发');
    expect(one.brief).toContain('八回合全队总伤 meanTotal');
    expect(one.brief).toContain('前三回合爆发 meanFirst3');

    // 对拍：同一套阵容只换一处（用户场景：「槽2 用 A 还是 B」）
    const [a, b] = LEARNABLE_SKILL_IDS;
    const many = await runTool(
      'simulate_many',
      {
        plans: [
          { label: '带 A', plan: planWith([ctx.deps.__plan.slots[0].heroId], [[a]]) },
          { label: '带 B', plan: planWith([ctx.deps.__plan.slots[0].heroId], [[b]]) },
        ],
        runs: 100,
      },
      ctx
    );
    expect(many.summary).toContain('八回合总伤');
    expect(many.summary).toContain('前三回合爆发');
    expect(many.brief).toContain('八回合总伤');
    expect(many.brief).toContain('前三回合爆发');
    const rows = (many.data as { rows: Array<{ meanTotal: number; meanFirst3: number }> }).rows;
    expect(rows.every((r) => Number.isFinite(r.meanTotal) && Number.isFinite(r.meanFirst3))).toBe(true);
  });

  it('runTool 未知工具名 → 抛错', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    await expect(runTool('nope', {}, ctx)).rejects.toThrow(/未知工具/);
  });
});

// ─────────────────────────── 我的 box（识图建档，设计文档 §15） ───────────────────────────

/** 唯一名 + 已上架（主战法已实现）的三个武将：第 1 个放进 box，另两个留在库外；**两两避开同队互斥**别干扰断言 */
function threeListedHeroes(): [string, string, string] {
  const byName = new Map<string, number>();
  for (const h of HEROES) byName.set(h.name, (byName.get(h.name) ?? 0) + 1);
  const uniq = HEROES.filter((h) => byName.get(h.name) === 1);
  const clash = (a: { mutualExclusionGroup: string | null }, b: { mutualExclusionGroup: string | null }): boolean =>
    Boolean(a.mutualExclusionGroup && a.mutualExclusionGroup === b.mutualExclusionGroup);
  for (const a of uniq)
    for (const b of uniq)
      for (const c of uniq)
        if (a.id !== b.id && b.id !== c.id && a.id !== c.id && !clash(a, b) && !clash(a, c) && !clash(b, c)) return [a.id, b.id, c.id];
  throw new Error('库里唯一名上架武将不足（测试前置不成立）');
}

/** 直接造一个只读视图（工具层只认 `strict` / Set，不需要走存储） */
function boxView(heroIds: string[], skillIds: string[], strict = true): BoxView {
  return { profileId: 'p1', profileName: '我的号', heroIds: new Set(heroIds), skillIds: new Set(skillIds), strict, empty: false };
}

describe('advisor tools · 我的 box 收窄', () => {
  const [heroIn, heroOut, heroOut2] = threeListedHeroes();
  const [skillIn, skillOut] = LEARNABLE_SKILL_IDS;
  /** 关 1 复用截图识别的校验器 → 必须三个位置齐全，所以断言都用三将方案 */
  const plan3 = (skills: string[][] = []): AdvisorPlan => planWith([heroIn, heroOut, heroOut2], skills);

  it('search_hero：**检索不受 box 限制**（用户 2026-09-29 修正）——全库都回，✓/✗ 只作提示', async () => {
    const ctx = makeCtx({ fakeRuns: true, box: boxView([heroIn], []) });
    const outside = await runTool('search_hero', { q: heroNameOf(heroOut) }, ctx);
    expect((outside.data as { hits: Array<{ id: string }> }).hits.map((h) => h.id)).toContain(heroOut);
    expect(outside.summary).toContain('✗你没有');
    expect(outside.brief).toContain('检索不受 box 限制');

    const inside = await runTool('search_hero', { q: heroNameOf(heroIn) }, ctx);
    expect((inside.data as { hits: Array<{ id: string }> }).hits.map((h) => h.id)).toContain(heroIn);
    expect(inside.summary).toContain('✓你有');
  });

  it('关掉严格模式 → 连 ✓/✗ 标注也没有（等于没有这个功能）', async () => {
    const ctx = makeCtx({ fakeRuns: true, box: boxView([heroIn], [], false) });
    const r = await runTool('search_hero', { q: heroNameOf(heroOut) }, ctx);
    expect((r.data as { hits: Array<{ id: string }> }).hits.map((h) => h.id)).toContain(heroOut);
    expect(r.brief ?? '').not.toContain('检索不受 box 限制');
    expect(r.summary).not.toContain('✗你没有');
  });

  it('search_skill / list_skills：同样不受限（清单外的照回，标 ✗）', async () => {
    const ctx = makeCtx({ fakeRuns: true, box: boxView([], [skillIn]) });
    const one = await runTool('search_skill', { q: skillNameOf(skillOut) }, ctx);
    expect((one.data as { hits: Array<{ id: string }> }).hits.map((h) => h.id)).toContain(skillOut);
    expect(one.summary).toContain('✗你没有');

    const pool = await runTool('list_skills', { limit: 5 }, ctx);
    const d = pool.data as { total: number; rows: Array<{ id: string }> };
    expect(d.total).toBeGreaterThan(5); // 全池都在（不再只有 box 里那 1 个）
    expect(pool.brief).toContain('检索不受 box 限制');
  });

  it('optimize_skills：候选池收窄到 box 里的战法（预估与真跑用的是同一份 options）', async () => {
    const seen: Array<{ candidateIds?: string[] }> = [];
    const ctx = makeCtx({
      fakeRuns: true,
      box: boxView([], [skillIn]),
      deps: {
        estimateSkillBattles: (_cfg, opts) => {
          seen.push(opts as { candidateIds?: string[] });
          return 100;
        },
        optimizeSkills: async (_cfg, opts) => {
          seen.push(opts as { candidateIds?: string[] });
          return { battles: 0, ms: 1, finals: [] } as never;
        },
      },
    });
    await runTool('optimize_skills', { plan: ctx.deps.__plan }, ctx);
    expect(seen.length).toBeGreaterThan(1);
    for (const opts of seen) expect(opts.candidateIds).toEqual([skillIn]);
  });

  it('optimize_skills：模型自己给的候选全在 box 外 → 明确报错（不空跑几千场）', async () => {
    const ctx = makeCtx({ fakeRuns: true, box: boxView([], [skillIn]) });
    await expect(runTool('optimize_skills', { plan: ctx.deps.__plan, candidateSkillIds: [skillOut] }, ctx)).rejects.toThrow(
      /一个都不在用户 box 里/
    );
  });

  it('optimize_mates：候选武将收窄到 box；主战法未实现的如实跳过并报出来', async () => {
    const noSkill = ALL_HEROES.find((h) => !h.mainSkillId);
    const seen: Array<{ candidateIds?: string[] }> = [];
    const ctx = makeCtx({
      fakeRuns: true,
      box: boxView([heroIn, ...(noSkill ? [noSkill.id] : [])], []),
      deps: {
        estimateMateBattles: (_cfg, opts) => {
          seen.push(opts as { candidateIds?: string[] });
          return 100;
        },
        optimizeMates: async (_cfg, opts) => {
          seen.push(opts as { candidateIds?: string[] });
          return {
            battles: 0,
            ms: 1,
            finals: [],
            baseline: { mean: 0, meanTotal: 0, runs: 0 },
            candidateCount: 1,
            candidateSkipped: 0,
            poolSkippedMutual: 0,
            matchLabel: 'm',
            coreLabel: 'c',
            poolLabel: 'p',
            noMatchSlot: false,
            baselineIllegal: false,
          } as never;
        },
      },
    });
    await runTool('optimize_mates', { plan: ctx.deps.__plan }, ctx);
    expect(seen.length).toBeGreaterThan(1);
    for (const opts of seen) expect(opts.candidateIds).toEqual([heroIn]);
  });

  it('get_my_box：没建 box → 明确让模型先要截图；建了 → 计数 + 清单 + 严格模式状态', async () => {
    const none = await runTool('get_my_box', {}, makeCtx({ fakeRuns: true }));
    expect(none.summary).toContain('还没有 box');

    const ctx = makeCtx({ fakeRuns: true, box: boxView([heroIn], [skillIn]) });
    const r = await runTool('get_my_box', {}, ctx);
    expect(r.summary).toContain('武将 1 个 / 可学战法 1 个');
    expect(r.summary).toContain('严格模式开');
    const d = r.data as { heroes: Array<{ id: string }>; skills: Array<{ id: string }> };
    expect(d.heroes.map((h) => h.id)).toEqual([heroIn]);
    expect(d.skills.map((s) => s.id)).toEqual([skillIn]);
  });

  it('validate_plan：box 外的将法**不算不合法**（用户 2026-09-29 修正）——进 boxIssues，ok 仍为 true', async () => {
    // 三将都在 box 里、只带 box 外的战法 → 一条 skill_not_in_box，但方案依然合法
    const ctx = makeCtx({ fakeRuns: true, box: boxView([heroIn, heroOut, heroOut2], [skillIn]) });
    const skillBad = await runTool('validate_plan', { plan: plan3([[skillOut]]) }, ctx);
    const sd = skillBad.data as { ok: boolean; errors: Array<{ code: string }>; boxIssues: Array<{ code: string }> };
    expect(sd.ok).toBe(true);
    expect(sd.errors).toEqual([]);
    expect(sd.boxIssues.map((e) => e.code)).toEqual(['skill_not_in_box']);
    expect(skillBad.summary).toContain('不算不合法');

    const good = await runTool('validate_plan', { plan: plan3([[skillIn]]) }, ctx);
    expect((good.data as { ok: boolean }).ok).toBe(true);
    expect((good.data as { boxIssues: unknown[] }).boxIssues).toEqual([]);

    // box 里只有第 1 个将 → 另外两将各报一条 hero_not_in_box（同样只是 boxIssues）
    const narrow = makeCtx({ fakeRuns: true, box: boxView([heroIn], [skillIn]) });
    const heroBad = await runTool('validate_plan', { plan: plan3() }, narrow);
    expect((heroBad.data as { boxIssues: Array<{ code: string }> }).boxIssues.map((e) => e.code)).toEqual(['hero_not_in_box', 'hero_not_in_box']);
    expect((heroBad.data as { ok: boolean }).ok).toBe(true);

    // 真正的非法（不在库）仍进 errors
    const broken = await runTool('validate_plan', { plan: plan3([['no_such_skill']]) }, narrow);
    expect((broken.data as { ok: boolean }).ok).toBe(false);

    // 关掉严格模式 → 连 boxIssues 都没有
    const loose = makeCtx({ fakeRuns: true, box: boxView([heroIn], [skillIn], false) });
    const okAgain = await runTool('validate_plan', { plan: plan3([[skillOut]]) }, loose);
    expect((okAgain.data as { boxIssues: unknown[] }).boxIssues).toEqual([]);
  });

  it('空 box（还没识别）不算严格：不拦任何东西（什么都没识别 ≠ 什么都不许用）', async () => {
    const ctx = makeCtx({ fakeRuns: true, box: boxView([], [], false) });
    const r = await runTool('validate_plan', { plan: plan3([[skillOut]]) }, ctx);
    expect((r.data as { ok: boolean }).ok).toBe(true);
  });

  it('optimize_winrate：严格 box 时评估过的战法都不出清单', async () => {
    const seen = new Set<string>();
    const ctx = makeCtx({
      fakeRuns: true,
      box: boxView([heroIn, heroOut, heroOut2], [skillIn]),
      deps: {
        matchup: async (plan) => {
          for (const slot of plan.slots) for (const id of slot.skillIds) seen.add(id);
          return fakePool(0.6, 0.02);
        },
      },
    });
    await runTool('optimize_winrate', { plan: plan3(), matchSlotKeys: ['0-0'], coarseRuns: 2, finalists: 1 }, ctx);
    expect(seen.has(skillIn)).toBe(true);
    expect(seen.has(skillOut)).toBe(false);
  });

  it('optimize_winrate：候选全在 box 外 → 不跑对打', async () => {
    let called = 0;
    const ctx = makeCtx({
      fakeRuns: true,
      box: boxView([heroIn, heroOut, heroOut2], [skillIn]),
      deps: {
        matchup: async () => {
          called += 1;
          return fakePool(0.5, 0.1);
        },
      },
    });
    await expect(runTool('optimize_winrate', { plan: plan3(), candidateSkillIds: [skillOut], matchSlotKeys: ['0-0'] }, ctx)).rejects.toThrow(/不在用户 box/);
    expect(called).toBe(0);
  });

  it('optimize_winrate coreUnit：先队友、再队友战法、最后才给核心填战法，简报带分对手', async () => {
    const core = 'h479';
    const mates = SLOTTED_HEROES.filter((h) => !h.mutualExclusionGroup && h.id !== core).slice(0, 4).map((h) => h.id);
    const skills = LEARNABLE_SKILL_IDS.slice(0, 6);
    const seen: AdvisorPlan[] = [];
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        matchup: async (plan) => {
          seen.push(JSON.parse(JSON.stringify(plan)) as AdvisorPlan);
          return fakePool(0.5, 0.01);
        },
      },
    });
    const r = await runTool(
      'optimize_winrate',
      {
        plan: planWith([core, mates[0], mates[1]]),
        coreUnit: '大营',
        candidateHeroIds: mates,
        candidateSkillIds: skills,
        coarseRuns: 1,
        finalists: 1,
      },
      ctx
    );
    const coreSkilled = seen.findIndex((p) => p.slots[0].skillIds.length > 0);
    expect(coreSkilled).toBeGreaterThan(0);
    for (const p of seen) {
      if (p.slots[0].skillIds.length > 0) {
        expect(p.slots[1].skillIds).toHaveLength(2);
        expect(p.slots[2].skillIds).toHaveLength(2);
      }
    }
    expect(seen.some((p) => p.slots[0].skillIds.length === 0 && p.slots[1].heroId !== mates[0])).toBe(true);
    expect(r.brief).toContain('分对手');
    expect(r.brief).toContain('甲');
    expect(r.summary).toContain('先队友');
    const data = r.data as { lineup: boolean; opponents: Array<{ note: string }> };
    expect(data.lineup).toBe(true);
    expect(data.opponents.map((o) => o.note)).toEqual(['甲']);
  });
});

/** 假的对手池成绩，字段够 publishMatchup / 搜索排序用 */
function fakePool(winRate: number, halfWidth: number, meanTotal = 8000, meanFirst3 = 3000): PoolMatchup {
  const win = Math.round(winRate * 100);
  return {
    version: 'test',
    fingerprint: 'test|',
    baseSeed: 1,
    runsPerOpponent: 100,
    opponents: [
      {
        id: 'o1',
        note: '甲',
        source: 'benchmark',
        runs: 100,
        win,
        draw: 0,
        loss: 100 - win,
        winRate,
        halfWidth,
        meanTotal,
        meanFirst3,
        controlMine: 0,
      },
    ],
    runs: 100,
    win,
    draw: 0,
    loss: 100 - win,
    winRate,
    halfWidth,
    meanTotal,
    meanFirst3,
    controlMine: 0,
    worst: { id: 'o1', note: '甲', winRate },
    battles: 100,
    ms: 1,
  };
}

describe('advisor tools · 对手池胜率', () => {
  const [a, b, c] = threeListedHeroes();
  const [skillA, skillB] = LEARNABLE_SKILL_IDS;
  const base = (): AdvisorPlan => planWith([a, b, c]);

  it('matchup_pool：低于 100 场抬回 100，再交给对打', async () => {
    const runs: number[] = [];
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        matchup: async (_plan, n) => {
          runs.push(n);
          return fakePool(0.55, 0.05);
        },
      },
    });
    const r = await runTool('matchup_pool', { plan: base(), runsPerOpponent: 10 }, ctx);
    expect(runs).toEqual([100]);
    expect((r.data as { winRate: number }).winRate).toBe(0.55);
    expect(r.summary).toContain('综合胜率');
    expect(r.summary).toContain('八回合总伤');
  });

  it('compare_variants：动了两处直接拒绝，一场都不跑', async () => {
    let called = 0;
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        matchup: async () => {
          called += 1;
          return fakePool(0.5, 0.01);
        },
      },
    });
    const after = base();
    after.slots[0] = { ...after.slots[0], skillIds: [skillA] };
    after.slots[1] = { ...after.slots[1], skillIds: [skillB] };
    await expect(runTool('compare_variants', { before: base(), after }, ctx)).rejects.toThrow(/一次只能换一处/);
    expect(called).toBe(0);
  });

  it('compare_variants：只换一个战法，区间重叠就说分不出来，并给出两项伤害差', async () => {
    let n = 0;
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        matchup: async () => fakePool(n++ === 0 ? 0.5 : 0.52, 0.08, n === 1 ? 8000 : 9000, n === 1 ? 3000 : 3200),
      },
    });
    const after = base();
    after.slots[0] = { ...after.slots[0], skillIds: [skillA] };
    const r = await runTool('compare_variants', { before: base(), after }, ctx);
    const data = r.data as { distinguishable: boolean; delta: { winRatePct: number; meanTotal: number; meanFirst3: number } };
    expect(data.distinguishable).toBe(false);
    expect(r.summary).toContain('分不出来');
    expect(data.delta.meanTotal).toBe(1000);
    expect(data.delta.meanFirst3).toBe(200);
    expect(data.delta.winRatePct).toBe(2);
  });

  it('remove_user_opponent：固定集 id 删不掉', async () => {
    const id = loadBenchmark()[0]?.id;
    expect(id).toBeTruthy();
    const ctx = makeCtx({ fakeRuns: true });
    await expect(runTool('remove_user_opponent', { id }, ctx)).rejects.toThrow(/固定测试集不能删除/);
  });

  it('remove_user_opponent：用户没点确认就不写', async () => {
    const ctx = makeCtx({
      fakeRuns: true,
      deps: {
        removeUserOpponent: () => {
          throw new Error('不该写到存储');
        },
      },
    });
    ctx.confirm = async () => false;
    await expect(runTool('remove_user_opponent', { id: 'user-1' }, ctx)).rejects.toThrow(/没有确认/);
  });
});
