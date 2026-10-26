/**
 * 端到端取证（2026-10-25）：谋略 DoT 的「策略战法」认定 + 其徐如林〈诛杀〉
 *
 * 用户三条报障里可端到端取证的 ①③：
 *   ① 纯 DoT 战法（庞统【密谋定蜀】只有 inflict_status、没有 strategy_damage 段）不算
 *      「造成策略伤害的战法」→ 宝物词条【筹算】（`strategySkillsOnly` + `mainSkillOnly` 的
 *      `trigger_boost`）整条被跳过，发动率停在 35%；
 *   ③ 谋略 DoT 跳伤不触发晋·司马懿【其徐如林】的相邻〈诛杀〉（机制码 546）。
 *
 * 阵容（双方各 3 人，40 级 / 9000 兵）：
 *   我方 大营 庞统 h477（【密谋定蜀】，A 组另戴 1042 旌阳万仞 + 锻造词条【筹算】15%）
 *        中军 晋·司马懿 h807（【其徐如林】，一类指挥）
 *        前锋 裸将
 *   敌方 三名裸将（只留普攻）
 *
 * 断言（每个种子）：
 *   A1 带【筹算】：【密谋定蜀】的 skill_trigger 出现 baseRate = 50（35 + 15）
 *   A2 不带【筹算】：只出现 35 —— 守「这条口径没有被放宽」
 *   B  只要出现庞统施法的谋略 DoT 跳伤，其徐如林的〈诛杀〉条数必须 > 0，且 ≥ 跳伤条数
 *      （每次跳伤对所有相邻敌军各一条）
 *   B3 全场**策略伤害的来源战法只有【其徐如林】**—— 这套阵容里没有任何 strategy_damage 输出
 *      （庞统只放 DoT / 减伤 / 增伤，司马懿只挂光环，第三人与敌方都是裸将），
 *      所以诛杀条数**只可能**由谋略 DoT 跳伤触发；这是本取证最硬的一环。
 *
 * 用法：npx tsx scripts/_probe_dot_strategy.mts [局数]
 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

const RUNS = Number(process.argv[2] ?? 20);

interface SideSpec {
  pangTongWithTreasure: boolean;
}

function buildTeam(spec: SideSpec): General[] {
  const mk = (id: string, position: General['position']): General => {
    const rec = byId.get(id);
    if (!rec) throw new Error('hero not found: ' + id);
    return { ...leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000), position, morale: 100 } as General;
  };
  const pangtong = mk('h477', '大营');
  pangtong.mainSkillId = 'mimou_dingshu';
  pangtong.activeSkillIds = ['mimou_dingshu'];
  pangtong.passiveSkillIds = [];
  pangtong.pursuitSkillIds = [];
  pangtong.commandSkillIds = [];
  if (spec.pangTongWithTreasure) {
    pangtong.treasure = { treasureId: 1042, level: 10, affix: { name: '筹算', value: 15 } };
  }

  const sima = mk('h807', '中军');
  sima.mainSkillId = 'qixu_rulin';
  sima.activeSkillIds = [];
  sima.passiveSkillIds = [];
  sima.pursuitSkillIds = [];
  sima.commandSkillIds = ['qixu_rulin'];

  const filler = mk('h24', '前锋');
  filler.activeSkillIds = [];
  filler.passiveSkillIds = [];
  filler.pursuitSkillIds = [];
  filler.commandSkillIds = [];
  delete filler.mainSkillId;

  return [pangtong, sima, filler];
}

function buildEnemies(): General[] {
  return (['h23', 'h790', 'h769'] as const).map((id, i) => {
    const rec = byId.get(id);
    if (!rec) throw new Error('hero not found: ' + id);
    const g = {
      ...leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000),
      position: (['大营', '中军', '前锋'] as const)[i],
      morale: 100,
    } as General;
    g.activeSkillIds = [];
    g.passiveSkillIds = [];
    g.pursuitSkillIds = [];
    g.commandSkillIds = [];
    delete g.mainSkillId;
    return g;
  });
}

interface Tally {
  dotTicks: number;
  zhusha: number;
  baseRates: Set<number>;
  zhushaSamples: string[];
  /** 全场「策略伤害」事件的来源战法 id 集合（B3） */
  strategySkillIds: Set<string>;
}

