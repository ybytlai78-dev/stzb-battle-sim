/**
 * 渲染覆盖守卫：`BattleEvent` 联合里每新增一种事件，必须在两个渲染器里各有一个 `case`：
 *   - `web/battleView.ts`（网页详细战报）
 *   - `src/engine/report.ts`（CLI 文本 / JSON 战报）
 * 或者列入下面的「静默白名单」（只作分组标记、不需要独立行的事件）。
 *
 * 背景（都曾真实漏渲染过，表现为「机制发生了但战报上一行都没有」）：
 *   - `share_damage`（伤害分摊，言出必克 / 雅虑适时）—— 只看到被分摊者挨打与分摊者的恢复，看不出谁替谁挨了多少；
 *   - `cowardice_immune_blocked`（怯战免疫）、`command_immune_blocked`、`status_resisted`、`seal_settle`。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 只作分组/边界标记、不需要独立渲染行的事件（新增事件若要放进这里，请写清理由） */
const SILENT = new Set([
  'battle_start', 'preparation_end', 'prep_phase', 'formation_bonus',
  'round_start', 'round_end', 'unit_act_end', 'battle_end',
]);

/** 取 BattleEvent 联合里出现的事件类型（从 `export type BattleEvent` 到下一个顶层声明） */
function battleEventTypes(): string[] {
  const lines = readFileSync(join(ROOT, 'src/engine/types.ts'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('export type BattleEvent'));
  expect(start, '找不到 export type BattleEvent').toBeGreaterThan(-1);
  let end = start + 1;
  while (end < lines.length && !/^(export |\/\*\*)/.test(lines[end])) end++;
  const body = lines.slice(start, end).join('\n');
  return [...new Set([...body.matchAll(/type:\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort();
}

/** 取某渲染器里 `case 'x':` 覆盖的事件类型 */
function renderedTypes(relPath: string): Set<string> {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  return new Set([...src.matchAll(/case\s+'([a-z_]+)':/g)].map((m) => m[1]));
}

describe('战报渲染覆盖（BattleEvent ←→ 两个渲染器）', () => {
  const types = battleEventTypes();
  const targets = [
    ['web/battleView.ts', renderedTypes('web/battleView.ts')],
    ['src/engine/report.ts', renderedTypes('src/engine/report.ts')],
  ] as const;

  it('事件类型解析成功（防解析器静默失效）', () => {
    expect(types.length).toBeGreaterThan(30);
    expect(types).toContain('share_damage');
  });

  for (const [file, handled] of targets) {
    it(`${file} 覆盖全部事件类型（或列入静默白名单）`, () => {
      const missing = types.filter((t) => !handled.has(t) && !SILENT.has(t));
      expect(missing, `这些事件在 ${file} 里没有渲染行（漏渲染 → 战报上看不到该机制）`).toEqual([]);
    });
  }
});
