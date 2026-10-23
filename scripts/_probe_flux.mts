/**
 * 只读探针：敛微穷极（lianwei_qiongji）「策略伤害浮动」到底有没有生效。
 * 用法：npx tsx scripts/_probe_flux.mts
 */
import { runBattle } from '../src/engine/combat';
import { initHeroDB, getGeneral, level40 } from '../src/data/heroes';
import { withSkills } from '../src/data/hero-utils';
import type { General } from '../src/engine/types';

function dummy(id: string): General {
  return {
    id, name: id, rarity: '5星', cost: 3, faction: '群', tags: [],
    mutualExclusionGroup: null, troopType: 'archer', position: '前锋',
    attack: 80, defense: 80, strategy: 80, speed: 40, attackRange: 3,
    maxTroops: 9000, mainSkillName: '', skillDesc: '',
    activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [],
    morale: 100,
  } as General;
}

async function run(seed: number, withFlux: boolean) {
  await initHeroDB();
  // 三个都带策略主动战法：迷阵（谋略伤害 + 暴走）/ 落雷（谋略伤害）/ 楚歌四起（谋略 DoT）
  const c1 = withSkills(dummy('c1'), { activeSkillIds: ['mizhen'] });
  const c2 = withSkills(dummy('c2'), { activeSkillIds: ['luolei'] });
  const c3 = withSkills(dummy('c3'), { activeSkillIds: ['chuge_siqi'] });
  const driver = withSkills(
    withFlux ? level40(getGeneral('h814'), {}, 9000) : dummy('h814'),
    { activeSkillIds: [] }
  );
  return runBattle({
    myTeam: [driver, c1, c2],
    enemyTeam: [c3, dummy('e2'), dummy('e3')],
    seed,
    maxRounds: 8,
    inertSides: ['enemy'],
  });
}

const r1 = await run(20260101, true);
console.log('=== 全部 damage / dot_tick 事件 ===');
for (const e of r1.events as any[]) {
  if (e.type !== 'damage' && e.type !== 'dot_tick') continue;
  console.log(
    `r${e.round} ${e.type} ${e.sourceId}->${e.targetId} dmg=${e.amount ?? e.damage} ` +
    `bkd=${JSON.stringify(e.breakdown)} detail=${e.detail ?? ''}`
  );
}

console.log('\n=== 同条件多 seed：伤害序列（看是否抖动）===');
for (const withFlux of [true, false]) {
  for (const seed of [1, 2, 3, 4, 5]) {
    const rep = await run(seed, withFlux);
    const dmg = (rep.events as any[])
      .filter((e) => e.type === 'damage' || e.type === 'dot_tick')
      .map((e) => e.amount ?? e.damage);
    console.log(`flux=${withFlux} seed=${seed} n=${dmg.length} 伤害=${dmg.join(',')}`);
  }
}
