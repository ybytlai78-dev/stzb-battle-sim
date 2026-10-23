/** 临时核验：十常侍上架状态 + 乱政 实跑事件 */
import fs from 'node:fs';
import { recordToGeneral, leveledFromRecord, mainSkillSlot } from '../src/data/hero-utils';
import { SKILL_REGISTRY } from '../src/data/skills';
import { isHeroListed } from '../src/data/listing';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map(heroes.map((h) => [h.id, h]));

function build(id: string, position: General['position'], extras: string[]): General {
  const rec = byId.get(id);
  const g1 = recordToGeneral(rec);
  const leveled = leveledFromRecord(g1, rec, 40, { strategy: 40 }, 9000);
  const g: General = { ...leveled, position, morale: 100 } as General;
  for (const sid of extras) {
    const slot = mainSkillSlot(sid);
    if (!slot) { console.warn('skip unknown skill', sid); continue; }
    (g as any)[slot] = [...(g as any)[slot], sid];
  }
  return g;
}

const h2 = byId.get('h2');
console.log('h2 mainSkillId =', JSON.stringify(h2.mainSkillId), 'mainSkillName =', h2.mainSkillName);
console.log('isHeroListed(h2) =', isHeroListed(h2));
console.log('registry has luanzheng =', !!SKILL_REGISTRY['luanzheng']);

const red: General[] = [
  build('h2', '大营', ['dashang_sanjun']),
  build('h16', '中军', []),
  build('h479', '前锋', []),
];
const blue: General[] = [
  build('h799', '大营', []),
  build('h790', '中军', []),
  build('h769', '前锋', []),
];
const tally: Record<string, number> = {};
const details: Record<string, string> = {};
let casts = 0;
let ticks = 0;
let multiTarget = 0;
for (let seed = 1; seed <= 40; seed++) {
  const rep = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 } as any);
  const evs = rep.events as any[];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.type === 'dot_tick' && e.skillId === 'luanzheng') ticks++;
    if (e.type !== 'skill_cast' || e.skillId !== 'luanzheng') continue;
    casts++;
    const applied: string[] = [];
    const targets: string[] = [];
    for (let k = i + 1; k < Math.min(i + 6, evs.length); k++) {
      const n = evs[k];
      if (n.type !== 'status_inflicted') break;
      applied.push(n.statusType);
      targets.push(n.unitId);
      tally[n.statusType] = (tally[n.statusType] ?? 0) + 1;
      details[n.statusType] ??= n.detail;
    }
    if (new Set(targets).size > 1) multiTarget++;
  }
}
console.log('casts(40 battles) =', casts);
console.log('independent-target casts (>=2 distinct targets) =', multiTarget);
console.log('status tally per cast application:', tally);
console.log('details:', details);
console.log('dot ticks:', ticks);
