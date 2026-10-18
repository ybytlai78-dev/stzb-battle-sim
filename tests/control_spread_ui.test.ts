// @vitest-environment jsdom
/**
 * 「控制扩散（鸾凤和鸣）」在**网页详细战报**里的可读性回归（2026-10-18 用户截图报障）。
 *
 * 用户报障现场（截图）：第 7 回合【小乔&大乔】发动【双艳】→ 目标：贾诩、荀彧 →
 * 紧接一行「小乔&大乔 的control_spread状态解除」—— 玩家看不到任何「+1 目标」的效果，还看到裸状态 key。
 *
 * 本测试钉住网页战报三行字（口径见 tests/control_spread.test.ts 的机制契约）：
 *   ① 额外目标命中：「【曹操】被【双艳】的控制扩散额外命中（新增控制）」
 *   ② 标记被用掉：「【小乔&大乔】 的控制扩散已用掉（本次控制额外命中 1 个目标）」（不再裸写 control_spread）
 *   ③ 同源重挂暴走要看得见：「暴走持续 2 回合（刷新）」
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createBattleView } from '../web/battleView';
import { runBattle } from '../src/engine/combat';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

function make(id: string, position: General['position']): General {
  const rec = byId.get(id);
  if (!rec) throw new Error('hero not found: ' + id);
  const base = leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000);
  return { ...base, position, morale: 120 } as General;
}

/** 小乔（鸾凤和鸣）+ 小乔&大乔（双艳）+ 裸将 vs 贾诩 / 荀彧 / 曹操 —— 与 scripts/_diag_control_spread.mts 同配置 */
function battleReport(seed = 1) {
  return runBattle({
    myTeam: [make('h687', '大营'), make('h424', '中军'), make('h799', '前锋')],
    enemyTeam: [make('h794', '大营'), make('h24', '中军'), make('h23', '前锋')],
    seed,
    maxRounds: 8,
  });
}

describe('详细战报 · 控制扩散可见性', () => {
  it('第 2 回合：额外命中 1 个敌军 + 标记用掉，两行都要看得见', () => {
    const report = battleReport(1);
    const view = createBattleView(report);
    document.body.append(view.el);
    view.setRound(2);
    const text = view.el.textContent ?? '';

    // 本段两名目标 + 额外一名（曹操），战报里 3 条暴走 + 1 条「控制扩散额外命中」
    expect(text).toContain('被【双艳】的控制扩散额外命中（新增控制）');
    expect(text).toContain('的控制扩散已用掉（本次控制额外命中 1 个目标）');
    // 不再出现裸状态 key（用户截图里那一行）
    expect(text).not.toContain('control_spread');

    document.body.innerHTML = '';
  });

  it('第 3 回合：同源重挂的暴走刷新要看得见（旧实现全静默）', () => {
    const report = battleReport(1);
    const view = createBattleView(report);
    document.body.append(view.el);
    view.setRound(3);
    const text = view.el.textContent ?? '';

    expect(text).toContain('暴走持续 2 回合（刷新）');
    // 本回合额外目标已经处于暴走 → 只能刷新，标记保留（不发「已用掉」）
    expect(text).toContain('的控制扩散额外命中（刷新已有控制）');
    expect(text).not.toContain('的控制扩散已用掉');

    document.body.innerHTML = '';
  });
});
