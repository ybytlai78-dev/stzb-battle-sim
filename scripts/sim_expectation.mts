/**
 * L2 伤害期望模型 · 离线跑批（真引擎模拟测评）
 * ---------------------------------------------------------------------------
 * 与页面「模拟测评」区**同一套逻辑**（`web/simExpectation.ts`）：
 *   靶子 = 不还手的木桩 ×3（不放战法、不普攻）→ 逐槽粗筛 3 场 → 组合榜单前十 → 决赛 ≥20 场 → 伤害期望排行。
 *
 * 用法（默认：拿「已识别敌对队伍集」里我方队的配置当待测队伍，清出每个将最后一个可学槽来搜）：
 *   npx tsx scripts/sim_expectation.mts
 *   npx tsx scripts/sim_expectation.mts --team 我方·SP太史慈曹植陆抗 --clear 0-2,1-2,2-2
 *   npx tsx scripts/sim_expectation.mts --keep 10 --top 10 --coarse 3 --final 20 --troops 30000
 *   npx tsx scripts/sim_expectation.mts --candidates shenbing_tianjiang,dashang_sanjun   # 收窄候选（快跑）
 *   npx tsx scripts/sim_expectation.mts --out docs/L2模拟期望测评报告.md
 *
 * 参数：
 *   --team <名>       待测队伍（队伍集.json 里的 name；缺省取第一支「我方·」）
 *   --clear a-b,c-d   把指定「将序-槽序」槽位清空参与匹配（缺省 = 每个将最后一个「可学」槽位；主战法槽不碰）
 *   --match <0,1>     参与匹配的将（缺省 = 自动识别的核心将；其余将战法原样保留）
 *   --core <0,1>      排序目标的核心将（缺省 = 自动识别：主战法带伤害段且属性最高者）
 *   --coarse <n>      粗筛场次（默认 3）
 *   --final <n>       决赛场次（默认 20，下限 20）
 *   --keep <n>        每个将粗筛后保留的选项数（默认 10；双槽将的选项 = 成对组合）
 *   --paircars <n>    双槽将的配对基准数（默认 10：单挂前 N 名 × 全部候选，成对评估）
 *   --top <n>         组合榜单前 N 支进决赛（默认 32）
 *   --maxcombo <n>    组合评估上限（默认 1000）
 *   --rank <t|f>      排序依据：t = 整局总伤（默认）、f = 前三回合总伤
 *   --troops <n>      木桩单只兵力（默认 150000；伤害公式不看目标兵力，给足只为不被兵力截断）
 *   --def <n> --str <n> --troop <cavalry|infantry|archer>  木桩属性（缺省取配置里的「目标」栏）
 *   --candidates <ids> 候选战法池（逗号分隔；缺省 = 全部可学战法）
 *   --seed <n>        基种子（默认 20260922）
 *   --out <path>      报告输出路径（默认 docs/L2模拟期望测评报告.md）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TroopType } from '../src/engine/types';
import { fmt } from '../web/roundChart';
import { autoCoreUnits } from '../web/simExpectation';
import { HERO_RECORDS } from '../web/heroes';
import {
  dummyLabel,
  simExpectationSteps,
  skillName,
  FINAL_RUNS_MIN,
  type SimExpectResult,
} from '../web/simExpectation';
import type { ViewCfg } from '../web/teamConfig';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
function arg(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const pct = (v: number, digits = 1): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;

/** 待测队伍：从「已识别敌对队伍集」里取（深拷一份：本脚本会清空槽位，不能改共享数据） */
interface TeamSetEntry {
  name: string;
  cfg: ViewCfg;
}
const teamSet = JSON.parse(fs.readFileSync(path.join(rootDir, '已识别敌对队伍集/队伍集.json'), 'utf8')) as TeamSetEntry[];

const want = arg('team');
const picked = (want ? teamSet.find((t) => t.name === want) : teamSet.find((t) => t.name.startsWith('我方'))) ?? teamSet[0];
if (!picked) throw new Error('队伍集为空：先跑 scripts/scan_team.mts 归档识别结果');
const my = picked;
const cfg = JSON.parse(JSON.stringify(my.cfg)) as ViewCfg;

// 木桩属性：缺省取配置里的「目标」栏，可用 --def/--str/--troop 覆盖
const troopArg = arg('troop');
if (troopArg) cfg.enemy.troopType = troopArg as TroopType;
cfg.enemy = {
  defense: Number(arg('def', String(cfg.enemy.defense))),
  strategy: Number(arg('str', String(cfg.enemy.strategy))),
  troopType: cfg.enemy.troopType,
};
const troops = Number(arg('troops', '150000'));

