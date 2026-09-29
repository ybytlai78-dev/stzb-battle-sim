/**
 * 战斗诊断文本渲染（纯函数，只读）：把 `diagnoseBattle` / `diagnoseBatch` 的结构化结果
 * 排成人能读的战报。数字全部来自诊断结果本身，渲染层不做任何计算（除千分位/百分号格式）。
 */
import type {
  BatchDiagnosis, BattleDiagnosis, CauseFinding, CommonIssue, CounterPairRow, SideDiagnosis,
} from './diagnosis';

const LINE = '─'.repeat(64);

function fmt(n: number): string {
  const v = Math.round(n);
  return (v === 0 ? 0 : v).toLocaleString('en-US');
}

function signed(n: number): string {
  const v = Math.round(n);
  return `${v > 0 ? '+' : ''}${(v === 0 ? 0 : v).toLocaleString('en-US')}`;
}

function pct(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

/** 中英混排对齐：按显示宽度补空格（中文/全角算 2 列） */
function pad(s: string, width: number): string {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, width - w));
}

function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd();
}

function counterDir(p: CounterPairRow): string {
  if (p.expectedReduce > 0) return `被克 −${Math.round(p.expectedReduce * 100)}%`;
  return `反克 +${Math.round(-p.expectedReduce * 100)}%`;
}

