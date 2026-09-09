# Review package: Task 2 (no git)
## Files changed
web/main.ts
web/styles.css
web/mobile.css
web/smoke.test.ts

## Diff

### main.ts
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-2-before/main.ts', LF will be replaced by CRLF t
he next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-daabe8f0-724d-44bb-b5b0-20d4301392f1.ps1:137 字符: 493
+ ...  $f"); $d = git --no-pager diff --no-index -U10 -- $before $after 2>& ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/main.ts', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-2-before/main.ts b/web/main.ts
index f45ca12..0e82b86 100644
--- a/.superpowers/sdd/snapshots/task-2-before/main.ts
+++ b/web/main.ts
@@ -223,69 +223,106 @@ function startBattle(): void {
   }
   try {
     const report = runBattle({ myTeam: my, enemyTeam: enemy, seed, maxRounds: MAX_ROUNDS });
     recordBattle(report, my, enemy);
     // 鎴樻姤瀹瑰櫒椤绘寕杞藉湪椤甸潰涓婏紙杩斿洖閰嶅皢鍚庡鍣ㄨ闅愯棌锛屼笉 remove 浠ュ厤鑴辩 DOM锛?     if (!battleRoot.isConnected) {
       const host = app.querySelector('main') ?? app;
       host.appendChild(battleRoot);
     }
     battleRoot.style.display = '';
-    // 闅愯棌缂栬緫鍖猴紝灞曠ず鎴樻姤锛堥粯璁ょ畝鐣ユ垬鎶ワ紝椤甸潰鍐呭垏鎹?缁熻 / 鎴樻姤璇︽儏锛?+    // 闅愯棌缂栬緫鍖猴紝灞曠ず鎴樻姤锛堥粯璁ょ畝鐣ワ紱搴曟爮鍒囨崲 缁熻 / 璇︽儏锛?     editorRoot.style.display = 'none';
     errBox.textContent = '';
     renderBattleView(report, 'summary');
   } catch (e) {
     errBox.textContent = `妯℃嫙澶辫触锛?{(e as Error).message}`;
   }
 }
 
