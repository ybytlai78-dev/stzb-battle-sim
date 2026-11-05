/**
 * 端到端回归：张飞【长坂之吼】prepareTurns = 2 + 胜兵求战（jump_prep turns 1）。
 *
 * 期望：命中跳过后只登记准备槽（`prepare_start{skippedTurns:1, remaining:1}`），绝不 `prepare_skip` 直放；
 * 未命中（80% 外）走正常 2 回合准备。旧实现命中即直放 = 跳过全部 2 个准备回合（用户 2026-11-05 报障现场）。
 *
 * 用法：`npx tsx scripts/_e2e_shengbing_jump.mts`（PASS 退出码 0）
 */
import { runBattle } from '../src/engine/combat';
import type { General, Position } from '../src/engine/types';

const naked = (id: string, position: Position): General => ({
  id,
  name: id,
  rarity: '4星',
  cost: 1,
  faction: '汉',
  tags: [],
  mutualExclusionGroup: null,
  troopType: 'infantry',
  position,
  attack: 100,
  defense: 100,
  strategy: 100,
  speed: 40,
  attackRange: 3,
  maxTroops: 30000,
  mainSkillName: '',
  skillDesc: '',
  activeSkillIds: [],
  passiveSkillIds: [],
  commandSkillIds: [],
  pursuitSkillIds: [],
  morale: 100,
});

const zhangfei: General = {
  ...naked('zhangfei', '大营'),
  name: '张飞',
  rarity: '5星',
  faction: '蜀',
  troopType: 'cavalry',
  attack: 240,
  defense: 150,
  strategy: 60,
  speed: 90,
  attackRange: 4,
  maxTroops: 30000,
  mainSkillName: '长坂之吼',
  mainSkillId: 'changban_zhihou',
  activeSkillIds: ['changban_zhihou'],
  commandSkillIds: ['shengbing_qiuzhan'],
};

let starts = 0;
let skippedOne = 0;
let normal = 0;
let other = 0;
let skips = 0;
let sampleStart: unknown = null;

for (let seed = 1; seed <= 200; seed++) {
  const report = runBattle({
    myTeam: [zhangfei, naked('a1', '前锋'), naked('a2', '中军')],
    enemyTeam: [naked('e1', '前锋'), naked('e2', '中军'), naked('e3', '大营')],
    seed,
    maxRounds: 8,
    // 木桩：敌方不还手，只为观察准备槽时序
    inertSides: ['enemy'],
  });
  for (const ev of report.events) {
    if (ev.type === 'prepare_start' && ev.skillId === 'changban_zhihou') {
      starts++;
      if (ev.skippedTurns === 1 && ev.remaining === 1) {
        skippedOne++;
        sampleStart ??= ev;
      } else if (ev.skippedTurns == null && ev.remaining == null) {
        // 胜兵求战 80% 未命中：正常 2 回合准备（事件不带跳过量）
        normal++;
      } else {
        other++;
      }
    }
    if (ev.type === 'prepare_skip' && ev.skillId === 'changban_zhihou') skips++;
  }
}

console.log(
  `200 局 · 长坂之吼：开始准备 ${starts} 次（跳过 1 回合→仍需 1 回合：${skippedOne}；未跳过→正常 2 回合：${normal}；异常：${other}），直接跳过 ${skips} 次`
);
console.log('样例 prepare_start:', JSON.stringify(sampleStart));

const ok = skippedOne > 0 && other === 0 && skips === 0;
console.log(ok ? 'PASS：只跳 1 个准备回合、仍需再准备 1 回合' : 'FAIL：出现跳过全部准备回合的现场');
process.exit(ok ? 0 : 1);
