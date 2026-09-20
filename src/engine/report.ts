1
/**
 * 战报渲染：JSON（结构透传）+ 人类可读文本（CLI）
 */
import type { BattleEvent, BattleReport, UnitStats } from './types';
import { SKILL_REGISTRY } from '../data/skills';
import { computeDetailedStats } from './stats';
import { formatBonusText } from './troopBonus';

let _formationSawBonus = false;

export function reportToText(report: BattleReport): string {
  _formationSawBonus = false;
  const lines: string[] = [];
  const fmt = (n: number) => n.toLocaleString('en-US');

  lines.push('======== 战斗开始 ========');
  lines.push(`种子 ${report.seed} ｜ 最多 ${report.maxRounds} 回合`);
  lines.push(`我方：${report.myTeam.map((g) => `${g.position} ${g.name}`).join(' / ')}`);
  lines.push(`敌方：${report.enemyTeam.map((g) => `${g.position} ${g.name}`).join(' / ')}`);
  lines.push('');

  for (const ev of report.events) {
    renderEvent(lines, ev);
  }

  lines.push('');
  lines.push('======== 战斗结束 ========');
  const label = report.result === 'win' ? '胜利' : report.result === 'loss' ? '失败' : '平局';
  lines.push(`结果：${label}（${report.rounds} 回合）`);
  lines.push(`我方剩余：${report.finalMyTroops.map(fmt).join(' / ')}`);
  lines.push(`敌方剩余：${report.finalEnemyTroops.map(fmt).join(' / ')}`);
  lines.push('');
  lines.push(renderStatsTable(report.stats));
  lines.push('');
  lines.push(renderDetailedStats(report));
  return lines.join('\n');
}

function renderStatsTable(stats: UnitStats[]): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const my = stats.filter((s) => s.side === 'my');
  const enemy = stats.filter((s) => s.side === 'enemy');

  const rows: string[] = [];
  rows.push('────── 战斗统计 ──────');
  const header = '武将'.padEnd(6) + '普通攻击'.padStart(10) + '普攻伤害'.padStart(10) + '战法次数'.padStart(10) + '战法伤害'.padStart(10) + '恢复次数'.padStart(10) + '恢复兵力'.padStart(12);
  rows.push(header);
  rows.push('─'.repeat(68));

  const body = (list: UnitStats[]) =>
    list.map((s) => {
      const name = s.name.padEnd(6);
      return `${name}${String(s.attackCount).padStart(10)}${fmt(s.attackDamage).padStart(10)}${String(s.skillCount).padStart(10)}${fmt(s.skillDamage).padStart(10)}${String(s.healCount).padStart(10)}${fmt(s.healAmount).padStart(12)}`;
    });

  rows.push('── 我方 ──');
  rows.push(...body(my));
  rows.push('── 敌方 ──');
  rows.push(...body(enemy));
  rows.push('─'.repeat(68));

  const myTotal = my.reduce((acc, s) => acc + s.attackDamage + s.skillDamage, 0);
  const enemyTotal = enemy.reduce((acc, s) => acc + s.attackDamage + s.skillDamage, 0);
  rows.push(`合计 我方总伤害 ${fmt(myTotal)} ｜ 敌方总伤害 ${fmt(enemyTotal)}`);
  return rows.join('\n');
}

/** 战法级明细：每武将下列出其战法（次数 ｜ 杀伤 ｜ 恢复）——恢复战法（张机金匮要略/刘备皇裔流离等）
 *  统计「次数 1 ｜ 杀伤 0 ｜ 恢复 x」；指挥队友攻击（奇兵拒北借友军）的杀伤计入施法者战法。 */
