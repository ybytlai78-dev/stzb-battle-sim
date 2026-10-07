import { describe, expect, it } from 'vitest';
import { createRun } from '../../src/rogue/run';
import { createPool } from '../../src/rogue/pool';
import { createWallet } from '../../src/rogue/economy';
import { SAVE_KEY, loadRun, memoryStorage, saveRun } from '../../src/rogue/save';
import { beginPull } from '../../src/rogue/gacha';
import { Rng } from '../../src/engine/rng';

const sample = () => ({
  run: createRun(7),
  pool: createPool({ heroes: ['h479'], skills: ['tiebi'] }),
  wallet: createWallet(),
  gacha: null,
  enemy: null,
  enemyLevel: null,
  nonce: 0,
});

describe('存档', () => {
  it('写入后能读回', () => {
    const storage = memoryStorage();
    const data = sample();
    const pull = beginPull(data.wallet, new Rng(1), ['h479', 'h29', 'h16'])!;
    data.wallet = pull.wallet;
    data.gacha = pull.pull;
    data.nonce = 1;
    saveRun(storage, data);
    expect(loadRun(storage)).toEqual(data);
  });

  it('没有存档、坏 JSON、版本不对、缺字段都是 null', () => {
    expect(loadRun(memoryStorage())).toBeNull();
    const broken = memoryStorage();
    broken.setItem(SAVE_KEY, '{ 这不是 json');
    expect(loadRun(broken)).toBeNull();
    const version = memoryStorage();
    const data = sample() as { run: { schemaVersion: number } };
    data.run.schemaVersion = 999;
    version.setItem(SAVE_KEY, JSON.stringify(data));
    expect(loadRun(version)).toBeNull();
    const missing = memoryStorage();
    missing.setItem(SAVE_KEY, JSON.stringify({ run: { schemaVersion: 1 } }));
    expect(loadRun(missing)).toBeNull();
  });

  it('卡池形状坏了返回 null，清除后也是 null', () => {
    const storage = memoryStorage();
    const data = sample() as { pool: { heroes: unknown } };
    data.pool.heroes = 'not-an-array';
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    expect(loadRun(storage)).toBeNull();
    const ok = memoryStorage();
    saveRun(ok, sample());
    ok.removeItem(SAVE_KEY);
    expect(loadRun(ok)).toBeNull();
  });
});
