/**
 * 百家战法（bj_*）在装配链路里的可用性契约（2026-10-23 用户「改」后建立）。
 *
 * 事实链：`src/data/skills.ts` 末尾 `...BAIJIA_SKILLS` 已把这 21 条并入 `SKILL_REGISTRY`
 * （与 `BAIJIA_SKILLS` 是同一批对象引用），因此 Web 侧 `attachSkills` / 战法背包 / 预设详情
 * 只查 `SKILL_REGISTRY` 就能拿到 bj_*，不需要在 Web 层再拼一次表。
 * 这条契约守的是「别再有人以为 bj_* 是独立表而漏挂」。
 */
import { describe, expect, it } from 'vitest';
import { attachSkills } from '../web/heroes';
import { BAIJIA_SKILLS } from '../src/data/baijia';
import { SKILL_REGISTRY } from '../src/data/skills';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';

function host(patch: Partial<General> = {}): General {
  return {
    id: 'host',
    name: '夏侯渊',
    rarity: '5星',
    cost: 4,
    faction: '魏',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position: '大营',
    attack: 100,
    defense: 80,
    strategy: 80,
    speed: 90,
    attackRange: 3,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...patch,
  };
}

/** 四个槽位里的全部战法 id */
function allSlots(g: General): string[] {
  return [...g.activeSkillIds, ...g.passiveSkillIds, ...g.commandSkillIds, ...g.pursuitSkillIds];
}

describe('百家战法在装配链路里可用', () => {
  it('21 条 bj_* 全部并入 SKILL_REGISTRY，且与 BAIJIA_SKILLS 同一批对象', () => {
    const ids = Object.keys(BAIJIA_SKILLS);
    expect(ids.length).toBe(21);
    for (const id of ids) {
      expect(SKILL_REGISTRY[id], `${id} 没进注册表`).toBe(BAIJIA_SKILLS[id]);
    }
    expect(SKILL_REGISTRY['bj_550008']?.name).toBe('西陲立功');
    expect(SKILL_REGISTRY['bj_550008']?.type).toBe('active');
  });

  it('attachSkills 逐条都能挂进对应类型槽，一条都不漏', () => {
    for (const id of Object.keys(BAIJIA_SKILLS)) {
      const g = attachSkills(host(), [id]);
      expect(allSlots(g), `${id} 未被挂进任何槽位`).toContain(id);
      const type = BAIJIA_SKILLS[id].type;
      const bucket =
        type === 'passive' ? g.passiveSkillIds
          : type === 'command' ? g.commandSkillIds
            : type === 'pursuit' ? g.pursuitSkillIds
              : g.activeSkillIds;
      expect(bucket, `${id} 挂错槽位（type=${type}）`).toContain(id);
    }
    // 不改写入参
    expect(host().activeSkillIds).toEqual([]);
  });

  it('经 attachSkills 挂上的被动词条能在战斗里触发（分兵在准备阶段挂上）', () => {
    const report = runBattle({
      myTeam: [attachSkills(host(), ['bj_550021'])],
      enemyTeam: [host({ id: 'foe', name: '张辽', faction: '魏', position: '大营' })],
      seed: 1,
      maxRounds: 1,
    });
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.detail.includes('分兵'))).toBe(true);
  });
});