// ── 参与匹配的将：--match 指定；缺省 = 自动识别的核心将（其余将原装战法一个都不动） ──
const matchSpec = arg('match');
const matchUnits = matchSpec
  ? matchSpec.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  : autoCoreUnits(cfg);

// ── 空槽位：--clear 指定；缺省 = **参与匹配的每个将**的全部「可学」槽位（最多 2 格 → 双槽将走成对评估）
//    （截图识别的配置把主战法记在 skillIds[0]，主战法不能被替换，故跳过它）
//    未参与匹配的将：原装战法原样保留（只搜核心将的槽） ──
const clearSpec = arg('clear');
const clearSlots: Array<[number, number]> = [];
const skippedMain: string[] = [];
if (clearSpec) {
  for (const s of clearSpec.split(',')) {
    const [u, k] = s.split('-').map((v) => Number(v));
    clearSlots.push([u, k]);
  }
} else {
  for (const i of matchUnits) {
    const slot = cfg.slots[i];
    if (!slot) continue;
    const main = HERO_RECORDS[slot.heroId]?.mainSkillId;
    const learnable = slot.skillIds
      .map((id, k) => ({ id, k }))
      .filter((x) => Boolean(x.id) && x.id !== main)
      .map((x) => x.k);
    const picked = learnable.slice(-2); // 面板每将 2 个可学战法槽（SKILL_SLOTS）
    if (!picked.length) picked.push(slot.skillIds.length); // 没有可学槽 → 追加一格新槽位
    for (const k of picked) clearSlots.push([i, k]);
    if (main) skippedMain.push(...slot.skillIds.map((_, k) => `${i}-${k}`).filter((key) => !picked.includes(Number(key.split('-')[1]))));
  }
}

/** 被清掉的「原装战法」（用于回答「搜出来的比玩家实际带的强吗」）；未参与匹配的将不碰 */
const originalPicks = new Map<string, string>();
const keptUnits: string[] = [];
for (const [u, k] of clearSlots) {
  const slot = cfg.slots[u];
  if (!slot) continue;
  if (!matchUnits.includes(u)) {
    // --clear 指到了不参与匹配的将：不动它，只记账
    keptUnits.push(`${u}-${k}`);
    continue;
  }
  const original = slot.skillIds[k];
  if (original) originalPicks.set(`${u}-${k}`, original);
  if (slot.skillIds.length > k) slot.skillIds[k] = '';
  while (slot.skillIds.length < k) slot.skillIds.push('');
}

const opts = {
  coarseRuns: Number(arg('coarse', '3')),
  finalRuns: Math.max(FINAL_RUNS_MIN, Number(arg('final', String(FINAL_RUNS_MIN)))),
  unitKeep: Number(arg('keep', '32')),
  pairCarriers: Number(arg('paircars', '10')),
  coarseTop: Number(arg('top', '32')),
  maxCombos: Number(arg('maxcombo', '1000')),
  rankBy: (arg('rank', 't') === 'f' ? 'first3' : 'total') as 'total' | 'first3',
  dummyTroops: troops,
  baseSeed: Number(arg('seed', '20260922')),
  candidateIds: arg('candidates')?.split(',').map((s) => s.trim()).filter(Boolean),
  /** 参与匹配的将（缺省 = 自动识别的核心将） */
  matchUnits,
  /** 排序目标的核心将（缺省 = 自动识别；--core all = 全队总伤口径） */
  coreUnits:
    arg('core') === 'all'
      ? cfg.slots.map((_, i) => i)
      : arg('core')?.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)),
};

process.stderr.write(
  `[sim_expectation] 待测队伍：${my.name} ｜ 靶子：${dummyLabel(cfg.enemy, troops)}（不还手）\n` +
    `  空槽位：${clearSlots.map(([u, k]) => `${u}-${k}`).join(', ')}` +
    `（原装：${[...originalPicks.values()].map((id) => skillName(id)).join(' / ') || '无'}）` +
    `${skippedMain.length ? ` · 跳过主战法槽 ${skippedMain.join(', ')}` : ''}\n` +
    `  粗筛 ${opts.coarseRuns} 场 · 每将保留 ${opts.unitKeep} · 配对基准 ${opts.pairCarriers} · 榜单前 ${opts.coarseTop} 进决赛 · 决赛 ${opts.finalRuns} 场\n`
);

