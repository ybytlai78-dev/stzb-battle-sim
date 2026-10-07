import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('玩法层边界', () => {
  it('src/rogue 不碰 DOM、存储介质，也不引用武将表现层', () => {
    const files = readdirSync('src/rogue').filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = readFileSync(`src/rogue/${name}`, 'utf8');
      expect(text, name).not.toMatch(/localStorage/);
      expect(text, name).not.toMatch(/document\./);
      expect(text, name).not.toMatch(/\bwindow\b/);
      expect(text, name).not.toMatch(/web\/heroes/);
    }
  });
});
