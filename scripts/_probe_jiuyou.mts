import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General } from '../src/engine/types';
const gen = (p: Partial<General> & { id: string; position: General['position'] }): General => ({
  id: p.id, name: p.id, rarity: '5星', cost: 3, faction: '蜀', tags: [], mutualExclusionGroup: null,
  troopType: 'infantry', attack: p.attack ?? 120, defense: p.defense ?? 120, strategy: p.strategy ?? 100,
  speed: p.speed ?? 50, attackRange: p.attackRange ?? 2, maxTroops: p.maxTroops ?? 9000,
  mainSkillName: '', skillDesc: '', activeSkillIds: p.activeSkillIds ?? [], passiveSkillIds: p.passiveSkillIds ?? [],
  commandSkillIds: p.commandSkillIds ?? [], pursuitSkillIds: p.pursuitSkillIds ?? [], morale: 100, ...p,
});
const my = [
  gen({ id: 'gyp', position: '前锋', attack: 300, defense: 140, speed: 70, attackRange: 3, mainSkillId: 'jinguo_zhanzhen', activeSkillIds: ['jinguo_zhanzhen'], passiveSkillIds: ['jishi'], commandSkillIds: ['chengjian_jixi'], treasure: { treasureId: 1123, level: 10 } }),
  gen({ id: 'liushan', position: '中军', mainSkillId: 'cijian_changqu', commandSkillIds: ['cijian_changqu'], strategy: 160 }),
  gen({ id: 'a2', position: '大营' }),
];
const ef = [0,1,2].map(i => gen({ id: 'e'+i, position: (['前锋','中军','大营'] as const)[i], attack: 40, defense: 100, speed: 20, maxTroops: 20000 }));
const rep = runBattle({ myTeam: my, enemyTeam: ef, seed: 3, maxRounds: 8 });
for (const ev of rep.events as BattleEvent[]) {
  const any = ev as any;
  if (String(any.sourceSkillId ?? '').includes('1123') || String(any.skillId ?? '').includes('1123')) console.log('EV', JSON.stringify(ev).slice(0,200));
  if (ev.type === 'damage' || ev.type === 'attack_hit') {
    const mods = (any.modifiers?.caused ?? []).filter((m: any) => String(m.skillName ?? '').includes('金鸠') || String(m.skillId ?? '').includes('1123'));
    if (mods.length) console.log('MOD', JSON.stringify(mods), 'dmg=', any.damage ?? any.damage);
  }
}