const t0 = Date.now();
const gen = simExpectationSteps(cfg, opts);
let step = gen.next();
let seen = 0;
while (!step.done) {
  seen += 1;
  if (seen % 200 === 0) {
    const p = step.value;
    const phase = p.phase === 'slot' ? '逐槽粗筛' : p.phase === 'combo' ? '组合粗筛' : '决赛';
    process.stderr.write(`\r  跑批中… ${p.battle} 场（${phase} ${p.phaseDone}/${p.phaseTotal}）`);
  }
  step = gen.next();
}
process.stderr.write(`\r  跑批完成：${step.value.battles} 场 / ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
const res: SimExpectResult = step.value;
process.stderr.write(
  `  参与匹配：${res.matchLabel} ｜ 排序口径：核心将「${res.coreLabel}」伤害期望 ｜ 空槽位 ${res.slots.length} 个\n`
);

// ─────────────────────────── 报告 ───────────────────────────

const lines: string[] = [];
lines.push('# L2 伤害期望 · 模拟测评报告（真引擎）');
lines.push('');
lines.push('> 生成：`npx tsx scripts/sim_expectation.mts`（与页面「模拟测评」区同一套逻辑：`web/simExpectation.ts`）');
lines.push('');
lines.push('## 0. 口径');
lines.push('');
lines.push('- **本报告只算伤害期望**：胜率 / 平局 / 兵力优势是 L4（`battle-sim.html`）的事，这里不掺。');
lines.push(
  `- **靶子 = 不还手的木桩 ×3**：不放战法、不普攻（引擎 \`BattleConfig.inertSides\`），只挨打；属性 = ${dummyLabel(
    cfg.enemy,
    troops
  )}；我方打在木桩身上的 DoT / 延迟伤害照常结算。`
);
lines.push(
  `- **三阶段**：① 逐将粗筛 = 每个候选战法 **${opts.coarseRuns} 场**（**双槽将按成对组合评估**：单挂前 ${opts.pairCarriers} 名当搭子基准、与全部候选各配一次——击势这类"要带满槽才见效"的增伤战法不会被单挂成绩误杀）→ 每将保留前 ${opts.unitKeep} 个选项；② 组合粗筛榜单 = 整队组合各 **${opts.coarseRuns} 场** → 前 ${opts.coarseTop} 支进决赛；③ 决赛 = 每支 **${opts.finalRuns} 场**（下限 ${FINAL_RUNS_MIN}）→ 汇总伤害期望排行。`
);
lines.push('- **只填空槽**：已指定战法的槽位原样保留、不进候选池（守全队战法唯一）；候选池 = 全部可学战法 − 队内已占用。');
lines.push(
  `- **排序口径 = 核心将「${res.coreLabel}」的伤害期望**（可多选核心 → 求和），**不是全队总伤**：辅助战法的强度不随施法者属性变` +
    `（实测「计险远近」放谁都是 44,699）→ 用总伤排时大量并列、搜索随手挑一个，就会出现「主C带辅助、辅助带输出」；` +
    `改成核心将口径后，输出战法只有放在核心将身上才涨目标，定位自然落位。全队总伤只作参考列。`
);
lines.push(`- **参与匹配的将**：${res.matchLabel}（其余将的战法原样保留、不参与搜索，对齐 L3 优化器的 \`unitIdxs\`）。`);
lines.push(
  `- **复现**：种子 = 基种子 ${opts.baseSeed} + 场次（同一场次对所有候选一致 → 配对比较），奇数场交换场地；木桩方视角随交换场地翻转。`
);
lines.push('');
lines.push('## 1. 本次跑批');
lines.push('');
lines.push('| 项 | 值 |');
lines.push('|---|---|');
lines.push(`| 待测队伍 | ${my.name} |`);
lines.push(`| 靶子 | ${dummyLabel(cfg.enemy, troops)}（不还手） |`);
lines.push(`| 参与匹配的将 | ${res.matchLabel} |`);
lines.push(`| 排序口径（核心将） | ${res.coreLabel} 的伤害期望 |`);
lines.push(`| 参与匹配的空槽位 | ${res.slots.map((s) => `${s.unitName}·槽${s.slot + 1}`).join('、') || '（无）'} |`);
lines.push(`| 候选战法 | ${res.candidateCount} 个（排除队内已占用 ${res.candidateSkipped}） |`);
lines.push(
  `| 组合粗筛 | 评估 ${res.combos.length} 个组合（${res.distinctCombos} 套不同战法）${res.combosCapped ? '，达到评估上限、更靠后的没跑' : ''} |`
);
lines.push(`| 进决赛 | ${res.finals.length} 支（不同战法套）× ${opts.finalRuns} 场 |`);
lines.push(`| 真跑场次 | ${res.battles} 场（耗时 ${(res.ms / 1000).toFixed(1)}s） |`);
lines.push(`| 时间窗 | ${opts.rankBy === 'first3' ? '前三回合' : '整局'} |`);
lines.push('');

