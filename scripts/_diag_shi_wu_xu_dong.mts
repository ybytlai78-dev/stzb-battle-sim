/** 势无虚动消耗口径端到端取证：黄盖带【势无虚动】(被动) + 烈火焚舟(追击) 跑真局，
 *  统计「下一次造成的伤害提高 N%」各档次数 —— 修好后应只有 40%，不出现 80%/120%。 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { leveledFromRecord, recordToGeneral } from '../src/data/hero-utils';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8'));
const byId = new Map<string, any>(heroes.map((h: any) => [h.id, h]));
const mk = (id: string, pos: any, opts: { extraPassive?: string[]; bare?: boolean } = {}) => {
  const rec = byId.get(id)!;
  const base = leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000);
  const g: any = { ...base, position: pos };
  if (opts.bare) {
    g.mainSkillId = ''; g.activeSkillIds = []; g.passiveSkillIds = []; g.commandSkillIds = []; g.pursuitSkillIds = [];
  }
  if (opts.extraPassive) g.passiveSkillIds = [...(g.passiveSkillIds ?? []), ...opts.extraPassive];
  return g;
};

const rounds = 8;
const seeds = [1001, 1002, 1003, 1004, 1005];
const tally: Record<string, number> = {};
let battles = 0;
for (const seed of seeds) {
  const r = runBattle({
    seed,
    maxRounds: rounds,
    myTeam: [mk('h783', '前锋', { extraPassive: ['shiwu_xudong'] }), mk('h799', '中军', { bare: true }), mk('h807', '大营', { bare: true })],
    enemyTeam: [mk('h16', '前锋'), mk('h24', '中军', { bare: true }), mk('h23', '大营', { bare: true })],
  } as any);
  battles++;
  for (const e of r.events as any[]) {
    if (e.type === 'status_inflicted' && e.statusType === 'damage_boost' && /下一次造成的伤害提高/.test(e.detail ?? '')) {
      tally[e.detail] = (tally[e.detail] ?? 0) + 1;
    }
  }
}
console.log(`局数 ${battles}`);
console.log('「下一次造成的伤害提高 N%」分布：', tally);
const bad = Object.keys(tally).filter((k) => !/提高 40%$/.test(k));
console.log(bad.length === 0 ? 'PASS：只有 40%（每次追击发动后即清空）' : `FAIL：出现未清空档位 ${bad.join(' / ')}`);

// 附带：烈火焚舟挂上的燃烧倍率（势无虚动每层 40% 曾把它从 210% 抬到 268%/…）
const burns: Record<string, number> = {};
for (const seed of seeds) {
  const r = runBattle({
    seed,
    maxRounds: rounds,
    myTeam: [mk('h783', '前锋', { extraPassive: ['shiwu_xudong'] }), mk('h799', '中军', { bare: true }), mk('h807', '大营', { bare: true })],
    enemyTeam: [mk('h16', '前锋'), mk('h24', '中军', { bare: true }), mk('h23', '大营', { bare: true })],
  } as any);
  for (const e of r.events as any[]) {
    if (e.type === 'status_inflicted' && e.statusType === 'burning' && /燃烧/.test(e.detail ?? '')) {
      burns[e.detail] = (burns[e.detail] ?? 0) + 1;
    }
  }
}
console.log('烈火焚舟燃烧倍率：', burns);
