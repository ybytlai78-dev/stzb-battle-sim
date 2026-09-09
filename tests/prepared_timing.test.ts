/**
 * 准备战法时序测试（v0.10）：判定成功本回合进入准备，下回合主动战法阶段释放；
 * 释放后本回合不再进行释放判定 → 极端情况 8 回合最多释放 4 次
 * （第 1/3/5/7 回合判定成功准备 → 第 2/4/6/8 回合释放）。
 * 使用蜀·关羽主战法「樊渊泅囚」（1 回合准备），固定种子断言时序不变量。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 50,
    defense: 50,
    strategy: 50,
    speed: 20,
    attackRange: 1,
    maxTroops: 30000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

const SKILL = '樊渊泅囚';

/** 断言一场 8 回合战斗的准备战法时序不变量（对任意成败组合恒成立） */
function assertPreparedTiming(skillName: string, seed: number, carrier: General): void {
  const enemy: General[] = ['e1', 'e2', 'e3'].map((id, i) =>
    dummy(id, (['前锋', '中军', '大营'] as Position[])[i])
  );
  const report = runBattle({ myTeam: [carrier], enemyTeam: enemy, seed, maxRounds: 8 });

  // 按回合归类事件
  let round = 0;
  const byRound = new Map<number, BattleEvent[]>();
  for (const ev of report.events) {
    if (ev.type === 'round_start') { round = (ev as { round: number }).round; continue; }
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(ev);
  }
  const evs = (r: number) => byRound.get(r) ?? [];
  const has = (r: number, type: string) =>
    evs(r).some((e) => e.type === type && 'skillName' in e && e.skillName === skillName);

  const casts: number[] = [];
  const preps: number[] = [];
  for (let r = 1; r <= 8; r++) {
    if (has(r, 'skill_cast')) casts.push(r);
    if (has(r, 'prepare_start')) preps.push(r);
  }

  // 释放次数 ≤ 4（8 回合上限：1/3/5/7 准备 → 2/4/6/8 释放）
  expect(casts.length).toBeLessThanOrEqual(4);
  // 每个释放回合 r：上一回合已准备，本回合不再进入准备、不做发动率判定
  for (const r of casts) {
    expect(preps.includes(r - 1), `[${skillName}] 释放回合 ${r} 前应已准备`).toBe(true);
    expect(preps.includes(r), `[${skillName}] 释放回合 ${r} 不应再次进入准备`).toBe(false);
    expect(has(r, 'skill_trigger'), `[${skillName}] 释放回合 ${r} 不应做发动率判定`).toBe(false);
  }
  // 每个准备回合 r（r<8）：下一回合必定释放
  for (const r of preps) {
    if (r < 8) expect(casts.includes(r + 1), `[${skillName}] 准备回合 ${r} 后一回合应释放`).toBe(true);
  }
}

/** 全部已实现准备战法（SKILL_REGISTRY 中 type='active' && prepare=true） */
const PREPARED_SKILLS = Object.values(SKILL_REGISTRY)
  .filter((s) => s.type === 'active' && s.prepare)
  .map((s) => ({ id: s.id, name: s.name }));

describe('准备战法时序（蜀·关羽 樊渊泅囚）', () => {
  it('主战法为 1 回合准备主动战法', () => {
    const g = hero('h451');
    expect(g.name).toBe('关羽');
    expect(g.activeSkillIds).toContain('fanyuan_qiou');
  });

  it('8 回合最多释放 4 次：判定成功回合进入准备，下一回合释放，释放回合不再判定', () => {
    const guanyu = withSkills(level40(hero('h451'), { attack: 40 }), { activeSkillIds: ['fanyuan_qiou'] });
    guanyu.position = '前锋';
    assertPreparedTiming(SKILL, 20260101, guanyu);
  });
});

describe('全部准备战法统一时序（' + '27 个，引擎管线全局生效）', () => {
  for (const { id, name } of PREPARED_SKILLS) {
    it(`${name}（${id}）：8 回合最多释放 4 次，释放回合不判定、下一回合自动释放`, () => {
      const carrier = withSkills(level40(hero('h451'), { attack: 40 }), { activeSkillIds: [id] });
      carrier.position = '前锋';
      for (const seed of [777, 20260101, 42]) {
        assertPreparedTiming(name, seed, carrier);
      }
    });
  }
});
