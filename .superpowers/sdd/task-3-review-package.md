# Review package: Task 3 (no git)
## Files changed
web/battleSummary.ts
web/styles.css
web/mobile.css
web/smoke.test.ts
tests/damage_lab_smoke.test.ts

## Diff

### web/battleSummary.ts
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-3-before/battleSummary.ts', LF will be replaced 
by CRLF the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-78d7b226-1fb3-44e8-b8b5-adebd6062693.ps1:143 字符: 425
+ ... rc)"); $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/battleSummary.ts', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-3-before/battleSummary.ts b/web/battleSummary.ts
index 8f409c9..eb7f940 100644
--- a/.superpowers/sdd/snapshots/task-3-before/battleSummary.ts
+++ b/web/battleSummary.ts
@@ -3,17 +3,17 @@
  * 绠€鐣ユ垬鎶ユ帓甯冿細钃濆乏绾㈠彸锛涢《閮ㄩ暅鍍忔€诲叺鍔涙潯锛堟崯澶辩敤娴呰壊锛夛紱涓嬫柟闀滃儚姝﹀皢鐢诲儚锛堣摑锛氬ぇ钀?涓啗/鍓嶉攱锛?  * 绾細鍓嶉攱/涓啗/澶ц惀锛夛紝涓棿銆孷S銆嶅垎鍓诧紝缁撴灉鐢ㄧ巼鍦熷嵃绔狅紙鑳?璐?骞筹級鍒嗗壊锛?  * 姣忎釜姝﹀皢涓嬫柟鏈夊叺鍔涙潯锛屽叺鍔涗负 0 鈫?鐢诲儚涓庡叺鍔涙潯鐏板簳锛堥樀浜★級銆?  * 鍥炲悎鏁?绉嶅瓙鍐欏湪涓棿 VS 鍒楋紝閬垮厤搴曡鏂囧瓧涓庣敾鍍忛噸鍙犮€?  */
 import type { BattleReport, General, UnitState } from '../src/engine/types';
 import { SKILL_REGISTRY } from '../src/data/skills';
 import { computeDetailedStats, computeContributionShares, type UnitDetailedStats } from '../src/engine/stats';
