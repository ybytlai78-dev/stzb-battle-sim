/**
 * 伤害测试实验室（并入主站版 v2）冒烟测试（jsdom）：
 * 直接 import web/damageLab 模块 + 挂载，验证：三栏布局 / 竖排槽位卡 / 侍卫面板 /
 * 模拟 → 独立伤害分析页（饼图 + 数学统计）/ 战报我方在左侍卫在右 / 返回实验室 / 兵种切换。
 * 引擎逻辑已在 Node 侧全量覆盖，这里只验证浏览器端主链路。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyEditor, emptySlot, skillMeta, type EditorHandlers, type EditorState } from '../web/teamEditor';
import { SKILL_REGISTRY } from '../src/data/skills';
import { HEROES, avatarSrc, portraitSrc } from '../web/heroes';
import {
  mountDamageLab,
  simulate,
  getGuard,
  setGuard,
  setMorale,
  buildGuardTeam,
  type GuardConfig,
} from '../web/damageLab';

/** 重置侍卫配置（隔离用例间状态；skillIds 留空，simulate 时会自动随机） */
function resetGuard(): void {
  setGuard({ attack: 82, defense: 92, strategy: 78, speed: 58, troops: 9000, troopType: 'infantry', skillIds: [] });
}

function makeHandlers(state: EditorState): EditorHandlers {
  return {
    onPickHero(team, idx, heroId) {
      state[team][idx] = { ...emptySlot(), heroId };
    },
    onMoveSlot(fromTeam, fromIdx, toTeam, toIdx) {
      if (fromTeam === toTeam && fromIdx === toIdx) return;
      const from = state[fromTeam][fromIdx];
      const to = state[toTeam][toIdx];
      if (!from.heroId) return;
      state[fromTeam][fromIdx] = to;
      state[toTeam][toIdx] = from;
    },
    onAddSkill(team, idx, skillId) {
      if (!state[team][idx].extraSkillIds.includes(skillId)) {
        state[team][idx].extraSkillIds = [...state[team][idx].extraSkillIds, skillId];
      }
    },
    onRemoveSkill(team, idx, skillId) {
      state[team][idx].extraSkillIds = state[team][idx].extraSkillIds.filter((id) => id !== skillId);
    },
    onSetFreePoints(team, idx, key, value) {
      state[team][idx].freePoints[key] = Math.max(0, value);
    },
    onSetRedness(team, idx, redness) {
      state[team][idx].redness = redness;
    },
    onSetTreasure() {},
    onSetLevel(team, idx, level) {
      state[team][idx].level = level;
    },
    onSetSecondaryTroop(team, idx, troop) {
      state[team][idx].secondaryTroop = troop;
      state[team][idx].secondaryTraits = troop ? [] : undefined;
    },
    onSetSecondaryTrait(team, idx, slot, trait) {
      const learned = [...(state[team][idx].secondaryTraits ?? [])];
      if (trait) learned[slot] = trait;
      else learned.splice(slot, 1);
      state[team][idx].secondaryTraits = learned.filter(Boolean).slice(0, 2);
    },
    onRemoveHero(team, idx) {
      state[team][idx] = emptySlot();
    },
    onClearTeam(team) {
      state[team] = [emptySlot(), emptySlot(), emptySlot()];
    },
  };
}

function boot(opts: { searchSlot?: boolean } = {}): { state: EditorState; onExit: () => void } {
  document.body.innerHTML = '';
  // 主站顶栏的搜索框容器：实验室应把武将池 .toolbar 搬到这里（真实页面由 main.ts 提供该节点）
  if (opts.searchSlot) {
    const slot = document.createElement('div');
    slot.id = 'pool-search-slot';
    document.body.appendChild(slot);
  }
  const root = document.createElement('div');
  root.id = 'lab-root';
  document.body.appendChild(root);
  const state = emptyEditor();
  const onExit = vi.fn();
  mountDamageLab(root, { state, handlers: makeHandlers(state), onExit });
  return { state, onExit };
}

/**
 * 填满我方测试队伍。跳过互斥组冲突（下架后池内前几名可能是同名异构，如两名吕布）。
 */
