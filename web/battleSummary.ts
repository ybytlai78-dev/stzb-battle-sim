/**
 * 战报展示：简略战报（总兵力条 + 双方画像 + 结果印章）+ 统计视图
 * 简略战报排布：蓝左红右；顶部镜像总兵力条（损失用浅色）；下方镜像武将画像（蓝：大营/中军/前锋，
 * 红：前锋/中军/大营），中间「VS」分割，结果用书法字（胜/败/平）分割；
 * 每个武将下方有兵力条，兵力为 0 → 画像与兵力条灰底（阵亡）。
 * 回合数/种子写在中间 VS 列，避免底行文字与画像重叠。
 */
import type { BattleReport, General, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { computeDetailedStats, computeContributionShares, type UnitDetailedStats } from '../src/engine/stats';
import { avatarSrc, portraitSrc, getHeroById, rednessStars, skillGrade, TROOP_CHAR, factionIconSrc, cardFrameSrc } from './heroes';
import { RESULT_GLYPH } from './resultGlyph';

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

/**
 * 结果印章：金属书法字 胜 / 败 / 平 + 下方说明。
 * 标签可参数化（实验室：我方胜利 / 侍卫胜利）。
 */
function resultStamp(result: BattleReport['result'], opts: SummaryOpts): string {
  const glyph = RESULT_GLYPH[result];
  const cls = result === 'win' ? 'stamp-win' : result === 'loss' ? 'stamp-loss' : 'stamp-draw';
  const note =
    result === 'win' ? (opts.resultLabels?.win ?? '红队胜利')
      : result === 'loss' ? (opts.resultLabels?.loss ?? '蓝队胜利')
        : (opts.resultLabels?.draw ?? '双方平局');
  return `
    <div class="stamp ${cls}">
      <img class="stamp-ch" src="${glyph.src}" alt="${glyph.alt}" />
      <span class="stamp-note">${note}</span>
    </div>`;
}

/** 单个武将卡：上＝官方卡面（画像铺满 + 卡框 + 左上势力字 / 竖排名 / 右上红度 / 底部 Lv·兵种），
 *  下＝该将兵力条与剩余兵力（战报核心数据，放在卡面外）。兵力 0 → 整卡灰暗阵亡。
 *  卡面结构/类名与武将池卡、配将槽位卡一致（.frame / .plate / .fac / .card-bar）。 */
function heroCard(g: General, troops: number, color: 'red' | 'blue'): string {
  const pct = g.maxTroops > 0 ? (troops / g.maxTroops) * 100 : 0;
  const dead = troops <= 0;
  const r = g.redness ?? 0;
  const lv = g.level ?? 40;
  const hero = getHeroById(g.id);
  const faction = hero?.faction ?? '';
  const facIcon = factionIconSrc(faction);
  return `
    <div class="sum-hero ${dead ? 'dead' : ''}">
      <div class="sh-card">
        <img class="sh-art" src="${portraitSrc(g.id)}" alt="${g.name}" loading="lazy" decoding="async" onerror="this.style.display='none'" />
        <div class="frame" style="background-image:url('${cardFrameSrc()}')"></div>
        <div class="plate">
          ${facIcon ? `<img class="fac" data-faction="${faction}" alt="${faction}" src="${facIcon}" />` : ''}
          <div class="sh-name">${g.name}</div>
          <div class="sh-stars" title="红度 ${r}/5">${rednessStars(r)}</div>
          <div class="card-bar">
            <span class="lv"><i>Lv.</i>${lv}</span>
            <span class="troop" title="兵种">${TROOP_CHAR[g.troopType] ?? '?'}</span>
          </div>
        </div>
      </div>
      <div class="sh-meta">${g.position}</div>
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

// ─── 统计视图（图二骨架）：左轨武将/战法 + 行：站位竖签 + 头像卡 + 四列战法或三占比 ───

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

/**
 * 统计行左侧头像卡：`avatarSrc`（_s.jpg）+ 姓名 + 等级 + 红度点。
 * @param g 武将
 */
function heroMini(g: General): string {
  const r = g.redness ?? 0;
  const lv = g.level ?? 40;
  const stars = Array.from({ length: 5 }, (_, i) => `<i${i < r ? ' class="on"' : ''}></i>`).join('');
  return `<div class="hcard" data-name="${g.name}">
    <img src="${avatarSrc(g.id)}" alt="${g.name}" draggable="false" onerror="this.style.display='none'" />
    <span class="hn">${g.name}</span>
    <span class="lv">Lv.${lv}</span>
    <span class="stars" aria-label="红度 ${r}">${stars}</span>
  </div>`;
}

/**
 * 战法格：品级圆点 + 名称 + 次数 / 杀伤；恢复与杀伤同一行（绿色）。
 * 普攻不带品级；空携带槽显示 — / 0。
 * @param name 列名（普攻 / 战法名 / —）
 * @param count 次数
 * @param damage 杀伤
 * @param heal 恢复兵力
 * @param grade 品级字母，空则不渲染角标
 */
function skillCellHtml(
  name: string,
  count: number,
  damage: number,
  heal: number,
  grade: string | null,
): string {
  const badge = grade ? `<i class="grade ${grade.toLowerCase()}">${grade}</i>` : '';
  const healHtml = heal > 0
    ? ` <span class="heal">恢复 ${heal.toLocaleString()}</span>`
    : '';
  return `<div class="sk">
    <div class="sk-h">${badge}<span class="sk-n">${name}</span><span class="sk-c">次数 ${count}</span></div>
    <div class="sk-d">杀伤 ${damage.toLocaleString()}${healHtml}</div>
  </div>`;
}

/**
 * 按 `columnOrder` 拼四列：普攻 + 主战法 + 携带一 + 携带二。
 * @param g 武将
 * @param stats 该武将详细统计
 */
function skillRowHtml(g: General, stats: UnitDetailedStats | undefined): string {
  const cols = columnOrder(g);
  const atk = skillCellHtml('普攻', stats?.attackCount ?? 0, stats?.attackDamage ?? 0, 0, null);
  const skills = cols.map((c) => {
    if (!c.skillId) {
      return skillCellHtml(c.label, 0, 0, 0, null);
    }
    const s = stats?.skills.find((x) => x.skillId === c.skillId);
    return skillCellHtml(
      SKILL_REGISTRY[c.skillId]?.name ?? c.label,
      s?.castCount ?? 0,
      s?.damage ?? 0,
      s?.healAmount ?? 0,
      skillGrade(c.skillId),
    );
  });
  return `<div class="sk-row">${atk}${skills.join('')}</div>`;
}

/**
 * 武将统计：本队伤害 / 恢复 / 控制占比条（`computeContributionShares`）。
 * @param pct 伤害占比
 * @param healPct 恢复占比
 * @param ctrlPct 控制占比
 */
function shareRowHtml(pct: number, healPct: number, ctrlPct: number): string {
  const bar = (label: string, n: number, kind: '' | ' heal' | ' ctrl') => {
    const w = Math.max(0, Math.min(100, n));
    return `<div class="meter${kind}"><span>${label} ${fmtPct(n)}</span><span class="bar"><i style="width:${w}%"></i></span></div>`;
  };
  return `<div class="sh-row">
    ${bar('伤害', pct, '')}
    ${bar('恢复', healPct, ' heal')}
    ${bar('控制', ctrlPct, ' ctrl')}
  </div>`;
}

/**
 * 统计页（图二骨架）：`.stats-view` > `.st-page`（左轨 + 行列表）。
 *
 * 口径：次数 = skill_cast 计数（指挥战法准备阶段算 1 次，如魏武之世 次数 1 · 杀伤 0）；
 * 杀伤 = 该战法命中伤害合计（指挥队友攻击计入施法者 `creditToId`，不含普攻/DoT/分兵溅射）；
 * 恢复 = heal 事件回复兵力合计（归属施法者，如刘备皇裔流离/张机金匮要略）。
 *
 * 行序：红 大营→中军→前锋，再蓝 前锋→中军→大营（缺槽过滤）。默认 `data-stats="skill"`。
 * @param report 当前战报
 */
export function createStatsView(report: BattleReport): HTMLElement {
  const root = document.createElement('div');
  root.className = 'stats-view';

  const units = unitsFromReport(report);
  const detailed = computeDetailedStats(report.events, units);
  const byId = new Map(detailed.map((d) => [d.unitId, d]));
  const shares = computeContributionShares(report.events, units);
  const shareById = new Map(shares.map((s) => [s.unitId, s]));

  const POS = ['大营', '中军', '前锋'] as const;
  const redRows = POS.map((p) => report.myTeam.find((g) => g.position === p)).filter((g): g is General => !!g);
  const blueRows = (['前锋', '中军', '大营'] as const)
    .map((p) => report.enemyTeam.find((g) => g.position === p))
    .filter((g): g is General => !!g);

  let mode: 'skill' | 'hero' = 'skill';

  /**
   * 渲染一行：站位竖签 + 头像卡 + 战法四列或占比条。
   * @param g 武将
   * @param side 红/蓝
   */
  const statsRow = (g: General, side: 'red' | 'blue'): string => {
    const body = mode === 'skill'
      ? skillRowHtml(g, byId.get(g.id))
      : (() => {
          const sh = shareById.get(g.id);
          return shareRowHtml(sh?.damagePct ?? 0, sh?.healPct ?? 0, sh?.controlPct ?? 0);
        })();
    return `<div class="st-row">
      <span class="pos-tag ${side}">${g.position}</span>
      ${heroMini(g)}
      ${body}
    </div>`;
  };

  const paintMain = (): void => {
    const main = root.querySelector('.st-main');
    if (!main) return;
    main.innerHTML = `
      <div class="st-team">${redRows.map((g) => statsRow(g, 'red')).join('')}</div>
      <div class="st-team">${blueRows.map((g) => statsRow(g, 'blue')).join('')}</div>`;
  };

  root.innerHTML = `
    <div class="st-page">
      <aside class="st-rail">
        <button type="button" data-stats="hero">武将统计</button>
        <button type="button" data-stats="skill" class="is-on">战法统计</button>
      </aside>
      <div class="st-main scroll-quiet"></div>
    </div>`;
  paintMain();

  root.querySelectorAll<HTMLButtonElement>('[data-stats]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-stats');
      if (next !== 'skill' && next !== 'hero') return;
      mode = next;
      root.querySelectorAll('[data-stats]').forEach((el) => el.classList.toggle('is-on', el === btn));
      paintMain();
    });
  });
  return root;
}
