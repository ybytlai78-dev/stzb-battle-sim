import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine/rng';
import { createWallet } from '../../src/rogue/economy';
import { beginPull, claimBonus, drawFive, pickFromPull } from '../../src/rogue/gacha';
import { addHero, createPool } from '../../src/rogue/pool';

const catalogue = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];

describe('五连抽', () => {
  it('抽出 5 张，且都在目录里；同一种子可复现', () => {
    const a = drawFive(new Rng(7), catalogue);
    const b = drawFive(new Rng(7), catalogue);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(a.every((id) => catalogue.includes(id))).toBe(true);
  });

  it('目录只有 1 人时五张可以重复', () => {
    expect(drawFive(new Rng(1), ['only'])).toEqual(['only', 'only', 'only', 'only', 'only']);
  });

  it('付得起就扣 950，并带上尚未公开的爽玩结果', () => {
    const began = beginPull(createWallet(3000), new Rng(3), catalogue);
    expect(began!.wallet.jade).toBe(2050);
    expect(began!.pull.shown).toHaveLength(5);
    expect(began!.pull.picked).toBeNull();
    expect(catalogue).toContain(began!.pull.bonus);
  });

  it('玉符不足不抽，原钱包不变', () => {
    const wallet = createWallet(100);
    expect(beginPull(wallet, new Rng(1), catalogue)).toBeNull();
    expect(wallet.jade).toBe(100);
  });

  it('五选一只能选展示里的；选完才能领爽玩', () => {
    const began = beginPull(createWallet(), new Rng(9), catalogue)!;
    expect(() => pickFromPull(began.pull, 'not-in-pull')).toThrow();
    const picked = pickFromPull(began.pull, began.pull.shown[2]!);
    expect(picked.picked).toBe(began.pull.shown[2]);
    expect(claimBonus(picked)).toBe(began.pull.bonus);
    expect(pickFromPull(picked, picked.picked!)).toBe(picked);
  });

  it('三次五连抽一共入池 6 次获得，玉符剩 150', () => {
    let wallet = createWallet();
    let pool = createPool();
    const rng = new Rng(11);
    for (let i = 0; i < 3; i += 1) {
      const began = beginPull(wallet, rng, catalogue)!;
      wallet = began.wallet;
      const chosen = pickFromPull(began.pull, began.pull.shown[0]!);
      pool = addHero(pool, chosen.picked!).pool;
      pool = addHero(pool, claimBonus(chosen)).pool;
    }
    expect(wallet.jade).toBe(150);
    expect(pool.heroes.reduce((sum, hero) => sum + hero.copies, 0)).toBe(6);
    expect(beginPull(wallet, rng, catalogue)).toBeNull();
  });
});