function fillRedTeam(state: EditorState, count = 3): void {
  const heroes = HEROES.filter((h) => h.mainSkillId);
  const picked: typeof heroes = [];
  const usedGroups = new Set<string>();
  for (const h of heroes) {
    const g = h.mutualExclusionGroup as string | null | undefined;
    if (g && usedGroups.has(g)) continue;
    if (g) usedGroups.add(g);
    picked.push(h);
    if (picked.length >= count) break;
  }
  for (let i = 0; i < count; i++) {
    const h = picked[i % picked.length];
    state.red[i] = {
      heroId: h.id,
      extraSkillIds: [],
      freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 },
      redness: 0,
      level: 40,
      treasure: null,
    };
  }
}

/** 模拟 HTML5 DataTransfer（setData 写入、getData 读出） */
function makeDT(data = '', effectAllowed: 'copy' | 'move' = 'copy'): DataTransfer {
  let stored = data;
  return {
    getData: (t: string) => (t === 'text/plain' ? stored : ''),
    setData: (_t: string, v: string) => { stored = v; },
    dropEffect: effectAllowed,
    effectAllowed,
  } as unknown as DataTransfer;
}

/** 已入队槽位卡 → 另一槽位（队内换位） */
function dragFilledSlot(fromIdx: number, toIdx: number): void {
  const from = document.querySelectorAll('.lab-slots .slot')[fromIdx] as HTMLElement;
  const to = document.querySelectorAll('.lab-slots .slot')[toIdx] as HTMLElement;
  const dt = makeDT('', 'move');
  const start = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(start, 'dataTransfer', { value: dt });
  from.dispatchEvent(start);
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dt });
  to.dispatchEvent(drop);
}

/** 已入队槽位卡 → 武将池（卸下） */
function dragFilledSlotToPool(fromIdx: number): void {
  const from = document.querySelectorAll('.lab-slots .slot')[fromIdx] as HTMLElement;
  const pool = document.querySelector('.lab-pool') as HTMLElement;
  const dt = makeDT('', 'move');
  const start = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(start, 'dataTransfer', { value: dt });
  from.dispatchEvent(start);
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dt });
  pool.dispatchEvent(drop);
}

/** 模拟拖拽：武将池卡 dragstart → 槽位 dragover（高亮）→ drop（投放 heroId） */
function dragFromPoolToSlot(heroId: string, slotIdx: number): void {
  const dt = {
    getData: (t: string) => (t === 'text/plain' ? heroId : ''),
    setData: () => {},
    dropEffect: 'copy',
    effectAllowed: 'copy',
  } as unknown as DataTransfer;
  const card = Array.from(document.querySelectorAll('.lab-pool .hero-card')).find(
    (c) => (c as HTMLElement).dataset.heroId === heroId
  ) as HTMLElement;
  expect(card, `武将池应有「${heroId}」卡牌`).toBeTruthy();
  const start = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(start, 'dataTransfer', { value: dt });
  card.dispatchEvent(start);

  const slot = document.querySelectorAll('.lab-slots .slot')[slotIdx] as HTMLElement;
  const over = new Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(over, 'dataTransfer', { value: dt });
  slot.dispatchEvent(over);
  expect(slot.classList.contains('drag-over')).toBe(true); // 拖拽高亮

  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dt });
  slot.dispatchEvent(drop);
  expect(slot.classList.contains('drag-over')).toBe(false);
}

