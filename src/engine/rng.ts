/**
 * 可复现随机数生成器（mulberry32）。
 * 同一种子 → 完全相同的序列，保证战斗可复现（用户故事 B-04）。
 * 引擎内部一律使用本 RNG，禁用 Math.random。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 返回 [0, 1) 浮点数 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [0, max) 整数 */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** 返回 [min, max] 整数 */
  intInclusive(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** 按概率 p 判定成功（p 为 0~1） */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * 从数组中不放回抽取 n 项（顺序随机）。
   * 兵无常势：3 组效果抽 2 组。
   */
  pickN<T>(items: readonly T[], n: number): T[] {
    const copy = items.slice();
    const k = Math.min(Math.max(n, 0), copy.length);
    for (let i = 0; i < k; i++) {
      const j = i + this.int(copy.length - i);
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy.slice(0, k);
  }
}
