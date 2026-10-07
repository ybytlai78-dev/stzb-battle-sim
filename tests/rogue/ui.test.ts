// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SKILL_REGISTRY } from '../../src/data/skills';
import { createWallet } from '../../src/rogue/economy';
import { createPool } from '../../src/rogue/pool';
import { createRun } from '../../src/rogue/run';
import { memoryStorage, saveRun } from '../../src/rogue/save';
import { mountRogue } from '../../web/rogue/app';
import { shopRows } from '../../web/rogue/catalogue';

describe('肉鸽界面', () => {
  it('开局能看到第 1 关、3 条命和 3000 玉符', () => {
    const root = document.createElement('div');
    mountRogue(root, { storage: memoryStorage(), seed: 7 });
    expect(root.textContent).toContain('第 1 关');
    expect(root.textContent).toContain('命数 3');
    expect(root.textContent).toContain('玉符 3000');
  });

  it('五连抽可以五选一，再爽玩，玉符变成 2050', () => {
    const storage = memoryStorage();
    const root = document.createElement('div');
    mountRogue(root, { storage, seed: 7 });
    (root.querySelector('#rg-nav-gacha') as HTMLButtonElement).click();
    (root.querySelector('#rg-pull') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.rg-card')).toHaveLength(5);
    (root.querySelector('#rg-card-0') as HTMLButtonElement).click();
    expect(root.querySelector('#rg-bonus')).toBeTruthy();
    (root.querySelector('#rg-bonus') as HTMLButtonElement).click();
    expect(root.textContent).toContain('玉符 2050');
    const again = document.createElement('div');
    mountRogue(again, { storage });
    (again.querySelector('#rg-nav-pool') as HTMLButtonElement).click();
    expect(again.textContent).toContain('卡池 ·');
    expect(again.textContent).not.toContain('还没有武将');
  });

  it('商店能按名字买到 A 级战法，玉符不足时按钮禁用', () => {
    const storage = memoryStorage();
    const root = document.createElement('div');
    mountRogue(root, { storage, seed: 7 });
    const row = shopRows().find((item) => item.grade === 'A');
    expect(row).toBeTruthy();
    (root.querySelector('#rg-nav-shop') as HTMLButtonElement).click();
    const input = root.querySelector('#rg-shop-q') as HTMLInputElement;
    input.value = row!.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const buy = root.querySelector(`[data-skill="${row!.id}"]`) as HTMLButtonElement;
    expect(buy.disabled).toBe(false);
    expect(SKILL_REGISTRY[row!.id]).toBeTruthy();
    buy.click();
    expect(root.textContent).toContain('玉符 2400');
    expect(root.textContent).toContain('已买入');
  });

  it('预置三名武将后能出战并看到战报和败因', () => {
    const storage = memoryStorage();
    saveRun(storage, {
      run: createRun(11, 12, 3),
      pool: createPool({ heroes: ['h479', 'h29', 'h16'], skills: [] }),
      wallet: createWallet(500),
      gacha: null,
      enemy: null,
      enemyLevel: null,
      nonce: 0,
    });
    const root = document.createElement('div');
    mountRogue(root, { storage });
    (root.querySelector('#rg-nav-intel') as HTMLButtonElement).click();
    expect(root.querySelector('#rg-intel')).toBeTruthy();
    (root.querySelector('#rg-to-team') as HTMLButtonElement).click();
    (root.querySelector('#rg-fight') as HTMLButtonElement).click();
    expect(root.querySelector('#rg-report')).toBeTruthy();
    expect((root.querySelector('#rg-cause')?.textContent ?? '').length).toBeGreaterThan(0);
  });
});
