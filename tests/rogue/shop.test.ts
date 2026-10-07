import { describe, expect, it } from 'vitest';
import { createWallet } from '../../src/rogue/economy';
import { createPool } from '../../src/rogue/pool';
import { buySkill, shopListings } from '../../src/rogue/shop';

const catalogue = [
  { skillId: 'b1', grade: 'B' },
  { skillId: 'a1', grade: 'A' },
  { skillId: 's1', grade: 'S' },
];

describe('商店', () => {
  it('只上架未拥有的 A/S，B 级不卖', () => {
    const list = shopListings(['a1'], catalogue);
    expect(list.map((row) => row.skillId)).toEqual(['s1']);
    expect(list[0]!.price).toBe(1200);
  });

  it('买得起就入包并扣费，已拥有、买不起、不在售都不改原对象', () => {
    const wallet = createWallet(1000);
    const pool = createPool();
    const bought = buySkill(wallet, pool, 'a1', catalogue);
    expect(bought.ok).toBe(true);
    if (bought.ok) {
      expect(bought.wallet.jade).toBe(400);
      expect(bought.pool.skills).toEqual(['a1']);
    }
    expect(wallet.jade).toBe(1000);
    expect(pool.skills).toEqual([]);
    expect(buySkill(createWallet(100), pool, 's1', catalogue)).toEqual({ ok: false, reason: 'broke' });
    expect(buySkill(wallet, createPool({ skills: ['a1'] }), 'a1', catalogue)).toEqual({ ok: false, reason: 'owned' });
    expect(buySkill(wallet, pool, 'b1', catalogue)).toEqual({ ok: false, reason: 'not_for_sale' });
  });
});
