/**
 * 组合优化器（web/optimizer.ts + 页面）测试
 * ① 候选池：纯控制/纯防御战法不进默认池、伤害与增益战法进池；
 * ② 束搜索：结果按目标降序、不重复带主战法、不重复同一战法、与手工枚举一致；
 * ③ 评估器：计数正确、同配置可复现（优化器结果必须确定性）；
 * ④ 队友搜索：两阶段结果降序、队友不重复、可应用到配置；
 * ⑤ 页面：结构 + 切换模式 + 真实点一次搜索出结果（小参数）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { candidatePool, hasContribution, isFullyModeled, makeEvaluator, searchLoadouts, searchTeammates } from '../web/optimizer';
import { HERO_RECORDS, isMainSkill } from '../web/heroes';
import { defaultCfg, unitTemplates } from '../web/teamConfig';
import { mountOptimizer } from '../web/optimizerView';

const cfgOf = () => defaultCfg(['h3', 'h5', 'h16']);

describe('候选池', () => {
  it('有伤害段 / DoT / 修正的战法进池；纯控制不进默认池', () => {
    expect(hasContribution('tujin', 120)).toBe(true); // 主动 115% 单体
    expect(hasContribution('yiji_dangqian', 120)).toBe(true); // 准备 280% 全体
    expect(hasContribution('dashang_sanjun', 120)).toBe(true); // 一类指挥 +48% 增伤
    expect(hasContribution('zhanbi_duanjin', 120)).toBe(false); // 纯怯战控制
    const pool = candidatePool(120);
    expect(pool.all.length).toBeGreaterThan(pool.contributing.length);
    expect(pool.contributing).toContain('tujin');
    expect(pool.contributing).not.toContain('zhanbi_duanjin');
  });

  it('只含可学习战法：武将主战法不进池（主战法不能被别的武将学）', () => {
    const pool = candidatePool(120);
    const mainSkillOfOutput = unitTemplates(cfgOf())[0].mainSkillId!;
    expect(mainSkillOfOutput).toBeTruthy();
    expect(pool.all).not.toContain(mainSkillOfOutput);
    expect(pool.all).not.toContain('xuejian_huangsha'); // 血溅黄砂 = 马超主战法
    expect(pool.strict.every((id) => !isMainSkill(id))).toBe(true);
  });

  it('严格池 = 有贡献 + 已上架 + 无未建模字段；被排除的有原因清单', () => {
    const pool = candidatePool(120);
    // 扩覆盖后严格池应显著变大（2026-09-22：36 → 64）
    expect(pool.strict.length).toBeGreaterThanOrEqual(90); // 覆盖扩展：36 → 92
    pool.strict.forEach((id) => {
      expect(isFullyModeled(id, 120)).toBe(true);
      expect(hasContribution(id, 120)).toBe(true);
    });
    expect(pool.excluded.length).toBeGreaterThan(0);
    pool.excluded.forEach((e) => expect(e.notes.length).toBeGreaterThan(0));
    expect(pool.excluded.every((e) => !isMainSkill(e.id))).toBe(true);
    // 主战法连 learnable 底座都不进：奋疾先登（乐进）/ 血溅黄砂（马超）都不该出现在任何档里
    expect(pool.all).not.toContain('fenji_xiandeng');
    expect(pool.excluded.map((e) => e.id)).not.toContain('fenji_xiandeng');
  });
});

describe('评估器', () => {
  it('同一配置可复现、计数递增', () => {
    const cfg = cfgOf();
    const ev = makeEvaluator(cfg);
    const picks = { 0: ['tujin'], 1: [], 2: [] };
    const a = ev.score(picks);
    const b = ev.score(picks);
    expect(a).toBe(b);
    expect(ev.count).toBeGreaterThanOrEqual(2);
    expect(a).toBeGreaterThan(0);
  });

  it('战法确实提升三回合总伤（突进 vs 空槽）', () => {
    const cfg = cfgOf();
    const ev = makeEvaluator(cfg);
    const empty = ev.score({ 0: [], 1: [], 2: [] });
    const withSkill = ev.score({ 0: ['tujin'], 1: [], 2: [] });
    expect(withSkill).toBeGreaterThan(empty);
  });
});

describe('束搜索（战法最优解）', () => {
  it('单槽全枚举：束搜索结果与手工枚举一致，按降序排列', () => {
    const cfg = cfgOf();
    const candidates = ['tujin', 'yiji_dangqian', 'tongchou_dijin', 'huanglong'].filter((id) => hasContribution(id, 120));
    const report = searchLoadouts(cfg, { unitIdxs: [0], slots: 1, candidates, beam: 32, top: 10 });
    const manual = candidates
      .map((id) => makeEvaluator(cfg).score({ 0: [id], 1: [], 2: [] }))
      .sort((a, b) => b - a);
    expect(report.results.length).toBe(Math.min(10, candidates.length));
    expect(report.results[0].score).toBeCloseTo(manual[0], 6);
    report.results.forEach((r, i) => {
      expect(r.picks[0]).toHaveLength(1);
      if (i > 0) expect(r.score).toBeLessThanOrEqual(report.results[i - 1].score);
    });
  });

  it('不会把主战法或重复战法塞进槽位；结果含替换建议', () => {
    const cfg = cfgOf();
    const mainSkill = unitTemplates(cfg)[0].mainSkillId!;
    const candidates = Object.keys(candidatePool(120).contributing).slice(0, 0).length
      ? candidatePool(120).contributing.slice(0, 25)
      : candidatePool(120).contributing.slice(0, 25);
    const report = searchLoadouts(cfg, { unitIdxs: [0], slots: 2, candidates, beam: 8, top: 5 });
    report.results.forEach((r) => {
      const picked = r.picks[0];
      expect(new Set(picked).size).toBe(picked.length);
      expect(picked).not.toContain(mainSkill);
    });
    expect(report.alternatives.length).toBeGreaterThan(0);
    report.alternatives.forEach((a) => expect(a.delta).toBeLessThanOrEqual(0));
  });

  it('目标口径可切换：整局 8 回合的评分 = 8 回合累计（≠ 前三回合）', () => {
    const cfg = cfgOf();
    const candidates = ['tujin', 'yiji_dangqian', 'xianqu_tuji'];
    const r3 = searchLoadouts(cfg, { unitIdxs: [0], slots: 1, candidates, beam: 8, top: 3, rounds: 3 });
    const r8 = searchLoadouts(cfg, { unitIdxs: [0], slots: 1, candidates, beam: 8, top: 3, rounds: 8 });
    expect(r3.results[0].score).toBeLessThan(r8.results[0].score);
    const ev8 = makeEvaluator(cfg, 8);
    expect(ev8.objectiveRounds).toBe(8);
    expect(ev8.score(r8.results[0].picks)).toBeCloseTo(r8.results[0].score, 6);
    const ev3 = makeEvaluator(cfg, 3);
    expect(ev3.objectiveRounds).toBe(3);
    expect(ev3.score(r8.results[0].picks)).toBeLessThan(ev8.score(r8.results[0].picks));
  });

  it('整局口径下队友搜索同样可用（分数 = 该组合整局累计）', () => {
    const cfg = cfgOf();
    const out = searchTeammates(cfg, { pool: ['h5', 'h16', 'h34', 'h450'], keep: 3, top: 3, rounds: 8 });
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results[0].score).toBeGreaterThan(0);
    const three = searchTeammates(cfg, { pool: ['h5', 'h16', 'h34', 'h450'], keep: 3, top: 3, rounds: 3 });
    expect(out.results[0].score).toBeGreaterThan(three.results[0].score);
  });

  it('整队唯一：同一战法不会被两个武将同时携带，主战法也不被他人再带一次', () => {
    const cfg = cfgOf();
    const mainA = unitTemplates(cfg)[0].mainSkillId!;
    const report = searchLoadouts(cfg, {
      unitIdxs: [0, 1, 2],
      slots: 2,
      candidates: [
        'jifeng_ershi',
        'wenjiu_zhanjiang',
        'yiji_dangqian',
        'yuzhan_yuyong',
        'jishi',
        'tujin',
        'dashang_sanjun',
        'shenbing_tianjiang',
        'chuge_siqi',
        'yanfen_jizhen',
        'xianqu_tuji',
        'tongchou_dijin',
      ],
      beam: 8,
      top: 5,
    });
    expect(report.results.length).toBeGreaterThan(0);
    report.results.forEach((r) => {
      const all = [0, 1, 2].flatMap((i) => r.picks[i] ?? []);
      expect(new Set(all).size).toBe(all.length); // 跨武将不重复
      expect(all).not.toContain(mainA);
    });
  });

  it('队友搜索：队友之间 / 与输出将的主战法不撞车', () => {
    const cfg = cfgOf();
    const out = searchTeammates(cfg, { pool: ['h5', 'h16', 'h34', 'h450', 'h574', 'h705'], keep: 6, top: 8 });
    expect(out.results.length).toBeGreaterThan(0);
    const outputMains = new Set([unitTemplates(cfg)[0].mainSkillId].filter(Boolean));
    out.results.forEach((r) => {
      const mains = r.heroIds.map((id) => HERO_RECORDS[id]?.mainSkillId).filter((v): v is string => Boolean(v));
      expect(new Set(mains).size).toBe(mains.length);
      mains.forEach((m) => expect(outputMains.has(m)).toBe(false));
    });
  });

  it('束宽越大不劣于束宽小的结果（搜索单调性）', () => {
    const cfg = cfgOf();
    const candidates = candidatePool(120).contributing.slice(0, 40);
    const narrow = searchLoadouts(cfg, { unitIdxs: [0], slots: 2, candidates, beam: 4, top: 1 });
    const wide = searchLoadouts(cfg, { unitIdxs: [0], slots: 2, candidates, beam: 16, top: 1 });
    expect(wide.results[0].score).toBeGreaterThanOrEqual(narrow.results[0].score - 1e-9);
  });

  it('三将同时优化：只为参与的武将填槽，其他将保持原配置', () => {
    const cfg = cfgOf();
    cfg.slots[2].skillIds = ['tujin'];
    const candidates = ['yiji_dangqian', 'chuge_siqi', 'dashang_sanjun'];
    const report = searchLoadouts(cfg, { unitIdxs: [0, 1], slots: 1, candidates, beam: 6, top: 3 });
    const best = report.results[0];
    expect(best.picks[0]).toHaveLength(1);
    expect(best.picks[1]).toHaveLength(1);
    expect(best.picks[2]).toEqual(['tujin']); // 未参与搜索的将保持原样
  });
});

describe('队友搭配搜索', () => {
  it('两阶段结果降序、队友不重复，且应用后配置可评估', () => {
    const cfg = cfgOf();
    const pool = ['h3', 'h5', 'h16', 'h6', 'h34', 'h450', 'h574', 'h705'].filter((id) => unitTemplates(cfg)[0].heroId !== id);
    const out = searchTeammates(cfg, { pool, keep: 5, top: 5 });
    expect(out.results.length).toBeGreaterThan(0);
    out.results.forEach((r, i) => {
      expect(r.heroIds[0]).not.toBe(r.heroIds[1]);
      expect(unitTemplates(cfg)[0].heroId).not.toBe(r.heroIds[0]);
      if (i > 0) expect(r.score).toBeLessThanOrEqual(out.results[i - 1].score);
    });
    expect(out.evaluated).toBeGreaterThan(pool.length);
  });
});

describe('页面（jsdom）', () => {
  it('页面：两个模式标签与各自设置项都在（防回归）', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountOptimizer(root);

    const tabText = [...root.querySelectorAll('.op-tab')].map((b) => b.textContent ?? '').join(' ');
    expect(tabText).toContain('战法最优解');
    expect(tabText).toContain('队友最佳搭配');
    // 战法模式设置项
    ['objective', 'mode', 'slots', 'beam', 'poolTier'].forEach((k) =>
      expect(root.querySelector(`[data-set="${k}"]`), `缺少 data-set=${k}`).toBeTruthy()
    );
    expect(root.querySelector('#op-run')!.textContent).toContain('战法');
    // 队友模式设置项
    root.querySelectorAll<HTMLButtonElement>('.op-tab')[1].click();
    ['poolSize', 'keep'].forEach((k) =>
      expect(root.querySelector(`[data-set="${k}"]`), `缺少 data-set=${k}`).toBeTruthy()
    );
    expect(root.querySelector('#op-run')!.textContent).toContain('队友');
    root.remove();
  });

  it('渲染结构、切换模式、点一次搜索出结果', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountOptimizer(root);

    expect(root.querySelectorAll('.op-tab')).toHaveLength(2);
    expect(root.querySelector('.rm-hero-value')!.textContent).toBeTruthy();
    expect(root.querySelectorAll('.rm-unit')).toHaveLength(3);

    // 切到队友模式 → 设置区换成队友参数
    const matesTab = root.querySelectorAll<HTMLButtonElement>('.op-tab')[1];
    matesTab.click();
    expect(root.querySelector('[data-set="poolSize"]')).toBeTruthy();
    expect(root.querySelector<HTMLButtonElement>('#op-run')!.textContent).toContain('队友');

    // 切回战法模式，用小参数真跑一次
    root.querySelectorAll<HTMLButtonElement>('.op-tab')[0].click();
    const slotsSel = root.querySelector<HTMLSelectElement>('[data-set="slots"]')!;
    slotsSel.value = '1';
    slotsSel.dispatchEvent(new Event('change'));
    const beamSel = root.querySelector<HTMLSelectElement>('[data-set="beam"]')!;
    beamSel.value = '8';
    beamSel.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('#op-run')!.click();

    for (let i = 0; i < 200 && !root.querySelector('.op-table'); i += 1) {
      await new Promise((res) => setTimeout(res, 10));
    }
    const table = root.querySelector('.op-table');
    expect(table).toBeTruthy();
    expect(root.querySelectorAll('.op-table tbody tr').length).toBeGreaterThan(0);
    expect(root.querySelector('#op-chart svg')).toBeTruthy();
    expect(root.querySelector('#op-chart')!.innerHTML).not.toContain('NaN');

    root.remove();
  }, 60000);
});