lines.push(`## 2. 逐将粗筛（按核心将「${res.coreLabel}」伤害排序；双槽将按**成对组合**评估）`);
lines.push('');
for (const unit of res.coarse) {
  const origKeys = unit.slots
    .map((slot) => originalPicks.get(`${unit.unit}-${slot}`))
    .filter((v): v is string => Boolean(v));
  const origRow = origKeys.length
    ? unit.rows.find((r) => r.picks.map((p) => p.skillId).sort().join('+') === [...origKeys].sort().join('+'))
    : undefined;
  lines.push(
    `### ${unit.unitName}（${unit.mode === 'pair' ? '**双槽·成对评估**' : '单槽'}：槽${unit.slots
      .map((s) => s + 1)
      .join(' + 槽')}，${unit.rows.length} 个${unit.mode === 'pair' ? '组合' : '候选'} × ${opts.coarseRuns} 场）`
  );
  lines.push('');
  if (origRow) {
    lines.push(
      `> 玩家原装（${origRow.label}）排第 **${origRow.rank}** / ${unit.rows.length}（核心将场均 ${fmt(origRow.meanCore)}）。`
    );
    lines.push('');
  } else if (origKeys.length) {
    lines.push(`> 玩家原装（${origKeys.map((id) => skillName(id)).join(' + ')}）未出现在前 10 名。`);
    lines.push('');
  }
  lines.push('| 名次 | 战法组合 | 逐场（核心将伤害） | 核心将·整局 | 全队·整局 | 核心将·前三 | 结论 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of unit.rows.slice(0, 10)) {
    lines.push(
      `| ${r.rank} | ${r.label}${r.from === 'single' && unit.mode === 'pair' ? '（单挂）' : ''} | ${r.damages
        .map((d) => fmt(d))
        .join(' / ')} | ${fmt(r.meanCore)} | ${fmt(r.meanTotal)} | ${fmt(r.meanCoreFirst3)} | ${
        r.kept ? `进组合（前 ${opts.unitKeep}）` : '淘汰'
      } |`
    );
  }
  if (unit.rows.length > 10) lines.push(`| … | 其余 ${unit.rows.length - 10} 个已淘汰 | | | | | |`);
  lines.push('');
}

lines.push('## 3. 组合粗筛榜单（前 20 名）');
lines.push('');
lines.push(
  `> 评估 ${res.combos.length} 个组合（${res.distinctCombos} 套不同战法）——换将 / 换槽的排列常打出完全一样的结果，` +
    `进决赛按「不同战法套」取前 ${opts.coarseTop}，同一套只保留成绩最好的一种排法（表里标「同套」）。`
);
lines.push('');
lines.push('| 名次 | 整队战法组合 | 逐场（核心将伤害） | 核心将·整局 | 全队·整局 | 核心将·前三 | 结论 |');
lines.push('|---|---|---|---|---|---|---|');
for (const c of res.combos.slice(0, 20)) {
  const tag = c.advanced
    ? `进决赛（前 ${opts.coarseTop} 套）`
    : c.duplicateOf !== null
      ? `同套（与第 ${c.duplicateOf} 名）`
      : '止步粗筛';
  lines.push(
    `| ${c.rank} | ${c.label} | ${c.damages.map((d) => fmt(d)).join(' / ')} | ${fmt(c.meanCore)} | ${fmt(c.meanTotal)} | ${fmt(
      c.meanCoreFirst3
    )} | ${tag} |`
  );
}
if (res.combos.length > 20) lines.push(`| … | 其余 ${res.combos.length - 20} 个组合止步粗筛 | | | | |`);
lines.push('');

