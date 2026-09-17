/**
 * 伤害率 / 增减伤成长率锁定（《谋略战法受谋略成长调研.md》§二已验证、§六大明州表）。
 * 只锁调研已确认项；推定值（0.7 / 0.13 / 0.15 惯例）不进本表。
 */
import { describe, it, expect } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import { firstOnHurt, type Skill, type SkillOutput, type CreateStatus } from '../src/engine/types';

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
  /** 战报反推（2026-09）：持节镇西 / 魏武之世 / 强势 / 七步释嫌 / 母仪浮梦 / 黄天余音 / 金匮要略 / 谋议宏图 */
  chijie_zhenxi: { stack_attack: 0.15, stack_strategy: 0.15, stack_defense: 0.15 },
  weiwu_zhishi: { attack_buff: 0.045, defense_buff: 0.045, strategy_buff: 0.045, speed_buff: 0.045 },
  qiangshi: { damage_boost: 0.225 },
  qibu_shixian: { damage_boost: 0.008 },
  muyi_fumeng: { damage_boost: 0.2 },
  huangtian_yuyin: { attack_buff: 0.2, defense_buff: 0.2, strategy_buff: 0.2, speed_buff: 0.2 },
  jinkui_yaolue: { damage_reduce: 0.18 },
  mouyi_hongtu: { damage_reduce: 0.175 },
  /** 战报反推（2026-09）：烈火焚舟一段燃烧 1.35、二段引爆 2.26 */
  liehuo_fenzhou: { burning: 1.35, detonate: 2.26 },
  /** 用户确认（2026-09-15）：赏顺伐逆恢复 65% 成长 0.325；反击 180% 仍取基值不进本表 */
  shangshun_fani: { heal: 0.325 },
  /** 用户实测反解（2026-09-17，游戏内实读；见《速度战法受速度成长调研.md》与各战法注释） */
  dongru_leizhen: { damage_boost: 0.2532 },
  weiwu_zhi_ze: { damage_boost: 0.08 },
  zhuge_jinnang: { damage_reduce: 0.25, damage_boost: 0 },
  lieying_shouxian: { attack_buff: 0.115, defense_buff: 0.115, strategy_buff: 0.115, speed_buff: 0.115 },
  qiji_rufeng: { speed_buff: 0.075 },
  moumou_weiwo: { strategy_damage: 1.825 },
  hubao_dujun: { damage_boost: 0.25 },
};

function collectOutputs(skill: Skill): SkillOutput[] {
  const out = [...skill.output];
  // 一类指挥的准备阶段输出（其疾如风的速度 buff 在这里）
  if (skill.type === 'command' && skill.initialOutput) {
    out.push(...skill.initialOutput);
  }
  if (skill.type === 'command' && skill.delayedOutput) {
    out.push(...skill.delayedOutput.output);
  }
  if ('onHeal' in skill && skill.onHeal?.output) {
    out.push(...skill.onHeal.output);
  }
  if ('onHurt' in skill) {
    const onHurtOut = firstOnHurt(skill.onHurt)?.output;
    if (onHurtOut) out.push(...onHurtOut);
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
    if (o.kind === 'strategy_damage' && o.strategyScaled && o.growthRate !== undefined) push('strategy_damage', o.growthRate);
    if (o.kind === 'heal' && o.strategyScaled) push('heal', o.growthRate);
    if (o.kind === 'grant_damage_boost') push('grant_damage_boost', o.growthRate);
    if (o.kind === 'inflict_status') {
      if (o.detonate?.growthRate !== undefined) {
        push('detonate', o.detonate.growthRate);
      }
      for (const st of statusList(o.status)) {
        if (st.type === 'panic' || st.type === 'burning' || st.type === 'sorcery' || st.type === 'curse' || st.type === 'ignite') {
          push(st.type, st.growthRate);
        }
        // 缩放维不限谋略：速度（其疾如风）/ 攻击 / 防御 类同样进本表
        const scaledFlag =
          ('strategyScaled' in st && st.strategyScaled === true) ||
          ('speedScaled' in st && st.speedScaled === true) ||
          ('attackScaled' in st && st.attackScaled === true) ||
          ('defenseScaled' in st && st.defenseScaled === true);
        if (
          (st.type === 'damage_reduce' ||
            st.type === 'damage_boost' ||
            st.type === 'attack_buff' ||
            st.type === 'defense_buff' ||
            st.type === 'strategy_buff' ||
            st.type === 'speed_buff') &&
          scaledFlag &&
          'growthRate' in st &&
          st.growthRate !== undefined
        ) {
          push(st.type, st.growthRate);
        }
      }
    }
  }
  if (skill.type === 'command' && skill.stackBuff) {
    const sb = skill.stackBuff;
    if (sb.onAttack) push('stack_attack', sb.onAttack.growthRate);
    if (sb.onStrategy) push('stack_strategy', sb.onStrategy.growthRate);
    if (sb.onDefense) push('stack_defense', sb.onDefense.growthRate);
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