-/** 鎴樻姤瑙嗗浘娓叉煋锛歴ummary=绠€鐣?/ stats=缁熻 / detail=閫愬洖鍚堣鎯咃紙椤甸潰鍐呭垏鎹紝椤堕儴瀵艰埅濮嬬粓鍙锛?*/
+/** 鍏抽棴鎴樻姤椤碉細鍘绘帀 report-open銆佹仮澶嶉厤灏嗗尯銆佹竻绌烘垬鎶?DOM */
+function closeReportView(): void {
+  app.classList.remove('report-open');
+  editorRoot.style.display = '';
+  battleRoot.style.display = 'none';
+  battleRoot.innerHTML = '';
+}
+
+/**
+ * 鎴樻姤瑙嗗浘娓叉煋锛歴ummary=绠€鐣?/ stats=缁熻 / detail=閫愬洖鍚堣鎯呫€?+ * 椤电鍦ㄥ簳鏍?`.report-dock`锛屾棤椤堕儴 `.report-nav`锛涚粰 `#app` 鍔?`report-open` 闅愯棌鍝佺墝椤舵爮涓庨厤灏嗗簳鏍忋€?+ */
 function renderBattleView(report: BattleReport, mode: 'summary' | 'stats' | 'detail'): void {
   battleRoot.innerHTML = '';
+  app.classList.add('report-open');
 
   const view = document.createElement('div');
   view.className = 'report-view';
 
-  // 杩斿洖閰嶅皢涓?Tab 鍚屼竴琛岋紝閬垮厤鍗曠嫭鍗犻珮鎶婄敾鍍忛《鍑鸿鍙?-  const nav = document.createElement('div');
-  nav.className = 'report-nav';
+  const body = document.createElement('div');
+  body.className = 'report-body';
+  if (mode === 'summary') {
+    body.appendChild(createBattleSummary(report));
+  } else if (mode === 'stats') {
+    body.appendChild(createStatsView(report));
+  } else {
+    body.appendChild(createBattleView(report).el);
+  }
+  view.appendChild(body);
+
+  const dock = document.createElement('footer');
+  dock.className = 'report-dock';
+
   const back = document.createElement('button');
+  back.type = 'button';
   back.className = 'btn ghost btn-back';
   back.textContent = '鈫?杩斿洖閰嶅皢';
-  back.onclick = () => {
-    editorRoot.style.display = '';
-    battleRoot.style.display = 'none';
-    battleRoot.innerHTML = '';
-  };
-  nav.appendChild(back);
+  back.onclick = () => closeReportView();
+  dock.appendChild(back);
+
+  const tabs = document.createElement('nav');
+  tabs.className = 'report-tabs';
+  tabs.setAttribute('aria-label', '鎴樻姤瑙嗗浘');
   const modes: Array<['summary' | 'stats' | 'detail', string]> = [
-    ['summary', '绠€鐣ユ垬鎶?],
+    ['summary', '绠€鐣?],
     ['stats', '缁熻'],
-    ['detail', '鎴樻姤璇︽儏'],
+    ['detail', '璇︽儏'],
   ];
   for (const [m, label] of modes) {
     const b = document.createElement('button');
+    b.type = 'button';
     b.className = 'btn ghost' + (m === mode ? ' on' : '');
+    b.dataset.mode = m;
     b.textContent = label;
     b.onclick = () => renderBattleView(report, m);
-    nav.appendChild(b);
+    tabs.appendChild(b);
   }
-  view.appendChild(nav);
+  dock.appendChild(tabs);
+
+  const reuse = document.createElement('button');
+  reuse.type = 'button';
+  reuse.className = 'btn ghost';
+  reuse.textContent = '澶嶇敤闃熶紞';
+  reuse.onclick = () => reuseTeamFromReport(report);
+  dock.appendChild(reuse);
+
+  const again = document.createElement('button');
+  again.type = 'button';
+  again.className = 'btn primary';
+  again.textContent = '鍐嶆墦涓€鍦?;
+  again.onclick = () => {
+    battleRoot.innerHTML = '';
+    startBattle();
+  };
+  dock.appendChild(again);
 
-  if (mode === 'summary') {
-    view.appendChild(createBattleSummary(report));
-  } else if (mode === 'stats') {
-    view.appendChild(createStatsView(report));
-  } else {
-    view.appendChild(createBattleView(report).el);
-  }
+  view.appendChild(dock);
   battleRoot.appendChild(view);
 }
 
 /** 鎴樻姤 鈫?SlotState 鍙嶆帹锛堜笌 buildGeneral 浜掗€嗭級锛氶潰鏉?= round(鍩虹 + (L-1)脳鎴愰暱) + 鑷敱鍔犵偣锛?  *  绛夌骇/绾㈠害闅忔垬鎶ラ€忎紶杩樺師锛涜嚜鐢卞姞鐐规寜璇ョ瓑绾у弽鎺紙闈㈡澘绮剧‘杩樺師锛夈€?*/
 function generalToSlot(g: General): SlotState {
   const h = HEROES.find((x) => x.id === g.id);
   const level = g.level ?? 40;
   const redness = g.redness ?? 0;
   const mainId = h?.mainSkillId ?? '';
@@ -306,23 +343,21 @@ function generalToSlot(g: General): SlotState {
 /** 澶嶇敤鎴樻姤闃熶紞锛氭妸绾?钃濆弻鏂癸紙澶ц惀鈫掍腑鍐涒啋鍓嶉攱锛夊鍒跺埌閰嶅皢鍖猴紝杩斿洖閰嶅皢鐣岄潰 */
 function reuseTeamFromReport(report: BattleReport): void {
   const toSlots = (team: General[]): SlotState[] =>
     RED_POSITIONS.map((p) => {
       const g = team.find((x) => x.position === p);
       return g ? generalToSlot(g) : emptySlot();
     });
   state.red = toSlots(report.myTeam);
   state.blue = toSlots(report.enemyTeam);
   refresh();
-  editorRoot.style.display = '';
-  battleRoot.style.display = 'none';
-  battleRoot.innerHTML = '';
+  closeReportView();
 }
 
 /** 搴旂敤鍏ュ彛锛氭寕杞藉埌 #app锛堟祻瑙堝櫒鑷姩璋冪敤锛涙祴璇曞彲鎵嬪姩璋冪敤锛?*/
 export function initApp(root?: HTMLElement): void {
   // 閲嶇疆閰嶅皢鐘舵€侊紙鏀寔閲嶅鍒濆鍖?娴嬭瘯闅旂锛?   Object.assign(state, emptyEditor());
   redMorale = 120;
   blueMorale = 120;
   seed = Math.floor(Math.random() * 1000000);
   app = root ?? document.getElementById('app')!;


### styles.css
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-2-before/styles.css', LF will be replaced by CRL
F the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-daabe8f0-724d-44bb-b5b0-20d4301392f1.ps1:137 字符: 493
+ ...  $f"); $d = git --no-pager diff --no-index -U10 -- $before $after 2>& ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/styles.css', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-2-before/styles.css b/web/styles.css
index 7e9d7fb..6e9d956 100644
--- a/.superpowers/sdd/snapshots/task-2-before/styles.css
+++ b/web/styles.css
@@ -72,20 +72,23 @@ input[type="text"]:focus, input[type="number"]:focus, select:focus {
   border-color: var(--gold);
 }
 
 /* 鈹€鈹€ 搴旂敤楠ㄦ灦锛氬浐瀹氬崟灞?鈹€鈹€ */
 #app, .app-shell {
   height: 100%;
   display: flex;
   flex-direction: column;
   overflow: hidden;
 }
+/* 鎴樻姤椤碉細闅愯棌鍝佺墝椤舵爮涓庨厤灏嗗簳鏍忥紝鍙暀 .report-dock */
+#app.report-open header.app { display: none; }
+#app.report-open .control-bar { display: none; }
 
 /* 鈹€鈹€ 椤舵爮锛堢巼鍦熸爣棰樻爮锛氶噾绾?+ 鏆楃孩鍙岀嚎 + 宸︿笂銆岀巼銆嶅浘鏍囷級 鈹€鈹€ */
 header.app {
   flex-shrink: 0;
   display: flex;
   align-items: center;
   gap: 14px;
   padding: 10px 24px;
   background: linear-gradient(180deg, #26200f, #1b150c);
   border-bottom: 1px solid var(--gold);
@@ -764,20 +767,23 @@ main {
   color: var(--gold);
   border: none;
   font-weight: 500;
   padding: 4px 10px;
 }
 .btn.ghost:hover, .btn.done:hover {
   background: transparent;
   border: none;
   color: var(--gold-bright);
 }
+.btn.primary {
+  font-weight: 700;
+}
 
 /* 椤靛唴鎻愮ず锛堟浛浠ｇ郴缁?alert锛?*/
 .app-notice {
   position: fixed;
   top: 58px;
   left: 50%;
   transform: translateX(-50%);
   z-index: 300;
   max-width: min(520px, 90vw);
   background: var(--panel);
@@ -1069,20 +1075,28 @@ main {
   overflow-y: auto;
 }
 .report-view {
   min-width: 0;
   flex: 1;
   min-height: 0;
   display: flex;
   flex-direction: column;
   overflow: hidden;
 }
+.report-body {
+  flex: 1;
+  min-height: 0;
+  min-width: 0;
+  overflow: hidden;
+  display: flex;
+  flex-direction: column;
+}
 
 .sum-result {
   display: grid;
   grid-template-columns: 1fr 120px 1fr;
   align-items: center;
   gap: 12px;
   flex-shrink: 0;
 }
 .sum-side { min-width: 0; }
 .sum-side .ss-title {
@@ -1257,48 +1271,59 @@ main {
 .vs-badge .sum-rounds {
   font-size: 10.5px;
   color: var(--text-weak);
   letter-spacing: 0;
   line-height: 1.35;
   text-align: center;
   margin-top: 4px;
   flex-shrink: 0;
 }
 
-/* 鎴樻姤瑙嗗浘鍒囨崲锛氳繑鍥為厤灏?+ Tab 鍚屼竴琛?*/
-.report-nav {
+/* 鎴樻姤搴曟爮锛氳繑鍥為厤灏?+ 灞呬腑椤电 + 澶嶇敤闃熶紞 / 鍐嶆墦涓€鍦?*/
+.report-dock {
+  flex-shrink: 0;
+  display: flex;
+  flex-direction: row;
+  align-items: center;
+  justify-content: space-between;
+  gap: 6px;
+  padding: 8px 12px;
+  background: var(--color-surface);
+  border-top: 1px solid var(--line);
+}
+.report-tabs {
+  flex: 1;
   display: flex;
+  justify-content: center;
   align-items: center;
+  min-width: 0;
   gap: 4px;
-  margin-bottom: 8px;
-  border-bottom: 1px solid var(--line);
-  flex-shrink: 0;
 }
-.report-nav .btn {
+.report-tabs .btn {
   padding: 6px 16px;
   font-size: 13px;
   letter-spacing: 2px;
   border-radius: 0;
 }
-.report-nav .btn.on {
+.report-tabs .btn.on {
   background: transparent;
   color: var(--gold-bright);
   box-shadow: inset 0 -2px 0 var(--gold);
   font-weight: 700;
 }
-.report-nav .btn-back {
+.report-dock .btn-back {
   margin-right: 8px;
   padding: 6px 10px;
   letter-spacing: 1px;
-  color: var(--text-dim);
+  color: var(--color-text-muted);
 }
-.report-nav .btn-back:hover { color: var(--gold-bright); }
+.report-dock .btn-back:hover { color: var(--gold-bright); }
 
 /* 鈹€鈹€ 缁熻瑙嗗浘锛堢珫琛級鈹€鈹€ */
 .stats-view {
   padding: 6px 4px;
   flex: 1;
   min-height: 0;
   overflow-y: auto;
 }
 .stats-view .stats-table { margin-top: 0; }
 .stats-view table { table-layout: fixed; }


### mobile.css
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-2-before/mobile.css', LF will be replaced by CRL
F the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-daabe8f0-724d-44bb-b5b0-20d4301392f1.ps1:137 字符: 493
+ ...  $f"); $d = git --no-pager diff --no-index -U10 -- $before $after 2>& ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/mobile.css', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-2-before/mobile.css b/web/mobile.css
index 542c642..5cb39d6 100644
--- a/.superpowers/sdd/snapshots/task-2-before/mobile.css
+++ b/web/mobile.css
@@ -105,22 +105,23 @@
   .sum-hero { padding: 4px 4px 6px; }
   .sum-hero .sh-name { font-size: 12px; margin: 4px 0 1px; }
   .sum-hero .sh-meta { font-size: 10px; margin-bottom: 3px; }
   .sum-hero .sh-stars { font-size: 10px; letter-spacing: 2px; padding: 10px 0 2px; }
   .sum-hero .sh-art { min-height: 0; }
   .sum-hero .sh-troops { font-size: 10px; margin-top: 2px; }
   .sum-hero .troopbar { height: 9px; }
   .vs-badge > span:first-of-type { font-size: 18px; }
   .vs-badge .sum-rounds { font-size: 9.5px; }
   .vs-badge::before, .vs-badge::after { max-height: 28px; }
-  .report-nav { margin-bottom: 4px; }
-  .report-nav .btn { padding: 4px 10px; font-size: 12px; }
+  .report-dock { padding: 4px 10px; min-height: 42px; }
+  .report-dock .btn { padding: 4px 10px; font-size: 12px; }
+  .report-tabs .btn { padding: 4px 10px; font-size: 12px; }
 
   /* 缁熻 / 璇︽儏琛ㄦ牸 */
   .stats-table th, .stats-table td { padding: 3px 8px; font-size: 11px; }
   .stats-share-modal { width: min(96vw, 860px); }
   .ss-row, .ss-heads { grid-template-columns: 1fr 28px 1fr; gap: 4px; }
   .ss-pos-mid { font-size: 10px; }
   .troops-wrap { gap: 8px; margin-bottom: 8px; }
   .troop-col { padding: 8px 12px; }
   .troop-row { font-size: 11px; margin-bottom: 5px; }
   .event-stream { padding: 8px 12px; }


### smoke.test.ts
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-2-before/smoke.test.ts', LF will be replaced by 
CRLF the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-daabe8f0-724d-44bb-b5b0-20d4301392f1.ps1:137 字符: 493
+ ...  $f"); $d = git --no-pager diff --no-index -U10 -- $before $after 2>& ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/smoke.test.ts', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-2-before/smoke.test.ts b/web/smoke.test.ts
index 6078b7d..467b9c5 100644
--- a/.superpowers/sdd/snapshots/task-2-before/smoke.test.ts
+++ b/web/smoke.test.ts
@@ -237,26 +237,30 @@ describe('Web 鎴樻枟妯℃嫙鍣ㄥ啋鐑?, () => {
     expect(summary.querySelector('.vs-badge')).toBeTruthy();                 // VS 鍥炬爣
     expect(summary.querySelectorAll('.sum-hero').length).toBe(4);            // 3 绾?+ 1 钃?     expect(summary.querySelectorAll('.sh-stars').length).toBe(4);            // 鏄熺骇/绾㈠害
     expect(summary.textContent).toContain('绾?);
     expect(summary.textContent).toMatch(/(绾㈤槦鑳滃埄|钃濋槦鑳滃埄|鍙屾柟骞冲眬|绾㈣儨|钃濊儨|骞冲眬)/);
     // 鍗曞睆甯冨眬锛氬簳閮ㄤ笉鍐嶉噸澶嶃€岀粺璁?鎴樻姤璇︽儏銆嶏紱鍥炲悎/绉嶅瓙鏀惰繘 VS 鍒楋紝閬垮厤鐩栦綇鐢诲儚
     expect(document.querySelector('.report-toolbar')).toBeFalsy();
     expect(summary.querySelector('.sum-foot')).toBeFalsy();
     expect(summary.querySelector('.vs-badge')!.textContent).toContain('鍥炲悎');
     expect(summary.querySelector('.vs-badge')!.textContent).toContain('绉嶅瓙');
-    // 杩斿洖閰嶅皢涓?Tab 鍚屼竴琛岋紝涓嶅崟鐙崰楂?-    expect(document.querySelector('.report-nav')!.textContent).toContain('杩斿洖閰嶅皢');
-
-    // 缁熻瑙嗗浘锛堥《閮ㄥ鑸垏鎹級
+    // 鎴樻姤椤垫棤椤舵爮椤电锛氳繑鍥為厤灏?/ 绠€鐣?/ 缁熻 / 璇︽儏 鍦ㄥ簳鏍?+    const dock = document.querySelector('.report-dock') as HTMLElement;
+    expect(dock, '鎴樻姤搴曟爮搴斿嚭鐜?).toBeTruthy();
+    expect(dock.textContent).toContain('杩斿洖閰嶅皢');
+    expect(dock.textContent).toContain('绠€鐣?);
+    expect(dock.textContent).toContain('缁熻');
+    expect(dock.textContent).toContain('璇︽儏');
+    expect(document.querySelector('.report-nav')).toBeFalsy();
     const navBtn = (label: string) =>
-      Array.from(document.querySelectorAll('.report-nav .btn')).find((b) => b.textContent!.includes(label)) as HTMLElement;
+      Array.from(dock.querySelectorAll('button')).find((b) => b.textContent!.includes(label)) as HTMLElement;
     navBtn('缁熻').click();
     const stats = document.querySelector('.stats-view') as HTMLElement;
     expect(stats, '缁熻瑙嗗浘搴斿嚭鐜?).toBeTruthy();
     expect(stats.querySelectorAll('tbody tr').length).toBe(4);
     // 姣忚 5 涓?td锛氬ご鍍?+ 鏅敾 + 涓绘垬娉?+ 鎼哄甫涓€ + 鎼哄甫浜岋紱椤舵爮浠?1 涓€岃鎯呫€?     stats.querySelectorAll('tbody tr').forEach((tr) => {
       expect(tr.querySelectorAll('td').length).toBe(5);
     });
     expect(stats.querySelectorAll('.st-detail-btn').length).toBe(1);
     (stats.querySelector('.st-detail-btn') as HTMLButtonElement).click();
@@ -270,26 +274,26 @@ describe('Web 鎴樻枟妯℃嫙鍣ㄥ啋鐑?, () => {
     expect(firstRow.querySelector('.ss-card.row-blue')).toBeTruthy();
     expect(firstRow.querySelector('.ss-card.row-red')).toBeTruthy();
     (sharePanel.querySelector('.m-close') as HTMLElement).click();
     expect(document.querySelector('.stats-share-modal')).toBeFalsy();
     // 鏅敾缁熻鍦ㄦ櫘鏀诲垪涓嬶紙涓嶅湪澶村儚鍒楋級
     const attackTd = stats.querySelectorAll('tbody tr')[0].querySelectorAll('td')[1];
     expect(attackTd.textContent).toContain('鏅敾');
     expect(attackTd.textContent).toContain('娆℃暟');
     // 涓绘垬娉曞垪锛堝瓩鏉冧富鎴樻硶 涔濋敗榛勯緳锛?     expect(stats.textContent).toContain('涔濋敗榛勯緳');
-    // 椤堕儴瀵艰埅涓€閿繑鍥炵畝鐣?-    navBtn('绠€鐣ユ垬鎶?).click();
+    // 搴曟爮椤电涓€閿繑鍥炵畝鐣?+    navBtn('绠€鐣?).click();
     expect(document.querySelector('.battle-summary')).toBeTruthy();
 
     // 鎴樻姤璇︽儏锛堥€愬洖鍚堜簨浠讹級
-    navBtn('鎴樻姤璇︽儏').click();
+    navBtn('璇︽儏').click();
     const banner = document.querySelector('.result-banner') as HTMLElement;
     expect(banner, '缁撴灉妯箙搴斿嚭鐜?).toBeTruthy();
     expect(banner.textContent).toMatch(/(鑳滃埄|骞冲眬|澶辫触)/);
     expect(document.querySelectorAll('.troop-row').length).toBe(4); // 3 绾?+ 1 钃?     expect(document.querySelector('.event-stream')).toBeTruthy();
     expect(document.querySelector('.stats-table')).toBeTruthy();
     // 鍥炲悎瀵艰埅锛?(濮?~8
     expect(document.querySelectorAll('.rtab').length).toBe(9);
     expect(document.querySelector('.event-stream')!.textContent).toContain('銆愰樀瀹广€?);
     expect(document.querySelector('.event-stream')!.textContent).toContain('銆愬叺绉嶃€?);

