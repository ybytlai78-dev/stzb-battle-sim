/**
 * AI 顾问 · 路由可达性审计（内部脚本 `_` 前缀，S4 的静态那一半）
 * ---------------------------------------------------------------------------
 * 回答一个**不含运气**的问题：把评测集的每一条提问，按当前路由规则算一遍——
 *   ① 这条提问进哪一档？
 *   ② 评测判分**期望的工具**在这一档里开放吗？（不开放 = 模型必须先 route_task 一轮）
 *   ③ 「人肉搜索」那条便宜路径（skill_detail / list_skills）**是否仍然开放**？
 *   ④ 首轮锚定对首问的影响：第一个请求里能不能直接调它期望的工具？
 *
 * 它**不调模型、不跑一局战斗**：纯函数 + 评测用例目录，秒级、可复现、可进 CI。
 * 真模型的通过率 / token 对照仍要 `ADVISOR_KEY=… npx tsx scripts/advisor_eval.mts`（另两份加
 * `--no-routing` / `--anchor`）——那份由用户自己跑，额度是他的。
 *
 * 用法：npx tsx scripts/_advisor_route_audit.mts [--json 输出路径]
 */
import fs from 'node:fs';
import { ADVISOR_EVAL_CASES } from '../web/advisor/evalCases';
import { ALL_TIERS, anchorToolNames, classifyTiers, toolNamesFor, wireToolNames } from '../web/advisor/router';
import { createTools } from '../web/advisor/tools';

const all = createTools();
const registry = all.map((t) => t.name);
const CHEAP_PATH = ['skill_detail', 'list_skills'];

interface Row {
  id: string;
  ask: string;
  tiers: string[];
  expected: string[];
  /** 期望工具在「分档」下是否直接可达 */
  reachableTiered: boolean;
  /** 期望工具在「分档 + 首轮锚定」的第一个请求里是否可达 */
  reachableInAnchor: boolean;
  /** 便宜路径（人肉搜索）在这一档里是否仍然开放 */
  cheapPathOpen: boolean;
  /** 期望工具是否要靠 route_task 才开（= 该档工具的档位） */
  needsPromotion: string | null;
}

const rows: Row[] = [];
for (const c of ADVISOR_EVAL_CASES) {
  const tiers = classifyTiers(c.ask);
  const wire = wireToolNames(tiers, false);
  const anchorWire = anchorToolNames();
  // 判分期望：toolsAll 必须全在；toolsAny 至少一个在（两条都算"期望"）
  const allExpect = c.expect.toolsAll ?? [];
  const anyExpect = c.expect.toolsAny ?? [];
  const expected = allExpect.length ? allExpect : anyExpect;
  const hit = (names: string[]): boolean => {
    if (allExpect.length) return allExpect.every((n) => names.includes(n));
    if (anyExpect.length) return anyExpect.some((n) => names.includes(n));
    return true; // 这条用例没在工具面上提要求
  };
  const missing = expected.filter((n) => !wire.includes(n));
  rows.push({
    id: c.id,
    ask: c.ask,
    tiers,
    expected,
    reachableTiered: hit(wire),
    reachableInAnchor: hit(anchorWire),
    cheapPathOpen: CHEAP_PATH.some((n) => wire.includes(n)),
    needsPromotion: missing.length ? (missing.every((n) => ALL_TIERS.some((t) => toolNamesFor([t]).includes(n))) ? 'search' : '?') : null,
  });
}

const pad = (s: string, n: number): string => {
  let w = 0;
  for (const ch of s) w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};
const line = (r: Row): string =>
  `${pad(r.id, 14)} ${pad(r.tiers.join('+'), 14)} ${pad(r.expected.join(',') || '—', 22)} ` +
  `${r.reachableTiered ? '✔' : '✘ 需 route_task'}      ${r.reachableInAnchor ? '✔' : '✘'}        ${r.cheapPathOpen ? '开放' : '—'}`;

console.log('用例'.padEnd(12) + ' 档位' + ' '.repeat(10) + '期望工具' + ' '.repeat(16) + '分档可达        锚定轮可达  便宜路径');
console.log('-'.repeat(110));
for (const r of rows) console.log(line(r));

const unreachable = rows.filter((r) => !r.reachableTiered);
const cheapOpen = rows.filter((r) => r.cheapPathOpen);
const anchorBlocked = rows.filter((r) => !r.reachableInAnchor && r.expected.length);
console.log('\n=== 汇总 ===');
console.log(`用例 ${rows.length} 条`);
console.log(`分档下期望工具不可达（要 route_task 一轮）：${unreachable.length} 条${unreachable.length ? ' → ' + unreachable.map((r) => r.id).join(', ') : ''}`);
console.log(`首轮锚定挡住首问期望工具：${anchorBlocked.length} 条（锚定轮只有 ${anchorToolNames().join(', ')}）`);
console.log(`「人肉搜索」便宜路径（${CHEAP_PATH.join(' / ')}）仍开放的档：${cheapOpen.length ? [...new Set(cheapOpen.map((r) => r.tiers.join('+')))] .join(' / ') : '无'}`);
console.log('注：便宜路径仍开放 = S1 的"撤菜单"挡不住这条退化路（它在 base 档里，而 base 档必须给足）；');
console.log('    真正对它下手的是 S2 的近场引导（"别自己逐个 skill_detail 翻战法"）与 S3 的锚定轮——真模型对照见 §16.13。');

const outIdx = process.argv.indexOf('--json');
if (outIdx >= 0 && process.argv[outIdx + 1]) {
  fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify({ registry, rows }, null, 2), 'utf8');
  console.log(`写入：${process.argv[outIdx + 1]}`);
}
