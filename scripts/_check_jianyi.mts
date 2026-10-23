/** 临时核验：卞夫人上架状态 + 俭仪蹈和 实跑事件 */
import fs from 'node:fs';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import { SKILL_REGISTRY } from '../src/data/skills';
import { isHeroListed } from '../src/data/listing';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map(heroes.map((h: any) => [h.id, h]));

function build(id: string, position: General['position']): General {
  const rec = byId.get(id);
  const g1 = recordToGeneral(rec);
  return { ...leveledFromRecord(g1, rec, 40, { strategy: 40 }, 9000), position, morale: 100 } as General;
}

const h603 = byId.get('h603');
console.log('h603 mainSkillId =', JSON.stringify(h603.mainSkillId), 'mainSkillName =', h603.mainSkillName);
console.log('isHeroListed(h603) =', isHeroListed(h603));
console.log('registry has jianyi_daohe =', !!SKILL_REGISTRY['jianyi_daohe']);
const def = SKILL_REGISTRY['jianyi_daohe'] as any;
console.log('skill: type', def.type, 'phase', def.phase, 'range', def.range, 'targetMode', def.targetMode);

// 卞夫人放蓝方（大营），红方带主动战法频繁出手 → 观察 属性压制 + 犹豫/怯战
const red: General[] = [build('h799', '大营'), build('h790', '中军'), build('h769', '前锋')];
const blue: General[] = [build('h603', '大营'), build('h16', '中军'), build('h479', '前锋')];

const applied: Record<string, number> = {};
const attrDetail: Record<string, string> = {};
let triggerRolls = 0;
let triggerHits = 0;
let hitRounds: Record<number, number> = {};
let hitAfterActive = 0;
let hitAfterBasic = 0;

for (let seed = 1; seed <= 40; seed++) {
  const rep = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 } as any);
  const evs = rep.events as any[];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.type === 'skill_trigger' && e.skillId === 'jianyi_daohe') {
      triggerRolls++;
      if (e.success) triggerHits++;
    }
    if (e.type !== 'status_inflicted') continue;
    if (e.statusType === 'attack_buff' || e.statusType === 'strategy_buff') {
      attrDetail[e.statusType] = e.detail;
      applied[`${e.statusType}:${e.unitId}`] = (applied[`${e.statusType}:${e.unitId}`] ?? 0) + 1;
    }
    if (e.statusType === 'hesitation' || e.statusType === 'cowardice') {
      applied[e.statusType] = (applied[e.statusType] ?? 0) + 1;
      const r = evs.slice(Math.max(0, i - 6), i);
      const lastAct = [...r].reverse().find((x) => x.type === 'skill_cast' || x.type === 'attack_hit');
      if (lastAct?.type === 'skill_cast') hitAfterActive++;
      if (lastAct?.type === 'attack_hit') hitAfterBasic++;
    }
  }
  // 回合分布来自 round_start 计数
  for (const e of evs) if (e.type === 'round_end') hitRounds[e.round] = (hitRounds[e.round] ?? 0) + 1;
}
console.log('属性压制 detail:', attrDetail);
console.log('属性压制施加次数（键=类型:单位）:', applied);
console.log('判定次数', triggerRolls, '命中', triggerHits, '命中率', triggerRolls ? (triggerHits / triggerRolls).toFixed(2) : '-');
console.log('犹豫/怯战 计数:', applied.hesitation ?? 0, applied.cowardice ?? 0);
console.log('触发前一条动作 = 主动战法 / 普攻:', hitAfterActive, '/', hitAfterBasic);
