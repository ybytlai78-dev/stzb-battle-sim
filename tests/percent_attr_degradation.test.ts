/**
 * 「百分比效果退化成固定点数」回归（2026-11-08）：
 *  1. 宝物属性词条/特效的「是不是百分比」只能取自数据 `effect.unit`：
 *     - 天资 / 骁锐 / 稳固 的锻造词条是百分比（#5%~15%# / #10%~20%#）
 *     - 灵动 的锻造词条是点数（#10~30#），天问二阶「天资 2.5」也是点数
 *     修前 `attr()` 从不传 percent → 词条被静默降级成点数。
 *  2. 许褚【裸衣鏖战】「使其攻击属性下降 15%」缺 `percent: true` → 实减 15 点。
 * 断言用「200 → 220（百分比）vs 200+10 = 210（点数）」把两种口径区分开。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { effectiveStat, inflictStatus } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import { buildTreasureStatuses } from '../src/engine/treasure';
import { AFFIXES, TREASURES } from '../src/data/treasures';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { CreateStatus, General, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function makeUnit(
  id: string,
  stats: Partial<Pick<UnitState['general'], 'attack' | 'defense' | 'strategy' | 'speed'>> = {},
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '吴',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: '前锋',
      attack: 200,
      defense: 200,
      strategy: 200,
      speed: 200,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
      ...stats,
    },
    side: 'my',
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(1),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 空 General：本组词条（天资/骁锐/稳固/灵动）不依赖携带者字段 */
const self = {} as General;

const built = (loadout: { treasureId: number; level?: number; affix?: { name: string; value: number } }) =>
  buildTreasureStatuses(loadout, self);

/** 施加宝物来源的状态（与运行时同源前缀，跳过冲突判定） */
function applyTreasureStatuses(unit: UnitState, list: CreateStatus[]): CombatContext {
  const ctx = makeCtx();
  for (const s of list) inflictStatus(ctx, unit, s, 'passive', 'treasure:test', unit.general.id);
  return ctx;
}

const statusOf = (list: ReturnType<typeof built>, label: string): CreateStatus => {
  const hit = list.find((x) => x.label === label);
  if (!hit) throw new Error(`未产出状态：${label}`);
  return hit.create;
};

const affixStatus = (name: string, value: number, treasureId = 1003): CreateStatus => {
  const hits = built({ treasureId, level: 10, affix: { name, value } }).filter((x) =>
    x.sourceId.startsWith('treasure:affix:'),
  );
  expect(hits).toHaveLength(1);
  return hits[0].create;
};

describe('宝物 percent 词条：按数据 unit 结算', () => {
  it('天资 10%（锻造词条）：谋略 200 → 220（修前被降级成点数 → 210）', () => {
    const s = affixStatus('天资', 10);
    expect(s.type).toBe('strategy_buff');
    expect((s as { percent?: boolean }).percent).toBe(true);

    const u = makeUnit('a');
    applyTreasureStatuses(u, [s]);
    expect(effectiveStat(u, 'strategy')).toBe(220);
  });

  it('骁锐 10%（锻造词条）：攻击 200 → 220', () => {
    const s = affixStatus('骁锐', 10);
    expect((s as { percent?: boolean }).percent).toBe(true);

    const u = makeUnit('a');
    applyTreasureStatuses(u, [s]);
    expect(effectiveStat(u, 'attack')).toBe(220);
  });

  it('悬翦（1036）稳固 1.5%×5 = 7.5%：防御 200 → 215（点数口径会是 207.5）', () => {
    const s = statusOf(built({ treasureId: 1036, level: 10 }), '稳固');
    expect((s as { percent?: boolean }).percent).toBe(true);

    const u = makeUnit('a');
    applyTreasureStatuses(u, [s]);
    expect(effectiveStat(u, 'defense')).toBe(215);
  });
});

describe('宝物 point 词条：仍按点数（不得被百分比化）', () => {
  it('仁风（1054）灵动 2.0×5 = 10 点：速度 100 → 110（百分比口径会是 105）', () => {
    const s = statusOf(built({ treasureId: 1054, level: 10 }), '灵动');
    expect((s as Record<string, unknown>).amount).toBe(10);
    expect(Boolean((s as { percent?: boolean }).percent)).toBe(false);

    const u = makeUnit('a', { speed: 100 });
    applyTreasureStatuses(u, [s]);
    expect(effectiveStat(u, 'speed')).toBe(110);
  });

  it('天问（1129）天资 2.5×5 = 12.5 点：谋略 200 → 212.5（百分比口径会是 225）', () => {
    const s = statusOf(built({ treasureId: 1129, level: 10 }), '天资');
    expect(Boolean((s as { percent?: boolean }).percent)).toBe(false);

    const u = makeUnit('a');
    applyTreasureStatuses(u, [s]);
    expect(effectiveStat(u, 'strategy')).toBe(212.5);
  });

  it('同名词条跨宝物量纲不同：1027 稳固仍是点数（与 1036 的百分比稳固并存）', () => {
    const point = statusOf(built({ treasureId: 1027, level: 10 }), '稳固');
    expect(Boolean((point as { percent?: boolean }).percent)).toBe(false);
    const percent = statusOf(built({ treasureId: 1036, level: 10 }), '稳固');
    expect((percent as { percent?: boolean }).percent).toBe(true);
  });
});

