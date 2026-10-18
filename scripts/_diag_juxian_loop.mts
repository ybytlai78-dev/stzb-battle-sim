/**
 * 取证（2026-10-18）：汉荀彧【举贤决机】× 沮授【缓师徐持】× 刘备【皇裔流离】的「套环」风险
 *
 * 问题（用户 m00631）：包内对汉荀彧有没有防套环设计？汉荀彧 + 沮授 的组合会不会反复触发、
 * 以及反复触发刘备的回复？
 *
 * 链路：
 *   ① 沮授（一类指挥 onHurt，已行动的敌军受伤后 50%×士气、判两次）→ 目标四维各 -20（可叠加）
 *   ② 每条属性下降状态施加时 → 汉荀彧【举贤决机】onAttrChange（敌军下降，40%）→ 一次策略伤害
 *   ③ 该次伤害 → 沮授 onHurt 会不会再触发？→ 刘备【皇裔流离】会不会再判恢复？
 *
 * 用法：
 *   npx tsx scripts/_diag_juxian_loop.mts            # 20 局
 *   npx tsx scripts/_diag_juxian_loop.mts 50         # 50 局
 *   npx tsx scripts/_diag_juxian_loop.mts dump 1     # 打印第 1 局相关战报行
 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { renderEventLines } from '../src/engine/report';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

function make(id: string, position: General['position'], opts: { bare?: boolean; speed?: number } = {}): General {
  const rec = byId.get(id);
  if (!rec) throw new Error('hero not found: ' + id);
  const base = leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000);
  const g: General = { ...base, position } as General;
  if (opts.bare) {
    g.mainSkillId = '';
    g.mainSkillName = '';
    g.activeSkillIds = [];
    g.passiveSkillIds = [];
    g.commandSkillIds = [];
    g.pursuitSkillIds = [];
  }
  if (opts.speed != null) g.speed = opts.speed;
  return g;
}

/** 敌方木桩：三个裸将、速度拉高（先行动 → 满足沮授「已行动的敌军受到伤害后」） */
function dummyTeam(): General[] {
  return [
    make('h23', '大营', { bare: true, speed: 200 }),
    make('h24', '中军', { bare: true, speed: 190 }),
    make('h799', '前锋', { bare: true, speed: 180 }),
  ];
}

const ENEMY_LIUBEI = process.argv[3] === 'enemy-liubei';

function myTeam(withJuxian: boolean): General[] {
  return [
    make('h794', '大营', { bare: !withJuxian }), // 汉荀彧（举贤决机）
    make('h771', '中军'), // 沮授（缓师徐持）
    make('h799', '前锋', { bare: true }),
  ];
}

/** 敌方：刘备（皇裔流离）在敌方时，我方举贤的每次策略伤害都会去掷一次他的恢复 */
function enemyTeam(): General[] {
  if (!ENEMY_LIUBEI) return dummyTeam();
  return [
    make('h16', '大营', { speed: 210 }), // 刘备（皇裔流离）
    make('h24', '中军', { bare: true, speed: 190 }),
    make('h23', '前锋', { bare: true, speed: 180 }),
  ];
}

interface Stat {
  juxianTrig: number; // 举贤决机判定次数
  juxianHit: number; // 判定成功次数
  juxianDmg: number; // 其策略伤害次数
  juxianDmgTotal: number;
  huanshiTrig: number; // 缓师徐持逐次判定
  huanshiHit: number;
  attrDown: number; // 四维下降状态施加条数
  healCount: number; // 刘备恢复次数
  healAmount: number;
  rounds: number;
}

function count(withJuxian: boolean, seed: number): Stat {
  const report = runBattle({
    myTeam: myTeam(withJuxian),
    enemyTeam: enemyTeam(),
    seed,
    maxRounds: 8,
  });
  const ev = report.events as any[];
  const st: Stat = {
    juxianTrig: 0,
    juxianHit: 0,
    juxianDmg: 0,
    juxianDmgTotal: 0,
    huanshiTrig: 0,
    huanshiHit: 0,
    attrDown: 0,
    healCount: 0,
    healAmount: 0,
    rounds: 0,
  };
  for (const e of ev) {
    if (e.type === 'round_start') st.rounds = Math.max(st.rounds, e.round ?? 0);
    if (e.type === 'skill_trigger' && e.skillId === 'juxian_jueji') {
      st.juxianTrig++;
      if (e.success) st.juxianHit++;
    }
    if (e.type === 'skill_trigger' && e.skillId === 'huanshi_xuchi') {
      st.huanshiTrig++;
      if (e.success) st.huanshiHit++;
    }
    if (e.type === 'damage' && e.skillId === 'juxian_jueji') {
      st.juxianDmg++;
      st.juxianDmgTotal += (e as any).damage ?? 0;
    }
    if (e.type === 'heal' && e.skillId === 'huangyi_liuli') {
      st.healCount++;
      st.healAmount += (e as any).amount ?? 0;
    }
    if (
      e.type === 'status_inflicted' &&
      ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'].includes(e.statusType) &&
      /降低/.test(e.detail ?? '')
    ) {
      st.attrDown++;
    }
  }
  return st;
}

function avg(list: number[]): number {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
}

const args = process.argv.slice(2);
const dumpIdx = args[0] === 'dump' ? Number(args[1] ?? 1) : null;
const runs = dumpIdx != null ? 1 : Number(args[0] ?? 20);

const rows: Array<{ withJuxian: boolean; st: Stat }> = [];
for (let i = 0; i < runs; i++) {
  const seed = 7000 + i;
  rows.push({ withJuxian: true, st: count(true, seed) });
  rows.push({ withJuxian: false, st: count(false, seed) });
}

for (const withJuxian of [true, false]) {
  const sel = rows.filter((r) => r.withJuxian === withJuxian).map((r) => r.st);
  const tag = withJuxian ? '带汉荀彧' : '无汉荀彧';
  console.log(
    `${tag}  举贤判定 ${avg(sel.map((s) => s.juxianTrig)).toFixed(1)} 次 / 命中 ${avg(sel.map((s) => s.juxianHit)).toFixed(1)}` +
      ` / 伤害 ${avg(sel.map((s) => s.juxianDmg)).toFixed(1)} 段 (合计 ${avg(sel.map((s) => s.juxianDmgTotal)).toFixed(0)})` +
      ` ｜ 缓师判定 ${avg(sel.map((s) => s.huanshiTrig)).toFixed(1)} 命中 ${avg(sel.map((s) => s.huanshiHit)).toFixed(1)}` +
      ` ｜ 属性下降 ${avg(sel.map((s) => s.attrDown)).toFixed(1)} 条` +
      ` ｜ 刘备(皇裔)恢复 ${avg(sel.map((s) => s.healCount)).toFixed(1)} 次 / ${avg(sel.map((s) => s.healAmount)).toFixed(0)} 兵力`
  );
}

if (dumpIdx != null) {
  const report = runBattle({ myTeam: myTeam(true), enemyTeam: enemyTeam(), seed: 7000, maxRounds: 8 });
  const lines = renderEventLines(report);
  const keep = lines.filter((l) => /举贤决机|缓师徐持|皇裔流离|降低|恢复|策略攻击/.test(l));
  console.log(keep.join('\n'));
}
