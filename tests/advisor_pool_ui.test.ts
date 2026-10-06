/**
 * 顾问页对手池面板：固定集只读，从预设加入和移出都要再点一次确认。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mountAdvisor } from '../web/advisor/view';
import { makeCtx } from '../web/advisor/tools';
import { EXTRA_POOL_KEY, loadBenchmark } from '../web/opponentPool';
import { PRESET_STORAGE_KEY, writePresetFile, type TeamPreset } from '../web/presetStore';
import { DEFAULT_DUMMY, type AdvisorPlan } from '../web/advisor/types';
import { SLOTTED_HEROES } from '../web/heroes';
import type { SlotState } from '../web/teamEditor';
import type { AdvisorHost } from '../web/advisorHost';

function slot(heroId: string): SlotState {
  return {
    heroId,
    extraSkillIds: [],
    freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 },
    redness: 0,
    level: 40,
    treasure: null,
  };
}

function preset(): TeamPreset {
  return {
    id: 'p-ui',
    no: 7,
    name: '面板测试队',
    side: 'red',
    slots: [slot('h443'), slot('h474'), slot('lvmeng')],
    createdAt: 1,
    updatedAt: 1,
  };
}

afterEach(() => {
  localStorage.removeItem(EXTRA_POOL_KEY);
  localStorage.removeItem(PRESET_STORAGE_KEY);
  document.body.innerHTML = '';
});

describe('顾问对手池面板', () => {
  it('固定集没有移出按钮；确认后才能加入和移出预设', () => {
    writePresetFile({ maxNo: 7, list: [preset()] });
    const heroes = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    const plan: AdvisorPlan = {
      slots: heroes.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 40, skillIds: [] })),
      coreUnitIds: [],
      dummy: { ...DEFAULT_DUMMY },
    };
    const host: AdvisorHost = { teamLabel: '红队', readTeam: () => plan, applyPlan: () => ({ ok: true }) };
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountAdvisor(root, { host, ctx: makeCtx({ fakeRuns: true }), fake: true });

    const bench = root.querySelector('.advisor-pool-row[data-source="benchmark"]');
    expect(bench?.textContent).toContain('固定');
    expect(bench?.textContent).toContain(loadBenchmark()[0]?.note ?? '');
    expect(bench?.querySelector('.advisor-pool-remove')).toBeNull();
    expect((root.querySelector('.advisor-pool-preset') as HTMLSelectElement).value).toBe('p-ui');

    const add = root.querySelector<HTMLButtonElement>('.advisor-pool-add')!;
    add.click();
    expect(add.textContent).toBe('确认加入？');
    expect(root.querySelector('.advisor-pool-row[data-source="user"]')).toBeNull();
    add.click();
    const user = root.querySelector('.advisor-pool-row[data-source="user"]');
    expect(user?.textContent).toContain('面板测试队');
    expect(root.querySelector('.advisor-pool-status')?.textContent).toContain('加入对手池');

    const remove = user?.querySelector<HTMLButtonElement>('.advisor-pool-remove');
    remove?.click();
    expect(remove?.textContent).toBe('确认移出？');
    expect(root.querySelector('.advisor-pool-row[data-source="user"]')).not.toBeNull();
    remove?.click();
    expect(root.querySelector('.advisor-pool-row[data-source="user"]')).toBeNull();
    expect(root.querySelector('.advisor-pool-row[data-source="benchmark"]')).not.toBeNull();
  });
});