function runOne(withTreasure: boolean, seed: number): Tally {
  const myTeam = buildTeam({ pangTongWithTreasure: withTreasure });
  const enemyTeam = buildEnemies();
  const pangTongId = myTeam[0].id;
  const report = runBattle({ myTeam, enemyTeam, seed, maxRounds: 8 });
  const t: Tally = { dotTicks: 0, zhusha: 0, baseRates: new Set(), zhushaSamples: [], strategySkillIds: new Set() };
  for (const ev of report.events as any[]) {
    if (ev.type === 'dot_tick' && (ev.casterId ?? ev.sourceId) === pangTongId) t.dotTicks += 1;
    if (ev.type === 'skill_trigger' && ev.skillId === 'mimou_dingshu' && typeof ev.baseRate === 'number') {
      t.baseRates.add(ev.baseRate);
    }
    if (ev.type === 'damage' && ev.damageType === 'strategy') t.strategySkillIds.add(String(ev.skillId));
    if (ev.type === 'damage' && ev.skillId === 'qixu_rulin' && ev.subSkill === '诛杀') {
      t.zhusha += 1;
      if (t.zhushaSamples.length < 2) {
        t.zhushaSamples.push(`第${ev.round ?? '?'}回合 ${ev.unitId ?? ev.targetId ?? '?'} -${ev.damage}`);
      }
    }
  }
  return t;
}

const withT: Tally = { dotTicks: 0, zhusha: 0, baseRates: new Set(), zhushaSamples: [], strategySkillIds: new Set() };
const withoutT: Tally = { dotTicks: 0, zhusha: 0, baseRates: new Set(), zhushaSamples: [], strategySkillIds: new Set() };
for (let i = 0; i < RUNS; i += 1) {
  const seed = 1001 + i;
  const a = runOne(true, seed);
  const b = runOne(false, seed);
  withT.dotTicks += a.dotTicks;
  withT.zhusha += a.zhusha;
  a.baseRates.forEach((r) => withT.baseRates.add(r));
  a.strategySkillIds.forEach((s) => withT.strategySkillIds.add(s));
  if (withT.zhushaSamples.length === 0) withT.zhushaSamples = a.zhushaSamples;
  withoutT.dotTicks += b.dotTicks;
  withoutT.zhusha += b.zhusha;
  b.baseRates.forEach((r) => withoutT.baseRates.add(r));
  b.strategySkillIds.forEach((s) => withoutT.strategySkillIds.add(s));
}

const line = (label: string, t: Tally): string =>
  `${label}｜DoT 跳伤 ${t.dotTicks} 次｜〈诛杀〉${t.zhusha} 条｜密谋定蜀基础发动率 ${
    [...t.baseRates].sort((x, y) => x - y).join('/') || '—'
  }%｜策略伤害来源 ${[...t.strategySkillIds].join(',') || '—'}`;

console.log(line('A 带【筹算】', withT));
console.log(line('B 不带宝物', withoutT));

const onlyAura = (t: Tally): boolean =>
  t.strategySkillIds.size > 0 && [...t.strategySkillIds].every((s) => s === 'qixu_rulin');

const checks: [string, boolean, string][] = [
  ['A1 带筹算时基础发动率提到 50', withT.baseRates.has(50), `实际 ${[...withT.baseRates].join('/')}`],
  ['A2 不带筹算仍是 35（口径未放宽）', !withoutT.baseRates.has(50) && withoutT.baseRates.has(35), `实际 ${[...withoutT.baseRates].join('/')}`],
  ['B1 谋略 DoT 跳伤触发了〈诛杀〉', withT.dotTicks > 0 && withT.zhusha > 0, `跳伤 ${withT.dotTicks} / 诛杀 ${withT.zhusha}`],
  ['B2 诛杀条数 ≥ 跳伤条数（每次跳伤至少 1 条）', withT.zhusha >= withT.dotTicks, `${withT.zhusha} vs ${withT.dotTicks}`],
  ['B3 全场策略伤害只来自其徐如林（无 strategy_damage 直伤）', onlyAura(withT) && onlyAura(withoutT), [...withT.strategySkillIds].join(',')],
];

let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}（${detail}）`);
}
if (withT.zhushaSamples.length) console.log('诛杀样例：' + withT.zhushaSamples.join('；'));
process.exit(failed === 0 ? 0 : 1);
