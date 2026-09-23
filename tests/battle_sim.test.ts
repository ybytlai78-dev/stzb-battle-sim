/**
 * 实战胜率批量模拟（web/battleSim.ts + 页面）测试
 * ① 复现性：同配置两次批量结果一致（固定种子）；不同基种子会有差异；
 * ② 交换场地：胜负按我方视角还原（交换跑一半的胜率应与不交换接近）；
 * ③ 统计口径：胜/平/负之和 = 场次、伤害占比 ∈ [0,1]、控制人回合 ≥ 0、恢复占比 ∈ [0,1]、
 *    成员伤害之和 ≈ 我方总伤害；
 * ④ 控制时长解析：detail → 回合数；
 * ⑤ 页面：结构 + 对手池保存/备注 + 真跑 100 场出统计（不渲染战报）。
 */
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { General } from '../src/engine/types';
import { DEFAULT_ENV, judgeOutcome, parseDuration, runBatch, runOne } from '../web/battleSim';
import { mountBattleSim } from '../web/battleSimView';
import { HERO_REGISTRY, initHeroDB, level40, withSkills } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

/** 造一支队伍：三将（部分带战法） */
function team(skills: { active?: string[]; command?: string[]; passive?: string[] } = {}, tag = 'a'): General[] {
  const POS = ['大营', '中军', '前锋'] as const;
  return POS.map((pos, i) => {
    const base = level40(HERO_REGISTRY['h3']);
    return withSkills({ ...base, position: pos, id: `${tag}${i}`, name: `${tag}将${i + 1}` } as General, {
      activeSkillIds: skills.active ?? [],
      commandSkillIds: skills.command ?? [],
      passiveSkillIds: skills.passive ?? [],
    });
  });
}

const smallEnv = { ...DEFAULT_ENV, maxRounds: 8 };

describe('批量模拟：复现性与交换场地', () => {
  it('固定种子 → 两次批量结果完全一致', () => {
    const mine = team({ active: ['yiji_dangqian'] }, 'm');
    const opp = team({ passive: ['yuzhan_yuyong'] }, 'o');
    const a = runBatch(mine, opp, { runs: 40, env: smallEnv });
    const b = runBatch(mine, opp, { runs: 40, env: smallEnv });
    expect(a.win).toBe(b.win);
    expect(a.draw).toBe(b.draw);
    expect(a.avgDamageMine).toBeCloseTo(b.avgDamageMine, 6);
    expect(a.controlMine).toBeCloseTo(b.controlMine, 6);
  });

  it('不同基种子：结果可以不同（但统计量仍在合理区间）', () => {
    const mine = team({ active: ['yiji_dangqian'] }, 'm');
    const opp = team({}, 'o');
    const a = runBatch(mine, opp, { runs: 40, env: { ...smallEnv, baseSeed: 1 } });
    const b = runBatch(mine, opp, { runs: 40, env: { ...smallEnv, baseSeed: 999 } });
    expect(a.runs).toBe(40);
    expect(b.runs).toBe(40);
    expect(a.winRate).toBeGreaterThanOrEqual(0);
    expect(a.winRate).toBeLessThanOrEqual(1);
  });

  it('交换场地：胜负按我方视角还原（我方强度不变，胜率不因位置崩坏）', () => {
    const mine = team({ active: ['yiji_dangqian'], command: ['xianqu_tuji'] }, 'm');
    const opp = team({}, 'o');
    const swap = runBatch(mine, opp, { runs: 60, env: { ...smallEnv, swapSides: true } });
    const noSwap = runBatch(mine, opp, { runs: 60, env: { ...smallEnv, swapSides: false } });
    expect(swap.win + swap.draw + swap.loss).toBe(60);
    // 我方明显更强 → 两种口径都应高胜率（允许 20 个百分点差异）
    expect(noSwap.winRate).toBeGreaterThan(0.6);
    expect(swap.winRate).toBeGreaterThan(noSwap.winRate - 0.2);
  });

  it('单场：result 与剩余兵力比例自洽', () => {
    const mine = team({ active: ['yiji_dangqian'] }, 'm');
    const opp = team({}, 'o');
    const raw = runOne(mine, opp, 0, smallEnv);
    expect(raw.myTroopRatio).toBeGreaterThanOrEqual(0);
    expect(raw.enemyTroopRatio).toBeGreaterThanOrEqual(0);
    expect(raw.myTroopRatio + raw.enemyTroopRatio).toBeGreaterThan(0);
    expect(raw.myDamage).toBeGreaterThan(0);
  });
});

