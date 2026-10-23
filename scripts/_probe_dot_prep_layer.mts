/**
 * 探针：若「准备阶段已叠好卫瓘谋略层」，月英 / 灵帝的谋略 DoT 与神兵·大赏能否吃到？
 *
 * 用户口径（m00265）：DoT 在给敌方施加时就计算增减伤与伤害 → 只要 prep 阶段叠上谋略层，
 * 月英（恐慌/燃烧/妖术）与灵帝（恐慌）在之后 R1/R3/R5 施加时都吃得到。
 *
 * 做法：现引擎两处缺口（未叠）见文档 §五，这里手工按持节镇西同型结构注入 3 层 strategy_buff，
 * 再跑 神兵/大赏 + triggerDelayedOutputs，读 DoT 冻结值与增减伤。
 *
 * 运行：npx tsx scripts/_probe_dot_prep_layer.mts
 */
import { Rng } from '../src/engine/rng';
import {
  effectiveStat,
  triggerCommandSkills,
  triggerDelayedOutputs,
  type CombatContext,
} from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';
import { HERO_REGISTRY, initHeroDB, level40 } from '../src/data/heroes';
import { withSkills } from '../src/data/hero-utils';
import type { General, Position, Skill, Status, UnitState } from '../src/engine/types';

function mk(id: string, position: Position, commandSkillIds: string[], side: 'my' | 'enemy' = 'my'): UnitState {
  const g: General = withSkills(level40(HERO_REGISTRY[id]), { commandSkillIds }) as General;
  return {
    general: { ...g, position },
    side,
    troops: 9000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function mkDummy(id: string, position: Position, side: 'my' | 'enemy' = 'enemy'): UnitState {
  const g: General = {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 60,
    attackRange: 3,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
  return { general: g, side, troops: 9000, alive: true, wounded: 0, totalDead: 0, statuses: [], preparations: [] };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

const buffSum = (u: UnitState, type: string): number =>
  u.statuses.filter((s) => s.type === type).reduce((a, s) => a + ('amount' in s ? s.amount : 0), 0);
const buffLayers = (u: UnitState, type: string): number => u.statuses.filter((s) => s.type === type).length;

function boosts(u: UnitState, dir: 'caused' | 'taken'): number[] {
  return u.statuses
    .filter((s) => s.type === 'damage_boost' && (s as { direction?: string }).direction === dir)
    .map((s) => ('rate' in s ? s.rate : 0));
}

/** 读 DoT 冻结值（挂上时预存） */
function readDots(team: UnitState[]): string[] {
  const out: string[] = [];
  for (const u of team) {
    for (const s of u.statuses) {
      if (s.type !== 'panic' && s.type !== 'burning' && s.type !== 'sorcery') continue;
      const st = (s as unknown as {
        stored?: { damage: number; breakdown?: { troopBase: number; base: number; main: number } };
      }).stored;
      out.push(
        `${u.general.name}:${s.type}=${st ? st.damage : 'none'}` +
          (st?.breakdown
            ? `(兵力${st.breakdown.troopBase}+基础${st.breakdown.base}+主${st.breakdown.main})`
            : ''),
      );
    }
  }
  return out;
}

/** 持节镇西每层数值：round(22 + 0.15×(caster 谋略−80)) */
const layerAmount = (casterStrategy: number): number => Math.round(22 + 0.15 * (casterStrategy - 80));

/** 手工注入 n 层谋略（与 addStackLayer 产出的 status 同型） */
function injectStrategyLayers(u: UnitState, n: number, amount: number): void {
  for (let i = 0; i < n; i++) {
    u.statuses.push({
      type: 'strategy_buff',
      amount,
      remaining: 1,
      appliedRound: 0,
      sourceSkillType: 'command',
      sourceSkillId: 'chijie_zhenxi',
    } as unknown as Status);
  }
}

type Row = {
  label: string;
  heroId: string;
  main: string;
  extra: string[];
  rounds: number[];
};

function runCase(row: Row, inject: boolean): void {
  const ctx = makeCtx();
  const wg = mk('weiguan', '中军', ['chijie_zhenxi']);
  const core = mk(row.heroId, '大营', [row.main, ...row.extra]);
  ctx.myTeam = [wg, core];
  ctx.enemyTeam = (['前锋', '中军', '大营'] as Position[]).map((p, i) => mkDummy(`e${i + 1}`, p));

  // 卫瓘先释放（注册 stackBuff 配置 + 真实叠层；本行核心当前无 prep 叠层路径，故 0 层）
  triggerCommandSkills(ctx, wg);

  const tag = inject ? '【注入 3 层谋略】' : '【未注入】';
  if (inject) {
    const amt = layerAmount(effectiveStat(wg, 'strategy'));
    injectStrategyLayers(core, 3, amt);
    console.log(`\n== ${row.label} ${tag} 每层 ${amt} ==`);
  } else {
    console.log(`\n== ${row.label} ${tag} ==`);
  }

  triggerCommandSkills(ctx, core);

  console.log(
    `  谋略层=${buffLayers(core, 'strategy_buff')} 合计+${buffSum(core, 'strategy_buff')} ` +
      `→ 生效谋略 ${effectiveStat(core, 'strategy')}`,
  );
  console.log(`  敌方 taken = [${ctx.enemyTeam.map((e) => boosts(e, 'taken').join('/') || '0').join(', ')}]`);
  console.log(`  我方 caused = 卫瓘 ${boosts(wg, 'caused').join('/') || '0'} / 核心 ${boosts(core, 'caused').join('/') || '0'}`);

  for (const r of row.rounds) {
    ctx.currentRound = r;
    triggerDelayedOutputs(ctx, r);
    console.log(`  R${r} DoT = [${readDots(ctx.enemyTeam).join(' | ')}]`);
  }
}

const main = async () => {
  await initHeroDB();

  const rows: Row[] = [
    { label: '黄月英 · 匠心不竭 + 神兵 + 大赏', heroId: 'h20', main: 'jiangxin_bujie', extra: ['shenbing_tianjiang', 'dashang_sanjun'], rounds: [1, 3, 5] },
    { label: '灵帝 · 帝临回光 + 神兵 + 大赏', heroId: 'h101', main: 'diling_huiguang', extra: ['shenbing_tianjiang', 'dashang_sanjun'], rounds: [3] },
    { label: '吕蒙 · 白衣渡江 + 神兵 + 大赏（参照）', heroId: 'lvmeng', main: 'baiyi_dujiang', extra: ['shenbing_tianjiang', 'dashang_sanjun'], rounds: [3] },
  ];

  for (const inject of [false, true]) {
    for (const row of rows) runCase(row, inject);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
