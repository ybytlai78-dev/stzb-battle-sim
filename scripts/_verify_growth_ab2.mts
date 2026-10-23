/**
 * 验证探针：反向缺口（文案声称受属性影响、数据未挂成长率）补齐后的数值增长。
 * 跑法：npx tsx scripts/_verify_growth_ab2.mts
 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General } from '../src/engine/types';

type AttrKey = 'speed' | 'defense' | 'attack' | 'strategy';
type Field = 'commandSkillIds' | 'activeSkillIds' | 'passiveSkillIds';

function gen(p: Partial<General> & { id: string; position: General['position'] }): General {
  return {
    name: p.id,
    rarity: '5星',
    cost: 3,
    faction: '蜀',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    attack: 120,
    defense: 120,
    strategy: 100,
    speed: 50,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...p,
  };
}

function watch(
  label: string,
  field: Field,
  skillId: string,
  troop: General['troopType'],
  attr: AttrKey,
  grid: number[],
  statusType: string
) {
  console.log(`\n=== ${label}（受 ${attr}，看 ${statusType}）===`);
  for (const v of grid) {
    const boost = { [attr]: v } as Partial<General>;
    const me = gen({ id: 'a1', position: '前锋', troopType: troop, ...boost, [field]: [skillId] });
    const mates = ([0, 1] as const).map((i) =>
      gen({ id: 'a' + (i + 2), position: (['中军', '大营'] as const)[i], troopType: troop })
    );
    const foe = ([0, 1, 2] as const).map((i) =>
      gen({ id: 'e' + i, position: (['前锋', '中军', '大营'] as const)[i], attack: 100, defense: 100, speed: 40 })
    );
    const events: BattleEvent[] = runBattle({ myTeam: [me, ...mates], enemyTeam: foe, seed: 5, maxRounds: 4 }).events;
    const seen = new Set<string>();
    for (const e of events) {
      if (e.type !== 'status_inflicted') continue;
      const ev = e as { statusType?: string; detail?: string };
      if (ev.statusType !== statusType) continue;
      seen.add((ev.detail ?? '').split(' 持续')[0]);
    }
    console.log(`  ${attr}=${v}: ${[...seen].join(' | ') || '（本场未触发）'}`);
  }
}

watch('令明负榇', 'commandSkillIds', 'lingming_fuchen', 'cavalry', 'speed', [60, 200, 300], 'split');
watch('逆谋', 'commandSkillIds', 'nimou', 'cavalry', 'attack', [60, 200, 300], 'damage_reduce');
watch('定军扬威', 'activeSkillIds', 'dingjun_yangwei', 'cavalry', 'defense', [60, 200, 300], 'damage_reduce');
watch('国士无双', 'commandSkillIds', 'guoshi_wushuang', 'cavalry', 'attack', [60, 200, 300], 'damage_boost');
watch('截断', 'activeSkillIds', 'jieduan', 'archer', 'speed', [60, 200, 300], 'damage_boost');
watch('拒盾', 'activeSkillIds', 'judun', 'infantry', 'defense', [60, 200, 300], 'damage_reduce');
watch('迫近', 'activeSkillIds', 'pojin', 'archer', 'defense', [60, 200, 300], 'damage_boost');
watch('退避', 'activeSkillIds', 'tuibi', 'infantry', 'speed', [60, 200, 300], 'damage_reduce');
watch('难知如阴', 'commandSkillIds', 'nanzhi_ruyin', 'cavalry', 'speed', [60, 200, 300], 'jump_prep');
