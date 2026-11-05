import { describe, expect, it } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills.ts';

/**
 * 属性 / 减伤成长率的回归守卫。
 *
 * 2026-11-01 包内对拍（`npx tsx scripts/rag/slotdiff.mts`）抓出 9 条同型差异：引擎写了数值却没写 `growthRate`
 * —— 等于把「随属性成长」当成常数。逐条按包内 `tb_cfg_skill_detail` 的 `intel_param` 补齐后差异归零，
 * 这个文件把结论钉住：**值 + 成长率 + 缩放标记三者缺一，战法就静默不缩放**。
 *
 * 尤其 `strategyScaled` 不能漏：`src/engine/action.ts` 的缩放分支只在
 * `(strategyScaled && growthRate !== undefined)` 时进入，只写 growthRate 不会生效。
 */

type Row = Record<string, unknown>;

const outputs = (id: string): Row[] => {
  const skill = (SKILL_REGISTRY as unknown as Record<string, { output: Row[] }>)[id];
  return skill.output;
};

const statusOf = (id: string, type: string): Row => {
  const hit = outputs(id)
    .map((o) => o.status as Row | undefined)
    .filter((s): s is Row => !!s && s.type === type);
  expect(hit.length, `${id} 缺 ${type} 段`).toBeGreaterThan(0);
  return hit[0];
};

describe('包内 detail 修正的属性成长率（回归守卫）', () => {
  it('金匮要略减伤 20.4% 成长 0.13/点（20077301：const 10 + intel 26）', () => {
    const s = statusOf('jinkui_yaolue', 'damage_reduce');
    expect(s.rate).toBeCloseTo(0.204, 6);
    expect(s.growthRate).toBeCloseTo(0.13, 6);
    expect(s.strategyScaled).toBe(true);
  });

  it('将倾之柱减伤 49% 成长 0.175/点（20000712：const 35 + intel 35）', () => {
    const s = statusOf('jiangqing_zhizhu', 'damage_reduce');
    expect(s.rate).toBeCloseTo(0.49, 6);
    expect(s.growthRate).toBeCloseTo(0.175, 6);
    expect(s.strategyScaled).toBe(true);
  });

  it('献刀七星速度 −28 成长 0.1/点（20004202：const 2000 + intel 2000）', () => {
    const s = statusOf('xiandao_qixing', 'speed_buff');
    expect(s.amount).toBe(-28);
    expect(s.growthRate).toBeCloseTo(0.1, 6);
    expect(s.strategyScaled).toBe(true);
  });

  it('筹策绝道谋略 / 速度各 −25，成长 0.11/点（20095302/20095303）', () => {
    for (const type of ['strategy_buff', 'speed_buff']) {
      const s = statusOf('chouce_juedao', type);
      expect(s.amount).toBe(-25);
      expect(s.growthRate).toBeCloseTo(0.11, 6);
      expect(s.strategyScaled).toBe(true);
    }
  });

  it('绝道防御 −6 成长 0.075/点（20012402：const 0 + intel 1500）', () => {
    const s = statusOf('juedao', 'defense_buff');
    expect(s.amount).toBe(-6);
    expect(s.growthRate).toBeCloseTo(0.075, 6);
    expect(s.strategyScaled).toBe(true);
  });

  it('落石防御 −5.2 成长 0.065/点（20012302：const 0 + intel 1300）', () => {
    const s = statusOf('luoshi', 'defense_buff');
    expect(s.amount).toBe(-5.2);
    expect(s.growthRate).toBeCloseTo(0.065, 6);
    expect(s.strategyScaled).toBe(true);
  });
});

describe('缩放标记与成长率必须成对出现（否则静默不缩放）', () => {
  // 「必须带标记」只适用于 executeSkillOutputs 里走属性缩放分支的段。
  // DoT（动摇/恐慌/燃烧/妖术/诅咒/引燃）的 rate 走另一条无条件缩放路径
  // （`scaledValue(create.rate, create.growthRate, effStrategy)`），本来就不需要标记。
  const NEEDS_MARKER = new Set([
    'attack_buff',
    'defense_buff',
    'strategy_buff',
    'speed_buff',
    'damage_reduce',
    'damage_boost',
    'split',
    'jump_prep',
    'avoid_charge',
  ]);

  it('凡是写了 growthRate 的属性 / 增减伤段，都必须带一个 *Scaled 标记', () => {
    const offenders: string[] = [];
    for (const [id, skill] of Object.entries(SKILL_REGISTRY as unknown as Record<string, { output: Row[] }>)) {
      for (const o of skill.output ?? []) {
        const s = o.status as Row | undefined;
        if (!s || s.growthRate === undefined) continue;
        if (!NEEDS_MARKER.has(String(s.type))) continue;
        const scaled = s.attackScaled || s.defenseScaled || s.speedScaled || s.strategyScaled;
        if (!scaled) offenders.push(`${id}/${String(s.type)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
