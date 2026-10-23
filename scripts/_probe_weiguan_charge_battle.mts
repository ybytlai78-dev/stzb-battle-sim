/**
 * 端到端取证：卫瓘「持节镇西」在**真战斗**（runBattle）里对吕蒙/月英/灵帝的叠层时机与类型。
 *
 * 手工 ctx 的探针（_probe_weiguan_charge.mts）只证明「prepareCommandSkills 逐个释放时」的形状；
 * 本脚本证的是 combat.ts 的真实流水线：
 *   准备阶段 = 全体 battle_start 被动 → **turnOrder（速度降序）逐个 triggerCommandSkills** → preparation_end
 * 所以我们把「持节镇西」的 status_inflicted 事件按「preparation_end 之前 / 之后 + 回合号」归类，
 * 直接看：谁在准备阶段叠层、叠的是哪种属性、到第几回合才出现谋略层。
 *
 * 用法：npx tsx scripts/_probe_weiguan_charge_battle.mts
 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { level40, initHeroDB, HERO_REGISTRY, getGeneral } from '../src/data/heroes';
import { withSkills } from '../src/data/hero-utils';
import type { General, Position } from '../src/engine/types';

const heroesJson = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const heroList: any[] = Array.isArray(heroesJson) ? heroesJson : (heroesJson.heroes ?? []);
const mainSkillById = new Map<string, string>(
  heroList.map((h) => [String(h.id), String(h.mainSkillId ?? '')])
);

/** 我方一将：真面板 + 指定站位 + 主战法在前的一类指挥顺序 + 可选速度加点 */
function ally(
  id: string,
  position: Position,
  extraCommand: string[],
  opts: { speed?: number; morale?: number } = {}
): General {
  const base = level40(getGeneral(id), opts.speed ? { speed: opts.speed } : {});
  const main = mainSkillById.get(id) ?? '';
  return withSkills(base, { commandSkillIds: [main, ...extraCommand].filter(Boolean) }) as General;
}

/** 敌方木桩：真面板裸将（清空战法），保证「持节镇西」只可能来自我方卫瓘 */
function dummy(id: string, position: Position): General {
  const g = level40(getGeneral(id));
  return {
    ...g,
    position,
    activeSkillIds: [],
    passiveSkillIds: [],
    pursuitSkillIds: [],
    commandSkillIds: [],
  } as General;
}

const ENEMY = (): General[] => [dummy('h24', '前锋'), dummy('h807', '中军'), dummy('h23', '大营')];

type Flat = { phase: 'prep' | 'battle'; round: number; target: string; kind: '攻击' | '谋略' | '防御' | '?' };

function classify(report: any, myIds: Set<string>): {
  layers: Flat[];
  boostRates: string[];
  dots: string[];
} {
  const evs = report.events as any[];
  const layers: Flat[] = [];
  const boostRates: string[] = [];
  const dots: string[] = [];
  let prepEnd = evs.findIndex((e) => e.type === 'preparation_end');
  if (prepEnd < 0) prepEnd = 0;
  let round = 0;
  evs.forEach((ev, i) => {
    if (ev.type === 'round_start' && typeof ev.round === 'number') round = ev.round;
    if (ev.type === 'dot_tick') {
      dots.push(`R${round}:${String(ev.dotType ?? '?')}:${String(ev.damage ?? '?')}`);
      return;
    }
    if (ev.type !== 'status_inflicted') return;
    const detail = String(ev.detail ?? '');
    if (detail.includes('持节镇西')) {
      const kind = detail.includes('谋略属性')
        ? '谋略'
        : detail.includes('攻击属性')
          ? '攻击'
          : detail.includes('防御属性')
            ? '防御'
            : '?';
      layers.push({ phase: i < prepEnd ? 'prep' : 'battle', round, target: String(ev.unitId), kind });
    }
    if (ev.statusType === 'damage_boost') {
      const m = detail.match(/(\d+(?:\.\d+)?)%/);
      const side = myIds.has(String(ev.unitId)) ? '我方' : '敌方';
      const dir = detail.includes('造成的') ? 'caused' : detail.includes('受到的') ? 'taken' : '?';
      boostRates.push(
        `${i < prepEnd ? '准备阶段' : `R${round}`} ${side}/${dir}=${m ? m[1] + '%' : detail.slice(0, 24)}`
      );
    }
  });
  return { layers, boostRates, dots };
}