function sideSection(s: SideDiagnosis, side: 'my' | 'enemy'): string[] {
  const out: string[] = [];
  const tag = side === 'my' ? '我方' : '敌方';
  const l = s.ledger;
  out.push(`【${tag}】总伤害 ${fmt(s.totalDamage)}（兵力基础 ${fmt(l.troopBase)} + 受增减伤作用分量 ${fmt(Math.max(0, s.totalDamage - l.troopBase))}）`);
  const usableDelta = l.entries.reduce((a, x) => a + x.amount, 0);
  out.push(
    `  因果账本（只作用于 base+main 分量）：基线 ${fmt(l.baseline)} ${signed(usableDelta)} = 实际 ${fmt(Math.max(0, s.totalDamage - l.troopBase))}` +
      `；分类：增伤 ${signed(l.byKind.boost)} / 减伤 ${signed(l.byKind.reduce)} / 克制 ${signed(l.byKind.counter)}${l.byKind.trait ? ` / 兵种特性 ${signed(l.byKind.trait)}` : ''}`
  );
  if (l.entries.length > 0) {
    out.push(row(['  来源', '方向', '绝对贡献', '命中', '均值', '施加者/受击方'], [22, 6, 12, 6, 8, 24]));
    for (const e of l.entries.slice(0, 10)) {
      out.push(
        row(
          [
            `  ${e.skillName}`,
            e.direction === 'caused' ? '造成+ ' : e.direction === 'taken' ? '受到+ ' : '减伤',
            signed(e.amount),
            `${e.hits}`,
            `${Math.round(e.avgRate * 1000) / 10}%`,
            e.byUnit.map((u) => `${u.name} ${signed(u.amount)}`).join('、'),
          ],
          [22, 6, 12, 6, 8, 24]
        )
      );
    }
    if (l.entries.length > 10) out.push(`  …另有 ${l.entries.length - 10} 条来源（见 JSON）`);
  } else {
    out.push('  因果账本：本场没有任何增减伤/克制归因（无归因路径之外无账本条目）');
  }
  if (l.unattributed > 0) out.push(`  无归因路径（预存伤害等不吃增减伤）：${fmt(l.unattributed)}`);
  if (l.cappedLoss > 0) out.push(`  兵力截断（applyTroopCap）损失：${fmt(l.cappedLoss)}`);
  if (l.clampedHits > 0) out.push(`  触底事件（增减伤净额 ≤ −90%，按 10% 结算）：${l.clampedHits} 条，账本按比例分摊`);
  out.push(`  账本闭合自检：Σ来源贡献 −（可作用分量 − 基线）= ${l.closedCheck}（应为 0）`);

  // 贡献排名
  out.push('');
  out.push(row(['  武将', '总伤害', '占比', '普攻', '战法', 'DoT', '分兵', '恢复', '控制占比'], [14, 10, 7, 9, 9, 8, 8, 9, 9]));
  for (const u of s.damageBySource) {
    out.push(
      row(
        [
          `  ${u.name}`,
          fmt(u.damage),
          pct(u.damagePct),
          fmt(u.attackDamage),
          fmt(u.skillDamage),
          fmt(u.dotDamage),
          fmt(u.splitDamage),
          fmt(u.heal),
          pct(u.controlPct),
        ],
        [14, 10, 7, 9, 9, 8, 8, 9, 9]
      )
    );
  }

  // 控制
  const c = s.control;
  out.push('');
  out.push(`  控制：被控 ${c.takenRounds}/${c.actedRounds} 单位回合（${pct(c.takenPct)}）；施加控制覆盖敌方 ${c.dealtRounds}/${c.enemyActedRounds}（${pct(c.dealtPct)}）` +
    (c.unattributedDealtRounds ? `；另有 ${c.unattributedDealtRounds} 回合控制施加者无法推定` : ''));
  const takenRows = c.taken.filter((x) => x.controlledRounds > 0).sort((a, b) => b.controlledRounds - a.controlledRounds);
  for (const t of takenRows) {
    const types = Object.entries(t.byType).map(([k, v]) => `${k}×${v}`).join('、');
    out.push(`    ${t.name}：被控 ${t.controlledRounds}/${t.actedRounds}（${pct(t.controlledPct)}）｜${types}｜流失判定机会 ${t.skippedActiveAttempts} 次`);
  }
  if (c.evidence.length > 0) out.push(`    事件佐证：${c.evidence.map((e) => `${e.reason}×${e.count}`).join('、')}`);

  // 克制
  out.push('');
  out.push(`  兵种克制：被克 ${s.counters.counteredHits} 条（损失 ${fmt(s.counters.counteredLoss)}）；反克 ${s.counters.favoredHits} 条（收益 ${fmt(s.counters.favoredGain)}）；归因实交 ${s.counters.confirmedHits}/${s.counters.expectedHits}（${pct(s.counters.compliancePct)}）`);
  for (const p of s.counters.pairs.slice(0, 6)) {
    out.push(
      `    ${p.attackerName}（${p.attackerTroop}）→ ${p.targetName}（${p.targetTroop}）｜${counterDir(p)}｜${p.hits} 条伤害 ${fmt(p.damage)}｜影响 ${signed(p.impact)}｜实交 ${p.confirmedHits}/${p.hits}${p.clampedHits ? `｜触底 ${p.clampedHits}` : ''}`
    );
  }
  if (s.counters.exceptions.length > 0) out.push(`    例外：${s.counters.exceptions.map((e) => `${e.reason}×${e.count}`).join('、')}`);

  // 效果覆盖
  out.push('');
  out.push('  效果覆盖（增益/减益，按携带方）：');
  out.push(row(['    效果', '类别', '施加', '覆盖单位回合', '覆盖率', '平均持续', '推定来源'], [18, 6, 7, 14, 9, 10, 20]));
  for (const e of s.effects.slice(0, 12)) {
    out.push(
      row(
        [
          `    ${e.name}`,
          e.kind,
          `${e.appliedCount}`,
          `${e.coveredUnitRounds}/${e.eligibleUnitRounds}`,
          pct(e.coveragePct),
          `${e.avgDurationRounds} 回合`,
          e.sources.length ? e.sources.map((x) => x.skillName).join('、') : '—',
        ],
        [18, 6, 7, 14, 9, 10, 20]
      )
    );
  }
  if (s.effects.length > 12) out.push(`    …另有 ${s.effects.length - 12} 类效果（见 JSON）`);

  // 主战法
  out.push('');
  out.push('  主战法空转证据：');
  if (s.mainSkills.length === 0) out.push('    （战报未携带 mainSkillId，无法定位主战法）');
  for (const m of s.mainSkills) {
    out.push(
      `    ${m.name}【${m.skillName}】(${m.skillType}${m.oneTime ? '·一次性' : ''})：` +
        `行动 ${m.actedRounds} 回合｜释放 ${m.casts} 次${m.castSemantics === 'effect_rounds' ? '（按生效回合计）' : ''}｜判定 ${m.triggers} 次（失败 ${m.triggerFailures}）` +
        (m.castSemantics === 'skill_cast' ? `｜实际发动率 ${pct(m.castRatePct)}` : '') +
        `｜空放 ${m.noEffectCasts}｜准备 ${m.prepareStarts}（跳过 ${m.prepareSkips}/中断 ${m.prepareFailed}）`
    );
    out.push(
      `      有效生效 ${m.effectiveRounds} 回合｜被控跳过 ${m.controlledSkips}｜准备中 ${m.preparingRounds}｜**空转 ${m.idleRounds} 回合（${pct(m.idleRatePct)}）**｜` +
        `产出伤害 ${fmt(m.damage)}${m.heal ? ` / 恢复 ${fmt(m.heal)}` : ''}${m.statusApplied ? ` / 状态 ${m.statusApplied} 次` : ''}｜每有效回合均伤 ${fmt(m.avgDamagePerEffectiveRound)}`
    );
    for (const e of m.evidence.slice(0, 6)) out.push(`      · ${e.detail}`);
    if (m.evidence.length > 6) out.push(`      · …另有 ${m.evidence.length - 6} 条证据`);
  }

  // 顺序缺口
  out.push('');
  out.push(`  技能顺序缺口（先打伤害、后施加增伤）：${s.orderGaps.length} 处`);
  for (const g of s.orderGaps.slice(0, 8)) {
    out.push(
      `    第 ${g.round} 回合 · ${g.unitName}【${g.skillName}】早于【${g.buffSkillName}】${g.direction === 'caused' ? '+' : ''}${Math.round((g.rate ?? 0) * 100)}%` +
        `（${g.scope === 'self' ? '自身槽位顺序' : '同窗口他人效果'}，事件 #${g.eventIndex}，可受益分量 ${fmt(g.usable)}，估算少打 ${g.estimatedMissed !== undefined ? fmt(g.estimatedMissed) : '未量化'}）`
    );
  }
  if (s.orderGaps.length > 8) out.push(`    …另有 ${s.orderGaps.length - 8} 处（见 JSON）`);

  return out;
}

