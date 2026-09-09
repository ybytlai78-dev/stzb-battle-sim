/**
 * 伤害率 / 增减伤成长率锁定（《谋略战法受谋略成长调研.md》§二已验证、§六大明州表）。
 * 只锁调研已确认项；推定值（0.7 / 0.13 / 0.15 惯例）不进本表。
 */
import { describe, it, expect } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { Skill, SkillOutput, CreateStatus } from '../src/engine/types';

/** 已确认：技能 id → 效果键 → 成长率/点 */
const CONFIRMED: Record<string, Record<string, number>> = {
  jiagong: { strategy_damage: 0.945 },
  xuanwu_fuliu: { strategy_damage: 1.5 },
  baiyi_dujiang: { strategy_damage: 2.25 },
  jiangqing_zhizhu: { strategy_damage: 0.625 },
  huoshi_fengwei: { strategy_damage: 0.95, ignite: 2.45 },
  mimou_dingshu: { curse: 1.225, panic: 1.125 },
  shichou: { strategy_damage: 2.1 },
  fushi_yehuo: { strategy_damage: 0.95, burning: 0.95 },
  weiji_nanyan: { sorcery: 1.075 },
  chuge_siqi: { panic: 1.275 },
  yanfen_jizhen: { strategy_damage: 1.3, burning: 1.3 },
  quhu_tunlang: { strategy_damage: 1.85 },
  xixiang_wugong: { strategy_damage: 2.075 },
  kui_xiangta: { strategy_damage: 0.69 },
  gongxin: { strategy_damage: 1.075 },
  sanshu_qimou: { strategy_damage: 1.85 },
  famou: { strategy_damage: 2.175 },
  luolei: { strategy_damage: 1.35 },
  mizhen: { strategy_damage: 1.5 },
  fengsheng_heli: { panic: 1.3 },
  weiya_kunjun: { strategy_damage: 2.25 },
  shengdong_jixi: { strategy_damage: 2.45 },
  shuiyan_qijun: { strategy_damage: 2.25 },
  duquan: { panic: 0.875 },
  kuidi: { strategy_damage: 0.785 },
  huoozi: { strategy_damage: 0.75, burning: 0.75 },
  quefu: { strategy_damage: 1.75 },
  dashang_sanjun: { grant_damage_boost: 0.15 },
  shenbing_tianjiang: { grant_damage_boost: 0.15 },
  biqi_fengmang: { damage_reduce: 0.15 },
  wuxin_lianzhan: { damage_boost: 0.15 },
  libing_mousheng: { strategy_damage: 2.25 },
  yunchou_juesheng: { strategy_damage: 1.585 },
  huaide_weiwei: { strategy_damage: 1.75 },
};

function collectOutputs(skill: Skill): SkillOutput[] {
  const out = [...skill.output];
  if (skill.type === 'command' && skill.delayedOutput) {
    out.push(...skill.delayedOutput.output);
  }
  return out;
}

function statusList(st: CreateStatus | CreateStatus[]): CreateStatus[] {
  return Array.isArray(st) ? st : [st];
}

/** 从战法输出抽出「效果键 → 成长率」 */
function extractGrowths(skill: Skill): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  const push = (key: string, rate: number) => {
    (found[key] ??= []).push(rate);
  };
  for (const o of collectOutputs(skill)) {
    if (o.kind === 'strategy_damage' && o.strategyScaled) push('strategy_damage', o.growthRate);
    if (o.kind === 'grant_damage_boost') push('grant_damage_boost', o.growthRate);
    if (o.kind === 'inflict_status') {
      for (const st of statusList(o.status)) {
        if (st.type === 'panic' || st.type === 'burning' || st.type === 'sorcery' || st.type === 'curse' || st.type === 'ignite') {
          push(st.type, st.growthRate);
        }
        if (
          (st.type === 'damage_reduce' || st.type === 'damage_boost') &&
          st.strategyScaled &&
          st.growthRate !== undefined
        ) {
          push(st.type, st.growthRate);
        }
      }
    }
  }
  return found;
}

describe('已确认伤害率/增减伤成长率', () => {
  it.each(Object.entries(CONFIRMED))('%s', (id, expected) => {
    const skill = SKILL_REGISTRY[id];
    expect(skill, `战法 ${id} 应在 SKILL_REGISTRY`).toBeTruthy();
    const found = extractGrowths(skill);
    for (const [key, rate] of Object.entries(expected)) {
      const actual = found[key];
      expect(actual, `${id} 应有 ${key} 成长率`).toBeTruthy();
      expect(actual!.every((n) => n === rate), `${id}.${key} 应为 ${rate}，实际 ${actual}`).toBe(true);
    }
  });

  it('密谋定蜀恐慌维持官方现行 143%（大明州旧版 115% 不用），成长率 1.125', () => {
    const skill = SKILL_REGISTRY.mimou_dingshu;
    const panic = collectOutputs(skill)
      .flatMap((o) => (o.kind === 'inflict_status' ? statusList(o.status) : []))
      .find((st) => st.type === 'panic');
    expect(panic).toBeTruthy();
    expect(panic!.rate).toBe(143);
    expect(panic!.growthRate).toBe(1.125);
  });
});