describe('伤害测试实验室（主站模块 v2）', () => {
  beforeEach(() => {
    resetGuard();
    setMorale(120);
  });

  it('三栏布局：左我方队伍（不分红蓝）｜中武将池｜右侍卫面板；无红蓝队编辑区', () => {
    const { state } = boot();
    expect(state).toBeTruthy();
    expect(document.querySelector('.lab-shell')).toBeTruthy();
    // 左栏：我方队伍＝纯立绘三格（「我方测试队伍」标题已删 — 用户 2026-09-19）
    const team = document.querySelector('.lab-team')!;
    expect(team.querySelector('.lab-team-head h2')).toBeNull();
    expect(team.querySelectorAll('.lab-slots .slot').length).toBe(3);
    expect(team.querySelector('.lab-slots .slot.empty')).toBeTruthy(); // 空队＝素材加号态（纯立绘在选将后出现）
    expect(document.querySelector('.team-panel.red')).toBeNull();
    expect(document.querySelector('.team-panel.blue')).toBeNull();
    // 中栏：武将池
    expect(document.querySelector('.lab-pool.hero-pool')).toBeTruthy();
    expect(document.querySelectorAll('.lab-pool .hero-card').length).toBeGreaterThan(20);
    // 右栏：木桩侍卫（两列字段 + 兵力独占一行；小字与侍卫战法区已删）
    const guardPanel = document.querySelector('#guard-panel')!;
    expect(guardPanel.querySelector('h2')!.textContent).toBe('木桩侍卫');
    expect(guardPanel.querySelector('.g-sub')).toBeNull();
    expect(guardPanel.querySelector('.g-troop-hint')).toBeNull();
    expect(guardPanel.querySelector('.g-skills')).toBeNull();
    expect(guardPanel.querySelectorAll('.g-grid .g-row').length).toBe(4); // 攻击/防御/谋略/速度
    expect(guardPanel.querySelector('.g-row-full label')!.textContent).toBe('兵力');
  });

  it('侍卫默认画像（亲卫 NPC 模板放大）', () => {
    boot();
    const g = getGuard();
    expect(g.attack).toBe(82);
    expect(g.defense).toBe(92);
    expect(g.strategy).toBe(78);
    expect(g.speed).toBe(58);
    expect(g.troops).toBe(9000);
    expect(g.troopType).toBe('infantry');
  });

  it('侍卫 id 走官方侍卫卡面/头像（非空 src）', () => {
    const team = buildGuardTeam();
    expect(team.map((g) => g.id)).toEqual(['guard-0', 'guard-1', 'guard-2']);
    for (const g of team) {
      expect(portraitSrc(g.id)).toBe('/portraits/guard.jpg');
      expect(avatarSrc(g.id)).toBe('/portraits/guard_s.jpg');
    }
  });

  it('模拟一次：实验室隐藏 → 伤害分析页（队伍统计 + 每将卡片饼图 + 数学统计）', () => {
    const { state } = boot();
    fillRedTeam(state, 3);
    simulate(1);
    // 实验室主体隐藏、分析页显示
    const labErr = (document.querySelector('.lab-err') as HTMLElement | null)?.textContent ?? '';
    expect(labErr, `模拟失败：${labErr}`).toBe('');
    expect((document.querySelector('.lab-main') as HTMLElement).style.display).toBe('none');
    const analysis = document.querySelector('.lab-analysis') as HTMLElement;
    expect(analysis.style.display).not.toBe('none');
    // 队伍统计块已按用户要求删除（2026-09-19）
    expect(analysis.querySelector('.batch-stats')).toBeNull();
    expect(analysis.querySelector('.batch-stat')).toBeNull();
    // 每将卡片：头像 + 饼图 + 数学统计（一行三张，样式见 lab.css 的 grid 三列）
    const cards = analysis.querySelectorAll('.share-card');
    expect(cards.length).toBe(3);
    for (const card of Array.from(cards)) {
      expect(card.querySelector('.sc-avatar')).toBeTruthy();
      expect(card.querySelector('.sc-pie svg path')).toBeTruthy(); // 饼图扇形
      const pcts = Array.from(card.querySelectorAll('.lg-pct')).map((el) => parseFloat(el.textContent!));
      const sum = pcts.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThan(99);
      expect(sum).toBeLessThan(101);
      expect(card.querySelector('.math-table')).toBeTruthy(); // 数学统计表
      expect(card.querySelectorAll('.math-table tr').length).toBe(4);
    }
    // 敌方侍卫折叠
    expect(analysis.querySelector('.guard-stats tbody tr')!.textContent).toContain('侍卫');
  });

  it('分析页 tab：简略战报我方在左侍卫在右（带画像）｜统计｜战报详情', () => {
    const { state } = boot();
    fillRedTeam(state, 1);
    simulate(1);
    const analysis = document.querySelector('.lab-analysis')!;
    const tabs = Array.from(analysis.querySelectorAll('.la-tabs .btn')) as HTMLElement[];
    expect(tabs.map((b) => b.textContent)).toEqual(['伤害分析', '简略战报', '统计', '战报详情']);
    // 简略战报：我方（左）vs 侍卫（右）
    tabs[1].click();
    const summary = analysis.querySelector('.battle-summary')!;
    expect(summary).toBeTruthy();
    const titles = Array.from(summary.querySelectorAll('.ss-title')).map((el) => el.textContent);
    expect(titles[0]).toContain('我方'); // 左 = 我方
    expect(titles[1]).toContain('侍卫'); // 右 = 侍卫
    // 简略战报在滚动容器内会把 .sh-art 压成 0 高：必须撑满剩余视口（与主站 report-view 同链）
    expect(analysis.querySelector('.la-body')!.classList.contains('la-fill')).toBe(true);
    // 画像＝卡面里的 img.sh-art（卡面上另有 img.fac 势力图标，别混进来）
    const imgs = Array.from(summary.querySelectorAll('.sum-hero img.sh-art')) as HTMLImageElement[];
    expect(imgs.length).toBeGreaterThanOrEqual(4); // 我方武将 + 侍卫 ×3
    for (const img of imgs) {
      const src = img.getAttribute('src') ?? '';
      expect(src, `${img.alt || '武将'} 画像 src 不应为空`).toMatch(/^\/portraits\//);
    }
    // 侍卫没有势力（无 faction 记录）→ 不渲染势力图标；我方武将要渲染
    for (const card of Array.from(summary.querySelectorAll('.sum-hero')) as HTMLElement[]) {
      const art = (card.querySelector('img.sh-art') as HTMLImageElement).getAttribute('src') ?? '';
      const isGuard = art.includes('guard');
      expect(!!card.querySelector('img.fac'), `势力图标缺失状态不对：${art}`).toBe(!isGuard);
    }
    const guardImgs = imgs.filter((img) => img.alt === '侍卫');
    expect(guardImgs.length).toBe(3);
    for (const img of guardImgs) {
      expect(img.getAttribute('src')).toContain('guard');
    }
    // 统计（图二骨架，与主站 createStatsView 共用；无占比弹窗）
    tabs[2].click();
    const stats = analysis.querySelector('.stats-view') as HTMLElement;
    expect(stats).toBeTruthy();
    expect(stats.querySelector('table')).toBeFalsy();
    expect(stats.querySelectorAll('.st-row').length).toBe(4); // 1 红 + 3 侍卫
    const labels = Array.from(stats.querySelectorAll('.pos-tag')).map((el) => el.textContent);
    expect(labels).toEqual(['大营', '前锋', '中军', '大营']); // 红大营后接蓝 前锋→中军→大营
    expect(stats.querySelector('[data-stats="skill"]')).toBeTruthy();
    expect(stats.querySelector('.sk-row')).toBeTruthy();
    (stats.querySelector('[data-stats="hero"]') as HTMLButtonElement).click();
    expect(stats.querySelector('.sh-row')).toBeTruthy();
    expect(stats.textContent).toContain('伤害');
    expect(document.querySelector('.stats-share-modal')).toBeFalsy();
    // 战报详情
    tabs[3].click();
    expect(analysis.querySelector('.battle-view')).toBeTruthy();
  });

  it('返回实验室按钮：分析页隐藏、实验室主体恢复', () => {
    const { state } = boot();
    fillRedTeam(state, 1);
    simulate(1);
    (document.querySelector('.la-head .btn') as HTMLElement).click(); // ← 返回实验室
    expect((document.querySelector('.lab-analysis') as HTMLElement).style.display).toBe('none');
    expect((document.querySelector('.lab-main') as HTMLElement).style.display).not.toBe('none');
  });

  it('模拟十次：聚合 10 场（战报选场 10 个 + 每将卡片一行三张）', () => {
    const { state } = boot();
    fillRedTeam(state, 3);
    simulate(10);
    const analysis = document.querySelector('.lab-analysis')!;
    expect(analysis.querySelectorAll('.share-card').length).toBe(3);
    // 切到战报类 tab：选场下拉应有 10 场，证明 10 份战报都聚合了（原「场次/胜率」统计块已删）
    (Array.from(analysis.querySelectorAll('.la-tabs .btn')) as HTMLElement[])
      .find((b) => b.textContent === '简略战报')!
      .click();
    expect(document.querySelectorAll('.la-head select option').length).toBe(10);
  });

  it('拖拽武将池卡牌到空槽位（Drop-Zone）：配将成功、槽位渲染、池子保留原卡', () => {
    const { state } = boot();
    const hero = HEROES.find((h) => h.mainSkillId)!;
    dragFromPoolToSlot(hero.id, 0); // 拖到大营
    expect(state.red[0].heroId).toBe(hero.id);
    const slots = document.querySelectorAll('.lab-slots .slot');
    expect(slots[0].textContent).toContain(hero.name); // 武将出现在对应编队位置
    expect(slots[0].classList.contains('empty')).toBe(false);
    // 左栏＝纯立绘：画像层就位（卡框 .frame / 卡面文字 .plate 由 CSS 对槽位隐藏，DOM 仍在）
    expect(slots[0].querySelector('.slot-card .slot-art')).toBeTruthy();
    // 武将池保留原始武将（不删除）
    const card = Array.from(document.querySelectorAll('.lab-pool .hero-card')).find(
      (c) => (c as HTMLElement).dataset.heroId === hero.id
    );
    expect(card).toBeTruthy();
  });

  it('拖拽到已选槽位：替换该位置武将', () => {
    const { state } = boot();
    fillRedTeam(state, 1); // 大营已选
    const hero2 = HEROES.find((h) => h.mainSkillId && h.id !== state.red[0].heroId)!;
    dragFromPoolToSlot(hero2.id, 0);
    expect(state.red[0].heroId).toBe(hero2.id);
  });

  it('已入队武将卡：队内换位保留配置 / 拖回武将池', () => {
    const { state } = boot();
    const heroes = HEROES.filter((h) => h.mainSkillId);
    const a = heroes[0];
    const b = heroes[1];
    dragFromPoolToSlot(a.id, 0);
    dragFromPoolToSlot(b.id, 1);
    state.red[0].extraSkillIds = ['tujin'];
    state.red[0].level = 45;
    expect((document.querySelectorAll('.lab-slots .slot')[0] as HTMLElement).draggable).toBe(true);

    dragFilledSlot(0, 1);
    expect(state.red[1].heroId).toBe(a.id);
    expect(state.red[1].extraSkillIds).toEqual(['tujin']);
    expect(state.red[1].level).toBe(45);
    expect(state.red[0].heroId).toBe(b.id);
    expect(document.querySelectorAll('.lab-slots .slot')[1].textContent).toContain(a.name);

    dragFilledSlotToPool(1);
    expect(state.red[1].heroId).toBeNull();
    expect(state.red[0].heroId).toBe(b.id);
    expect((document.querySelectorAll('.lab-slots .slot')[1] as HTMLElement).classList.contains('empty')).toBe(true);
  });

  it('兵种切换：弓兵 → 攻击距离 3；骑/步 → 2', () => {
    boot();
    setGuard({ troopType: 'archer' });
    for (const g of buildGuardTeam()) expect(g.attackRange).toBe(3);
    setGuard({ troopType: 'cavalry' });
    for (const g of buildGuardTeam()) expect(g.attackRange).toBe(2);
    setGuard({ troopType: 'infantry' });
    for (const g of buildGuardTeam()) expect(g.attackRange).toBe(2);
  });

  it('实验室不再自带「返回配将」行（返回入口收敛到主站顶栏导航）', () => {
    const { onExit } = boot();
    expect(document.querySelector('.lab-topbar')).toBeNull();
    expect(document.querySelector('.lab-title')).toBeNull();
    expect(onExit).not.toHaveBeenCalled(); // 自带返回入口已删，由 main.ts 的导航按钮触发 onExit
  });

  it('武将池 toolbar（搜索 + 筛选）搬到顶栏容器 #pool-search-slot：中栏只留卡格', () => {
    boot({ searchSlot: true });
    // 用户 2026-09-19 反馈「中栏的搜索框和筛选是多余部分」——现在搬到顶栏
    expect(document.querySelector('#pool-search-slot .toolbar')).toBeTruthy();
    expect(document.querySelector('#pool-search-slot input')).toBeTruthy();
    expect(document.querySelector('.lab-pool .toolbar')).toBeNull();
  });

  it('侍卫战法按类型分槽挂载（主动/被动/指挥/追击）', () => {
    boot();
    const skillIds: GuardConfig['skillIds'] = ['tujin', 'qixi', 'luanji'];
    setGuard({ skillIds });
    const team = buildGuardTeam();
    for (const g of team) {
      const all = [...g.activeSkillIds, ...g.passiveSkillIds, ...g.commandSkillIds, ...g.pursuitSkillIds];
      expect(all.sort()).toEqual([...skillIds].sort());
    }
  });

  it('skillMeta：长坂之吼为 2 回合准备；缺省 prepareTurns 仍为 1', () => {
    expect(skillMeta(SKILL_REGISTRY.changban_zhihou)).toContain('2回合准备');
    expect(skillMeta(SKILL_REGISTRY.changban_zhihou)).not.toContain('1回合准备');
    expect(skillMeta(SKILL_REGISTRY.xuanwu_fuliu)).toContain('1回合准备');
  });
});
