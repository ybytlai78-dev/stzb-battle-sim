/**
 * 探针：卫瓘「持节镇西」在**准备阶段**对月英/灵帝/吕蒙的叠层口径。
 *
 * 目的（用户问题）：三将都是一类指挥、伤害在准备阶段预存，效果到指定回合才打出。
 * 问：搭配卫瓘时，月英/灵帝是否像吕蒙一样在准备阶段吃到谋略层 → 让神兵天降/大赏三军（受谋略）
 *     读更高的生效谋略？
 *
 * 做法：手工 ctx + HERO_REGISTRY 真面板（40 级 9000 兵），按 combat.ts:170-173 的
 *       「turnOrder（速度降序）逐将 triggerCommandSkills」复刻准备阶段。
 *
 * 运行：npx tsx scripts/_probe_weiguan_charge.mts
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
import type { General, Position, Skill, UnitState } from '../src/engine/types';

const CORE = {
  lvmeng: { id: 'lvmeng', label: '吕蒙', main: 'baiyi_dujiang' },
  h20: { id: 'h20', label: '黄月英', main: 'jiangxin_bujie' },
  h101: { id: 'h101', label: '灵帝', main: 'diling_huiguang' },
  weiguan: { id: 'weiguan', label: '卫瓘', main: 'chijie_zhenxi' },
} as const;

function mk(id: string, position: Position, commandSkillIds: string[], side: 'my' | 'enemy' = 'my'): UnitState {
  const base = level40(HERO_REGISTRY[id]);
  const g: General = withSkills(base, { commandSkillIds }) as General;
  const positioned: General = { ...g, position };
  return {
    general: positioned,
    side,
    troops: 9000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

/** 木桩（不在 HERO_REGISTRY 里）：固定面板，避免依赖真实武将 */
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
const boostRates = (u: UnitState): number =>
  u.statuses.filter((s) => s.type === 'damage_boost').reduce((a, s) => a + ('rate' in s ? s.rate : 0), 0);

type Row = {
  label: string;
  coreId: string;
  coreLabel: string;
  coreSkills: string[];
  wgFirst: boolean;
  wgSpeed?: number; // 覆盖卫瓘速度（缺口径对照用）
  noWeiguan?: boolean; // 不带卫瓘（预存伤害的裸对照）
};

function runCase(row: Row) {
  const ctx = makeCtx();
  const wg = mk(CORE.weiguan.id, '中军', [CORE.weiguan.main]);
  if (row.wgSpeed !== undefined) wg.general.speed = row.wgSpeed;
  const core = mk(row.coreId, '大营', [row.coreSkills[0], ...row.coreSkills.slice(1)]);
  ctx.myTeam = [wg, core];
  const enemies = (['前锋', '中军', '大营'] as Position[]).map((p, i) => mkDummy(`e${i + 1}`, p));
  ctx.enemyTeam = enemies;

  // 复刻 combat.ts:170-173：turnOrder 速度降序 → 逐将 triggerCommandSkills
  const order = row.noWeiguan ? [core] : row.wgFirst ? [wg, core] : [core, wg];
  for (const u of order) triggerCommandSkills(ctx, u);

  const coreStrategy = effectiveStat(core, 'strategy');
  const wgStrategy = effectiveStat(wg, 'strategy');
  const wgAttack = effectiveStat(wg, 'attack');
  const lock = ctx.lockedCommands.find((l) => l.skill.id === row.coreSkills[0]);
  const stored = lock?.storedDamage?.length ?? 0;
  const storedZero = lock?.storedDamage ? lock.storedDamage.length : 0;
  const storedSummary = (lock?.storedDamage ?? []).map(
    (d) => `${d.targetId}:${d.damage}(兵力${d.breakdown?.troopBase ?? '?'}+基础${d.breakdown?.base ?? '?'}+主${d.breakdown?.main ?? '?'})`
  );

  const out = {
    label: row.label,
    coreLabel: row.coreLabel,
    wgSpeed: wg.general.speed,
    coreSpeed: core.general.speed,
    wgStrategy,
    wgAttack,
    coreStrategyBase: row.coreId === CORE.lvmeng.id ? 197 : undefined,
    stratLayers: buffLayers(core, 'strategy_buff'),
    stratSum: buffSum(core, 'strategy_buff'),
    atkLayers: buffLayers(core, 'attack_buff'),
    atkSum: buffSum(core, 'attack_buff'),
    coreStrategyEff: coreStrategy,
    enemyTaken: enemies.map(boostRates),
    allyCaused: boostRates(core) + boostRates(wg),
    storedDamageCount: storedZero,
    storedIsEmptyArray: stored === 0 && lock?.storedDamage !== undefined,
    hasStored: lock?.storedDamage !== undefined,
    storedSummary,
  };
  return { ctx, wg, core, enemies, out };
}

