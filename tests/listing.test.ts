/**
 * 暂时下架：上架武将须有已实现且成长率已确认的主战法；可学习战法不含未确认成长条目。
 */
import { describe, it, expect } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  OFFLINE_MAIN_SKILLS,
  OFFLINE_LEARNABLE_SKILLS,
  isHeroListed,
  isLearnableSkillListed,
} from '../src/data/listing';
import heroesJson from '../web/data/heroes.json';

describe('暂时下架名单', () => {
  it('下架主战法 / 可学习战法均在 SKILL_REGISTRY', () => {
    for (const id of Object.keys(OFFLINE_MAIN_SKILLS)) {
      expect(SKILL_REGISTRY[id], `主战法 ${id}`).toBeTruthy();
    }
    for (const id of Object.keys(OFFLINE_LEARNABLE_SKILLS)) {
      expect(SKILL_REGISTRY[id], `可学习 ${id}`).toBeTruthy();
    }
  });

  it('上架武将都有已实现主战法，且不在未确认成长名单', () => {
    const listed = heroesJson.filter(isHeroListed);
    expect(listed.length).toBeGreaterThan(20);
    for (const h of listed) {
      expect(h.mainSkillId, `${h.name} 应有主战法`).toBeTruthy();
      expect(SKILL_REGISTRY[h.mainSkillId], `${h.name} 主战法应已实现`).toBeTruthy();
      expect(OFFLINE_MAIN_SKILLS[h.mainSkillId], `${h.name} 不应带未确认成长主战法`).toBeUndefined();
    }
  });

  it('主战法未实现的五星武将全部下架', () => {
    const unimplemented = heroesJson.filter((h) => !h.mainSkillId);
    expect(unimplemented.length).toBeGreaterThan(0);
    expect(unimplemented.every((h) => !isHeroListed(h))).toBe(true);
  });

  it('未确认成长的可学习战法 isLearnableSkillListed=false', () => {
    expect(isLearnableSkillListed('jijiu')).toBe(false);
    expect(isLearnableSkillListed('qixi')).toBe(false);
    expect(isLearnableSkillListed('dashang_sanjun')).toBe(true);
    expect(isLearnableSkillListed('tujin')).toBe(true);
  });

  it('未确认成长的主战法对应武将全部下架', () => {
    const hidden = heroesJson.filter((h) => h.mainSkillId && OFFLINE_MAIN_SKILLS[h.mainSkillId]);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((h) => !isHeroListed(h))).toBe(true);
  });

  it('战报反推已确认成长的主战法上架', () => {
    const confirmed = [
      'chijie_zhenxi',
      'weiwu_zhishi',
      'qiangshi',
      'qibu_shixian',
      'muyi_fumeng',
      'huangtian_yuyin',
      'jinkui_yaolue',
      'mouyi_hongtu',
      'liehuo_fenzhou',
    ];
    for (const id of confirmed) {
      expect(OFFLINE_MAIN_SKILLS[id], `${id} 应已从上架黑名单移除`).toBeUndefined();
      const heroes = heroesJson.filter((h) => h.mainSkillId === id);
      expect(heroes.length, `${id} 应有携带武将`).toBeGreaterThan(0);
      expect(heroes.every(isHeroListed), `${id} 携带武将应上架`).toBe(true);
    }
  });
});
