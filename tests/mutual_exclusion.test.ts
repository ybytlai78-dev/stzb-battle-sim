/**
 * 互斥规则白名单制（2026-09-16，用户口径）：
 *  - **只有** 赵云 ↔ SP赵云、姜维(蜀·步) ↔ SP姜维(蜀·弓) 不可同队，runBattle 抛错；
 *  - 其余同名武将（关羽蜀/魏、司马懿魏/晋、荀彧魏/汉、吕布汉/群 …）一律可同队；
 *  - XP 卡不入互斥组：XP姜维 与 SP姜维（及其基础名版本）可同队。
 * 旧口径「同名自动成组」已废止。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { initHeroDB, getGeneral, HERO_RECORDS, validateMutualExclusion } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

/** 需要至少 3 人成队 + 1 敌人才能开打 */
const battleWith = (myTeam: ReturnType<typeof getGeneral>[]) => () =>
  runBattle({ seed: 1, maxRounds: 8, myTeam, enemyTeam: [getGeneral('taishici')] });

describe('互斥白名单：仅 赵云 与 姜维 两组', () => {
  it('validateMutualExclusion：赵云 + SP赵云 同队 → 返回错误信息', () => {
    const err = validateMutualExclusion([getGeneral('zhaoyun'), getGeneral('sp_zhaoyun')]);
    expect(err).toBeTruthy();
    expect(err).toContain('互斥冲突');
  });

  it('runBattle：赵云 + SP赵云 同队 → 抛「配队非法」', () => {
    expect(battleWith([getGeneral('zhaoyun'), getGeneral('sp_zhaoyun'), getGeneral('zhouyu')])).toThrow(
      /配队非法.*互斥冲突/
    );
  });

  it('敌方队也存在互斥冲突 → 同样抛错', () => {
    expect(() =>
      runBattle({
        seed: 1,
        maxRounds: 8,
        myTeam: [getGeneral('taishici'), getGeneral('zhouyu'), getGeneral('sunquan')],
        enemyTeam: [getGeneral('zhaoyun'), getGeneral('sp_zhaoyun'), getGeneral('lvmeng')],
      })
    ).toThrow(/配队非法.*互斥冲突/);
  });

  it('姜维组：SP姜维 归入「姜维」组；XP姜维 不入组 → 二者可同队', () => {
    expect(HERO_RECORDS['sp_jiangwei'].mutualExclusionGroup).toBe('姜维');
    expect(HERO_RECORDS['xp_jiangwei'].mutualExclusionGroup).toBeNull();
    expect(validateMutualExclusion([getGeneral('sp_jiangwei'), getGeneral('xp_jiangwei')])).toBeNull();
  });

  it('同名不同势力不再互斥（关羽蜀/魏、司马懿魏/晋、荀彧魏/汉）', () => {
    const pairs: [string, string][] = [
      ['h451', 'h26'],
      ['h472', 'h807'],
      ['h24', 'h794'],
    ];
    for (const [a, b] of pairs) {
      expect(HERO_RECORDS[a].mutualExclusionGroup, `${a} 不应有互斥组`).toBeNull();
      expect(HERO_RECORDS[b].mutualExclusionGroup, `${b} 不应有互斥组`).toBeNull();
      expect(validateMutualExclusion([getGeneral(a), getGeneral(b)]), `${a}+${b} 应可同队`).toBeNull();
    }
  });

  it('runBattle：SP姜维 + XP姜维 同队可正常开打（不抛错）', () => {
    expect(
      battleWith([getGeneral('sp_jiangwei'), getGeneral('xp_jiangwei'), getGeneral('weiyan')])
    ).not.toThrow();
  });

  it('SP 武将带 sp 标签，普通赵云不带；XP姜维 不带 sp 标签', () => {
    expect(getGeneral('zhaoyun').tags).toEqual([]);
    expect(getGeneral('sp_zhaoyun').tags).toEqual(['sp']);
    expect(getGeneral('xp_jiangwei').tags).toEqual([]);
  });
});
