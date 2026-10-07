import type { Position } from '../engine/types';

/** 一场战斗在肉鸽层的胜负。引擎的 `loss` 在这里写成 `lose`。 */
export type Outcome = 'win' | 'lose' | 'draw';

/** 一局的关卡进度与命数。玉符、卡池不放在这里。 */
export interface RunState {
  schemaVersion: 1;
  seed: number;
  /** 当前关卡号，从 1 起 */
  level: number;
  levelCount: number;
  lives: number;
  status: 'playing' | 'cleared' | 'dead';
}

/** 卡池里的一名武将。兵力挂在个体上，跨关累计。 */
export interface HeroSlot {
  heroId: string;
  /** 已获得次数，含第一次 */
  copies: number;
  redness: number;
  level: number;
  maxTroops: number;
  /** 当前可出战兵力（战后回写；伤兵已并回） */
  troops: number;
}

/** 卡池账本：武将、战法、宝物。 */
export interface PoolState {
  heroes: HeroSlot[];
  skills: string[];
  treasures: string[];
}

/**
 * 已经付款、尚未走完的五连抽。
 * 五张展示和爽玩结果在付款时就摇定，刷新不会重抽。
 */
export interface PendingPull {
  shown: string[];
  picked: string | null;
  bonus: string;
}

/** 本关已生成的敌军槽位。只存可重建的字段，不存引擎对象。 */
export interface EnemySlot {
  heroId: string;
  position: Position;
  redness: number;
  level: number;
  skillIds: string[];
}