describe('数据一致性：属性类特效的 percent 必须等于数据 unit', () => {
  const ATTR_TYPE: Record<string, string> = {
    骁锐: 'attack_buff',
    天资: 'strategy_buff',
    稳固: 'defense_buff',
    灵动: 'speed_buff',
  };

  it('全部宝物（含自带特效与锻造词条路径）逐条对齐 effect.unit', () => {
    const mismatched: string[] = [];
    for (const treasure of TREASURES) {
      const statuses = built({ treasureId: treasure.id, level: 10 });
      for (const effect of treasure.effects) {
        const type = ATTR_TYPE[effect.name];
        if (!type) continue;
        const hit = statuses.find((x) => x.label === effect.name && x.create.type === type);
        if (!hit) {
          mismatched.push(`${treasure.name}·${effect.name}（无状态）`);
          continue;
        }
        const actual = Boolean((hit.create as { percent?: boolean }).percent);
        if (actual !== (effect.unit === 'percent')) {
          mismatched.push(`${treasure.name}·${effect.name}（unit=${effect.unit}, percent=${actual}）`);
        }
      }
    }
    expect(mismatched, `percent 与数据 unit 不一致：${mismatched.join('、')}`).toEqual([]);
  });
});

describe('许褚【裸衣鏖战】攻击 -15%', () => {
  const debuff = (() => {
    const outputs = SKILL_REGISTRY.luoyi_aozhan.output ?? [];
    const statuses = outputs.flatMap((o) => {
      if (o.kind !== 'inflict_status') return [];
      return Array.isArray(o.status) ? o.status : [o.status];
    });
    const hit = statuses.find((s) => s.type === 'attack_buff');
    if (!hit) throw new Error('裸衣鏖战没有 attack_buff 段');
    return hit;
  })();

  it('数据带 percent:true，数值仍为 -15', () => {
    expect((debuff as { percent?: boolean }).percent).toBe(true);
    expect((debuff as { amount: number }).amount).toBe(-15);
  });

  it('目标攻击 200 → 170（-30），事件文案带 %', () => {
    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, debuff, 'passive', 'luoyi_aozhan', u.general.id);
    expect(effectiveStat(u, 'attack')).toBe(170); // 点数口径会是 185

    const ev = ctx.events.find((e) => e.type === 'status_inflicted' && e.statusType === 'attack_buff');
    const detail = ev && 'detail' in ev ? ev.detail : '';
    expect(detail).toBe('【a】的攻击属性降低了15%(30)(170)');
  });
});

// ---------------------------------------------------------------------------
// 数据守卫（2026-11-08，YG 口径）：
//   官方文案写成「攻击/防御/谋略/速度 属性提高/降低 X%」的属性效果 → 必须 percent: true；
//   文案是点数（无 %）→ 不得带 percent（反向核对由「文案点数却标 percent」清单守护，
//   当前为 0 处，故此处只做正向断言，避免把含糊文案误判成点数制）。
// 同一战法/同一条目的多段属性成组判定：只要文案里有 % 子句，该条全部属性 status 都要 percent。
// ---------------------------------------------------------------------------

const ATTR_STATUS_TYPES = new Set(['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff']);

/** 属性词后 ≤12 字符内紧跟 `数字%` 的子句；排除伤害/恢复/发动率等跨子句误配。 */
const PCT_ATTR_RE =
  /(攻击|防御|谋略|速度|四维|全属性)(属性)?(提高|降低|下降|提升|增加|减少|上升)([^，。；、|]{0,8}?)(\d+(?:\.\d+)?)\s*%/g;
const PCT_ATTR_EXCLUDE = /(伤害|恢复|发动|几率|概率|规避|免疫|减伤|攻击距离)/;

