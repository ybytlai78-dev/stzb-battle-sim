/**
 * 治疗战法恢复率成长率锁定（《谋略战法受谋略成长调研.md》§七，用户 2026-08-18 补全）。
 * 已入库战法在此断言 growthRate；未入库只作文档备忘，入库时把 id 补进本表。
 * 休整状态战法的成长率写在 inflict_status.type==='rest'。
 */
import { describe, it, expect } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { CreateStatus } from '../src/engine/types';

/** 已入库战法：heal 输出或 rest 状态的 growthRate（固定倍率 = 0） */
const IMPLEMENTED_HEAL_GROWTH: Record<string, number> = {
  zengyuan: 2.1,
  anfu_junxin: 0.975,
  qingnang_miyao: 0,
  shanbing_bugua: 0,
  qiebing: 0,
  gongxin: 0.75,
  chongzheng_qigu: 1.13,
  yuanjun_mice: 0.85,
  heliu: 1.375,
  sanjun_zhizhong: 1.575,
  libing_mousheng: 1.175,
  yangjing_xurui: 1.15,
  qibu_shixian: 1.46,
};

function restStatuses(st: CreateStatus | CreateStatus[]): Extract<CreateStatus, { type: 'rest' }>[] {
  const list = Array.isArray(st) ? st : [st];
  return list.filter((s): s is Extract<CreateStatus, { type: 'rest' }> => s.type === 'rest');
}

function healGrowths(skillId: string): { growthRate: number; strategyScaled: boolean }[] {
  const s = SKILL_REGISTRY[skillId];
  expect(s, `战法 ${skillId} 应在 SKILL_REGISTRY`).toBeTruthy();
  const out: { growthRate: number; strategyScaled: boolean }[] = [];
    const outputs = [...s.output];
    if (s.type === 'command' && s.allyActEvery) outputs.push(...s.allyActEvery.output);
    for (const o of outputs) {
    if (o.kind === 'heal') out.push({ growthRate: o.growthRate, strategyScaled: o.strategyScaled });
    if (o.kind === 'inflict_status') {
      for (const r of restStatuses(o.status)) {
        out.push({ growthRate: r.growthRate, strategyScaled: r.strategyScaled !== false });
      }
    }
  }
  return out;
}

describe('已入库治疗战法恢复率成长率', () => {
  it.each(Object.entries(IMPLEMENTED_HEAL_GROWTH))('%s heal/rest.growthRate = %s', (id, expected) => {
    const heals = healGrowths(id);
    expect(heals.length).toBeGreaterThan(0);
    for (const h of heals) {
      expect(h.growthRate).toBe(expected);
      expect(h.strategyScaled).toBe(expected > 0);
    }
  });
});
