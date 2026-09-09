import type { FormationBonus } from '../engine/types';

/** 称号定义：成员须全部在本队才触发，效果加给本队全体 */
export interface TitleDef {
  id: string;
  name: string;
  memberIds: readonly string[];
  effects: Array<{ stat: keyof FormationBonus; amount: number }>;
}

/** 当前仅魏之智；后续加称号只改本表 */
export const TITLE_REGISTRY: TitleDef[] = [
  {
    id: 'wei_zhi_zhi',
    name: '魏之智',
    memberIds: ['h24', 'h476', 'h618'],
    effects: [{ stat: 'strategy', amount: 32 }],
  },
];
