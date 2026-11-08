import { describe, expect, it } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';

type PathPart = string | number;

/**
 * 2026-11-06 批量接线：13 个战法 / 15 段成长率，外加名士在野斜率修正。
 *
 * 这些值全部来自 `tb_cfg_skill_detail`（hot_20261104）：
 *   value@80 = constant_param + 0.4 × intel_param，growth = intel_param / 200。
 * 本测试只锁「数据已经接到引擎字段上」，具体换算与战斗行为由各战法测试覆盖。
 */
const CASES: Array<{ label: string; skillId: string; path: PathPart[]; growth: number }> = [
  { label: '九伐中原 · 策略伤害', skillId: 'jiufa_zhongyuan', path: ['afterActive', 'output', 1, 'growthRate'], growth: 0.95 },
  { label: '巧音唤蝶 · 恢复', skillId: 'qiaoyin_huandie', path: ['output', 2, 'growthRate'], growth: 1.325 },
  { label: '千机谋变 · 策略伤害', skillId: 'qianji_moubian', path: ['output', 0, 'growthRate'], growth: 1.25 },
  { label: '诱敌深入 · 策略伤害', skillId: 'youdi_shenru', path: ['onHurt', 'output', 0, 'growthRate'], growth: 1.0 },
  { label: '众谋不懈 · 策略伤害（主动段）', skillId: 'zhongmou_buxie', path: ['output', 0, 'growthRate'], growth: 1.925 },
  {
    label: '众谋不懈 · 策略伤害（追击段）',
    skillId: 'zhongmou_buxie',
    path: ['onPursuitAttempt', 'output', 0, 'outputs', 0, 'growthRate'],
    growth: 1.925,
  },
  { label: '计定山越 · 友军恢复', skillId: 'jiding_shanyue', path: ['output', 3, 'growthRate'], growth: 1.15 },
  { label: '举贤决机 · 策略伤害', skillId: 'juxian_jueji', path: ['onAttrChange', 1, 'output', 0, 'growthRate'], growth: 1.0 },
  {
    label: '率尔方雅 · 高低属性策略伤害',
    skillId: 'lv_er_fang_ya',
    path: ['output', 2, 'recipientDamageByHigherStat', 'strategyGrowthRate'],
    growth: 1.1,
  },
  { label: '辞后定朝 · 女性防御', skillId: 'cihou_dingchao', path: ['onActSegments', 1, 'output', 3, 'status', 'growthRate'], growth: 0.225 },
  { label: '守静却敌 · 第 8 回合策略伤害', skillId: 'shoujing_quedi', path: ['delayedOutputs', 1, 'output', 0, 'growthRate'], growth: 0.7 },
  { label: '计谕废立 · 第二段策略伤害', skillId: 'jiyu_fuili', path: ['output', 3, 'growthRate'], growth: 1.3 },
  { label: '锦车持节 · 发动率', skillId: 'jinche_chijie', path: ['roundStartChance', 'growthRate'], growth: 0.125 },
  { label: '帝临回光 · 分兵', skillId: 'diling_huiguang', path: ['delayedOutput', 'output', 2, 'status', 'growthRate'], growth: 0.375 },
  { label: '帝临回光 · 恐慌', skillId: 'diling_huiguang', path: ['delayedOutput', 'output', 3, 'status', 'growthRate'], growth: 0.55 },
  { label: '名士在野 · 受到攻击伤害降低', skillId: 'mingshi_zaiye', path: ['output', 0, 'growthRate'], growth: 0.125 },
];

function at(skillId: string, path: PathPart[]): unknown {
  let cur: unknown = (SKILL_REGISTRY as Record<string, unknown>)[skillId];
  for (const part of path) {
    if (cur === null || typeof cur !== 'object') throw new Error(`路径不可达：${skillId}.${path.join('.')}`);
    cur = (cur as Record<string | number, unknown>)[part];
  }
  return cur;
}

describe('2026-11-06 批量成长率接线', () => {
  it.each(CASES)('$label → $growth', ({ skillId, path, growth }) => {
    const value = at(skillId, path);
    expect(typeof value).toBe('number');
    expect(value as number).toBeCloseTo(growth, 10);
  });
});
