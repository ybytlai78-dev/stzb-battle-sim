/**
 * 未雨绸缪 · 报障 ③ 端到端核对（子技能 / 谋略 DoT 触发）：
 *   真实 runBattle 跑「十常侍（乱政，纯 DoT 谋略伤害）+ 河内世泽（伤害全在随机子战法里）」
 *   两臂对照 —— 带未雨绸缪 vs 不带 —— 统计再发动条数与带机制 161 的策略伤害段数。
 *
 * 用法：npx tsx scripts/_verify_weiyu_subskill.mts
 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General } from '../src/engine/types';
import { readFileSync } from 'node:fs';

const HEROES = JSON.parse(readFileSync('web/data/heroes.json', 'utf8')) as any[];

function heroById(id: string, position: General['position'], skills: string[]): General {
  const h = HEROES.find((x) => x.id === id);
  if (!h) throw new Error('hero not found: ' + id);
  const active = h.mainSkillId ? [h.mainSkillId, ...skills] : [...skills];
  return {
    id: h.id,
    name: h.name,
    rarity: h.rarity,
    cost: h.cost,
    faction: h.faction,
    tags: h.tags ?? [],
    mutualExclusionGroup: h.mutualExclusionGroup ?? null,
    troopType: h.troopType,
    position,
    attack: Math.round(h.baseAttack + 39 * h.growthAttack),
    defense: Math.round(h.baseDefense + 39 * h.growthDefense),
    strategy: Math.round(h.baseStrategy + 39 * h.growthStrategy),
    speed: Math.round(h.baseSpeed + 39 * h.growthSpeed),
    attackRange: h.attackRange,
    maxTroops: 9000,
    mainSkillId: h.mainSkillId,
    mainSkillName: h.mainSkillName ?? '',
    skillDesc: '',
    activeSkillIds: active,
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
  } as General;
}

interface Arm {
  casts: Map<string, number>;
  recasts: Map<string, number>;
  strategyDamage: Map<string, number>;
  ignoredDamage: Map<string, number>;
  dotTicks: number;
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

function runArm(label: string, withWeiyu: boolean, runs = 20): Arm {
  const arm: Arm = {
    casts: new Map(),
    recasts: new Map(),
    strategyDamage: new Map(),
    ignoredDamage: new Map(),
    dotTicks: 0,
  };
  for (let seed = 1; seed <= runs; seed++) {
    // 未雨绸缪是「自身下一次造成策略伤害的主动战法」⇒ 必须挂在**同一武将**身上
    // 两臂分开：h2（主战法乱政 = 纯 DoT）与 h16（主战法是指挥，主动位只放河内世泽），
    // 各带一份未雨绸缪 —— 否则槽 1 的主战法会先消费标记，测不到另一条路径。
    const my = [
      heroById('h2', '大营', withWeiyu ? ['weiyu_choumou'] : []),
      heroById('h16', '中军', withWeiyu ? ['heneishize', 'weiyu_choumou'] : ['heneishize']),
      heroById('h742', '前锋', []),
    ];
    const enemy = [
      heroById('h815', '大营', []),
      heroById('h34', '中军', []),
      heroById('h634', '前锋', []),
    ];
    const report = runBattle({ myTeam: my, enemyTeam: enemy, maxRounds: 8, seed });
    for (const ev of report.events as BattleEvent[]) {
      if (ev.type === 'skill_cast') {
        const id = ev.skillId;
        bump(arm.casts, id);
        if (ev.recastBy && ev.recastRate === 0.5) bump(arm.recasts, id);
      } else if (ev.type === 'damage' && ev.damageType === 'strategy') {
        bump(arm.strategyDamage, ev.skillId);
        if (ev.ignoreStrategy) bump(arm.ignoredDamage, ev.skillId);
      } else if (ev.type === 'dot_tick') {
        arm.dotTicks++;
      }
    }
  }
  const focus = ['luanzheng', 'heneishize', 'weiyu_choumou'];
  console.log(`\n== ${label} ==`);
  for (const id of focus) {
    console.log(
      `  ${id.padEnd(14)} casts=${String(arm.casts.get(id) ?? 0).padStart(4)}` +
        ` 再发动=${String(arm.recasts.get(id) ?? 0).padStart(4)}` +
        ` 策略伤害段=${String(arm.strategyDamage.get(id) ?? 0).padStart(4)}` +
        ` 带无视=${String(arm.ignoredDamage.get(id) ?? 0).padStart(4)}`
    );
  }
  console.log(`  DoT 跳伤总数=${arm.dotTicks}`);
  return arm;
}

const off = runArm('对照组：不带未雨绸缪', false);
const on = runArm('实验组：带未雨绸缪', true);

const recastOf = (a: Arm, id: string) => a.recasts.get(id) ?? 0;
const okLuanzheng = recastOf(on, 'luanzheng') > 0 && recastOf(off, 'luanzheng') === 0;
const okHeneishize = recastOf(on, 'heneishize') > 0 && recastOf(off, 'heneishize') === 0;
const noLeak = (['luolei', 'mizhen', 'kuidi', 'famou', 'luoshi', 'mimou_dingshu'] as const).every(
  (id) => recastOf(on, id) === 0
);

console.log('\n== 断言 ==');
console.log(`  乱政（纯 DoT 谋略伤害）在带标记时才再发动：${okLuanzheng ? 'PASS' : 'FAIL'}`);
console.log(`  河内世泽（伤害全在子战法里）在带标记时才再发动：${okHeneishize ? 'PASS' : 'FAIL'}`);
console.log(`  未波及无关战法（不串战法）：${noLeak ? 'PASS' : 'FAIL'}`);
if (!okLuanzheng || !okHeneishize || !noLeak) process.exitCode = 1;
