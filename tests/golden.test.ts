/**
 * golden test：固定测试集 + 固定种子 → 锁定输出 JSON。
 * 首次运行生成 __snapshots__/golden.json，后续运行 diff 比对。
 * 引擎改动导致输出变化 → 测试失败，需人工确认是有意变更。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBattle } from '../src/engine/combat';
import { buildAllFixtures } from './fixtures';
import { initHeroDB } from '../src/data/heroes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, '__snapshots__');
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, 'golden.json');

let ALL_FIXTURES: Record<string, import('../src/engine/types').BattleConfig>;

beforeAll(async () => {
  await initHeroDB();
  ALL_FIXTURES = buildAllFixtures();
});

/** 只保留可复现的确定性字段，忽略 events（事件流已含全部信息，保留便于排查） */
function buildGolden() {
  const suites = Object.entries(ALL_FIXTURES).map(([name, config]) => {
    const report = runBattle(config);
    return {
      name,
      seed: report.seed,
      result: report.result,
      rounds: report.rounds,
      finalMyTroops: report.finalMyTroops,
      finalEnemyTroops: report.finalEnemyTroops,
      eventCount: report.events.length,
      events: report.events,
    };
  });
  return { generatedAt: 'seed-locked', suites };
}

describe('golden test', () => {
  it('固定配置 + 种子输出与快照一致', () => {
    const current = buildGolden();

    if (!existsSync(SNAPSHOT_PATH)) {
      // 首次运行：写入快照
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2), 'utf8');
      expect(true).toBe(true);
      return;
    }

    const stored = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    expect(current).toEqual(stored);
  });

  it('引擎可复现：同配置跑两次结果一致', () => {
    for (const [, config] of Object.entries(ALL_FIXTURES)) {
      const a = runBattle(config);
      const b = runBattle(config);
      expect(a.events).toEqual(b.events);
    }
  });
});