function pctAttrClauses(desc: string): string[] {
  const hits: string[] = [];
  for (const clause of desc.split(/[。；，、|]/)) {
    PCT_ATTR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PCT_ATTR_RE.exec(clause))) {
      if (!PCT_ATTR_EXCLUDE.test(m[4])) hits.push(clause.trim());
    }
  }
  return [...new Set(hits)];
}

/** 递归收集任意战法结构里形如 `{ type: '<x>_buff', amount }` 的状态对象（含 outputs/conditional/instanceGuard 等嵌套）。 */
function collectAttrStatuses(node: unknown, out: Array<{ type: string; amount: number; percent?: boolean }> = []) {
  if (Array.isArray(node)) {
    for (const n of node) collectAttrStatuses(n, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const obj = node as Record<string, unknown>;
  if (typeof obj.type === 'string' && ATTR_STATUS_TYPES.has(obj.type) && typeof obj.amount === 'number') {
    out.push(obj as unknown as { type: string; amount: number; percent?: boolean });
    return out;
  }
  for (const v of Object.values(obj)) collectAttrStatuses(v, out);
  return out;
}

describe('同类修复的行为口径（2026-11-08 补齐的 4 处）', () => {
  const firstAttrStatus = (skillId: string) => {
    const outputs = (SKILL_REGISTRY[skillId].output as Array<Record<string, unknown>>) ?? [];
    const flat = outputs.flatMap((o) => {
      if (o.kind !== 'inflict_status') return [];
      const st = o.status as unknown;
      return Array.isArray(st) ? st : [st];
    });
    const hit = flat.find(
      (s) => s && typeof s === 'object' && ATTR_STATUS_TYPES.has((s as { type: string }).type),
    );
    if (!hit) throw new Error(`${skillId} 没有属性 status`);
    return hit as { type: string; amount: number; percent?: boolean };
  };

  it('破胆：攻击降低 30% → 200 变 140（点数口径会是 170）', () => {
    const st = firstAttrStatus('podan');
    expect(st.percent).toBe(true);
    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, st as CreateStatus, 'active', 'podan', u.general.id);
    expect(effectiveStat(u, 'attack')).toBe(140);
  });

  it('奇佐鬼谋：谋略提高 22% → 200 变 244（点数口径会是 222）', () => {
    const st = firstAttrStatus('qizuo_guimou');
    expect(st.percent).toBe(true);
    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, st as CreateStatus, 'active', 'qizuo_guimou', u.general.id);
    expect(effectiveStat(u, 'strategy')).toBe(244);
  });
});

describe('数据守卫：官方文案「属性 X%」必须落到 percent', () => {
  const skillDesc = JSON.parse(
    readFileSync(new URL('../web/data/skill_desc.json', import.meta.url), 'utf8'),
  ) as Record<string, { desc?: string; desc1?: string }>;

  it('skills.ts：文案含「属性…X%」的战法，其属性 status 全部 percent:true', () => {
    const violations: string[] = [];
    let checked = 0;
    for (const [key, skill] of Object.entries(SKILL_REGISTRY as unknown as Record<string, Record<string, unknown>>)) {
      const id = typeof skill.id === 'string' ? skill.id : key;
      const d = skillDesc[id] ?? skillDesc[key];
      if (!d) continue;
      const clauses = pctAttrClauses(`${d.desc ?? ''} | ${d.desc1 ?? ''}`);
      const statuses = collectAttrStatuses(skill);
      if (!clauses.length || !statuses.length) continue;
      checked++;
      const missing = statuses.filter((s) => s.percent !== true);
      if (missing.length) {
        violations.push(`${key}(${id})「${clauses[0]}」→ ${missing.map((s) => `${s.type}:${s.amount}`).join(', ')}`);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4); // 奇佐鬼谋 / 折戟强攻 / 破胆 / 七擒七纵
    expect(violations).toEqual([]);
  });

  it('treasures.ts：自带特效与锻造词条的 unit 与官方文案量纲一致', () => {
    const violations: string[] = [];
    let checked = 0;
    const check = (label: string, desc: string, unit: string) => {
      if (!pctAttrClauses(desc).length) return;
      checked++;
      if (unit !== 'percent') violations.push(`${label}「${pctAttrClauses(desc)[0]}」unit=${unit}`);
    };
    for (const t of TREASURES) {
      for (const e of t.effects) check(`${t.id} ${t.name} ${e.name}`, e.desc, e.unit);
    }
    for (const [name, a] of Object.entries(AFFIXES)) check(`词条 ${name}`, a.desc, a.unit);
    expect(checked).toBeGreaterThanOrEqual(8); // 天资/骁锐/稳固 等成组百分比条目
    expect(violations).toEqual([]);
  });
});
