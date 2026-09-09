/**
 * CLI 入口：跑一场内置固定测试集战斗，输出文本战报。
 *   npm run dev            → 跑 T1 纯普攻
 *   npm run dev -- T3      → 跑 T3 谋略战法
 *   npm run dev -- --json T5  → 同时输出 JSON 战报到 stdout
 */
import { runBattle } from './engine/combat';
import { reportToText } from './engine/report';
import { buildAllFixtures } from '../tests/fixtures';
import { initHeroDB } from './data/heroes';

async function main() {
  await initHeroDB();
  const ALL_FIXTURES = buildAllFixtures();

  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const key = args.find((a) => !a.startsWith('--')) ?? 'T1_PURE_ATTACK';

  const config = ALL_FIXTURES[key];
  if (!config) {
    console.error(`未知测试集：${key}`);
    console.error(`可用：${Object.keys(ALL_FIXTURES).join(', ')}`);
    process.exit(1);
  }

  const report = runBattle(config);
  console.log(reportToText(report));

  if (wantJson) {
    console.log('\n===== JSON 战报 =====');
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
