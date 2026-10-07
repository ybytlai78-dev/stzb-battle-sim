import { describe, expect, it } from 'vitest';
import { applyOutcome, createRun } from '../../src/rogue/run';

describe('关卡状态机', () => {
  it('新局：第 1 关、12 关、3 条命、进行中', () => {
    expect(createRun(42)).toMatchObject({
      schemaVersion: 1,
      seed: 42,
      level: 1,
      levelCount: 12,
      lives: 3,
      status: 'playing',
    });
  });

  it('胜：关卡 +1', () => {
    expect(applyOutcome(createRun(1, 12), 'win').level).toBe(2);
  });

  it('打通最后一关 → cleared，关号停在最后一关', () => {
    const state = { ...createRun(1, 12), level: 12 };
    expect(applyOutcome(state, 'win')).toMatchObject({ level: 12, status: 'cleared' });
  });

  it('倒数第二关胜利后仍在进行，进入最后一关', () => {
    const state = { ...createRun(1, 12), level: 11 };
    expect(applyOutcome(state, 'win')).toMatchObject({ level: 12, status: 'playing' });
  });

  it('败：扣 1 条命、关号不变', () => {
    expect(applyOutcome(createRun(1, 12), 'lose')).toMatchObject({ level: 1, lives: 2, status: 'playing' });
  });

  it('命数扣光 → dead', () => {
    const state = { ...createRun(1, 12), lives: 1 };
    expect(applyOutcome(state, 'lose')).toMatchObject({ lives: 0, status: 'dead' });
  });

  it('真平：命数与关号都不变', () => {
    const state = createRun(1, 12);
    expect(applyOutcome(state, 'draw')).toBe(state);
  });

  it('终局后不再变化（同一引用）', () => {
    const dead = { ...createRun(1, 12), lives: 0, status: 'dead' as const };
    expect(applyOutcome(dead, 'win')).toBe(dead);
  });

  it('不可变：不改原对象', () => {
    const state = createRun(1, 12);
    applyOutcome(state, 'win');
    expect(state.level).toBe(1);
  });
});