const summarize = (rows: Flat[]) => {
  const key = (r: Flat) => `${r.phase === 'prep' ? '准备阶段' : `第${r.round}回合`}/${r.kind}`;
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k}×${v}`).join(' · ') || '（无）';
};

const CASES: Array<{ label: string; core: string; coreLabel: string; extra: string[]; wgSpeed?: number }> = [
  { label: 'A 吕蒙（卫瓘裸速 82 < 吕蒙 88）', core: 'lvmeng', coreLabel: '吕蒙', extra: ['shenbing_tianjiang', 'dashang_sanjun'] },
  {
    label: 'B 吕蒙（卫瓘加点速度 → 先手）',
    core: 'lvmeng',
    coreLabel: '吕蒙',
    extra: ['shenbing_tianjiang', 'dashang_sanjun'],
    wgSpeed: 40,
  },
  { label: 'C 月英（卫瓘裸速 82 > 月英 47，天然先手）', core: 'h20', coreLabel: '黄月英', extra: ['shenbing_tianjiang', 'dashang_sanjun'] },
  { label: 'D 灵帝（卫瓘裸速 82 < 灵帝 102）', core: 'h101', coreLabel: '灵帝', extra: ['shenbing_tianjiang', 'dashang_sanjun'] },
  {
    label: 'E 灵帝（卫瓘加点速度 → 先手）',
    core: 'h101',
    coreLabel: '灵帝',
    extra: ['shenbing_tianjiang', 'dashang_sanjun'],
    wgSpeed: 40,
  },
];

const main = async () => {
  await initHeroDB();
  const wgBase = level40(getGeneral('weiguan'));
  console.log(`卫瓘 40 级裸速=${wgBase.speed}；吕蒙=${level40(getGeneral('lvmeng')).speed}；` +
    `月英=${level40(getGeneral('h20')).speed}；灵帝=${level40(getGeneral('h101')).speed}\n`);

  for (const c of CASES) {
    for (const seed of [7, 21]) {
      const wg = ally('weiguan', '中军', [], c.wgSpeed !== undefined ? { speed: c.wgSpeed } : {});
      const core = ally(c.core, '大营', c.extra);
      const third = ally('h23', '前锋', []);
      const report = runBattle({ myTeam: [third, wg, core], enemyTeam: ENEMY(), seed, maxRounds: 8 });
      const myIds = new Set<string>([third.id, wg.id, core.id].map(String));
      const { layers, boostRates, dots } = classify(report, myIds);
      const wgLayers = layers.filter((l) => l.target === 'weiguan');
      const coreLayers = layers.filter((l) => l.target === c.core);
      console.log(`--- ${c.label} · seed=${seed} ---`);
      console.log(`  卫瓘 生效速度=${wg.speed}  vs ${c.coreLabel} ${core.speed}`);
      console.log(`  卫瓘自身叠层：${summarize(wgLayers)}`);
      console.log(`  ${c.coreLabel} 叠层：${summarize(coreLayers)}`);
      console.log(`  神兵/大赏 落地：${boostRates.slice(0, 8).join(' | ') || '（无）'}`);
      if (c.core === 'h101' || c.core === 'h20') {
        console.log(`  该队 DoT 跳伤（前 6 条）：${dots.slice(0, 6).join(' | ') || '（无）'}`);
      }
    }
  }

  // 附加：灵帝 帝临回光 的恐慌伤害在第几回合由谁结算（证明它不是「准备阶段算伤害」）
  {
    const wg = ally('weiguan', '中军', [], { speed: 40 });
    const core = ally('h101', '大营', []);
    const report = runBattle({ myTeam: [ally('h23', '前锋', []), wg, core], enemyTeam: ENEMY(), seed: 7, maxRounds: 8 });
    const dots = (report.events as any[])
      .filter((e) => e.type === 'dot_tick')
      .map((e) => `R${String(e.round ?? '?')}:${e.dotType ?? ''}:${e.damage}`);
    console.log(`\n--- 灵帝 帝临回光 恐慌跳伤（前 10 条）---\n  ${dots.slice(0, 10).join(' | ') || '（无）'}`);
    const panics = (report.events as any[]).filter(
      (e) => e.type === 'status_inflicted' && String(e.detail ?? '').includes('恐慌')
    );
    console.log(`  恐慌挂载条数=${panics.length}（应在第 3 回合准备阶段之外的 delayedOutputs/delayedOutput 时才挂）`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