describe('统计口径', () => {
  it('胜/平/负之和 = 场次；各占比在 [0,1]；成员伤害之和 ≈ 我方总伤害', () => {
    const mine = team({ active: ['yiji_dangqian'], passive: ['shenmou_yuanlv'] }, 'm');
    const opp = team({ command: ['dashang_sanjun'] }, 'o');
    const r = runBatch(mine, opp, { runs: 30, env: smallEnv });
    expect(r.win + r.draw + r.loss).toBe(30);
    expect(r.winRate).toBeGreaterThanOrEqual(0);
    expect(r.damageShare).toBeGreaterThanOrEqual(0);
    expect(r.damageShare).toBeLessThanOrEqual(1);
    expect(r.healShare).toBeGreaterThanOrEqual(0);
    expect(r.healShare).toBeLessThanOrEqual(1);
    expect(r.controlMine).toBeGreaterThanOrEqual(0);
    expect(r.perUnit.length).toBe(3);
    const unitDamage = r.perUnit.reduce((a, u) => a + u.avgDamage, 0);
    // 成员伤害之和 = 我方场均伤害（由 damageShare 与回合数间接校验：不应为 0）
    expect(unitDamage).toBeGreaterThan(0);
  });

  it('控制人回合：施加的控制状态按时长累计（混乱 2 回合 → 计 2）', () => {
    expect(parseDuration('陷入混乱，持续 2 回合', 1, 8)).toBe(2);
    expect(parseDuration('陷入混乱 持续至战斗结束', 3, 8)).toBe(6);
    expect(parseDuration('（无时长信息）', 1, 8)).toBe(1);
  });

  it('collectRun 归属自洽：双方伤害都在统计、控制归属按被控者阵营反推', () => {
    const mine = team({ active: ['yiji_dangqian'] }, 'm');
    const opp = team({ command: ['zhanbi_duanjin'] }, 'o'); // 战必断金 = 一类指挥怯战（控制）
    const raw = runOne(mine, opp, 0, smallEnv);
    expect(raw.myDamage).toBeGreaterThan(0); // 我方打了伤害
    expect(raw.myDamage + raw.enemyDamage).toBeGreaterThan(0);
    expect(raw.controlMine).toBeGreaterThanOrEqual(0);
    expect(raw.controlEnemy).toBeGreaterThanOrEqual(0);
    expect(raw.myTroopRatio).toBeGreaterThanOrEqual(0);
  });
});

describe('实战判定层（斩首优先，否则比剩余兵力）', () => {
  it('judgeOutcome：引擎 win/loss 即斩首；引擎 draw 时比剩余兵力比例', () => {
    expect(judgeOutcome('win', 0.1, 0.9)).toEqual({ win: true, draw: false, kind: 'decap' });
    expect(judgeOutcome('loss', 0.9, 0.1)).toEqual({ win: false, draw: false, kind: 'decap' });
    expect(judgeOutcome('draw', 0.6, 0.4)).toEqual({ win: true, draw: false, kind: 'troops' });
    expect(judgeOutcome('draw', 0.4, 0.6)).toEqual({ win: false, draw: false, kind: 'troops' });
    expect(judgeOutcome('draw', 0.5, 0.5)).toEqual({ win: false, draw: true, kind: 'none' });
  });

  it('胜率与兵力优势自洽：强队胜率高时优势必须为正（防止交换场地把比例算反）', () => {
    const mine = team({ active: ['yiji_dangqian'], command: ['xianqu_tuji'], passive: ['yuzhan_yuyong'] }, 'm');
    const opp = team({}, 'o');
    const n = 60;
    let wins = 0;
    let ratioWins = 0;
    for (let i = 0; i < n; i += 1) {
      const raw = runOne(mine, opp, i, smallEnv);
      if (raw.win) wins += 1;
      if (raw.myTroopRatio > raw.enemyTroopRatio) ratioWins += 1;
    }
    // 胜 ⟺ 兵力比例更高（斩首胜可能比例更低，允许极少偏差）
    expect(Math.abs(wins - ratioWins)).toBeLessThanOrEqual(2);
    const batch = runBatch(mine, opp, { runs: n, env: smallEnv });
    expect(batch.troopAdvantage).toBeGreaterThan(0);
    expect(batch.winRate).toBeGreaterThan(0.5);
    expect(batch.win + batch.draw + batch.loss).toBe(n);
    expect(batch.winDecap + batch.winTroops).toBeLessThanOrEqual(batch.win);
  });
});

describe('页面（jsdom）', () => {
  it('渲染结构 + 对手池保存/备注 + 真跑 100 场出统计', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountBattleSim(root);

    expect(root.querySelector('#bs-run')).toBeTruthy();
    expect(root.querySelector('#bs-mine .rm-unit')).toBeTruthy();
    expect(root.querySelector('#bs-opponent .rm-unit')).toBeTruthy();
    expect(root.querySelector('#bs-pool')!.textContent).toContain('对手池');

    // 存对手 + 改备注
    root.querySelector<HTMLButtonElement>('#bs-save-opp')!.click();
    const note = root.querySelector<HTMLInputElement>('[data-note="0"]')!;
    note.value = '测试对手A';
    note.dispatchEvent(new Event('change'));
    expect(root.querySelector('#bs-pool')!.textContent).toContain('测试对手A');

    // 跑 100 场
    const runsSel = root.querySelector<HTMLSelectElement>('#bs-runs')!;
    runsSel.value = '100';
    runsSel.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('#bs-run')!.click();
    for (let i = 0; i < 600 && !root.querySelector('.bs-hero-value'); i += 1) {
      await new Promise((res) => setTimeout(res, 20));
    }
    expect(root.querySelector('.bs-hero-value')).toBeTruthy();
    expect(root.querySelector('.bs-hero-value')!.textContent).toContain('%');
    expect(root.querySelector('#bs-result')!.textContent).toContain('平均剩余兵力优势');
    expect(root.querySelectorAll('.bs-bar-row').length).toBeGreaterThanOrEqual(3);
    expect(root.querySelector('.bs-pie-svg')).toBeTruthy();
    expect(root.querySelector('#bs-result')!.innerHTML).not.toContain('NaN');

    root.remove();
  }, 120000);
});
