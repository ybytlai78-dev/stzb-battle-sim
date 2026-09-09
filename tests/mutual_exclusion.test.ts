/**
 * SP 与普通重名武将互斥测试（v0.6）：
 *  - 同 mutualExclusionGroup（如 赵云/SP赵云）不可同队，runBattle 抛错
 *  - 不同组武将可正常组队
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { initHeroDB, getGeneral, validateMutualExclusion } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

describe('SP/普通重名武将互斥', () => {
  it('validateMutualExclusion：赵云 + SP赵云 同队 → 返回错误信息', () => {
    const err = validateMutualExclusion([getGeneral('zhaoyun'), getGeneral('sp_zhaoyun')]);
    expect(err).toBeTruthy();
    expect(err).toContain('互斥冲突');
  });

  it('validateMutualExclusion：魏司马懿 + 晋司马懿 同队 → 返回错误信息', () => {
    const err = validateMutualExclusion([getGeneral('h472'), getGeneral('h807')]);
    expect(err).toBeTruthy();
    expect(err).toContain('互斥冲突');
  });

  it('runBattle：赵云 + SP赵云 同队 → 抛「配队非法」', () => {
    expect(() =>
      runBattle({
        seed: 1,
        maxRounds: 8,
        myTeam: [getGeneral('zhaoyun'), getGeneral('sp_zhaoyun')],
        enemyTeam: [getGeneral('taishici')],
      })
    ).toThrow(/配队非法.*互斥冲突/);
  });

  it('敌方队也存在互斥冲突 → 同样抛错', () => {
    expect(() =>
      runBattle({
        seed: 1,
        maxRounds: 8,
        myTeam: [getGeneral('taishici')],
        enemyTeam: [getGeneral('zhaoyun'), getGeneral('sp_zhaoyun')],
      })
    ).toThrow(/配队非法.*互斥冲突/);
  });

  it('非同组武将可正常组队（不抛错）', () => {
    expect(() =>
      runBattle({
        seed: 1,
        maxRounds: 8,
        myTeam: [getGeneral('taishici'), getGeneral('zhouyu'), getGeneral('sunquan')],
        enemyTeam: [getGeneral('weiyan')],
      })
    ).not.toThrow();
  });

  it('SP 武将带 sp 标签，普通赵云不带', () => {
    expect(getGeneral('zhaoyun').tags).toEqual([]);
    expect(getGeneral('sp_zhaoyun').tags).toEqual(['sp']);
  });
});
