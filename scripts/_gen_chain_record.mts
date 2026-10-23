/**
 * 生成一条**真实引擎跑出来**的战报记录（含连环计 / 河内世泽 子战法标注 + 其徐如林〈诛杀〉），
 * 供网页截图脚本 `scripts/_shot_chain_labels.mjs` 使用。
 * 用法：npx tsx scripts/_gen_chain_record.mts [输出路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { runBattle } from '../src/engine/combat';
import { initHeroDB } from '../src/data/heroes';
import { buildGeneral } from '../web/heroes';

const out = process.argv[2] ?? 'docs/逆向对拍/baseline/chain_record.json';
await initHeroDB();

const myTeam = [
  // 王允：主战法【连环计】（chainSkills：伐谋 → 迷阵 → 落雷）
  buildGeneral('h693', ['heneishize'], { strategy: 40 }, '中军', 0, 40, 120),
  // 晋·司马懿：主战法【其徐如林】（相邻跳伤 = 诛杀）
  buildGeneral('h807', ['bishi_jixu'], { strategy: 40 }, '大营', 0, 40, 120),
  buildGeneral('h841', ['shengqi_lingran'], {}, '前锋', 0, 40, 120),
];
const enemyTeam = [
  buildGeneral('h815', [], {}, '前锋', 0, 40, 120),
  buildGeneral('h34', [], {}, '中军', 0, 40, 120),
  buildGeneral('h634', [], {}, '大营', 0, 40, 120),
];

console.log(
  '我方主战法:',
  myTeam.map((g) => `${g.name}(${g.id})=${g.mainSkillName}`).join(' / ')
);

type Ev = { type: string; skillId?: string; subSkill?: string };
const subsOf = (events: unknown[], skillId: string) =>
  new Set(
    (events as Ev[])
      .filter((e) => e.type === 'damage' && e.skillId === skillId && e.subSkill)
      .map((e) => e.subSkill as string)
  );

let picked: { report: ReturnType<typeof runBattle>; seed: number } | null = null;
let best: { report: ReturnType<typeof runBattle>; seed: number; score: number } | null = null;
for (let i = 0; i < 60; i++) {
  const seed = 7000 + i;
  const report = runBattle({ myTeam, enemyTeam, seed, maxRounds: 8 });
  const lh = subsOf(report.events, 'lianhuanji');
  const hs = subsOf(report.events, 'heneishize');
  const zs = subsOf(report.events, 'qixu_rulin');
  const score = (lh.size > 0 ? 2 : 0) + (hs.size > 0 ? 2 : 0) + (zs.has('诛杀') ? 3 : 0);
  if (!best || score > best.score) best = { report, seed, score };
  if (lh.size >= 2 && hs.size >= 1 && zs.has('诛杀') && (report.events as unknown[]).length > 40) {
    picked = { report, seed };
    break;
  }
}
picked ??= best!;

const record = {
  id: 'demo_chain',
  ts: Date.now(),
  label: '连环计 / 河内世泽 子战法 + 其徐如林〈诛杀〉',
  result: picked.report.result,
  rounds: picked.report.rounds,
  seed: picked.seed,
  myTeam: myTeam.map((g) => g.name),
  enemyTeam: enemyTeam.map((g) => g.name),
  report: picked.report,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(record));
console.log(
  '样本 seed',
  picked.seed,
  '事件',
  (picked.report.events as unknown[]).length,
  '| 连环计子战法',
  [...subsOf(picked.report.events, 'lianhuanji')],
  '| 河内世泽子战法',
  [...subsOf(picked.report.events, 'heneishize')],
  '| 其徐如林',
  [...subsOf(picked.report.events, 'qixu_rulin')]
);
console.log('写入', out, fs.statSync(out).size, 'B');
