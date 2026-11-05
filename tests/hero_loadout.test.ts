/**
 * 武将配置档案（web/heroLoadout.ts）与详情页「方案」页签。
 *
 * 用户 2026-11-05 的痛点：清空队伍/卸下武将回池后，再上阵战法、加点、宝物、兵种全被重置。
 * 两条口径：① 回池保留上次配置（自动记档 last）；② 详情页可存多套方案（plans）快速切换。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import { TREASURES_BY_ID } from '../src/data/treasures';
import { HERO_SECONDARY_TROOPS } from '../src/data/secondaryTroops';
import { traitsFor } from '../src/engine/secondaryTroop';
import {
  PLAN_MAX,
  applyLoadoutToSlot,
  deletePlan,
  describePoints,
  describeRedness,
  describeTreasure,
  listPlans,
  loadoutOf,
  normalizeLoadout,
  rememberedLoadout,
  rememberSlot,
  resetHeroConfig,
  savePlan,
} from '../web/heroLoadout';
import { HEROES, freePointBudget } from '../web/heroes';
import { emptySlot, openHeroDetail, type EditorHandlers, type EditorState, type SlotState } from '../web/teamEditor';

const HERO = HEROES.find((h) => (HERO_SECONDARY_TROOPS[h.id]?.length ?? 0) > 0)!;
const HERO_ID = HERO.id;
const TROOP = HERO_SECONDARY_TROOPS[HERO_ID][0];
const TRAIT = traitsFor(TROOP)[0];
const SKILLS = Object.keys(SKILL_REGISTRY);
const TREASURE_ID = Number(Object.keys(TREASURES_BY_ID)[0]);

function slotWith(partial: Partial<SlotState> = {}): SlotState {
  return { ...emptySlot(), heroId: HERO_ID, ...partial };
}

function makeHandlers(state: EditorState, applied: Array<{ team: string; idx: number; loadout: unknown }> = []): EditorHandlers {
  return {
    onPickHero(team, idx, heroId) {
      state[team][idx] = { ...emptySlot(), heroId };
    },
    onMoveSlot() {},
    onAddSkill() {},
    onRemoveSkill() {},
    onSetFreePoints() {},
    onSetRedness() {},
    onSetLevel() {},
    onSetSecondaryTroop() {},
    onSetSecondaryTrait() {},
    onSetTreasure() {},
    onSetChenshou() {},
    onRemoveHero(team, idx) {
      state[team][idx] = emptySlot();
    },
    onClearTeam() {},
    onApplyLoadout(team, idx, loadout) {
      applied.push({ team, idx, loadout });
      Object.assign(state[team][idx], applyLoadoutToSlot(state[team][idx].heroId!, loadout));
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  resetHeroConfig();
  document.body.innerHTML = '';
});

describe('normalizeLoadout：存档一律按现规则裁剪', () => {
  it('等级 40~50、红度 0~5 越界夹紧；不存在的战法被剔除、最多 2 个', () => {
    const n = normalizeLoadout(HERO_ID, {
      level: 99,
      redness: -3,
      extraSkillIds: [SKILLS[0], SKILLS[0], 'not_a_skill', SKILLS[1], SKILLS[2]],
    });
    expect(n.level).toBe(50);
    expect(n.redness).toBe(0);
    expect(n.extraSkillIds).toEqual([SKILLS[0], SKILLS[1]]);
  });

  it('加点超预算按 攻击→防御→谋略→速度 依次扣', () => {
    const budget = freePointBudget(HERO_ID, 0, 40);
    const n = normalizeLoadout(HERO_ID, {
      level: 40,
      redness: 0,
      freePoints: { attack: budget * 2, defense: budget, strategy: 5, speed: 5 },
    });
    const total = n.freePoints.attack + n.freePoints.defense + n.freePoints.strategy + n.freePoints.speed;
    expect(total).toBe(budget);
    expect(n.freePoints.attack).toBe(budget); // 第一项吃满，其余被扣光
    expect(n.freePoints.strategy).toBe(0);
    expect(n.freePoints.speed).toBe(0);
  });

  it('兵种不在该武将可转列表 → 清空，特性随之清空', () => {
    expect(normalizeLoadout(HERO_ID, { secondaryTroop: '象兵' as never, secondaryTraits: [TRAIT] }).secondaryTroop).toBeUndefined();
  });

  it('合法兵种保留，特性只留本兵种的、最多 2 个', () => {
    const n = normalizeLoadout(HERO_ID, { secondaryTroop: TROOP, secondaryTraits: [TRAIT, TRAIT, '不存在' as never] });
    expect(n.secondaryTroop).toBe(TROOP);
    expect(n.secondaryTraits).toEqual([TRAIT]);
  });

  it('宝物须在库内、等级夹到 1~10；库外宝物置空', () => {
    const ok = normalizeLoadout(HERO_ID, { treasure: { treasureId: TREASURE_ID, level: 99 } });
    expect(ok.treasure?.level).toBe(10);
    expect(normalizeLoadout(HERO_ID, { treasure: { treasureId: 999999 } }).treasure).toBeNull();
  });
});

describe('回池保留配置（自动记档）', () => {
  it('rememberSlot → loadoutOf → 再按档恢复，配置逐项一致', () => {
    const slot = slotWith({
      extraSkillIds: [SKILLS[0], SKILLS[1]],
      freePoints: { attack: 10, defense: 0, strategy: 0, speed: 0 },
      redness: 4,
      level: 45,
      secondaryTroop: TROOP,
      secondaryTraits: [TRAIT],
      treasure: { treasureId: TREASURE_ID, level: 6, affix: { name: '长驱', value: 3 } },
    });
    expect(rememberSlot(slot)).toBe(true);
    const back = rememberedLoadout(HERO_ID)!;
    expect(back).toEqual(loadoutOf(slot));
    const restored = applyLoadoutToSlot(HERO_ID, back);
    expect(restored.heroId).toBe(HERO_ID);
    expect(restored.extraSkillIds).toEqual(slot.extraSkillIds);
    expect(restored.freePoints).toEqual(slot.freePoints);
    expect(restored.redness).toBe(4);
    expect(restored.level).toBe(45);
    expect(restored.secondaryTroop).toBe(TROOP);
    expect(restored.treasure?.treasureId).toBe(TREASURE_ID);
  });

  it('同一配置重复记档不再写盘（未变不写）', () => {
    const slot = slotWith({ redness: 2 });
    expect(rememberSlot(slot)).toBe(true);
    expect(rememberSlot({ ...slot })).toBe(false);
    expect(rememberSlot({ ...slot, redness: 3 })).toBe(true);
    expect(rememberedLoadout(HERO_ID)?.redness).toBe(3);
  });

  it('没有档案时返回 null（首次上阵仍是空白武将）', () => {
    expect(rememberedLoadout(HERO_ID)).toBeNull();
  });
});

describe('配置方案：保存 / 上限 / 去重 / 删除', () => {
  it(`最多 ${PLAN_MAX} 套，超了给提示`, () => {
    for (let i = 0; i < PLAN_MAX; i++) {
      const r = savePlan(HERO_ID, normalizeLoadout(HERO_ID, { redness: i }));
      expect(r.ok).toBe(true);
    }
    const over = savePlan(HERO_ID, normalizeLoadout(HERO_ID, { redness: 5 }));
    expect(over.ok).toBe(false);
    expect(listPlans(HERO_ID)).toHaveLength(PLAN_MAX);
  });

  it('同一套配置不重复存', () => {
    const l = normalizeLoadout(HERO_ID, { redness: 2 });
    expect(savePlan(HERO_ID, l).ok).toBe(true);
    const dup = savePlan(HERO_ID, l);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain('已经存过');
    expect(listPlans(HERO_ID)).toHaveLength(1);
  });

  it('删除后按保存顺序重排（方案一…）', () => {
    const a = savePlan(HERO_ID, normalizeLoadout(HERO_ID, { redness: 1 }));
    const b = savePlan(HERO_ID, normalizeLoadout(HERO_ID, { redness: 2 }));
    expect(a.ok && b.ok).toBe(true);
    const left = deletePlan(HERO_ID, (a as { ok: true; plan: { id: string } }).plan.id);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe((b as { ok: true; plan: { id: string } }).plan.id);
  });

  it('方案按武将分开存', () => {
    const others = HEROES.filter((h) => h.id !== HERO_ID).slice(0, 1);
    savePlan(HERO_ID, normalizeLoadout(HERO_ID, { redness: 3 }));
    expect(listPlans(others[0].id)).toHaveLength(0);
  });
});

describe('摘要文案', () => {
  it('加点：全攻 / 分散 / 无', () => {
    expect(describePoints({ attack: 40, defense: 0, strategy: 0, speed: 0 })).toBe('全攻 +40');
    expect(describePoints({ attack: 20, defense: 0, strategy: 10, speed: 0 })).toBe('攻20 谋10');
    expect(describePoints({ attack: 0, defense: 0, strategy: 0, speed: 0 })).toBe('无加点');
  });

  it('红度：满红 / 白板 / N 红', () => {
    expect(describeRedness(5)).toBe('满红');
    expect(describeRedness(0)).toBe('白板');
    expect(describeRedness(3)).toBe('3红');
  });

  it('宝物：带词条 / 裸宝物 / 未佩戴', () => {
    const name = TREASURES_BY_ID[TREASURE_ID].name;
    expect(describeTreasure({ treasureId: TREASURE_ID, affix: { name: '长驱', value: 3 } })).toBe(`${name}·长驱`);
    expect(describeTreasure({ treasureId: TREASURE_ID })).toBe(name);
    expect(describeTreasure(null)).toBe('未佩戴宝物');
  });
});

describe('详情页「方案」页签（集成）', () => {
  const state: EditorState = { red: [emptySlot(), emptySlot(), emptySlot()], blue: [emptySlot(), emptySlot(), emptySlot()] };

  function openPlansTab(): HTMLElement {
    const tab = document.querySelector('.hd-tab[data-tab="plans"]') as HTMLElement;
    expect(tab).toBeTruthy();
    tab.click();
    return document.querySelector('.hd-plans') as HTMLElement;
  }

  it('页签存在；空档时给空态，保存后出现「方案一」', () => {
    state.red[0] = slotWith({ extraSkillIds: [SKILLS[0], SKILLS[1]], redness: 5 });
    const applied: Array<{ team: string; idx: number; loadout: unknown }> = [];
    openHeroDetail(HERO_ID, { placed: { team: 'red', idx: 0, slot: state.red[0] }, handlers: makeHandlers(state, applied) });
    expect(document.querySelector('.hd-tab[data-tab="plans"]')?.textContent).toBe('方案');

    const panel = openPlansTab();
    expect(panel.querySelector('.hd-plan-empty')).toBeTruthy();
    expect(panel.textContent).toContain('还没有保存的方案');
    expect(panel.textContent).toContain('0 / 6');

    (document.querySelector('[data-plan-save]') as HTMLElement).click();
    expect(listPlans(HERO_ID)).toHaveLength(1);
    const row = document.querySelector('.hd-plan') as HTMLElement;
    expect(row.querySelector('.hp-name')?.textContent).toBe('方案一');
    expect(row.querySelector('.hp-sum')?.textContent).toContain('满红');
  });

  it('套用：把方案配置就地写回槽位（详情页与 state 不脱钩）', () => {
    state.red[0] = slotWith({ redness: 5, extraSkillIds: [SKILLS[0], SKILLS[1]] });
    const applied: Array<{ team: string; idx: number; loadout: unknown }> = [];
    openHeroDetail(HERO_ID, { placed: { team: 'red', idx: 0, slot: state.red[0] }, handlers: makeHandlers(state, applied) });
    openPlansTab();
    (document.querySelector('[data-plan-save]') as HTMLElement).click();

    // 改成另一套配置后再套用「方案一」，应回到满红 + 两战法
    state.red[0].redness = 0;
    state.red[0].extraSkillIds = [];
    (document.querySelector('[data-plan-apply]') as HTMLElement).click();
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ team: 'red', idx: 0 });
    expect(state.red[0].redness).toBe(5);
    expect(state.red[0].extraSkillIds).toEqual([SKILLS[0], SKILLS[1]]);
  });

  it('未提供 onApplyLoadout 时套用按钮置灰', () => {
    state.red[1] = slotWith({ redness: 3 });
    const h = makeHandlers(state);
    delete (h as { onApplyLoadout?: unknown }).onApplyLoadout;
    openHeroDetail(HERO_ID, { placed: { team: 'red', idx: 1, slot: state.red[1] }, handlers: h });
    openPlansTab();
    (document.querySelector('[data-plan-save]') as HTMLElement).click();
    expect((document.querySelector('[data-plan-apply]') as HTMLButtonElement).disabled).toBe(true);
  });
});