-import { avatarSrc, portraitSrc, getHeroById, rednessStars } from './heroes';
+import { avatarSrc, portraitSrc, getHeroById, rednessStars, skillGrade } from './heroes';
 
 /** 缁熻瑙嗗浘鐢ㄧ殑鍗犱綅鍗曚綅锛堝彧鍙?general / side锛屽叺鍔涗笌鐘舵€佷笉鍙備笌姹囨€伙級 */
 function unitsFromReport(report: BattleReport): UnitState[] {
   const stub = (g: General, side: 'my' | 'enemy'): UnitState => ({
     general: g,
     side,
     troops: 0,
     wounded: 0,
@@ -152,17 +152,17 @@ export function createBattleSummary(report: BattleReport, opts: SummaryOpts = {}
       <div class="sum-red">
         ${rightOrder.map((g, i) => (g ? heroCard(g, rightTroops[i] ?? 0, rightColor) : '')).join('')}
       </div>
     </div>
   `;
   return root;
 }
 
-// 鈹€鈹€鈹€ 缁熻瑙嗗浘锛氱珫琛紙钃濆ぇ钀モ啋钃濆墠閿?/ 绾㈠墠閿嬧啋绾㈠ぇ钀ワ級锛屾瘡琛岋細澶村儚 鈫?鏅敾 鈫?涓绘垬娉?鈫?鎼哄甫涓€ 鈫?鎼哄甫浜岋紱椤舵爮銆岃鎯呫€嶇湅鍗犳瘮 鈹€鈹€鈹€
+// 鈹€鈹€鈹€ 缁熻瑙嗗浘锛堝浘浜岄鏋讹級锛氬乏杞ㄦ灏?鎴樻硶 + 琛岋細绔欎綅绔栫 + 澶村儚鍗?+ 鍥涘垪鎴樻硶鎴栦笁鍗犳瘮 鈹€鈹€鈹€
 
 /** 鎶婃灏嗙殑 General 杩樺師涓虹粺璁″垪椤哄簭锛氫富鎴樻硶 + 鎼哄甫鎴樻硶涓€/浜岋紙瑁呴厤椤哄簭锛屼富鎴樻硶闄ゅ锛?*/
 function columnOrder(g: General): Array<{ label: string; skillId: string | null }> {
   const hero = getHeroById(g.id);
   const mainId = hero?.mainSkillId && SKILL_REGISTRY[hero.mainSkillId] ? hero.mainSkillId : null;
   const cols: Array<{ label: string; skillId: string | null }> = [
     { label: hero?.mainSkillName || '鏈疄鐜?, skillId: mainId },
   ];
@@ -171,166 +171,168 @@ function columnOrder(g: General): Array<{ label: string; skillId: string | null
   );
   for (let i = 0; i < 2; i++) {
     const sid = extra[i] ?? null;
     cols.push({ label: sid ? SKILL_REGISTRY[sid]?.name ?? '' : '鈥?, skillId: sid });
   }
   return cols;
 }
 
-function skillCell(stats: UnitDetailedStats | undefined, skillId: string | null): string {
-  // 蹇呴』鏄?<td>锛?tr> 鍐呯洿鎺ユ斁 <div> 浼氳娴忚鍣ㄨ涪鍑鸿〃鏍硷紙鎴樻硶鍒楄窇鍒拌〃鏍煎锛?-  if (!skillId) {
-    return `<td class="st-cell"><span class="st-name">鏈疄鐜?/span><span class="st-nums">0 路 0 路 0</span></td>`;
-  }
-  const s = stats?.skills.find((x) => x.skillId === skillId);
-  return `
-    <td class="st-cell">
-      <span class="st-name">${SKILL_REGISTRY[skillId]?.name ?? skillId}</span>
-      <span class="st-nums">娆℃暟 ${s?.castCount ?? 0} 路 鏉€浼?${(s?.damage ?? 0).toLocaleString()} 路 鎭㈠ ${(s?.healAmount ?? 0).toLocaleString()}</span>
-    </td>`;
+/**
+ * 缁熻琛屽乏渚уご鍍忓崱锛歚avatarSrc`锛坃s.jpg锛? 濮撳悕 + 绛夌骇 + 绾㈠害鐐广€?+ * @param g 姝﹀皢
+ */
+function heroMini(g: General): string {
+  const r = g.redness ?? 0;
+  const lv = g.level ?? 40;
+  const stars = Array.from({ length: 5 }, (_, i) => `<i${i < r ? ' class="on"' : ''}></i>`).join('');
+  return `<div class="hcard" data-name="${g.name}">
+    <img src="${avatarSrc(g.id)}" alt="${g.name}" draggable="false" onerror="this.style.display='none'" />
+    <span class="hn">${g.name}</span>
+    <span class="lv">Lv.${lv}</span>
+    <span class="stars" aria-label="绾㈠害 ${r}">${stars}</span>
+  </div>`;
 }
 
-/** 涓€鏉″崰姣旇繘搴︽潯锛堜激瀹崇孩 / 鎭㈠缁?/ 鎺у埗绱級 */
-function shareMetric(label: string, pct: number, kind: 'dmg' | 'heal' | 'ctrl'): string {
-  return `
-    <div class="sm-row">
-      <span class="sm-label">${label}</span>
-      <div class="sm-bar"><i class="sm-fill ${kind}" style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
-      <span class="sm-pct">${fmtPct(pct)}</span>
-    </div>`;
+/**
+ * 鎴樻硶鏍硷細鍝佺骇鍦嗙偣 + 鍚嶇О + 娆℃暟 / 鏉€浼わ紱鎭㈠涓庢潃浼ゅ悓涓€琛岋紙缁胯壊锛夈€?+ * 鏅敾涓嶅甫鍝佺骇锛涚┖鎼哄甫妲芥樉绀?鈥?/ 0銆?+ * @param name 鍒楀悕锛堟櫘鏀?/ 鎴樻硶鍚?/ 鈥旓級
+ * @param count 娆℃暟
+ * @param damage 鏉€浼?+ * @param heal 鎭㈠鍏靛姏
+ * @param grade 鍝佺骇瀛楁瘝锛岀┖鍒欎笉娓叉煋瑙掓爣
+ */
+function skillCellHtml(
+  name: string,
+  count: number,
+  damage: number,
+  heal: number,
+  grade: string | null,
+): string {
+  const badge = grade ? `<i class="grade ${grade.toLowerCase()}">${grade}</i>` : '';
+  const healHtml = heal > 0
+    ? ` <span class="heal">鎭㈠ ${heal.toLocaleString()}</span>`
+    : '';
+  return `<div class="sk">
+    <div class="sk-h">${badge}<span class="sk-n">${name}</span><span class="sk-c">娆℃暟 ${count}</span></div>
+    <div class="sk-d">鏉€浼?${damage.toLocaleString()}${healHtml}</div>
+  </div>`;
 }
 
 /**
- * 鎵撳紑銆岃鎯呫€嶅崰姣旈潰鏉匡紙涓荤珯缁熻 / 瀹為獙瀹ょ粺璁″叡鐢級銆?- * 宸﹁摑鍙崇孩銆佸悓绔欎綅闈㈠闈紙澶ц惀 / 涓啗 / 鍓嶉攱锛夈€?- * @param report 褰撳墠鎴樻姤
+ * 鎸?`columnOrder` 鎷煎洓鍒楋細鏅敾 + 涓绘垬娉?+ 鎼哄甫涓€ + 鎼哄甫浜屻€?+ * @param g 姝﹀皢
+ * @param stats 璇ユ灏嗚缁嗙粺璁?  */
-function openSharePanel(report: BattleReport): void {
-  document.querySelectorAll('.stats-share-mask').forEach((el) => el.remove());
-  const shares = computeContributionShares(report.events, unitsFromReport(report));
-  const byId = new Map(shares.map((s) => [s.unitId, s]));
-
-  const card = (g: General | undefined, color: 'red' | 'blue') => {
-    if (!g) {
-      return `<div class="ss-card row-${color} empty"><div class="ss-hero"><span class="ss-name">绌虹己</span></div></div>`;
+function skillRowHtml(g: General, stats: UnitDetailedStats | undefined): string {
+  const cols = columnOrder(g);
+  const atk = skillCellHtml('鏅敾', stats?.attackCount ?? 0, stats?.attackDamage ?? 0, 0, null);
+  const skills = cols.map((c) => {
+    if (!c.skillId) {
+      return skillCellHtml(c.label, 0, 0, 0, null);
     }
-    const s = byId.get(g.id);
-    return `
-      <div class="ss-card row-${color}" data-unit-id="${g.id}">
-        <div class="ss-hero">
-          <img src="${avatarSrc(g.id)}" alt="" onerror="this.style.display='none'" />
-          <span class="ss-name">${g.name}</span>
-        </div>
-        <div class="ss-metrics">
-          ${shareMetric('浼ゅ鍗犳瘮', s?.damagePct ?? 0, 'dmg')}
-          ${shareMetric('鎭㈠鍗犳瘮', s?.healPct ?? 0, 'heal')}
-          ${shareMetric('鎺у埗鍗犳瘮', s?.controlPct ?? 0, 'ctrl')}
-        </div>
-      </div>`;
-  };
-
-  const pairRows = (['澶ц惀', '涓啗', '鍓嶉攱'] as const)
-    .map((pos) => {
-      const blue = report.enemyTeam.find((g) => g.position === pos);
-      const red = report.myTeam.find((g) => g.position === pos);
-      return `
-        <div class="ss-row">
-          ${card(blue, 'blue')}
-          <div class="ss-pos-mid">${pos}</div>
-          ${card(red, 'red')}
-        </div>`;
-    })
-    .join('');
-
-  const mask = document.createElement('div');
-  mask.className = 'modal-mask stats-share-mask';
-  mask.innerHTML = `
-    <div class="modal stats-share-modal" role="dialog" aria-labelledby="share-title">
-      <div class="m-head">
-        <h3 id="share-title">鎴樻枟鍗犳瘮</h3>
-        <span class="m-close" title="鍏抽棴">脳</span>
-      </div>
-      <div class="m-body">
-        <div class="ss-note">鏈槦鍐呭崰姣?路 demo锛堢偣鍑绘灏嗗睍寮€缁嗛」灏嗗湪鍚庣画琛ュ厖锛?/div>
-        <div class="ss-heads">
-          <span class="ss-side blue">钃濇柟</span>
-          <span></span>
-          <span class="ss-side red">绾㈡柟</span>
-        </div>
-        ${pairRows}
-      </div>
-    </div>`;
+    const s = stats?.skills.find((x) => x.skillId === c.skillId);
+    return skillCellHtml(
+      SKILL_REGISTRY[c.skillId]?.name ?? c.label,
+      s?.castCount ?? 0,
+      s?.damage ?? 0,
+      s?.healAmount ?? 0,
+      skillGrade(c.skillId),
+    );
+  });
+  return `<div class="sk-row">${atk}${skills.join('')}</div>`;
+}
 
-  const close = () => {
-    document.removeEventListener('keydown', onKey);
-    mask.remove();
-  };
-  const onKey = (e: KeyboardEvent) => {
-    if (e.key === 'Escape') close();
+/**
+ * 姝﹀皢缁熻锛氭湰闃熶激瀹?/ 鎭㈠ / 鎺у埗鍗犳瘮鏉★紙`computeContributionShares`锛夈€?+ * @param pct 浼ゅ鍗犳瘮
+ * @param healPct 鎭㈠鍗犳瘮
+ * @param ctrlPct 鎺у埗鍗犳瘮
+ */
+function shareRowHtml(pct: number, healPct: number, ctrlPct: number): string {
+  const bar = (label: string, n: number, kind: '' | ' heal' | ' ctrl') => {
+    const w = Math.max(0, Math.min(100, n));
+    return `<div class="meter${kind}"><span>${label} ${fmtPct(n)}</span><span class="bar"><i style="width:${w}%"></i></span></div>`;
   };
-  mask.addEventListener('click', (e) => {
-    if (e.target === mask) close();
-  });
-  mask.querySelector('.m-close')!.addEventListener('click', close);
-  document.addEventListener('keydown', onKey);
-  document.body.appendChild(mask);
+  return `<div class="sh-row">
+    ${bar('浼ゅ', pct, '')}
+    ${bar('鎭㈠', healPct, ' heal')}
+    ${bar('鎺у埗', ctrlPct, ' ctrl')}
+  </div>`;
 }
 
+/**
+ * 缁熻椤碉紙鍥句簩楠ㄦ灦锛夛細`.stats-view` > `.st-page`锛堝乏杞?+ 琛屽垪琛級銆?+ *
+ * 鍙ｅ緞锛氭鏁?= skill_cast 璁℃暟锛堟寚鎸ユ垬娉曞噯澶囬樁娈电畻 1 娆★紝濡傞瓘姝︿箣涓?娆℃暟 1 路 鏉€浼?0锛夛紱
+ * 鏉€浼?= 璇ユ垬娉曞懡涓激瀹冲悎璁★紙鎸囨尌闃熷弸鏀诲嚮璁″叆鏂芥硶鑰?`creditToId`锛屼笉鍚櫘鏀?DoT/鍒嗗叺婧呭皠锛夛紱
+ * 鎭㈠ = heal 浜嬩欢鍥炲鍏靛姏鍚堣锛堝綊灞炴柦娉曡€咃紝濡傚垬澶囩殗瑁旀祦绂?寮犳満閲戝尞瑕佺暐锛夈€?+ *
+ * 琛屽簭锛氱孩 澶ц惀鈫掍腑鍐涒啋鍓嶉攱锛屽啀钃?鍓嶉攱鈫掍腑鍐涒啋澶ц惀锛堢己妲借繃婊わ級銆傞粯璁?`data-stats="skill"`銆?+ * @param report 褰撳墠鎴樻姤
+ */
 export function createStatsView(report: BattleReport): HTMLElement {
   const root = document.createElement('div');
   root.className = 'stats-view';
 
   const units = unitsFromReport(report);
   const detailed = computeDetailedStats(report.events, units);
   const byId = new Map(detailed.map((d) => [d.unitId, d]));
+  const shares = computeContributionShares(report.events, units);
+  const shareById = new Map(shares.map((s) => [s.unitId, s]));
 
-  // 琛岄『搴忥細钃濆ぇ钀?鈫?钃濅腑鍐?鈫?钃濆墠閿嬶紙鍒嗛殧锛夆啋 绾㈠墠閿?鈫?绾腑鍐?鈫?绾㈠ぇ钀?-  const rows: Array<{ g: General; color: 'red' | 'blue' }> = [
-    ...(['澶ц惀', '涓啗', '鍓嶉攱'] as const).map((p) => ({ g: report.enemyTeam.find((x) => x.position === p)!, color: 'blue' as const })),
-    ...(['鍓嶉攱', '涓啗', '澶ц惀'] as const).map((p) => ({ g: report.myTeam.find((x) => x.position === p)!, color: 'red' as const })),
-  ];
+  const POS = ['澶ц惀', '涓啗', '鍓嶉攱'] as const;
+  const redRows = POS.map((p) => report.myTeam.find((g) => g.position === p)).filter((g): g is General => !!g);
+  const blueRows = (['鍓嶉攱', '涓啗', '澶ц惀'] as const)
+    .map((p) => report.enemyTeam.find((g) => g.position === p))
+    .filter((g): g is General => !!g);
 
-  const visibleRows = rows.filter((r) => r.g);
+  let mode: 'skill' | 'hero' = 'skill';
 
-  const rowHtml = visibleRows
-    .map(({ g, color }) => {
-      const d = byId.get(g.id);
-      const cols = columnOrder(g);
-      return `
-        <tr class="row-${color}">
-          <td class="st-hero">
-            <img src="${avatarSrc(g.id)}" alt="" onerror="this.style.display='none'" />
-            <span>${g.name}</span>
-          </td>
-          <td class="st-cell">
-            <span class="st-name">鏅敾</span>
-            <span class="st-nums">娆℃暟 ${d?.attackCount ?? 0} 路 鏉€浼?${(d?.attackDamage ?? 0).toLocaleString()}</span>
-          </td>
-          ${cols.map((c) => skillCell(d, c.skillId)).join('')}
-        </tr>`;
-    })
-    .join('');
+  /**
+   * 娓叉煋涓€琛岋細绔欎綅绔栫 + 澶村儚鍗?+ 鎴樻硶鍥涘垪鎴栧崰姣旀潯銆?+   * @param g 姝﹀皢
+   * @param side 绾?钃?+   */
+  const statsRow = (g: General, side: 'red' | 'blue'): string => {
+    const body = mode === 'skill'
+      ? skillRowHtml(g, byId.get(g.id))
+      : (() => {
+          const sh = shareById.get(g.id);
+          return shareRowHtml(sh?.damagePct ?? 0, sh?.healPct ?? 0, sh?.controlPct ?? 0);
+        })();
+    return `<div class="st-row">
+      <span class="pos-tag ${side}">${g.position}</span>
+      ${heroMini(g)}
+      ${body}
+    </div>`;
+  };
+
+  const paintMain = (): void => {
+    const main = root.querySelector('.st-main');
+    if (!main) return;
+    main.innerHTML = `
+      <div class="st-team">${redRows.map((g) => statsRow(g, 'red')).join('')}</div>
+      <div class="st-team">${blueRows.map((g) => statsRow(g, 'blue')).join('')}</div>`;
+  };
 
   root.innerHTML = `
-    <div class="stats-table">
-      <div class="stats-toolbar">
-        <button type="button" class="st-detail-btn">璇︽儏</button>
-      </div>
-      <table>
-        <thead>
-          <tr>
-            <th>姝﹀皢</th>
-            <th>鏅敾</th>
-            <th>涓绘垬娉?/th>
-            <th>鎼哄甫鎴樻硶涓€</th>
-            <th>鎼哄甫鎴樻硶浜?/th>
-          </tr>
-        </thead>
-        <tbody>${rowHtml}</tbody>
-      </table>
-      <div class="tip">鍙ｅ緞锛氭鏁?= skill_cast 璁℃暟锛堟寚鎸ユ垬娉曞噯澶囬樁娈电畻 1 娆★紝濡傞瓘姝︿箣涓?娆℃暟 1 路 鏉€浼?0锛夛紱鏉€浼?= 璇ユ垬娉曞懡涓激瀹冲悎璁★紙鎸囨尌闃熷弸鏀诲嚮璁″叆鏂芥硶鑰呮垬娉曪紝涓嶅惈鏅敾/DoT/鍒嗗叺婧呭皠锛夛紱鎭㈠ = heal 浜嬩欢鍥炲鍏靛姏鍚堣锛堝綊灞炴柦娉曡€咃紝濡傚垬澶囩殗瑁旀祦绂?寮犳満閲戝尞瑕佺暐锛夈€傘€岃鎯呫€嶆煡鐪嬫湰闃熶激瀹?/ 鎭㈠ / 鎺у埗鍗犳瘮锛坉emo锛夈€?/div>
-    </div>
-  `;
+    <div class="st-page">
+      <aside class="st-rail">
+        <button type="button" data-stats="hero">姝﹀皢缁熻</button>
+        <button type="button" data-stats="skill" class="is-on">鎴樻硶缁熻</button>
+      </aside>
+      <div class="st-main scroll-quiet"></div>
+    </div>`;
+  paintMain();
 
-  root.querySelector('.st-detail-btn')?.addEventListener('click', () => openSharePanel(report));
+  root.querySelectorAll<HTMLButtonElement>('[data-stats]').forEach((btn) => {
+    btn.addEventListener('click', () => {
+      const next = btn.getAttribute('data-stats');
+      if (next !== 'skill' && next !== 'hero') return;
+      mode = next;
+      root.querySelectorAll('[data-stats]').forEach((el) => el.classList.toggle('is-on', el === btn));
+      paintMain();
+    });
+  });
   return root;
 }


### web/styles.css
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-3-before/styles.css', LF will be replaced by CRL
F the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-78d7b226-1fb3-44e8-b8b5-adebd6062693.ps1:143 字符: 425
+ ... rc)"); $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/styles.css', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-3-before/styles.css b/web/styles.css
index 6e9d956..bab78b8 100644
--- a/.superpowers/sdd/snapshots/task-3-before/styles.css
+++ b/web/styles.css
@@ -36,16 +36,17 @@
   --color-text-muted: var(--text-dim);
   --color-crimson: var(--red);
   --color-gold: var(--gold);
   --color-green: var(--green);
   --color-blue: var(--blue);
   --color-grade-s: #d989a0;
   --color-grade-a: #4a7ab0;
   --color-grade-b: #4e8a62;
+  --color-line: var(--line);
   --color-scroll: color-mix(in srgb, var(--text-dim) 28%, var(--bg));
   --card-accent: 2px solid var(--red);
   --radius: 8px;
 }
 
 * { box-sizing: border-box; margin: 0; padding: 0; }
 
 html { font-size: 14px; }
@@ -1313,65 +1314,213 @@ main {
 .report-dock .btn-back {
   margin-right: 8px;
   padding: 6px 10px;
   letter-spacing: 1px;
   color: var(--color-text-muted);
 }
 .report-dock .btn-back:hover { color: var(--gold-bright); }
 
-/* 鈹€鈹€ 缁熻瑙嗗浘锛堢珫琛級鈹€鈹€ */
+/* 鈹€鈹€ 缁熻瑙嗗浘锛堝浘浜岄鏋讹細宸﹁建 + 琛岋級鈹€鈹€ */
 .stats-view {
   padding: 6px 4px;
   flex: 1;
   min-height: 0;
-  overflow-y: auto;
+  min-width: 0;
+  display: flex;
+  flex-direction: column;
+  overflow: hidden;
 }
-.stats-view .stats-table { margin-top: 0; }
-.stats-view table { table-layout: fixed; }
-.stats-view th { text-align: center; }
-.stats-view th:nth-child(1) { width: 110px; }
-.stats-view td { text-align: center; }
-.stats-view .row-blue td:first-child { border-left: 3px solid var(--blue); }
-.stats-view .row-red td:first-child { border-left: 3px solid var(--red); }
-/* 娉ㄦ剰锛歵d 淇濇寔 table-cell锛屼笉鑳界敤 flex锛堜細瀵艰嚧琛ㄦ牸鍒楀闄枫€佸唴瀹瑰爢鍙狅級 */
-.st-hero { text-align: left; white-space: nowrap; }
-.st-hero img {
-  width: 26px;
-  height: 26px;
-  border-radius: 50%;
-  border: 1px solid var(--line-strong);
-  object-fit: cover;
-  object-position: 50% 18%;
-  background: #000;
-  vertical-align: middle;
-  margin-right: 6px;
+.st-page {
+  flex: 1;
+  min-height: 0;
+  min-width: 0;
+  display: grid;
+  grid-template-columns: 28px minmax(0, 1fr);
+  gap: 6px;
 }
-.st-hero span { font-family: var(--font-kai); font-size: 13px; color: var(--ink); vertical-align: middle; }
-.st-cell .st-name { display: block; font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
-.st-cell .st-nums { display: block; font-size: 10.5px; color: var(--text-dim); }
-.stats-toolbar {
+.st-rail {
   display: flex;
-  justify-content: flex-end;
-  margin-bottom: 6px;
+  flex-direction: column;
+  align-items: center;
+  gap: 6px;
+  padding-top: 2px;
 }
-.st-detail-btn {
+.st-rail button {
+  writing-mode: vertical-rl;
+  letter-spacing: 0.2em;
+  padding: 8px 3px;
+  font-size: 11px;
+  color: var(--color-text-muted);
+  border-radius: 4px;
   background: transparent;
-  border: 1px solid var(--line-strong);
-  color: var(--gold);
+  border: 0;
   cursor: pointer;
-  font-size: 12px;
+  font-family: inherit;
+}
+.st-rail button.is-on {
+  background: var(--color-crimson);
+  color: var(--color-text);
+}
+.st-main {
+  position: relative;
+  min-width: 0;
+  min-height: 0;
+  display: flex;
+  flex-direction: column;
+  gap: 4px;
+}
+.st-team {
+  flex: 1;
+  min-height: 0;
+  display: flex;
+  flex-direction: column;
+  gap: 3px;
+  position: relative;
+  z-index: 1;
+}
+.st-row {
+  flex: 1 1 auto;
+  min-height: 50px;
+  min-width: 0;
+  display: grid;
+  grid-template-columns: 14px 44px minmax(0, 1fr);
+  gap: 4px;
+  align-items: stretch;
+}
+.pos-tag {
+  writing-mode: vertical-rl;
+  display: grid;
+  place-items: center;
+  font-size: 10px;
+  letter-spacing: 0.16em;
+  border-radius: 4px;
+  color: var(--color-text);
+}
+.pos-tag.red { background: var(--color-crimson); }
+.pos-tag.blue { background: var(--color-blue); }
+
+.hcard {
+  position: relative;
+  min-width: 0;
+  min-height: 50px;
+  height: 100%;
+  border-radius: 4px;
+  overflow: hidden;
+  background: var(--color-surface-2);
+  border: 1px solid var(--color-line);
+  border-bottom: var(--card-accent);
+  display: grid;
+}
+.hcard::after {
+  content: attr(data-name);
+  font-size: 10px;
+  color: var(--color-text-muted);
+  place-self: center;
+  z-index: 0;
+}
+.hcard img {
+  position: absolute;
+  inset: 0;
+  width: 100%;
+  height: 100%;
+  object-fit: cover;
+  object-position: 50% 18%;
+  z-index: 1;
+}
+.hcard .hn, .hcard .lv, .hcard .stars {
+  position: absolute;
+  z-index: 2;
+  text-shadow: 0 1px 2px var(--color-bg);
+}
+.hcard .hn {
+  left: 2px;
+  top: 1px;
+  font-size: 9px;
   font-family: var(--font-kai);
-  letter-spacing: 1px;
-  padding: 2px 12px;
+  font-style: normal;
+  line-height: 1.1;
 }
-.st-detail-btn:hover {
-  border-color: var(--gold);
-  color: var(--gold-bright);
-  background: rgba(201, 164, 92, .12);
+.hcard .lv { left: 2px; bottom: 1px; font-size: 8px; color: var(--color-gold); }
+.hcard .stars { display: none; }
+.hcard .stars i {
+  width: 5px;
+  height: 5px;
+  background: var(--color-line);
+  clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
+}
+.hcard .stars i.on { background: var(--color-crimson); }
+
+.sk-row, .sh-row {
+  min-width: 0;
+  min-height: 0;
+  display: grid;
+  grid-template-columns: repeat(4, minmax(0, 1fr));
+  gap: 4px;
+  background: var(--color-surface);
+  border: 1px solid var(--color-line);
+  border-radius: var(--radius);
+  padding: 4px 5px;
+  align-content: center;
+  overflow: visible;
+}
+.sh-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
+.sk { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
+.sk-h { display: flex; align-items: center; gap: 4px; min-width: 0; }
+.sk-n {
+  flex: 1;
+  min-width: 0;
+  font-size: 11px;
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+}
+.sk-c { font-size: 10px; color: var(--color-text-muted); flex: 0 0 auto; }
+.sk-d { font-size: 10px; color: var(--color-text-muted); }
+.sk-d .heal { color: var(--color-green); }
+
+.sk-row .grade {
+  width: 12px;
+  height: 12px;
+  border-radius: 50%;
+  display: grid;
+  place-items: center;
+  font-size: 8px;
+  flex: 0 0 auto;
+  padding: 0;
+  margin-left: 0;
+  border-color: transparent;
+}
+.sk-row .grade.c, .sk-row .grade.d {
+  background: var(--color-text-muted);
+  color: var(--color-text);
+}
+
+.sh-row .meter { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: var(--color-text-muted); }
+.sh-row .meter .bar { height: 8px; background: var(--color-surface-2); border-radius: 2px; overflow: hidden; }
+.sh-row .meter .bar i { display: block; height: 100%; background: var(--color-crimson); }
+.sh-row .meter.heal .bar i { background: var(--color-green); }
+.sh-row .meter.ctrl .bar i { background: var(--color-blue); }
+
+@media (min-width: 900px) {
+  .st-page {
+    grid-template-columns: 48px minmax(0, 1fr);
+    gap: 14px;
+  }
+  .st-rail button { font-size: 14px; padding: 14px 8px; }
+  .st-team { gap: 8px; }
+  .st-row { gap: 10px; }
+  .pos-tag { font-size: 13px; }
+  .hcard .hn { font-size: 12px; }
+  .hcard .lv { font-size: 11px; }
+  .hcard .stars { display: flex; right: 3px; top: 3px; gap: 1px; }
+  .hcard .stars i { width: 7px; height: 7px; }
+  .sk-row, .sh-row { gap: 10px; padding: 8px 12px; }
+  .sk-n { font-size: 13px; }
+  .sk-d { font-size: 12px; }
 }
 
 /* 鈹€鈹€ 缁熻銆岃鎯呫€嶅崰姣旈潰鏉匡紙涓荤珯 / 瀹為獙瀹ゅ叡鐢紱绫诲悕 ss-* 閬垮厤涓庡疄楠屽 .share-card 鍐茬獊锛夆攢鈹€ */
 .stats-share-modal { width: min(860px, 94vw); }
 .stats-share-modal .m-body { padding: 12px 16px 16px; }
 .ss-note {
   font-size: 11px;
   color: var(--text-weak);


### web/mobile.css
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-3-before/mobile.css', LF will be replaced by CRL
F the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-78d7b226-1fb3-44e8-b8b5-adebd6062693.ps1:143 字符: 425
+ ... rc)"); $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/mobile.css', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-3-before/mobile.css b/web/mobile.css
index 5cb39d6..af505ec 100644
--- a/.superpowers/sdd/snapshots/task-3-before/mobile.css
+++ b/web/mobile.css
@@ -111,16 +111,24 @@
   .sum-hero .troopbar { height: 9px; }
   .vs-badge > span:first-of-type { font-size: 18px; }
   .vs-badge .sum-rounds { font-size: 9.5px; }
   .vs-badge::before, .vs-badge::after { max-height: 28px; }
   .report-dock { padding: 4px 10px; min-height: 42px; }
   .report-dock .btn { padding: 4px 10px; font-size: 12px; }
   .report-tabs .btn { padding: 4px 10px; font-size: 12px; }
 
+  /* 缁熻椤甸鏋讹細妯睆琛岄珮涓嶅緱鍘嬪彔锛屽ご鍍忓垪绾?44px */
+  .st-row {
+    min-height: 50px;
+    grid-template-columns: 14px 44px minmax(0, 1fr);
+    gap: 4px;
+  }
+  .st-page { grid-template-columns: 28px minmax(0, 1fr); gap: 6px; }
+
   /* 缁熻 / 璇︽儏琛ㄦ牸 */
   .stats-table th, .stats-table td { padding: 3px 8px; font-size: 11px; }
   .stats-share-modal { width: min(96vw, 860px); }
   .ss-row, .ss-heads { grid-template-columns: 1fr 28px 1fr; gap: 4px; }
   .ss-pos-mid { font-size: 10px; }
   .troops-wrap { gap: 8px; margin-bottom: 8px; }
   .troop-col { padding: 8px 12px; }
   .troop-row { font-size: 11px; margin-bottom: 5px; }


### web/smoke.test.ts
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-3-before/smoke.test.ts', LF will be replaced by 
CRLF the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-78d7b226-1fb3-44e8-b8b5-adebd6062693.ps1:143 字符: 425
+ ... rc)"); $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/smoke.test.ts', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-3-before/smoke.test.ts b/web/smoke.test.ts
index 467b9c5..fbe3216 100644
--- a/.superpowers/sdd/snapshots/task-3-before/smoke.test.ts
+++ b/web/smoke.test.ts
@@ -214,17 +214,17 @@ describe('Web 鎴樻枟妯℃嫙鍣ㄥ啋鐑?, () => {
   });
 
   it('閫夊皢 鈫?寮€濮嬫ā鎷?鈫?榛樿绠€鐣ユ垬鎶ワ紝鍙垏鎹㈢粺璁?鎴樻姤璇︽儏', async () => {
     await boot();
     // 绾㈤槦锛氬墠閿?澶彶鎱堛€佷腑鍐?鍛ㄧ憸銆佸ぇ钀?瀛欐潈锛涜摑闃燂細鍓嶉攱=榄忓欢
     pickHeroIntoSlot('red', 2, '澶彶鎱?);
     pickHeroIntoSlot('red', 1, '鍛ㄧ憸');
     pickHeroIntoSlot('red', 0, '瀛欐潈');
-    pickHeroIntoSlot('blue', 0, '榄忓欢');
+    pickHeroIntoSlot('blue', 2, '榄忓欢');
     // 妲戒綅濉厖纭
     const redPanel = document.querySelector('.team-panel.red') as HTMLElement;
     expect(redPanel.querySelectorAll('.slot .hero-name')[2].textContent).toContain('澶彶鎱?);
     // 鎴樻硶鑺墖锛氬お鍙叉厛涓绘垬娉曟柟闃电獊鍑伙紙杩藉嚮锛?     expect(redPanel.querySelectorAll('.slot')[2].textContent).toContain('鏂归樀绐佸嚮');
     expect(redPanel.textContent).not.toContain('鐐瑰嚮鏌ョ湅璇︽儏');
     expect(redPanel.querySelector('.team-clear')!.textContent).toContain('娓呯┖鏈槦');
 
@@ -252,40 +252,28 @@ describe('Web 鎴樻枟妯℃嫙鍣ㄥ啋鐑?, () => {
     expect(dock.textContent).toContain('缁熻');
     expect(dock.textContent).toContain('璇︽儏');
     expect(document.querySelector('.report-nav')).toBeFalsy();
     const navBtn = (label: string) =>
       Array.from(dock.querySelectorAll('button')).find((b) => b.textContent!.includes(label)) as HTMLElement;
     navBtn('缁熻').click();
     const stats = document.querySelector('.stats-view') as HTMLElement;
     expect(stats, '缁熻瑙嗗浘搴斿嚭鐜?).toBeTruthy();
-    expect(stats.querySelectorAll('tbody tr').length).toBe(4);
-    // 姣忚 5 涓?td锛氬ご鍍?+ 鏅敾 + 涓绘垬娉?+ 鎼哄甫涓€ + 鎼哄甫浜岋紱椤舵爮浠?1 涓€岃鎯呫€?-    stats.querySelectorAll('tbody tr').forEach((tr) => {
-      expect(tr.querySelectorAll('td').length).toBe(5);
-    });
-    expect(stats.querySelectorAll('.st-detail-btn').length).toBe(1);
-    (stats.querySelector('.st-detail-btn') as HTMLButtonElement).click();
-    const sharePanel = document.querySelector('.stats-share-modal') as HTMLElement;
-    expect(sharePanel, '璇︽儏鍗犳瘮闈㈡澘搴旀墦寮€').toBeTruthy();
-    expect(sharePanel.textContent).toContain('浼ゅ鍗犳瘮');
-    expect(sharePanel.textContent).toContain('鎭㈠鍗犳瘮');
-    expect(sharePanel.textContent).toContain('鎺у埗鍗犳瘮');
-    expect(Array.from(sharePanel.querySelectorAll('.ss-pos-mid')).map((el) => el.textContent)).toEqual(['澶ц惀', '涓啗', '鍓嶉攱']);
-    const firstRow = sharePanel.querySelector('.ss-row') as HTMLElement;
-    expect(firstRow.querySelector('.ss-card.row-blue')).toBeTruthy();
-    expect(firstRow.querySelector('.ss-card.row-red')).toBeTruthy();
-    (sharePanel.querySelector('.m-close') as HTMLElement).click();
-    expect(document.querySelector('.stats-share-modal')).toBeFalsy();
-    // 鏅敾缁熻鍦ㄦ櫘鏀诲垪涓嬶紙涓嶅湪澶村儚鍒楋級
-    const attackTd = stats.querySelectorAll('tbody tr')[0].querySelectorAll('td')[1];
-    expect(attackTd.textContent).toContain('鏅敾');
-    expect(attackTd.textContent).toContain('娆℃暟');
-    // 涓绘垬娉曞垪锛堝瓩鏉冧富鎴樻硶 涔濋敗榛勯緳锛?+    expect(stats.querySelector('table')).toBeFalsy();
+    expect(stats.querySelectorAll('.st-row').length).toBe(4); // 3 绾?+ 1 钃?+    const labels = Array.from(stats.querySelectorAll('.pos-tag')).map((el) => el.textContent);
+    expect(labels).toEqual(['澶ц惀', '涓啗', '鍓嶉攱', '鍓嶉攱']); // 绾笁绔欎綅鍚庢帴钃濆墠閿?+    expect(stats.querySelector('[data-stats="skill"]')).toBeTruthy();
+    // 榛樿鎴樻硶缁熻锛氭櫘鏀?+ 娆℃暟鍦?.sk-row锛堜笉鍐嶇敤 td锛?+    expect(stats.querySelector('.sk-row')!.textContent).toContain('鏅敾');
+    expect(stats.querySelector('.sk-row')!.textContent).toContain('娆℃暟');
     expect(stats.textContent).toContain('涔濋敗榛勯緳');
+    (stats.querySelector('[data-stats="hero"]') as HTMLButtonElement).click();
+    expect(stats.querySelector('.sh-row')).toBeTruthy();
+    expect(stats.textContent).toContain('浼ゅ');
     // 搴曟爮椤电涓€閿繑鍥炵畝鐣?     navBtn('绠€鐣?).click();
     expect(document.querySelector('.battle-summary')).toBeTruthy();
 
     // 鎴樻姤璇︽儏锛堥€愬洖鍚堜簨浠讹級
     navBtn('璇︽儏').click();
     const banner = document.querySelector('.result-banner') as HTMLElement;
     expect(banner, '缁撴灉妯箙搴斿嚭鐜?).toBeTruthy();


### tests/damage_lab_smoke.test.ts
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-3-before/damage_lab_smoke.test.ts', LF will be r
eplaced by CRLF the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-78d7b226-1fb3-44e8-b8b5-adebd6062693.ps1:143 字符: 425
+ ... rc)"); $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'tests/damage_lab_smoke.test.ts', LF will be replaced by CRLF the next time Git touches
 it
diff --git a/.superpowers/sdd/snapshots/task-3-before/damage_lab_smoke.test.ts b/tests/damage_lab_smoke.test.ts
index 8395813..48a944c 100644
--- a/.superpowers/sdd/snapshots/task-3-before/damage_lab_smoke.test.ts
+++ b/tests/damage_lab_smoke.test.ts
@@ -260,29 +260,30 @@ describe('浼ゅ娴嬭瘯瀹為獙瀹わ紙涓荤珯妯″潡 v2锛?, () => {
       const src = img.getAttribute('src') ?? '';
       expect(src, `${img.alt || '姝﹀皢'} 鐢诲儚 src 涓嶅簲涓虹┖`).toMatch(/^\/portraits\//);
     }
     const guardImgs = imgs.filter((img) => img.alt === '渚嶅崼');
     expect(guardImgs.length).toBe(3);
     for (const img of guardImgs) {
       expect(img.getAttribute('src')).toContain('guard');
     }
-    // 缁熻锛堝惈銆岃鎯呫€嶅崰姣斿垪锛屼笌涓荤珯 createStatsView 鍏辩敤锛?+    // 缁熻锛堝浘浜岄鏋讹紝涓庝富绔?createStatsView 鍏辩敤锛涙棤鍗犳瘮寮圭獥锛?     tabs[2].click();
     const stats = analysis.querySelector('.stats-view') as HTMLElement;
     expect(stats).toBeTruthy();
-    expect(stats.querySelectorAll('.st-detail-btn').length).toBe(1);
-    (stats.querySelector('.st-detail-btn') as HTMLButtonElement).click();
-    const sharePanel = document.querySelector('.stats-share-modal') as HTMLElement;
-    expect(sharePanel, '瀹為獙瀹ょ粺璁¤鎯呭崰姣旈潰鏉垮簲鎵撳紑').toBeTruthy();
-    expect(sharePanel.textContent).toContain('浼ゅ鍗犳瘮');
-    expect(sharePanel.textContent).toContain('鎭㈠鍗犳瘮');
-    expect(sharePanel.textContent).toContain('鎺у埗鍗犳瘮');
-    expect(Array.from(sharePanel.querySelectorAll('.ss-pos-mid')).map((el) => el.textContent)).toEqual(['澶ц惀', '涓啗', '鍓嶉攱']);
-    (sharePanel.querySelector('.m-close') as HTMLElement).click();
+    expect(stats.querySelector('table')).toBeFalsy();
+    expect(stats.querySelectorAll('.st-row').length).toBe(4); // 1 绾?+ 3 渚嶅崼
+    const labels = Array.from(stats.querySelectorAll('.pos-tag')).map((el) => el.textContent);
+    expect(labels).toEqual(['澶ц惀', '鍓嶉攱', '涓啗', '澶ц惀']); // 绾㈠ぇ钀ュ悗鎺ヨ摑 鍓嶉攱鈫掍腑鍐涒啋澶ц惀
+    expect(stats.querySelector('[data-stats="skill"]')).toBeTruthy();
+    expect(stats.querySelector('.sk-row')).toBeTruthy();
+    (stats.querySelector('[data-stats="hero"]') as HTMLButtonElement).click();
+    expect(stats.querySelector('.sh-row')).toBeTruthy();
+    expect(stats.textContent).toContain('浼ゅ');
+    expect(document.querySelector('.stats-share-modal')).toBeFalsy();
     // 鎴樻姤璇︽儏
     tabs[3].click();
     expect(analysis.querySelector('.battle-view')).toBeTruthy();
   });
 
   it('杩斿洖瀹為獙瀹ゆ寜閽細鍒嗘瀽椤甸殣钘忋€佸疄楠屽涓讳綋鎭㈠', () => {
     const { state } = boot();
     fillRedTeam(state, 1);

