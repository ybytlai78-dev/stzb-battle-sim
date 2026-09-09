import type { BattleReport } from '../src/engine/types';
import { asset } from './assets';

/**
 * 战报结果书法字资源（仿金属刻字：胜=金、败=铜、平=银）。
 * 黑底 PNG，展示时用 mix-blend-mode: screen 抠黑。
 */
export const RESULT_GLYPH: Record<BattleReport['result'], { src: string; alt: string }> = {
  win: { src: asset('/stamps/win.png'), alt: '胜' },
  loss: { src: asset('/stamps/loss.png'), alt: '败' },
  draw: { src: asset('/stamps/draw.png'), alt: '平' },
};