lines.push('## 4. 决赛排行：每套配置的伤害期望');
lines.push('');
lines.push(`> 排序口径 = 核心将「${res.coreLabel}」的伤害期望；「全队总伤」只作参考列，不参与排名。`);
lines.push('');
lines.push('| 排行 | 整队战法组合 | 场次 | 核心将期望 | 95% 半宽 | 标准差 | 单场区间 | 全队总伤 | 核心将·前三 | 粗筛名次 | 粗筛偏差 |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const f of res.finals) {
  lines.push(
    `| ${f.rank} | ${f.label} | ${f.runs} | **${fmt(f.mean)}** | ±${fmt(f.halfWidth)} | ${fmt(f.sd)} | ${fmt(f.min)} ~ ${fmt(
      f.max
    )} | ${fmt(f.meanTotal)} | ${fmt(f.meanFirst3)} | ${f.coarseRank} | ${pct(f.coarseBias)} |`
  );
}
lines.push('');
for (const f of res.finals) {
  lines.push(`### 排行 ${f.rank}：${f.label}`);
  lines.push('');
  lines.push(
    `- 逐将场均伤害：${f.byUnit.map((u) => `${u.core ? '★' : ''}${u.name} ${fmt(u.mean)}`).join(' ｜ ')}（★ = 核心位，计入排序目标）`
  );
  lines.push(`- 逐战法场均伤害：${f.bySkill.map((s) => `${s.name} ${fmt(s.mean)}`).join(' ｜ ') || '（无战法伤害）'}`);
  if (f.wipedRuns) lines.push(`- ⚠ 有 ${f.wipedRuns}/${f.runs} 场把木桩打空（伤害被兵力截断）→ 调大 \`--troops\` 重跑。`);
  lines.push('');
}

lines.push('## 5. 结论与自检');
lines.push('');
const med = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};
const best = res.finals[0];
const second = res.finals[1];
if (best) {
  const overlap = second ? Math.abs(best.mean - second.mean) < best.halfWidth + second.halfWidth : false;
  const worstBias = res.finals.reduce((a, b) => (Math.abs(a.coarseBias) > Math.abs(b.coarseBias) ? a : b), best);
  lines.push(
    `1. **本次最优搭配**：${best.label} —— 核心将「${res.coreLabel}」${best.runs} 场场均 **${fmt(best.mean)}**（±${fmt(
      best.halfWidth
    )}，95%），单场区间 ${fmt(best.min)} ~ ${fmt(best.max)}（标准差 ${fmt(best.sd)}）；全队总伤 ${fmt(best.meanTotal)}。`
  );
  if (second) {
    lines.push(
      `2. **领先第二名**：比「${second.label}」${pct((best.mean - second.mean) / (second.mean || 1))}；两套 95% 区间${
        overlap ? '**有重叠**（差距不够显著 → 加大 --final 再判）' : '不重叠'
      }。`
    );
  }
  lines.push(
    `3. **3 场粗筛够不够**：同一组合「粗筛 ${opts.coarseRuns} 场」与决赛 ${opts.finalRuns} 场偏差最大的是「${
      worstBias.label
    }」${pct(worstBias.coarseBias)}；粗筛榜单排序与决赛排序成对一致率 **${(res.rankAgreement * 100).toFixed(0)}%** —— 3 场只用来淘汰。`
  );
  lines.push(
    `4. **木桩截断自检**：${
      res.wipedCombos ? `${res.wipedCombos} 个组合把木桩打空（期望偏低）→ 把 --troops 调大` : '没有组合把木桩打空，伤害没有被兵力截断'
    }。`
  );
  lines.push(
    `5. **旧解析口径对照**（仅历史参考）：解析值相对模拟期望的中位偏差 整局 **${pct(
      med(res.finals.map((f) => f.deltaTotal))
    )}**、前三回合 **${pct(med(res.finals.map((f) => f.deltaFirst3)))}**（正 = 模拟更高）。解析按抽象目标模板算、不含控制 / 规避 / 兵力截断，两条口径不一样。`
  );
  if (originalPicks.size) {
    lines.push(
      `6. **对比玩家原装**：原装战法 ${[...originalPicks.values()].map((id) => skillName(id)).join(' / ')} —— 名次见第 2 节各槽位表（粗筛口径）。`
    );
  }
}
lines.push('');
lines.push('## 6. 复现');
lines.push('');
lines.push('```bash');
lines.push('# 页面：npm run web → /round-model.html → 「模拟测评」区（同样口径、同样可配参数）');
lines.push('# 脚本：');
lines.push(
  `npx tsx scripts/sim_expectation.mts --team "${my.name}" --clear ${clearSlots.map(([u, k]) => `${u}-${k}`).join(',')} ` +
    `--coarse ${opts.coarseRuns} --final ${opts.finalRuns} --keep ${opts.unitKeep} --paircars ${opts.pairCarriers} --top ${opts.coarseTop} --rank ${
      opts.rankBy === 'first3' ? 'f' : 't'
    } --troops ${troops}`
);
lines.push('```');
lines.push('');

const outPath = path.resolve(rootDir, arg('out', 'docs/L2模拟期望测评报告.md')!);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
process.stdout.write(lines.join('\n'));
process.stderr.write(`[sim_expectation] 报告已写入 ${path.relative(rootDir, outPath)}\n`);
