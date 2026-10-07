/**
 * 玉符经济的参数表。改难度和定价只改这里，不改流程代码。
 * 口径见设计方案 v1.0 §四。
 */
export const ECONOMY = {
  startingJade: 3000,
  /** 一次五连抽的价格。3000 刚好够 3 次，余 150。 */
  gachaCost: 950,
  openingPulls: 3,
  skillPrice: { A: 600, S: 1200 } as const,
  clearJade: 500,
  levelCount: 12,
  lives: 3,
  freeGrades: ['D', 'C', 'B'] as const,
  shopGrades: ['A', 'S'] as const,
  /** 第 1 关目标胜率 */
  winRateStart: 0.9,
  /** 最后一关目标胜率 */
  winRateEnd: 0.4,
} as const;

export type ShopGrade = keyof typeof ECONOMY.skillPrice;

/** 玩家持有的玉符。 */
export interface Wallet {
  jade: number;
}

/**
 * 开一局时的钱包。
 * @param jade 缺省为开局玉符
 */
export function createWallet(jade: number = ECONOMY.startingJade): Wallet {
  return { jade };
}

/**
 * 是否付得起。
 * @param wallet 当前钱包
 * @param cost 价格，负数视为付不起
 */
export function canAfford(wallet: Wallet, cost: number): boolean {
  return cost >= 0 && wallet.jade >= cost;
}

/**
 * 扣玉符。余额不足时返回 null，不改原对象。
 * @param wallet 当前钱包
 * @param cost 非负价格
 */
export function spend(wallet: Wallet, cost: number): Wallet | null {
  if (!canAfford(wallet, cost)) return null;
  return { jade: wallet.jade - cost };
}

/**
 * 入账。负数金额忽略。
 * @param wallet 当前钱包
 * @param amount 增加的玉符
 */
export function gain(wallet: Wallet, amount: number): Wallet {
  return { jade: wallet.jade + Math.max(0, amount) };
}

/**
 * A/S 战法售价。
 * @param grade 商店品级
 */
export function priceOf(grade: ShopGrade): number {
  return ECONOMY.skillPrice[grade];
}

/**
 * 第 `level` 关的目标胜率，从 0.90 线性落到 0.40。
 * @param level 关卡号，从 1 起
 * @param levelCount 总关数
 */
export function targetWinRate(level: number, levelCount: number = ECONOMY.levelCount): number {
  if (levelCount <= 1) return ECONOMY.winRateStart;
  const clamped = Math.min(Math.max(level, 1), levelCount);
  const t = (clamped - 1) / (levelCount - 1);
  return ECONOMY.winRateStart + (ECONOMY.winRateEnd - ECONOMY.winRateStart) * t;
}

/**
 * 从品级表里取出指定品级的战法 id，结果排序，方便测试对比。
 * @param grades skillId → 品级
 * @param allowed 要留下的品级
 */
export function skillsOfGrades(grades: Record<string, string>, allowed: readonly string[]): string[] {
  const ok = new Set(allowed);
  return Object.entries(grades)
    .filter(([, grade]) => ok.has(grade))
    .map(([id]) => id)
    .sort();
}