const main = async () => {
  await initHeroDB();

  const panel = (id: string, label: string, main: string) => {
    const g = level40(HERO_REGISTRY[id]);
    return {
      label,
      id,
      speed: g.speed,
      strategy: g.strategy,
      attack: g.attack,
      defense: g.defense,
      mainSkillId: main,
      commandSkillIdsAtRegistry: g.commandSkillIds,
    };
  };
  const panels = [
    panel(CORE.weiguan.id, '卫瓘', CORE.weiguan.main),
    panel(CORE.lvmeng.id, '吕蒙', CORE.lvmeng.main),
    panel(CORE.h20.id, '黄月英', CORE.h20.main),
    panel(CORE.h101.id, '灵帝', CORE.h101.main),
  ];
  console.log('=== 40 级真面板（9000 兵，无加点）===');
  for (const p of panels) {
    console.log(
      `${p.label}(${p.id}) speed=${p.speed} strategy=${p.strategy} attack=${p.attack} defense=${p.defense} ` +
        `主战法=${p.mainSkillId} registry槽位=[${p.commandSkillIdsAtRegistry.join(',')}]`
    );
  }
  console.log(
    '\n[关键] 准备阶段释放顺序 = turnOrder 速度降序（combat.ts:170-173）→ ' +
      '卫瓘必须比核心快，才能把自己注册进 ctx.stackBuffs 后核心才叠层\n'
  );

  const rows: Row[] = [
    {
      label: 'A 吕蒙 + 白衣（卫瓘先手）',
      coreId: CORE.lvmeng.id,
      coreLabel: '吕蒙',
      coreSkills: ['baiyi_dujiang', 'shenbing_tianjiang', 'dashang_sanjun'],
      wgFirst: true,
    },
    {
      label: 'A2 吕蒙 不带白衣（卫瓘先手，对照组）',
      coreId: CORE.lvmeng.id,
      coreLabel: '吕蒙',
      coreSkills: ['shenbing_tianjiang', 'dashang_sanjun'],
      wgFirst: true,
    },
    {
      label: 'B 黄月英 + 匠心不竭（卫瓘先手）',
      coreId: CORE.h20.id,
      coreLabel: '黄月英',
      coreSkills: ['jiangxin_bujie', 'shenbing_tianjiang', 'dashang_sanjun'],
      wgFirst: true,
    },
    {
      label: 'C 灵帝 + 帝临回光（卫瓘先手）',
      coreId: CORE.h101.id,
      coreLabel: '灵帝',
      coreSkills: ['diling_huiguang', 'shenbing_tianjiang', 'dashang_sanjun'],
      wgFirst: true,
    },
    {
      label: 'A3 吕蒙 + 白衣（无卫瓘 = 预存伤害裸对照）',
      coreId: CORE.lvmeng.id,
      coreLabel: '吕蒙',
      coreSkills: ['baiyi_dujiang', 'shenbing_tianjiang', 'dashang_sanjun'],
      wgFirst: true,
      noWeiguan: true,
    },
    {
      label: 'E 吕蒙 + 白衣（卫瓘后手 = 反序）',
      coreId: CORE.lvmeng.id,
      coreLabel: '吕蒙',
      coreSkills: ['baiyi_dujiang', 'shenbing_tianjiang', 'dashang_sanjun'],
      wgFirst: false,
    },
    {
      label: 'F 灵帝 + 帝临回光（卫瓘后手 = 反序）',
      coreId: CORE.h101.id,
      coreLabel: '灵帝',
      coreSkills: ['diling_huiguang', 'shenbing_tianjiang', 'dashang_sanjun'],
      wgFirst: false,
    },
  ];

  for (const row of rows) {
    const { out } = runCase(row);
    console.log(`--- ${out.label} ---`);
    console.log(
      `  速度：卫瓘 ${out.wgSpeed} vs ${out.coreLabel} ${out.coreSpeed}` +
        `（释放顺序：${row.wgFirst ? '卫瓘→核心' : '核心→卫瓘'}）`
    );
    console.log(
      `  核心 谋略层=${out.stratLayers} 层 / 合计 +${out.stratSum}；攻击层=${out.atkLayers} 层 / +${out.atkSum}`
    );
    console.log(`  核心 生效谋略=${out.coreStrategyEff}`);
    console.log(`  敌方 taken rate = [${out.enemyTaken.join(', ')}]；我方 caused rate 合计=${out.allyCaused.toFixed(2)}`);
    console.log(
      `  主战法 lockedCommands：存在=${out.hasStored} storedDamage 条数=${out.storedDamageCount}` +
        `（空数组=该战法的 delayedOutput 无伤害段）`
    );
    if (out.storedDamageCount > 0) {
      console.log(`  预存伤害明细：${out.storedSummary.join(' | ')}`);
    }
  }

  // G：月英 prep 之后，把第 1 回合的 delayedOutputs 打出来，看恐慌/燃烧挂上时是否叠层
  {
    const { ctx, core } = runCase({
      label: 'G',
      coreId: CORE.h20.id,
      coreLabel: '黄月英',
      coreSkills: ['jiangxin_bujie'],
      wgFirst: true,
    });
    const before = buffLayers(core, 'strategy_buff');
    triggerDelayedOutputs(ctx, 1);
    const afterStatuses = core.statuses.filter((s) => /panic|burning|sorcery/.test(s.type)).length;
    const after = buffLayers(core, 'strategy_buff');
    console.log('--- G 月英：prep 后 → 第 1 回合 delayedOutputs（挂恐慌）---');
    console.log(`  prep 后谋略层=${before}；挂上 DoT 状态数=${afterStatuses}；调用后谋略层=${after}`);
    console.log(`  ⇒ ${after === before ? '挂 DoT 本身不叠层（叠层在 DoT 跳伤时 dealDotDamage）' : '挂 DoT 时发生叠层'}`);
  }

  // H：灵帝 delayedOutput 有 strategy_damage 吗？（直接读数据，排除推断）
  {
    const s = SKILL_REGISTRY['diling_huiguang'];
    const kinds = 'delayedOutput' in s && s.delayedOutput ? s.delayedOutput.output.map((o) => o.kind) : [];
    const s2 = SKILL_REGISTRY['jiangxin_bujie'];
    const hasPlural = 'delayedOutputs' in s2 && Array.isArray(s2.delayedOutputs);
    const pluralKinds = hasPlural ? (s2.delayedOutputs ?? []).flatMap((d) => d.output.map((o) => o.kind)) : [];
    const s3 = SKILL_REGISTRY['baiyi_dujiang'];
    const lvKinds = 'delayedOutput' in s3 && s3.delayedOutput ? s3.delayedOutput.output.map((o) => o.kind) : [];
    console.log('--- H 数据口径 ---');
    console.log(`  帝临回光 delayedOutput.output kinds = [${kinds.join(', ')}] → 含谋略 DoT（恐慌）= 预结算伤害段 ⇒ 判 strategy（2026-10-23 口径）`);
    console.log(`  匠心不竭 delayedOutputs(复数)=${hasPlural}，kinds=[${pluralKinds.join(', ')}] ⇒ prep 结算延迟效果前叠一次 + 每回合施加前叠层`);
    console.log(`  白衣渡江 delayedOutput.output kinds = [${lvKinds.join(', ')}] ⇒ 有 strategy_damage ⇒ strategy 层`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