function renderDetailedStats(report: BattleReport): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const units = [
    ...report.myTeam.map((g) => ({ general: g, side: 'my' as const, troops: 0, wounded: 0, totalDead: 0, alive: true, statuses: [], isPreparing: false, preparingSkillId: null })),
    ...report.enemyTeam.map((g) => ({ general: g, side: 'enemy' as const, troops: 0, wounded: 0, totalDead: 0, alive: true, statuses: [], isPreparing: false, preparingSkillId: null })),
  ];
  const detailed = computeDetailedStats(report.events, units);
  const lines: string[] = ['────── 战法统计（次数 ｜ 杀伤 ｜ 恢复）──────'];
  for (const d of detailed) {
    lines.push(`[${d.side === 'my' ? '红方' : '蓝方'}] ${d.name}`);
    if (d.attackCount > 0 || d.attackDamage > 0) {
      lines.push(`  · 普攻     次数 ${d.attackCount} ｜ 杀伤 ${fmt(d.attackDamage)}`);
    }
    for (const sk of d.skills) {
      const name = (SKILL_REGISTRY[sk.skillId]?.name ?? sk.skillId).padEnd(6);
      lines.push(`  · ${name} 次数 ${sk.castCount} ｜ 杀伤 ${fmt(sk.damage)} ｜ 恢复 ${fmt(sk.healAmount)}`);
    }
    if (d.attackCount === 0 && d.skills.length === 0) lines.push('  · （未行动）');
  }
  return lines.join('\n');
}

/** 渲染单个事件为文本行（供 Web 前端按准备阶段/回合分组展示） */
export function renderEventLines(ev: BattleEvent): string[] {
  const lines: string[] = [];
  renderEvent(lines, ev);
  return lines;
}

