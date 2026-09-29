/**
 * AI配将 独立页（`advisor.html` / `web/advisorPage.ts`）
 * ---------------------------------------------------------------------------
 * 设计口径：`docs/AI配将-页面布局设计.md` §9/§17（一个骨架两态）、§2（跨页队伍交接）、§5（功能按键 → 面板）
 * 这里只测**骨架与交接**，对话链路已由 `web/advisorSmoke.test.ts` 端到端覆盖。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountAdvisorPage } from './advisorPage';
import { applyPlanToTeam, readTeamState, writeTeamState, TEAM_KEY } from './teamStore';
import { __resetSettings } from './settings';
import { emptySlot, type EditorState } from './teamEditor';
import { DEFAULT_DUMMY, type AdvisorPlan } from './advisor/types';
import { SLOTTED_HEROES } from './heroes';

const heroIds = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);

const teamOf = (ids: string[]): EditorState => ({
  red: [0, 1, 2].map((i) => ({ ...emptySlot(), heroId: ids[i] ?? null, level: 45 })),
  blue: [0, 1, 2].map(() => emptySlot()),
});

const planOf = (ids: string[], skills: string[] = []): AdvisorPlan => ({
  slots: ids.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 45, skillIds: skills })),
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
});

function mount() {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  const handle = mountAdvisorPage(root);
  const page = root.querySelector('.advisor-page') as HTMLElement;
  return { root, page, handle };
}

describe('AI配将 独立页骨架（一个布局两态）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSettings();
  });

  it('挂载即显示（没有抽屉收起态）；侧栏默认收起，开关切到工作台', () => {
    const { page, handle } = mount();
    expect(page.classList.contains('open')).toBe(true);
    expect(page.classList.contains('rail-open')).toBe(false);

    (page.querySelector('.advisor-rail-toggle') as HTMLButtonElement).click();
    expect(page.classList.contains('rail-open')).toBe(true);
    expect(page.querySelector('.advisor-rail-toggle')!.getAttribute('aria-expanded')).toBe('true');

    (page.querySelector('.advisor-rail-close') as HTMLButtonElement).click();
    expect(page.classList.contains('rail-open')).toBe(false);
    handle.destroy();
  });

  it('骨架三段齐：顶栏（开关/率 logo/标题/返回配将/齿轮）+ 对话 + 输入区工具行', () => {
    const { page, handle } = mount();
    expect(page.querySelector('.advisor-top .advisor-rail-toggle')).toBeTruthy();
    expect(page.querySelector('.advisor-top .advisor-logo')).toBeTruthy();
    expect(page.querySelector('.advisor-title')!.textContent).toContain('AI配将');
    expect(page.querySelector('.advisor-top a[href="./index.html"]')).toBeTruthy();
    expect(page.querySelector('.advisor-main .advisor-log')).toBeTruthy();
    expect(page.querySelector('.advisor-composer .advisor-input')).toBeTruthy();
    expect(page.querySelectorAll('.advisor-tools button')).toHaveLength(4); // 我的 box / 偏好 / 历史 / 设置
    handle.destroy();
  });

  it('功能按键 → 按需面板：同一时刻只开一个；× 与 Esc 都能关', () => {
    const { page, handle } = mount();
    const open = (name: string): void => (page.querySelector(`.advisor-rail [data-sheet="${name}"]`) as HTMLButtonElement).click();
    const on = (): string[] => [...page.querySelectorAll<HTMLElement>('.advisor-sheet.on')].map((s) => s.dataset.sheetPanel ?? '');

    open('box');
    expect(on()).toEqual(['box']);
    expect(page.querySelector('.advisor-box-review')).toBeTruthy();
    open('history');
    expect(on()).toEqual(['history']); // 互斥
    (page.querySelector('.advisor-sheet.on [data-sheet-close]') as HTMLButtonElement).click();
    expect(on()).toEqual([]);

    open('prefs');
    expect(on()).toEqual(['prefs']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(on()).toEqual([]);
    handle.destroy();
  });

  it('页面上的设置入口（齿轮 / 工具行 / 引导条）打开的都是同一个弹窗', () => {
    const { page, handle } = mount();
    (page.querySelector('.advisor-top [data-settings]') as HTMLButtonElement).click();
    const m1 = document.querySelector('#advisor-settings-modal');
    expect(m1?.classList.contains('on')).toBe(true);
    (m1!.querySelector('[data-set-close]') as HTMLButtonElement).click();
    expect(m1!.classList.contains('on')).toBe(false);

    (page.querySelector('.advisor-tools [data-settings]') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#advisor-settings-modal')).toHaveLength(1); // 同一个节点，不重复建
    expect(document.querySelector('#advisor-settings-modal')!.classList.contains('on')).toBe(true);
    handle.destroy();
  });

  it('主界面零 key 控件：设置字段只在弹窗里（需求③）', () => {
    const { page, handle } = mount();
    expect(page.querySelector('#adv-key, #adv-base, #adv-model')).toBeNull();
    expect(page.querySelectorAll('input[type="password"]')).toHaveLength(0);
    // 页面上只有 box 面板的输入件（档案下拉 / 截图选择 / 严格开关 / 补录），没有模型与密钥
    expect(page.querySelector('.advisor-box-profile')).toBeTruthy();
    expect(page.querySelector('#adv-strict')).toBeTruthy();
    handle.destroy();
  });
});

describe('跨页队伍交接（主站 ⇄ 独立页）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSettings();
  });

  it('主站落盘的队伍 → 独立页读出来渲染（顶栏一行 + 侧栏三张主站同款卡）', () => {
    writeTeamState(teamOf(heroIds));
    const { page, handle } = mount();
    const cards = page.querySelectorAll('.advisor-team-list > *');
    expect(cards).toHaveLength(3);
    // 复用主站 renderSlot：立绘卡面 + 战法栏都在（不是自画的文字卡）
    expect(page.querySelector('.advisor-team-list .slot .slot-art')).toBeTruthy();
    expect(page.querySelector('.advisor-team-list .slot .hero-skills')).toBeTruthy();
    expect(page.querySelector('.advisor-team-inline')!.textContent).toContain('大营');
    // 「在主站编辑」是按键（项目按键标准 .btn.beige），不是文字链接
    const back = page.querySelector('.advisor-goto-main') as HTMLAnchorElement;
    expect(back.classList.contains('btn')).toBe(true);
    expect(back.classList.contains('beige')).toBe(true);
    // 空队：卡片退化成"未放置"，不报错
    localStorage.removeItem(TEAM_KEY);
    handle.destroy();
    const second = mount();
    expect(second.page.querySelectorAll('.advisor-team-list .advisor-slot.empty')).toHaveLength(3);
    second.handle.destroy();
  });

  it('应用方案 → 写回同一把键（主站靠 storage 事件重读）', () => {
    writeTeamState(teamOf([heroIds[1], heroIds[0], heroIds[2]]));
    const before = readTeamState()!;
    const res = applyPlanToTeam(before.red, planOf(heroIds));
    expect(res.ok).toBe(true);
    writeTeamState({ ...before, red: res.slots });
    const after = readTeamState()!;
    expect(after.red[0].heroId).toBe(heroIds[0]);
    expect(after.red[1].heroId).toBe(heroIds[1]);
  });

  it('写回也守规则：换将=原槽移走（与主站 onPickHero 同口径）；战法最多 2 个；不在库要报错', () => {
    const st = teamOf(heroIds); // [A, B, C]
    // 队内唯一：方案把 1 号位的武将放到 0 号位 → 原槽（1 号）被移走，不是报错
    const moved = applyPlanToTeam(st.red, planOf([heroIds[1], '', heroIds[2]]));
    expect(moved.ok).toBe(true);
    expect(moved.slots[0].heroId).toBe(heroIds[1]);
    expect(moved.slots[1].heroId).toBeNull();
    // 换将：加点清零（同主站 onPickHero）
    st.red[0].freePoints.attack = 20;
    const swapped = applyPlanToTeam(st.red, planOf([heroIds[2], heroIds[1], heroIds[0]]));
    expect(swapped.ok).toBe(true);
    expect(swapped.slots[0].heroId).toBe(heroIds[2]);
    expect(swapped.slots[0].freePoints.attack).toBe(0);
    // 战法槽上限 2（同主站 onAddSkill 口径）
    const many = applyPlanToTeam(st.red, planOf(heroIds, ['s1', 's2', 's3']));
    expect(many.slots[0].extraSkillIds).toHaveLength(2);
    // 不在库：如实报错，不静默写进去
    const bad = applyPlanToTeam(st.red, planOf(['h-not-exist', heroIds[1], heroIds[2]]));
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('不在武将库');
  });
});
