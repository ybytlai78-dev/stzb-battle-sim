/**
 * 重复获得武将时的红度阶梯。第 4 次起满红且不再变化。
 * 兵力与自由属性点仍走现成公式，这里只决定 redness / level。
 */
export const REDNESS_STEPS = [
  { minCopies: 1, redness: 0, level: 40 },
  { minCopies: 2, redness: 2, level: 40 },
  { minCopies: 3, redness: 4, level: 40 },
  { minCopies: 4, redness: 5, level: 50 },
] as const;

/** 满红需要的获得次数。 */
export const MAX_COPY = 4;

export interface Growth {
  redness: number;
  level: number;
}

export interface RecruitFeedback {
  heroId: string;
  copies: number;
  before: Growth | null;
  after: Growth;
  /** 红度增加了几星 */
  rednessDelta: number;
  levelUp: boolean;
  /** 本次之前已经满配 */
  capped: boolean;
}

/**
 * 按获得次数查红度与等级。不足 1 次按第 1 次计。
 * @param copies 获得次数
 */
export function growthForCopies(copies: number): Growth {
  const n = Math.max(1, Math.floor(copies));
  let growth: Growth = { redness: REDNESS_STEPS[0].redness, level: REDNESS_STEPS[0].level };
  for (const step of REDNESS_STEPS) {
    if (n >= step.minCopies) growth = { redness: step.redness, level: step.level };
  }
  return growth;
}

/**
 * 距离满红还要再获得几次。已满为 0。
 * @param copies 当前获得次数
 */
export function copiesUntilMax(copies: number): number {
  return Math.max(0, MAX_COPY - Math.max(0, Math.floor(copies)));
}

/**
 * 携带兵力：等级×100 + 5000 + 红度×200。与表现层公式保持一致，这里不引用表现层。
 * @param level 等级
 * @param redness 红度
 */
export function troopCapacity(level: number, redness = 0): number {
  return Math.max(0, level) * 100 + 5000 + Math.max(0, redness) * 200;
}

/**
 * 抽卡反馈文案。属性点用调用方传入的公式算，才能区分男女武将。
 * @param name 展示名
 * @param fb 本次获得的反馈
 * @param points (红度, 等级) → 自由属性点
 */
export function formatRecruit(
  name: string,
  fb: RecruitFeedback,
  points: (redness: number, level: number) => number,
): string {
  if (!fb.before) return `${name} 入池：${fb.after.redness} 红 · ${fb.after.level} 级`;
  if (fb.capped) return `${name} 已满红，不再成长`;
  const delta = points(fb.after.redness, fb.after.level) - points(fb.before.redness, fb.before.level);
  const levelText = fb.levelUp ? `，等级 ${fb.before.level}→${fb.after.level}` : '';
  return `${name} ${fb.before.redness} 红 → ${fb.after.redness} 红：属性点 +${delta}${levelText}`;
}