function renderEvent(lines: string[], ev: BattleEvent): void {
  const fmt = (n: number) => n.toLocaleString('en-US');
  switch (ev.type) {
    case 'battle_start':
      lines.push('────────── 准备阶段 ──────────');
      lines.push(`> 出手顺序：${ev.turnOrder.join(' > ')}`);
      break;
    case 'prep_phase':
      if (ev.phase === 'formation') {
        _formationSawBonus = false;
        lines.push('【阵容】');
      } else if (ev.phase === 'troop') {
        if (!_formationSawBonus) lines.push('  → 无部队加成');
        lines.push('【兵种】');
        lines.push('  → 暂无效果');
      } else {
        lines.push('【战法】');
      }
      break;
    case 'formation_bonus': {
      _formationSawBonus = true;
      const cat =
        ev.category === 'faction' ? '阵营加成'
          : ev.category === 'title' ? `称号加成「${ev.titleName ?? ''}」`
            : '兵种加成';
      lines.push(`  → ${ev.unitName} ${cat}：${formatBonusText(ev.bonuses)}`);
      break;
    }
    case 'preparation_end':
      lines.push('> 准备阶段结束');
      lines.push('');
      break;
    case 'round_start':
      lines.push(`────────── 第 ${ev.round} 回合 ──────────`);
      if (ev.turnOrder && ev.turnOrder.length > 0) {
        lines.push(`> 出手顺序：${ev.turnOrder.join(' > ')}`);
      }
      break;
    case 'unit_act_start':
      lines.push(`[行动] ${ev.name}（${ev.position}）· ${renderPhase(ev.phase)}`);
      break;
    case 'skill_trigger': {
      if (ev.rate !== undefined && ev.baseRate !== undefined && ev.morale !== undefined) {
        // 士气修正展示：当前生效几率 = 基础率 × 士气系数（120 士气 → 系数 1.12）
        const bonus = Math.round((ev.morale - 100) * 0.6);
        const coef = (100 + bonus) / 100;
        const who = ev.targetId && ev.targetId !== ev.unitId ? `「${ev.targetId}」←「${ev.unitId}」` : ev.unitId;
        lines.push(`  → 战法「${ev.skillName}」判定：${ev.success ? '发动' : '未发动'}（${who} 当前生效几率 ${ev.rate}% = ${ev.baseRate}% × 士气系数 ${coef}，士气 ${ev.morale}）`);
      } else {
        lines.push(`  → 战法「${ev.skillName}」判定：${ev.success ? '发动' : '未发动'}`);
      }
      break;
    }
    case 'skill_cast':
      lines.push(`  ✦ 【${ev.unitId}】发动【${ev.skillName}】！`);
      break;
    case 'skill_target':
      lines.push(`  → 目标：${ev.targetIds.join('、')}`);
      break;
    case 'seal_settle':
      lines.push(`  ✦ 【${ev.unitId}】【${ev.skillName}】玉玺结转：上一回合承担 ${fmt(ev.carried)}，按 ${Math.round(ev.ratio * 100)}% 使其损失 ${fmt(ev.damage)} 兵力（剩余 ${fmt(ev.afterTroops)}）`);
      break;
    case 'damage':
      if (ev.delayedEffect && ev.afterTroops !== undefined) {
        lines.push(`  ✦ 【${ev.sourceId}】【${ev.skillName}】的效果使【${ev.targetId}】损失了${ev.damage}兵力${afterSuffix(ev.afterTroops)}`);
      } else {
        lines.push(`  → 对「${ev.targetId}」造成${ev.damageType === 'physical' ? '攻击' : '谋略'}伤害 ${fmt(ev.damage)}${afterSuffix(ev.afterTroops)}（${renderBreakdown(ev.breakdown)}）`);
      }
      break;
    case 'stored_effect_expired': {
      const kind = ev.damageType === 'strategy' ? '策略攻击伤害效果' : '攻击伤害效果';
      lines.push(`  ✦ 【${ev.unitId}】的来自【${ev.sourceId}】【${ev.skillName}】的${kind}消失了`);
      break;
    }
    case 'attack_hit':
      lines.push(`  → 普攻命中「${ev.targetId}」（距离${ev.distance}）造成 ${fmt(ev.damage)}${afterSuffix(ev.afterTroops)}（${renderBreakdown(ev.breakdown)}）`);
      break;
    case 'no_attack_target':
      lines.push(`  → ${ev.name} 无法普攻：${ev.reason}`);
      break;
    case 'status_inflicted':
      if (ev.detail.includes('执行来自') || /的(攻击|防御|谋略|速度)属性(提高了|降低了)/.test(ev.detail)) {
        for (const line of ev.detail.split('\n')) {
          lines.push(`  ✦ ${line}`);
        }
      } else {
        lines.push(`  ✦ ${ev.unitId} 获得效果：${ev.detail}`);
      }
      break;
    case 'status_conflict':
      lines.push(`  ✘ ${ev.unitId} ${ev.detail}`);
      break;
    case 'status_expired':
      lines.push(`  ✦ ${ev.unitId} 的${statusName(ev.statusType)}状态解除`);
      break;
    case 'evasion_blocked':
      lines.push(`  ✦ 规避！${ev.unitId} 免疫伤害（剩余 ${ev.remainingStacks} 层）`);
      break;
    case 'heal':
      lines.push(`  ✚ ${ev.targetId} 恢复兵力 ${fmt(ev.amount)}（${fmt(ev.before)} → ${fmt(ev.after)}）`);
      break;
    case 'share_damage':
      // 伤害分摊（言出必克 / 雅虑适时）：unitId 替 targetId 承担 amount；引擎分摊时不另发 damage 事件
      lines.push(`  ⇄ ${ev.unitId} 为 ${ev.targetId} 分摊伤害 ${fmt(ev.amount)}（${SKILL_REGISTRY[ev.skillId]?.name ?? ev.skillId}）${afterSuffix(ev.afterTroops)}`);
      break;
    case 'prepare_start':
      lines.push(`  ⏳ ${ev.unitId} 开始准备「${ev.skillName}」`);
      break;
    case 'prepare_end':
      lines.push(`  ⏳ ${ev.unitId} 准备完成「${ev.skillName}」`);
      break;
    case 'prepare_skip':
      lines.push(`  ✦ ${ev.unitId} 跳过准备，直接发动「${ev.skillName}」`);
      break;
    case 'skill_exec':
      // 战法效果执行行（疮痍累身）：detail 本身已是「【周泰】执行来自【周泰】的【疮痍累身】效果！」
      lines.push(`  ${ev.detail}`);
      break;
    case 'status_changed':
      // 受击递减（疮痍累身每受该类型伤 −1/12）：detail 可能是完整句，也可能只是前半段
      lines.push(`  ${/^【/.test(ev.detail) ? ev.detail : `${ev.unitId} 的${ev.detail}`}`);
      break;
    case 'unit_dead':
      lines.push(`  ☠ ${ev.name}（${ev.side === 'my' ? '我方' : '敌方'}）阵亡`);
      break;
    case 'dot_tick':
      lines.push(`  ✦ ${ev.targetId} 受到${dotTypeName(ev.dotType)}伤害 ${fmt(ev.damage)}${afterSuffix(ev.afterTroops)}（${renderBreakdown(ev.breakdown)}）`);
      break;
    case 'siege_blocked':
      lines.push(`  ✘ ${ev.unitId} 受围困影响，无法回复兵力`);
      break;
    case 'insight_blocked':
      lines.push(`  ✦ ${ev.unitId} 洞察免疫了${statusName(ev.statusType)}效果`);
      break;
    case 'cowardice_immune_blocked':
      lines.push(`  ✦ ${ev.unitId} 免疫了${statusName(ev.statusType)}效果`);
      break;
    case 'control_immune_blocked':
      lines.push(`  ✦ ${ev.unitId} 免疫了${statusName(ev.statusType)}效果（坚毅）`);
      break;
    case 'command_immune_blocked':
      lines.push(`  ✦ ${ev.unitId} 免疫了${ev.statusType ? statusName(ev.statusType) : '负面'}效果（${SKILL_REGISTRY[ev.skillId]?.name ?? ev.skillId}）`);
      break;
    case 'status_resisted':
      lines.push(`  ✦ ${ev.unitId} 抵御了${statusName(ev.statusType)}效果（${SKILL_REGISTRY[ev.skillId]?.name ?? ev.skillId}）`);
      break;
    case 'split_damage':
      lines.push(`  → 分兵溅射「${ev.targetId}」造成 ${fmt(ev.damage)}${afterSuffix(ev.afterTroops)}（${renderBreakdown(ev.breakdown)}）`);
      break;
    case 'unit_act_end':
      break;
    case 'round_end': {
      lines.push(`[回合结束] 我方兵力 ${ev.myTroops.map(fmt).join('/')}（伤兵 ${ev.myWounded.map(fmt).join('/')} 阵亡 ${ev.myDead.map(fmt).join('/')}）｜ 敌方兵力 ${ev.enemyTroops.map(fmt).join('/')}（伤兵 ${ev.enemyWounded.map(fmt).join('/')} 阵亡 ${ev.enemyDead.map(fmt).join('/')}）`);
      lines.push('');
      break;
    }
    case 'battle_end':
      break;
  }
}