function findingLine(f: CauseFinding): string {
  return `${f.label}：影响 ${signed(f.impact)}｜证据 ${f.evidenceCount} 条｜${f.confidence === 'confirmed' ? '实证' : '估算'}\n    ${f.detail}`;
}

/** 单场诊断 → 文本 */
export function diagnosisToText(d: BattleDiagnosis): string {
  const out: string[] = [];
  out.push('═'.repeat(24) + ` 战斗诊断 · ${d.label} ` + '═'.repeat(24));
  out.push(
    `结果 ${d.result === 'win' ? '胜' : d.result === 'loss' ? '负' : '平'} · 回合 ${d.rounds}/${d.maxRounds} · 事件 ${d.eventCount} 条 · 诊断版本 ${d.version}`
  );
  out.push('');
  out.push('■ 归因结论（伤害差异到底是哪个）');
  out.push(`  ${d.verdict.summary}`);
  for (const f of d.verdict.findings) out.push(`  · ${findingLine(f)}`);
  out.push('');
  out.push('■ 病灶清单（阈值见尾注）');
  if (d.issues.length === 0) out.push('  未发现达到阈值的病灶');
  for (const i of d.issues) {
    out.push(`  [${i.severity === 'high' ? '高' : i.severity === 'medium' ? '中' : '低'}] ${i.label}：${i.detail}`);
    for (const e of i.evidence.slice(0, 6)) out.push(`      · ${e}`);
    if (i.evidence.length > 6) out.push(`      · …另有 ${i.evidence.length - 6} 条证据`);
  }
  out.push('');
  out.push(LINE);
  out.push('■ 我方');
  out.push(...sideSection(d.my, 'my'));
  out.push('');
  out.push(LINE);
  out.push('■ 敌方');
  out.push(...sideSection(d.enemy, 'enemy'));
  out.push('');
  out.push(LINE);
  out.push('■ 口径与提示');
  for (const n of d.notes) out.push(`  · ${n}`);
  out.push(
    `  · 账本口径：m = clamp(1 + Σ造成侧增伤 + Σ受到侧增伤 − Σ减伤, 0.1)；基线 = (base+main)/m；每条来源贡献 = 基线 × 数值`
  );
  out.push(
    `  · 覆盖率分母 = 该侧「有行动窗口的单位回合数」；采样点 = 该单位本回合行动开始时效果是否生效`
  );
  out.push(
    `  · 空转回合 = 行动回合 − 有效生效回合 − 被控跳过 − 准备中（被控与准备单列，避免与「控制」归因重复计数）`
  );
  out.push(
    `  · 阈值：主战法空转率 ≥ ${d.thresholds.mainSkillIdleRatePct}% 或空转 ≥ ${d.thresholds.mainSkillIdleRounds} 回合；顺序缺口 ≥ ${d.thresholds.orderGapCount} 次；` +
      `被克损失占比 ≥ ${d.thresholds.counterLossSharePct}%；被控占比 ≥ ${d.thresholds.controlTakenPct}%；施加控制 ≤ ${d.thresholds.controlDealtLowPct}%（低于对手时）；` +
      `增伤收益占比 ≤ ${d.thresholds.boostGainLowSharePct}%（且带增伤战法时）；伤害缺口 ≥ ${d.thresholds.damageGapPct}%`
  );
  out.push('  · 只读：诊断不修改战报、不新增埋点、不参与战斗结算（线上零开销）');
  return out.join('\n');
}

