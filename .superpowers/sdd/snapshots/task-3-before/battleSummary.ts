/**
 * 战报展示：简略战报（总兵力条 + 双方画像 + 结果印章）+ 统计视图
 * 简略战报排布：蓝左红右；顶部镜像总兵力条（损失用浅色）；下方镜像武将画像（蓝：大营/中军/前锋，
 * 红：前锋/中军/大营），中间「VS」分割，结果用率土印章（胜/负/平）分割；
 * 每个武将下方有兵力条，兵力为 0 → 画像与兵力条灰底（阵亡）。
 * 回合数/种子写在中间 VS 列，避免底行文字与画像重叠。
 */
import type { BattleReport, General, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { computeDetailedStats, computeContributionShares, type UnitDetailedStats } from '../src/engine/stats';
import { avatarSrc, portraitSrc, getHeroById, rednessStars } from './heroes';

/** 统计视图用的占位单位（只取 general / side，兵力与状态不参与汇总） */
function unitsFromReport(report: BattleReport): UnitState[] {
  const stub = (g: General, side: 'my' | 'enemy'): UnitState => ({
    general: g,
    side,
    troops: 0,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  });
  return [
    ...report.myTeam.map((g) => stub(g, 'my')),
    ...report.enemyTeam.map((g) => stub(g, 'enemy')),
  ];
}

/**
 * 百分比展示：整数不带小数，其余 1 位。
 * @param n 0~100 的占比
 */
function fmtPct(n: number): string {
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

/** 兵力条：实色=剩余，浅色=损失 */
function troopBar(pct: number, cls: string): string {
  const p = Math.max(0, Math.min(100, pct));
  return `
    <div class="troopbar ${cls}">
      <div class="tb-left" style="width:${p}%"></div>
      <div class="tb-lost" style="width:${100 - p}%"></div>
    </div>`;
}

/** 简略战报选项：左右方位与双方标签（默认蓝左红右、红方=我方——保持主站行为；实验室传 myLeft 让我方在左） */
export interface SummaryOpts {
  /** 我方显示在左（默认 false：敌方在左、我方在右） */
  myLeft?: boolean;
  /** 我方标签（默认「红方（我方）」） */
  myLabel?: string;
  /** 敌方标签（默认「蓝方（敌方）」） */
  enemyLabel?: string;
  /** 结果印章文案（默认 红队胜利/蓝队胜利/双方平局） */
  resultLabels?: { win?: string; loss?: string; draw?: string };
}

/** 结果印章（率土风）：胜=红印 负=蓝印 平=灰印；标签可参数化（实验室：我方/侍卫） */
function resultStamp(result: BattleReport['result'], opts: SummaryOpts): string {
  const [ch, cls, note] =
    result === 'win' ? ['胜', 'stamp-win', opts.resultLabels?.win ?? '红队胜利']
      : result === 'loss' ? ['负', 'stamp-loss', opts.resultLabels?.loss ?? '蓝队胜利']
        : ['平', 'stamp-draw', opts.resultLabels?.draw ?? '双方平局'];
  return `
    <div class="stamp ${cls}">
      <span class="stamp-ch">${ch}</span>
      <span class="stamp-note">${note}</span>
    </div>`;
}

/** 单个武将卡（画像 + 星级红度 + 站位等级 + 兵力条），兵力 0 → 灰底阵亡。 */
function heroCard(g: General, troops: number, color: 'red' | 'blue'): string {
  const pct = g.maxTroops > 0 ? (troops / g.maxTroops) * 100 : 0;
  const dead = troops <= 0;
  const r = g.redness ?? 0;
  const lv = g.level ?? 40;
  return `
    <div class="sum-hero ${dead ? 'dead' : ''}">
      <div class="sh-art">
        <img src="${portraitSrc(g.id)}" alt="${g.name}" onerror="this.style.display='none'" />
        <div class="sh-stars" title="红度 ${r}/5">${rednessStars(r)}</div>
      </div>
      <div class="sh-name">${g.name}</div>
      <div class="sh-meta">${g.position} · ${lv}级</div>
      ${troopBar(pct, dead ? 'bar-dead' : color === 'red' ? 'bar-red' : 'bar-blue')}
      <div class="sh-troops">${troops.toLocaleString()}${dead ? ' · 阵亡' : ''}</div>
    </div>`;
}

/** 简略战报选项：左右方位与双方标签（默认蓝左红右、红方=我方——保持主站行为；实验室传 myLeft 让我方在左） */
export interface SummaryOpts {
  /** 我方显示在左（默认 false：敌方在左、我方在右） */
  myLeft?: boolean;
  /** 我方标签（默认「红方（我方）」） */
  myLabel?: string;
  /** 敌方标签（默认「蓝方（敌方）」） */
  enemyLabel?: string;
}

/** 简略战报视图 */
export function createBattleSummary(report: BattleReport, opts: SummaryOpts = {}): HTMLElement {
  const myLeft = opts.myLeft === true;
  const myLabel = opts.myLabel ?? '红方（我方）';
  const enemyLabel = opts.enemyLabel ?? '蓝方（敌方）';
  const root = document.createElement('div');
  root.className = 'battle-summary';

  const myInitial = report.myTeam.reduce((a, g) => a + g.maxTroops, 0);
  const enInitial = report.enemyTeam.reduce((a, g) => a + g.maxTroops, 0);
  const myLeft2 = report.finalMyTroops.reduce((a, b) => a + b, 0);
  const enLeft = report.finalEnemyTroops.reduce((a, b) => a + b, 0);

  // 我方 / 敌方；默认敌方在左（myLeft=false）；myLeft=true 时我方在左
  const leftTeam = myLeft ? report.myTeam : report.enemyTeam;
  const rightTeam = myLeft ? report.enemyTeam : report.myTeam;
  // 左侧：大营/中军/前锋 从左到右；右侧：前锋/中军/大营 从左到右（镜像对称）
  const leftOrder: General[] = (['大营', '中军', '前锋'] as const).map((p) => leftTeam.find((g) => g.position === p)!);
  const rightOrder: General[] = (['前锋', '中军', '大营'] as const).map((p) => rightTeam.find((g) => g.position === p)!);
  const leftTroops = (['大营', '中军', '前锋'] as const).map((p) => (myLeft ? report.finalMyTroops : report.finalEnemyTroops)[leftTeam.findIndex((g) => g.position === p)]);
  const rightTroops = (['前锋', '中军', '大营'] as const).map((p) => (myLeft ? report.finalEnemyTroops : report.finalMyTroops)[rightTeam.findIndex((g) => g.position === p)]);
  const leftColor: 'red' | 'blue' = myLeft ? 'red' : 'blue';
  const rightColor: 'red' | 'blue' = myLeft ? 'blue' : 'red';
  const leftBarCls = myLeft ? 'bar-red' : 'bar-blue';
  const rightBarCls = myLeft ? 'bar-blue' : 'bar-red';

  root.innerHTML = `
    <div class="sum-result">
      <div class="sum-side">
        <div class="ss-title">${myLeft ? myLabel : enemyLabel}</div>
        ${troopBar((myLeft ? myInitial : enInitial) > 0 ? (myLeft ? myLeft2 : enLeft) / (myLeft ? myInitial : enInitial) * 100 : 0, leftBarCls)}
        <div class="ss-nums">剩余 <b>${(myLeft ? myLeft2 : enLeft).toLocaleString()}</b> / ${(myLeft ? myInitial : enInitial).toLocaleString()}</div>
      </div>
      ${resultStamp(report.result, opts)}
      <div class="sum-side">
        <div class="ss-title">${myLeft ? enemyLabel : myLabel}</div>
        ${troopBar((myLeft ? enInitial : myInitial) > 0 ? (myLeft ? enLeft : myLeft2) / (myLeft ? enInitial : myInitial) * 100 : 0, rightBarCls)}
        <div class="ss-nums">剩余 <b>${(myLeft ? enLeft : myLeft2).toLocaleString()}</b> / ${(myLeft ? enInitial : myInitial).toLocaleString()}</div>
      </div>
    </div>
    <div class="sum-roster">
      <div class="sum-blue">
        ${leftOrder.map((g, i) => (g ? heroCard(g, leftTroops[i] ?? 0, leftColor) : '')).join('')}
      </div>
      <div class="vs-badge">
        <span>VS</span>
        <span class="sum-rounds">共 ${report.rounds} 回合<br>种子 ${report.seed}</span>
      </div>
      <div class="sum-red">
        ${rightOrder.map((g, i) => (g ? heroCard(g, rightTroops[i] ?? 0, rightColor) : '')).join('')}
      </div>
    </div>
  `;
  return root;
}

// ─── 统计视图：竖表（蓝大营→蓝前锋 / 红前锋→红大营），每行：头像 → 普攻 → 主战法 → 携带一 → 携带二；顶栏「详情」看占比 ───

/** 把武将的 General 还原为统计列顺序：主战法 + 携带战法一/二（装配顺序，主战法除外） */
function columnOrder(g: General): Array<{ label: string; skillId: string | null }> {
  const hero = getHeroById(g.id);
  const mainId = hero?.mainSkillId && SKILL_REGISTRY[hero.mainSkillId] ? hero.mainSkillId : null;
  const cols: Array<{ label: string; skillId: string | null }> = [
    { label: hero?.mainSkillName || '未实现', skillId: mainId },
  ];
  const extra = [...g.activeSkillIds, ...g.passiveSkillIds, ...g.commandSkillIds, ...g.pursuitSkillIds].filter(
    (id) => id !== mainId
  );
  for (let i = 0; i < 2; i++) {
    const sid = extra[i] ?? null;
    cols.push({ label: sid ? SKILL_REGISTRY[sid]?.name ?? '' : '—', skillId: sid });
  }
  return cols;
}

function skillCell(stats: UnitDetailedStats | undefined, skillId: string | null): string {
  // 必须是 <td>：<tr> 内直接放 <div> 会被浏览器踢出表格（战法列跑到表格外）
  if (!skillId) {
    return `<td class="st-cell"><span class="st-name">未实现</span><span class="st-nums">0 · 0 · 0</span></td>`;
  }
  const s = stats?.skills.find((x) => x.skillId === skillId);
  return `
    <td class="st-cell">
      <span class="st-name">${SKILL_REGISTRY[skillId]?.name ?? skillId}</span>
      <span class="st-nums">次数 ${s?.castCount ?? 0} · 杀伤 ${(s?.damage ?? 0).toLocaleString()} · 恢复 ${(s?.healAmount ?? 0).toLocaleString()}</span>
    </td>`;
}

/** 一条占比进度条（伤害红 / 恢复绿 / 控制紫） */
function shareMetric(label: string, pct: number, kind: 'dmg' | 'heal' | 'ctrl'): string {
  return `
    <div class="sm-row">
      <span class="sm-label">${label}</span>
      <div class="sm-bar"><i class="sm-fill ${kind}" style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
      <span class="sm-pct">${fmtPct(pct)}</span>
    </div>`;
}

/**
 * 打开「详情」占比面板（主站统计 / 实验室统计共用）。
 * 左蓝右红、同站位面对面（大营 / 中军 / 前锋）。
 * @param report 当前战报
 */
function openSharePanel(report: BattleReport): void {
  document.querySelectorAll('.stats-share-mask').forEach((el) => el.remove());
  const shares = computeContributionShares(report.events, unitsFromReport(report));
  const byId = new Map(shares.map((s) => [s.unitId, s]));

  const card = (g: General | undefined, color: 'red' | 'blue') => {
    if (!g) {
      return `<div class="ss-card row-${color} empty"><div class="ss-hero"><span class="ss-name">空缺</span></div></div>`;
    }
    const s = byId.get(g.id);
    return `
      <div class="ss-card row-${color}" data-unit-id="${g.id}">
        <div class="ss-hero">
          <img src="${avatarSrc(g.id)}" alt="" onerror="this.style.display='none'" />
          <span class="ss-name">${g.name}</span>
        </div>
        <div class="ss-metrics">
          ${shareMetric('伤害占比', s?.damagePct ?? 0, 'dmg')}
          ${shareMetric('恢复占比', s?.healPct ?? 0, 'heal')}
          ${shareMetric('控制占比', s?.controlPct ?? 0, 'ctrl')}
        </div>
      </div>`;
  };

  const pairRows = (['大营', '中军', '前锋'] as const)
    .map((pos) => {
      const blue = report.enemyTeam.find((g) => g.position === pos);
      const red = report.myTeam.find((g) => g.position === pos);
      return `
        <div class="ss-row">
          ${card(blue, 'blue')}
          <div class="ss-pos-mid">${pos}</div>
          ${card(red, 'red')}
        </div>`;
    })
    .join('');

  const mask = document.createElement('div');
  mask.className = 'modal-mask stats-share-mask';
  mask.innerHTML = `
    <div class="modal stats-share-modal" role="dialog" aria-labelledby="share-title">
      <div class="m-head">
        <h3 id="share-title">战斗占比</h3>
        <span class="m-close" title="关闭">×</span>
      </div>
      <div class="m-body">
        <div class="ss-note">本队内占比 · demo（点击武将展开细项将在后续补充）</div>
        <div class="ss-heads">
          <span class="ss-side blue">蓝方</span>
          <span></span>
          <span class="ss-side red">红方</span>
        </div>
        ${pairRows}
      </div>
    </div>`;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    mask.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.querySelector('.m-close')!.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(mask);
}

export function createStatsView(report: BattleReport): HTMLElement {
  const root = document.createElement('div');
  root.className = 'stats-view';

  const units = unitsFromReport(report);
  const detailed = computeDetailedStats(report.events, units);
  const byId = new Map(detailed.map((d) => [d.unitId, d]));

  // 行顺序：蓝大营 → 蓝中军 → 蓝前锋（分隔）→ 红前锋 → 红中军 → 红大营
  const rows: Array<{ g: General; color: 'red' | 'blue' }> = [
    ...(['大营', '中军', '前锋'] as const).map((p) => ({ g: report.enemyTeam.find((x) => x.position === p)!, color: 'blue' as const })),
    ...(['前锋', '中军', '大营'] as const).map((p) => ({ g: report.myTeam.find((x) => x.position === p)!, color: 'red' as const })),
  ];

  const visibleRows = rows.filter((r) => r.g);

  const rowHtml = visibleRows
    .map(({ g, color }) => {
      const d = byId.get(g.id);
      const cols = columnOrder(g);
      return `
        <tr class="row-${color}">
          <td class="st-hero">
            <img src="${avatarSrc(g.id)}" alt="" onerror="this.style.display='none'" />
            <span>${g.name}</span>
          </td>
          <td class="st-cell">
            <span class="st-name">普攻</span>
            <span class="st-nums">次数 ${d?.attackCount ?? 0} · 杀伤 ${(d?.attackDamage ?? 0).toLocaleString()}</span>
          </td>
          ${cols.map((c) => skillCell(d, c.skillId)).join('')}
        </tr>`;
    })
    .join('');

  root.innerHTML = `
    <div class="stats-table">
      <div class="stats-toolbar">
        <button type="button" class="st-detail-btn">详情</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>武将</th>
            <th>普攻</th>
            <th>主战法</th>
            <th>携带战法一</th>
            <th>携带战法二</th>
          </tr>
        </thead>
        <tbody>${rowHtml}</tbody>
      </table>
      <div class="tip">口径：次数 = skill_cast 计数（指挥战法准备阶段算 1 次，如魏武之世 次数 1 · 杀伤 0）；杀伤 = 该战法命中伤害合计（指挥队友攻击计入施法者战法，不含普攻/DoT/分兵溅射）；恢复 = heal 事件回复兵力合计（归属施法者，如刘备皇裔流离/张机金匮要略）。「详情」查看本队伤害 / 恢复 / 控制占比（demo）。</div>
    </div>
  `;

  root.querySelector('.st-detail-btn')?.addEventListener('click', () => openSharePanel(report));
  return root;
}
