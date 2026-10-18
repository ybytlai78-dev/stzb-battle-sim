import { inflictStatus, effectiveMorale } from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
const u: any = {
  general: { id: 'u', name: 'u', rarity: '5星', cost: 3, faction: '吴', tags: [], mutualExclusionGroup: null, troopType: 'archer', position: '前锋', attack: 100, defense: 100, strategy: 80, speed: 50, attackRange: 1, maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100 },
  side: 'my', troops: 10000, alive: true, wounded: 0, totalDead: 0, statuses: [], preparations: [],
};
const mk = () => ({ rng: new Rng(1), myTeam: [u], enemyTeam: [], events: [], skills: new Map(Object.entries(SKILL_REGISTRY) as any), lockedCommands: [], stackBuffs: [], currentRound: 1 } as any);
const ctx = mk();
inflictStatus(ctx, u, { type: 'morale_boost', amount: -10, duration: 999 } as any, 'pursuit', 'liehuo_fenzhou');
inflictStatus(ctx, u, { type: 'morale_boost', amount: -10, duration: 999 } as any, 'active', 'other_skill');
console.log('instances', u.statuses.filter((s: any) => s.type === 'morale_boost').map((s: any) => s.amount), 'morale', effectiveMorale(u));
console.log('events', JSON.stringify(ctx.events.map((e: any) => [e.type, e.statusType, e.detail])));