function renderBreakdown(b: { troopBase: number; base: number; main: number }): string {
  return `兵力基础${b.troopBase} + 属性基础${b.base} + 主要${b.main}`;
}

/** 动兵力事件统一后缀：结算后剩余兵力（引擎带 afterTroops；缺省不显示）。
 *  注意：`fmt` 是各渲染函数内部各自的局部常量，这里直接照同样口径格式化。 */
function afterSuffix(after?: number): string {
  return after === undefined ? '' : `（剩余 ${after.toLocaleString('en-US')}）`;
}

function renderPhase(phase: string): string {
  switch (phase) {
    case 'active_skill': return '主动战法判定';
    case 'normal_attack': return '普通攻击';
    case 'pursuit_skill': return '追击战法判定';
    case 'command_skill': return '指挥战法';
    case 'passive_skill': return '被动战法';
    default: return phase;
  }
}

function statusName(type: string): string {
  switch (type) {
    case 'confusion': return '混乱';
    case 'rampage': return '暴走';
    case 'cowardice': return '怯战';
    case 'hesitation': return '犹豫';
    case 'evasion': return '规避';
    case 'combo': return '连击';
    case 'attack_buff': return '攻击增益';
    case 'defense_buff': return '防御增益';
    case 'speed_buff': return '速度增益';
    case 'damage_reduce': return '减伤';
    case 'morale_boost': return '士气提高';
    case 'insight': return '洞察';
    case 'cowardice_immune': return '免疫怯战';
    case 'siege': return '围困';
    case 'sorcery': return '妖术';
    case 'burning': return '燃烧';
    case 'panic': return '恐慌';
    case 'curse': return '妖术诅咒';
    case 'ignite': return '引燃';
    case 'split': return '分兵';
    case 'taunt': return '挑衅';
    case 'counter': return '反击';
    case 'cover': return '援護';
    case 'rest': return '休整';
    case 'ignore_def': return '无视防御';
    case 'skill_range_buff': return '战法距离';
    case 'range_buff': return '攻击距离';
    default: return type;
  }
}

function dotTypeName(type: string): string {
  switch (type) {
    case 'sorcery': return '妖术';
    case 'burning': return '燃烧';
    case 'panic': return '恐慌';
    case 'curse': return '妖术诅咒';
    case 'ignite': return '引燃';
    default: return type;
  }
}