function commonIssueLine(i: CommonIssue): string {
  return `  · ${i.label}：${i.reports}/${i.total} 场（${pct(i.sharePct)}）｜均值 ${Object.entries(i.metrics).map(([k, v]) => `${k}=${v}`).join('，')}\n    ${i.detail}`;
}

/** 批量诊断 → 文本 */
export function batchDiagnosisToText(b: BatchDiagnosis): string {
  const out: string[] = [];
  out.push('═'.repeat(20) + ` 批量战斗诊断 · ${b.total} 场 / ${b.groups.length} 组 ` + '═'.repeat(20));
  out.push(b.summary);
  out.push('');
  out.push('■ 分组（按队伍指纹自动识别：武将+槽位战法+等级+双方阵容）');
  out.push(row(['  组', '场次', '胜率', '场均伤害', '场均敌方', '每回合伤害'], [30, 6, 8, 12, 12, 12]));
  for (const g of b.groups) {
    out.push(
      row(
        [`  ${g.label}`, `${g.reports}`, pct(g.winRatePct), fmt(g.avgDamage), fmt(g.avgEnemyDamage), fmt(g.metrics.damagePerRound)],
        [30, 6, 8, 12, 12, 12]
      )
    );
  }
  out.push('');
  out.push('■ 同阵容共性问题（组内出现率 ≥ 阈值）');
  let any = false;
  for (const c of b.common) {
    out.push(`  ▸ ${c.group.label}（${c.group.reports} 场）`);
    if (c.issues.length === 0) {
      out.push(`    无共性问题${c.notes.length ? `（${c.notes.join('；')}）` : ''}`);
      continue;
    }
    any = true;
    for (const i of c.issues) out.push(commonIssueLine(i));
  }
  if (!any) out.push('  （无）');
  out.push('');
  out.push('■ 跨阵容差异因子（最高 vs 最低伤害组；相关对照，非因果证明）');
  if (!b.comparison) {
    out.push('  仅一组，无法做组间对照');
  } else {
    out.push(`  最高：${b.comparison.best.label}（每回合 ${fmt(b.comparison.best.metrics.damagePerRound)}）｜最低：${b.comparison.worst.label}（每回合 ${fmt(b.comparison.worst.metrics.damagePerRound)}）`);
    out.push(row(['  因子', '高分组', '低分组', '差值', '相对差', '方向', '说明'], [24, 12, 12, 10, 9, 10, 30]));
    for (const f of b.comparison.factors) {
      const favors = f.favors === 'best' ? '高分组占优' : f.favors === 'worst' ? '低分组反而占优' : f.favors === 'same' ? '相同' : '中性';
      out.push(row([`  ${f.label}`, `${f.best}`, `${f.worst}`, `${f.delta}`, pct(f.deltaPct), favors, f.note], [24, 12, 12, 10, 9, 10, 30]));
    }
    out.push(`  结论：${b.comparison.summary}`);
  }
  out.push('');
  out.push('  · 只读：批量诊断仅聚合既有战报事件流，不重跑引擎、不改战斗逻辑');
  return out.join('\n');
}

/** 供 JSON 导出前的轻量摘要（避免整包战报体积） */
export function diagnosisSummaryLine(d: BattleDiagnosis): string {
  return `${d.label}｜${d.result}｜我方 ${fmt(d.my.totalDamage)} vs 敌方 ${fmt(d.enemy.totalDamage)}｜主因 ${d.verdict.primary}｜病灶 ${d.issues.length} 项`;
}
