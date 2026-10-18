/**
 * 端到端取证（2026-10-18）：知己知彼「敌军侧只应是**受到**伤害提高」
 *
 * 用户报障：「知己知彼对敌方也有增伤效果，目标选取对方是使敌方受到伤害提高，不是给敌方增伤」
 *
 * 构造：双方各 3 名**裸将**（清空全部战法，只留普攻），我方 3 人各带【知己知彼】（一类指挥 prep）。
 * 于是本局里出现的「伤害提高」状态**只可能来自知己知彼**，可以干净地按阵营归因。
 *
 * 断言（每个种子都要成立）：
 *   A. 敌方单位身上**没有**任何「造成的…伤害提高」（caused）—— 这是本次修复点；
 *   B. 我方单位身上**有**「造成的…伤害提高」（caused）—— 修复不能误伤我军侧的叠层跟踪；
 *   C. 敌方单位身上**有**「受到的…伤害提高」（taken）—— 官方口径「使其受到该类型伤害提升」照常生效。
 *
 * 用法：npx tsx scripts/_diag_zhiji_zhibi.mts [局数]
 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

/** 裸将：面板按 40 级 / 9000 兵生成，战法全部清空（可选只挂知己知彼） */
function bare(id: string, position: General['position'], withZhiji: boolean): General {
  const rec = byId.get(id);
  if (!rec) throw new Error('hero not found: ' + id);
  const base = leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000);
  return {
    ...base,
    position,
    morale: 120,
    activeSkillIds: [],
    passiveSkillIds: [],
    pursuitSkillIds: [],
    commandSkillIds: withZhiji ? ['zhiji_zhibi'] : [],
  } as General;
}

const red: General[] = [
  bare('h799', '大营', true),
  bare('h790', '中军', true),
  bare('h769', '前锋', true),
];
const blue: General[] = [
  bare('h24', '大营', false),
  bare('h807', '中军', false),
  bare('h23', '前锋', false),
];

const redIds = new Set(red.map((g) => g.id));
const blueIds = new Set(blue.map((g) => g.id));

interface Tally {
  enemyCaused: number; // 敌方获得「造成的…提高」← 报障症状，必须为 0
  myCaused: number; // 我方获得「造成的…提高」← 跟踪层正常叠
  enemyTaken: number; // 敌方获得「受到的…提高」← 官方口径
  enemyCausedSamples: string[];
}

function tallyOf(seed: number): Tally {
  const report = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 });
  const t: Tally = { enemyCaused: 0, myCaused: 0, enemyTaken: 0, enemyCausedSamples: [] };
  for (const ev of report.events as any[]) {
    if (ev.type !== 'status_inflicted') continue;
    const detail = String(ev.detail ?? '');
    if (!detail.includes('伤害提高')) continue;
    const onEnemy = blueIds.has(ev.unitId);
    const onMine = redIds.has(ev.unitId);
    if (!onEnemy && !onMine) continue;
    if (detail.includes('造成的')) {
      if (onEnemy) {
        t.enemyCaused += 1;
        if (t.enemyCausedSamples.length < 3) t.enemyCausedSamples.push(detail);
      } else t.myCaused += 1;
    } else if (detail.includes('受到的') && onEnemy) t.enemyTaken += 1;
  }
  return t;
}

const runs = Number(process.argv[2] ?? 12);
let bad = 0;
for (let seed = 1; seed <= runs; seed++) {
  const t = tallyOf(seed);
  const ok = t.enemyCaused === 0 && t.myCaused > 0 && t.enemyTaken > 0;
  if (!ok) bad += 1;
  console.log(
    `seed ${String(seed).padStart(3)} · 我方「造成的」${String(t.myCaused).padStart(3)} 条` +
      ` · 敌方「受到的」${String(t.enemyTaken).padStart(3)} 条` +
      ` · 敌方「造成的」${String(t.enemyCaused).padStart(3)} 条` +
      `  ${ok ? 'OK' : 'FAIL ' + t.enemyCausedSamples.join(' | ')}`
  );
}

console.log(
  bad === 0
    ? `\nPASS：${runs}/${runs} 局 —— 敌方从不出「造成的伤害提高」，我方照常叠层、敌方照常吃「受到的伤害提高」`
    : `\nFAIL：${bad}/${runs} 局不满足口径`
);
process.exit(bad === 0 ? 0 : 1);
