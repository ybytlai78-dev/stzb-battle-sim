/**
 * 战斗诊断 CLI（只读）
 * ---------------------------------------------------------------------------
 * 用法：
 *   npx tsx scripts/diagnose.mts <战报.json ...>            # 单场或一批战报文件
 *   npx tsx scripts/diagnose.mts reports/ --json out.json   # 目录递归收集 + 导出结构化诊断
 *   npx tsx scripts/diagnose.mts --fixture T7_LOADOUT --runs 20        # 免文件：内置测试集同队跑批
 *   npx tsx scripts/diagnose.mts --fixture T7_LOADOUT,T8_WU_TRIO_L40 --runs 15   # 跨阵容差异因子
 *
 * 接受的战报 JSON 形状（自动识别）：
 *   - 单个 BattleReport
 *   - BattleReport[]
 *   - BattleRecord[]（Web 战报历史的 `{ report: BattleReport, ... }` 包装）
 *   - { reports: [...] } / { report: ... }
 *
 * 只读保证：本脚本只读战报 JSON 与内置 fixture，调用 `runBattle` 生成输入（fixture 模式），
 * 诊断本身不修改战报、不新增埋点、不参与战斗结算。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBattle } from '../src/engine/combat';
import { buildAllFixtures } from '../tests/fixtures';
import { initHeroDB } from '../src/data/heroes';
import { diagnoseBattle, diagnoseBatch, type BatchEntry, type BattleDiagnosis } from '../src/engine/diagnosis';
import { batchDiagnosisToText, diagnosisToText } from '../src/engine/diagnosisReport';
import type { BattleReport } from '../src/engine/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const jsonOut = argValue('--json');
const dumpDir = argValue('--dump-reports');
const fixtureArg = argValue('--fixture');
const runs = Number(argValue('--runs') ?? '1');
const quiet = argv.includes('--quiet');
const files = argv.filter(
  (a) => !a.startsWith('--') && a !== jsonOut && a !== fixtureArg && a !== dumpDir && a !== String(runs)
);

function isReport(x: unknown): x is BattleReport {
  return !!x && typeof x === 'object' && Array.isArray((x as BattleReport).events);
}

/** 把任意导出形状归一成 BattleReport[] */
function collect(value: unknown, sink: { report: BattleReport; label?: string }[], source: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collect(v, sink, `${source}#${i + 1}`));
    return;
  }
  if (isReport(value)) {
    sink.push({ report: value, label: `${source} · seed ${value.seed}` });
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as { report?: unknown; reports?: unknown };
    if (obj.report) return collect(obj.report, sink, source);
    if (Array.isArray(obj.reports)) return obj.reports.forEach((v, i) => collect(v, sink, `${source}#${i + 1}`));
  }
  throw new Error(`${source}: 不是可识别的战报 JSON（需要 BattleReport / BattleReport[] / BattleRecord[] / {reports}）`);
}

function walk(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
}

async function main(): Promise<void> {
  const entries: BatchEntry[] = [];

  if (fixtureArg) {
    await initHeroDB();
    const fixtures = buildAllFixtures();
    const keys = fixtureArg.split(',').map((s) => s.trim()).filter(Boolean);
    for (const key of keys) {
      const cfg = fixtures[key];
      if (!cfg) {
        console.error(`未知测试集：${key}\n可用：${Object.keys(fixtures).join(', ')}`);
        process.exit(1);
      }
      for (let i = 0; i < Math.max(1, runs); i++) {
        // 同队多次模拟：每次换种子（与 Web「开始模拟」同口径：系统内部生成种子）
        const report = runBattle({ ...cfg, seed: (cfg.seed ?? 1) + i * 7919 });
        entries.push({ report, label: `${key} #${i + 1} (seed ${report.seed})` });
      }
    }
  } else {
    const paths: string[] = [];
    for (const f of files) {
      const abs = path.isAbsolute(f) ? f : path.resolve(ROOT, f);
      if (!fs.existsSync(abs)) {
        console.error(`文件不存在：${f}`);
        process.exit(1);
      }
      if (fs.statSync(abs).isDirectory()) walk(abs, paths);
      else paths.push(abs);
    }
    if (paths.length === 0) {
      console.error(
        '用法：npx tsx scripts/diagnose.mts <战报.json ...> [--json out.json] [--quiet]\n' +
          '      npx tsx scripts/diagnose.mts --fixture T7_LOADOUT --runs 20 [--json out.json]'
      );
      process.exit(1);
    }
    for (const p of paths) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
      collect(raw, entries, path.relative(ROOT, p));
    }
  }

  if (entries.length === 0) {
    console.error('没有可诊断的战报');
    process.exit(1);
  }

  // 可选：把原始战报落盘（供「文件/目录」模式复用，或给别人诊断）
  if (dumpDir) {
    const dir = path.isAbsolute(dumpDir) ? dumpDir : path.resolve(ROOT, dumpDir);
    fs.mkdirSync(dir, { recursive: true });
    entries.forEach((e, i) => {
      const file = path.join(dir, `report-${String(i + 1).padStart(3, '0')}-seed${e.report.seed}.json`);
      fs.writeFileSync(file, JSON.stringify(e.report, null, 2), 'utf8');
    });
    console.log(`已导出 ${entries.length} 份原始战报 → ${path.relative(ROOT, dir)}/`);
  }

  let payload: unknown;
  let text: string;
  if (entries.length === 1) {
    const d = diagnoseBattle(entries[0].report, { label: entries[0].label });
    text = diagnosisToText(d);
    payload = d;
  } else {
    const b = diagnoseBatch(entries);
    text = batchDiagnosisToText(b);
    payload = { batch: b, reports: entries.map((e, i) => diagnoseBattle(e.report, { label: e.label ?? `#${i + 1}` })) };
  }

  if (!quiet) console.log(text);
  if (jsonOut) {
    const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.resolve(ROOT, jsonOut);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\n结构化诊断已写入：${path.relative(ROOT, outPath)}`);
  }

  // 单场诊断也给一个退出码信号：存在 high 病灶 → 1（便于批量脚本筛）
  if (entries.length === 1) {
    const d = payload as BattleDiagnosis;
    if (d.issues.some((i) => i.severity === 'high')) process.exitCode = 0; // 诊断本身不算失败，仅输出
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
