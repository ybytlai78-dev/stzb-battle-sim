# Review package: Task 4 (no git)
## Files changed
web/battleView.ts
web/styles.css
web/mobile.css
web/smoke.test.ts
web/damageModifier.test.ts

## Diff

### web/battleView.ts
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-4-before/battleView.ts', LF will be replaced by 
CRLF the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-303689f1-c794-4ea5-b801-4deee37703ab.ps1:143 字符: 508
+ ... nue }; $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/battleView.ts', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-4-before/battleView.ts b/web/battleView.ts
index ee56848..4645fff 100644
--- a/.superpowers/sdd/snapshots/task-4-before/battleView.ts
+++ b/web/battleView.ts
@@ -1,16 +1,25 @@
 /**
- * 鎴樻姤娓叉煋锛氱粨鏋滄í骞?+ 鍥炲悎瀵艰埅 + 姣忓洖鍚堝叺鍔涙潯 + 浜嬩欢娴?+ 缁熻琛?+ * 鎴樻姤璇︽儏锛氱揣鍑戠粨鏋滄í骞?+ 鍥句笁涓夋爮锛堝嚭鎵嬮『搴?/ 浜嬩欢娴?/ 鍥炲悎杞級銆?+ * 浜嬩欢鏂囨浠嶇敱 `renderEvents` / `renderPrepEvents` / `appendDamageModifierLine` 浜у嚭銆?  */
 import type { BattleEvent, BattleReport, DamageModifierSource, DamageModifiers } from '../src/engine/types';
 import { formatBonusText } from '../src/engine/troopBonus';
 import { SKILL_REGISTRY } from '../src/data/skills';
 import { avatarSrc } from './heroes';
 
+/** 浜嬩欢娴佹覆鏌撻檮鍔犱笂涓嬫枃锛氱粍澶村叺鍔涗笌绾㈣摑鍒嗚壊锛堜笉鏀逛簨浠跺瓧绗︿覆鍙ｅ緞锛?*/
+interface RenderEvCtx {
+  /** 鎸?unitId 鏌ュ綋鍓嶅洖鍚堝紑濮嬫椂鍏靛姏 */
+  troopsOf?: (unitId: string) => number | undefined;
+  /** 鎴戞柟鍗曚綅 id锛岀敤浜?`.act-head` 绾?钃濆簳 */
+  myIds?: Set<string>;
+}
+
 /** 鍑嗗闃舵涓夋鏍囬锛氶樀瀹?/ 鍏电 / 鎴樻硶 */
 const PHASE_LABEL: Record<'formation' | 'troop' | 'skill', string> = {
   formation: '闃靛',
   troop: '鍏电',
   skill: '鎴樻硶',
 };
 
 const PHASE_NAME: Record<string, string> = {
@@ -66,59 +75,124 @@ export function createBattleView(report: BattleReport, opts: BattleViewOpts = {}
   const initialEnemy = report.enemyTeam.map((g) => g.maxTroops);
 
   // 鍥炲悎 r锛?=鍒濆锛夊紑濮嬫椂鐨勫叺鍔?   const troopsAt = (r: number) =>
     r === 0
       ? { my: initialMy, enemy: initialEnemy }
       : roundEndTroops[r - 1] ?? { my: initialMy, enemy: initialEnemy };
 
-  // 鈹€鈹€ 缁撴灉妯箙 鈹€鈹€
+  const myIds = new Set(report.myTeam.map((g) => g.id));
+  let current = 0;
+  /**
+   * 鎸?unitId 鏌ュ綋鍓嶅洖鍚堝紑濮嬫椂鍏靛姏锛坢yTeam/enemyTeam 閰嶇疆搴忓鐓?myTroops/enemyTroops锛夈€?+   */
+  const troopsOf = (unitId: string): number | undefined => {
+    const { my, enemy } = troopsAt(current);
+    const mi = report.myTeam.findIndex((g) => g.id === unitId);
+    if (mi >= 0) return my[mi] ?? report.myTeam[mi]!.maxTroops;
+    const ei = report.enemyTeam.findIndex((g) => g.id === unitId);
+    if (ei >= 0) return enemy[ei] ?? report.enemyTeam[ei]!.maxTroops;
+    return undefined;
+  };
+  const evCtx: RenderEvCtx = { troopsOf, myIds };
+
+  // 鈹€鈹€ 缁撴灉妯箙锛堢揣鍑戯紝渚?smoke / 鍘嗗彶璇︽儏璇嗗埆锛夆攢鈹€
   const banner = document.createElement('div');
   banner.className = `result-banner ${report.result}`;
   const resLabel = report.result === 'win' ? (opts.resultWin ?? '绾㈤槦鑳滃埄') : report.result === 'loss' ? (opts.resultLoss ?? '钃濋槦鑳滃埄') : '骞冲眬';
   banner.innerHTML = `
     <span class="res">${resLabel}</span>
     <span>杩涜 ${report.rounds} 鍥炲悎 路 绉嶅瓙 ${report.seed}</span>
     <span>${myLabel}鍓╀綑 ${report.finalMyTroops.reduce((a, b) => a + b, 0).toLocaleString()} 锝?${enemyLabel}鍓╀綑 ${report.finalEnemyTroops.reduce((a, b) => a + b, 0).toLocaleString()}</span>
   `;
   root.appendChild(banner);
 
-  // 鈹€鈹€ 鍥炲悎瀵艰埅 鈹€鈹€
-  const nav = document.createElement('div');
-  nav.className = 'round-nav';
-  const btnPrev = document.createElement('button');
-  btnPrev.className = 'rbtn'; btnPrev.textContent = '鈼€ 涓婁竴鍥炲悎';
-  const btnNext = document.createElement('button');
-  btnNext.className = 'rbtn'; btnNext.textContent = '涓嬩竴鍥炲悎 鈻?;
-  const btnPlay = document.createElement('button');
-  btnPlay.className = 'rbtn'; btnPlay.textContent = '鈻?鑷姩鎾斁';
-  const label = document.createElement('span');
-  label.className = 'rlabel';
-  const tabs = document.createElement('div');
-  tabs.className = 'rtabs';
+  const startEv = report.events.find((e) => e.type === 'battle_start');
+  const turnOrder: string[] =
+    startEv && startEv.type === 'battle_start' && startEv.turnOrder.length > 0
+      ? startEv.turnOrder
+      : [...report.myTeam, ...report.enemyTeam].map((g) => g.id);
+
+  /** 杞ㄤ笂鎸夐挳 */
+  const railBtn = (text: string): HTMLButtonElement => {
+    const b = document.createElement('button');
+    b.type = 'button';
+    b.textContent = text;
+    return b;
+  };
+  const railSep = (): HTMLElement => {
+    const s = document.createElement('span');
+    s.className = 'sep';
+    return s;
+  };
+
+  // 鈹€鈹€ 鍥句笁涓夋爮 鈹€鈹€
+  const dv = document.createElement('div');
+  dv.className = 'dv';
+
+  const turns = document.createElement('aside');
+  turns.className = 'dv-turns';
+  const turnBtns: HTMLButtonElement[] = [];
+  turnOrder.forEach((id, i) => {
+    const btn = document.createElement('button');
+    btn.type = 'button';
+    btn.className = 'turn';
+    btn.dataset.unitId = id;
+    btn.innerHTML = `<span class="n">${i + 1}</span><span class="av"><img src="${avatarSrc(id)}" alt="" onerror="this.style.display='none'" /></span>`;
+    btn.onclick = () => scrollLogToUnit(id);
+    turns.appendChild(btn);
+    turnBtns.push(btn);
+  });
+
+  const mid = document.createElement('section');
+  mid.className = 'dv-mid';
+  const dvHead = document.createElement('div');
+  dvHead.className = 'dv-head';
+  const headTitle = document.createElement('strong');
+  dvHead.appendChild(headTitle);
+  const log = document.createElement('div');
+  log.className = 'dv-log scroll-quiet event-stream';
+  mid.append(dvHead, log);
+
+  const rail = document.createElement('aside');
+  rail.className = 'dv-rail';
+  const btnDetail = railBtn('璇?);
+  const btnSimple = railBtn('绠€');
+  const btnPrev = railBtn('涓?);
   const tabBtns: HTMLButtonElement[] = [];
   for (let r = 0; r <= report.rounds; r++) {
     const t = document.createElement('button');
+    t.type = 'button';
     t.className = 'rtab';
     t.textContent = r === 0 ? '濮? : String(r);
     t.onclick = () => setRound(r);
-    tabs.appendChild(t);
     tabBtns.push(t);
   }
-  nav.append(btnPrev, label, btnNext, btnPlay, tabs);
-  root.appendChild(nav);
+  const btnNext = railBtn('涓?);
+  const btnPlay = railBtn('鎾?);
+  rail.append(btnDetail, btnSimple, railSep(), btnPrev, ...tabBtns, btnNext, railSep(), btnPlay);
 
-  // 鈹€鈹€ 鍥炲悎鍐呭锛堝叺鍔?+ 浜嬩欢娴侊級鈹€鈹€
-  const body = document.createElement('div');
-  root.appendChild(body);
+  dv.append(turns, mid, rail);
+  root.appendChild(dv);
 
-  let current = 0;
   let timer: number | null = null;
 
+  btnDetail.classList.add('is-on');
+  btnDetail.onclick = () => {
+    dv.classList.remove('is-simple');
+    btnDetail.classList.add('is-on');
+    btnSimple.classList.remove('is-on');
+  };
+  btnSimple.onclick = () => {
+    dv.classList.add('is-simple');
+    btnSimple.classList.add('is-on');
+    btnDetail.classList.remove('is-on');
+  };
+
   // 鈹€鈹€ 澧炲噺浼ょ粺璁″脊绐楋紙鍗曞疄渚嬶細鐐瑰嚮銆寈%銆嶅湪閾炬帴鏃佸脊鍑猴級鈹€鈹€
   let popup: HTMLElement | null = null;
   let popupOwner: HTMLElement | null = null;
   const closePopup = () => {
     if (popup) {
       const line = popup.parentElement;
       if (line) line.style.zIndex = '';
       popup.remove();
@@ -149,70 +223,76 @@ export function createBattleView(report: BattleReport, opts: BattleViewOpts = {}
       : `${link.offsetLeft + link.offsetWidth + gap}px`;
     popup.style.top = `${Math.max(0, link.offsetTop - 6)}px`;
   };
   // 鐐瑰嚮閾炬帴浠ュ鐨勪换鎰忓鍏抽棴寮圭獥锛堥摼鎺ョ偣鍑昏嚜韬?stopPropagation锛?   document.addEventListener('click', (e) => {
     if (popup && !(e.target as HTMLElement).closest('.dmg-popup, .dmg-link')) closePopup();
   });
 
+  /**
+   * 鎶婃棩蹇楁粴鍒版寚瀹氬崟浣嶇殑琛屽姩缁勯《閮ㄣ€備笉鐢?scrollIntoView锛堝澹崇缉鏀句細閿欎綅锛夈€?+   * 鏈洖鍚堟病鏈夎鍗曚綅鐨?`.act-group` 鏃朵笉鎿嶄綔銆?+   */
+  function scrollLogToUnit(unitId: string): void {
+    const group = Array.from(log.querySelectorAll('.act-group')).find(
+      (el) => (el as HTMLElement).dataset.unitId === unitId,
+    ) as HTMLElement | undefined;
+    if (!group) return;
+    turnBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.unitId === unitId));
+    log.scrollTop += group.getBoundingClientRect().top - log.getBoundingClientRect().top;
+  }
+
   function setRound(r: number): void {
     current = Math.max(0, Math.min(report.rounds, r));
-    label.textContent = current === 0 ? '鎴樻枟寮€濮嬪墠' : `绗?${current} 鍥炲悎`;
+    headTitle.textContent = current === 0 ? '鍥炲悎鍓嶉樁娈? : `绗?${current} 鍥炲悎`;
     btnPrev.disabled = current === 0;
     btnNext.disabled = current >= report.rounds;
-    tabBtns.forEach((t, i) => t.classList.toggle('on', i === current));
+    tabBtns.forEach((t, i) => {
+      t.classList.toggle('on', i === current);
+      t.classList.toggle('is-on', i === current);
+    });
     renderRound();
   }
 
   function renderRound(): void {
     closePopup();
-    body.innerHTML = '';
-    const { my, enemy } = troopsAt(current);
-
-    const wrap = document.createElement('div');
-    wrap.className = 'troops-wrap';
-    wrap.appendChild(renderTroopCol('red', myLabel, report.myTeam, my));
-    wrap.appendChild(renderTroopCol('blue', enemyLabel, report.enemyTeam, enemy));
-    body.appendChild(wrap);
-
-    // 浜嬩欢娴?-    const stream = document.createElement('div');
-    stream.className = 'event-stream';
-    const title = document.createElement('div');
-    title.className = 'es-title';
-    title.textContent = current === 0 ? '鍑嗗闃舵浜嬩欢' : `绗?${current} 鍥炲悎琛屽姩鏄庣粏`;
-    stream.appendChild(title);
+    log.innerHTML = '';
     if (current === 0) {
-      renderPrepEvents(stream, prepEvents(report.events), nm, { toggle: togglePopup });
+      renderPrepEvents(log, prepEvents(report.events), nm, { toggle: togglePopup }, evCtx);
     } else {
       const evs = roundEvents[current - 1] ?? [];
-      if (evs.length === 0) stream.innerHTML += `<div class="ev dim">锛堟湰鍥炲悎鏃犺鍔級</div>`;
-      else renderEvents(stream, evs, nm, { toggle: togglePopup });
+      if (evs.length === 0) {
+        const empty = document.createElement('div');
+        empty.className = 'ev dim';
+        empty.textContent = '锛堟湰鍥炲悎鏃犺鍔級';
+        log.appendChild(empty);
+      } else {
+        renderEvents(log, evs, nm, { toggle: togglePopup }, evCtx);
+      }
     }
-    body.appendChild(stream);
   }
 
-  // 鈹€鈹€ 缁熻琛?鈹€鈹€
-  root.appendChild(renderStatsTable(report));
-
   btnPrev.onclick = () => setRound(current - 1);
   btnNext.onclick = () => setRound(current + 1);
   btnPlay.onclick = () => {
     if (timer !== null) {
       clearInterval(timer); timer = null;
-      btnPlay.textContent = '鈻?鑷姩鎾斁';
+      btnPlay.textContent = '鎾?;
+      btnPlay.classList.remove('is-on');
       return;
     }
     if (current >= report.rounds) setRound(0);
-    btnPlay.textContent = '鈴?鏆傚仠';
+    btnPlay.textContent = '鍋?;
+    btnPlay.classList.add('is-on');
     timer = window.setInterval(() => {
       if (current >= report.rounds) {
         clearInterval(timer!); timer = null;
-        btnPlay.textContent = '鈻?鑷姩鎾斁';
+        btnPlay.textContent = '鎾?;
+        btnPlay.classList.remove('is-on');
         return;
       }
       setRound(current + 1);
     }, 900);
   };
 
   setRound(0);
   return { el: root, setRound, roundCount: () => report.rounds };
@@ -231,17 +311,18 @@ function prepEvents(events: BattleEvent[]): BattleEvent[] {
 /**
  * 鍑嗗闃舵浜嬩欢娴侊細銆愰樀瀹广€戝嚭鎵嬮『搴?+ 閮ㄩ槦鍔犳垚銆併€愬叺绉嶃€戞殏鏃犳晥鏋溿€併€愭垬娉曘€戞寚鎸?琚姩銆?  * 涓嶈皟鐢?`appendEv(null, 鈥?`锛坓roup 涓?null 鏃剁洿鎺?return锛夈€?  */
 function renderPrepEvents(
   container: HTMLElement,
   evs: BattleEvent[],
   nm: (id: string) => string,
-  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void }
+  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void },
+  ctx?: RenderEvCtx
 ): void {
   const start = evs.find((e) => e.type === 'battle_start');
   const sections: Record<'formation' | 'troop' | 'skill', BattleEvent[]> = {
     formation: [],
     troop: [],
     skill: [],
   };
   let cur: 'formation' | 'troop' | 'skill' | null = null;
@@ -297,70 +378,51 @@ function renderPrepEvents(
   addHead(PHASE_LABEL.skill);
   const skillEvs = sections.skill;
   if (skillEvs.length === 0) {
     const d = document.createElement('div');
     d.className = 'ev dim';
     d.textContent = '锛堟棤鎴樻硶锛?;
     container.appendChild(d);
   } else {
-    renderEvents(container, skillEvs, nm, popupApi);
+    renderEvents(container, skillEvs, nm, popupApi, ctx);
   }
 }
 
-function renderTroopCol(
-  cls: string,
-  title: string,
-  team: BattleReport['myTeam'],
-  troops: number[]
-): HTMLElement {
-  const col = document.createElement('div');
-  col.className = `troop-col ${cls}`;
-  const hd = document.createElement('h4');
-  hd.textContent = title;
-  col.appendChild(hd);
-  team.forEach((g, i) => {
-    const t = troops[i] ?? g.maxTroops;
-    const pct = Math.max(0, Math.min(100, (t / g.maxTroops) * 100));
-    const row = document.createElement('div');
-    row.className = 'troop-row' + (t <= 0 ? ' dead' : '');
-    row.innerHTML = `
-      <span class="tavatar"><img src="${avatarSrc(g.id)}" alt="" onerror="this.style.display='none'" /></span>
-      <span class="tname" title="${g.name}">${g.name}</span>
-      <span class="tbar"><span class="tfill" style="width:${pct}%"></span></span>
-      <span class="tnum">${t.toLocaleString()}${t <= 0 ? ' 闃典骸' : ''}</span>
-    `;
-    col.appendChild(row);
-  });
-  return col;
-}
-
 /** 浜嬩欢娴佹覆鏌擄細鎸?unit_act_start 鍒嗙粍 */
 function renderEvents(
   container: HTMLElement,
   evs: BattleEvent[],
   nm: (id: string) => string,
-  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void }
+  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void },
+  ctx?: RenderEvCtx
 ): void {
   let group: HTMLElement | null = null;
 
   const flush = () => {
     if (group) { container.appendChild(group); group = null; }
   };
 
   for (const ev of evs) {
     switch (ev.type) {
       case 'unit_act_start': {
         flush();
         group = document.createElement('div');
         group.className = 'act-group';
+        group.dataset.unitId = ev.unitId;
         const head = document.createElement('div');
-        head.className = 'act-head';
-        head.innerHTML = `<img class="act-avatar" src="${avatarSrc(ev.unitId)}" alt="" onerror="this.style.display='none'" /><span class="dot"></span><span class="hl">${nm(ev.unitId)}</span><span class="phase">${PHASE_NAME[ev.phase] ?? ev.phase}</span>`;
+        const side = ctx?.myIds?.has(ev.unitId) ? 'red' : ctx?.myIds ? 'blue' : '';
+        head.className = side ? `act-head ${side}` : 'act-head';
+        const n = ctx?.troopsOf?.(ev.unitId);
+        const troopHtml = n !== undefined ? `<span class="troops">${n.toLocaleString()}</span>` : '';
+        head.innerHTML = `<img class="act-avatar" src="${avatarSrc(ev.unitId)}" alt="" onerror="this.style.display='none'" /><span class="hl">${nm(ev.unitId)}</span><span class="phase">${PHASE_NAME[ev.phase] ?? ev.phase}</span>${troopHtml}`;
         group.appendChild(head);
+        const body = document.createElement('div');
+        body.className = 'act-body';
+        group.appendChild(body);
         break;
       }
       case 'skill_trigger': {
         if (ev.rate !== undefined) {
           // 鍙繚鐣欎富骞诧細褰撳墠鐢熸晥鍑犵巼锛堝惈澹皵淇锛夛紱鎷彿鍐呯殑璁＄畻杩囩▼涓庡垽瀹氬瓧鏍蜂笉杈撳嚭
           const who =
             ev.targetId && ev.targetId !== ev.unitId
               ? `銆?{nm(ev.targetId)}銆戞潵鑷€?{nm(ev.unitId)}銆戠殑`
@@ -458,17 +520,18 @@ function renderEvents(
   flush();
 }
 
 function appendEv(group: HTMLElement | null, cls: string, html: string): void {
   if (!group) return;
   const div = document.createElement('div');
   div.className = `ev ${cls}`;
   div.innerHTML = html;
-  group.appendChild(div);
+  const body = group.querySelector(':scope > .act-body');
+  (body ?? group).appendChild(div);
 }
 
 // 鈹€鈹€鈹€ 澧炲噺浼ょ粺璁★紙浼ゅ鏁板瓧鍓嶆彃鍏ャ€屾娆′激瀹冲叡璁℃彁鍗?闄嶄綆 z%銆嶅噣鍚堣琛岋紝z 鍙偣鍑诲脊鍑虹粺璁￠潰鏉匡級鈹€鈹€鈹€
 
 /** 姝ｅ浼ゆ潵婧愶紙鍙楀埌渚?+ 閫犳垚渚э紝rate > 0锛夛細浼ゅ鎻愬崌锛堢鍏靛ぉ闄嶇被鍦ㄥ墠锛屽ぇ璧忎笁鍐涚被鍦ㄥ悗锛?*/
 function boostSources(mods: DamageModifiers): DamageModifierSource[] {
   return [...mods.taken, ...mods.caused].filter((s) => s.rate > 0);
 }
@@ -505,34 +568,35 @@ function netBoostPct(mods?: DamageModifiers): number {
  *  鏃犱换浣曞鍑忎激鎴栧噣鍊间负 0 鏃朵笉鏄剧ず銆?  *  琛屾湰韬?`position:relative`锛屼綔涓烘槑缁嗗脊绐楃殑鍖呭惈鍧楋紙閬垮厤鎸傚埌婊氬姩瀹瑰櫒鍚庨敊浣嶏級銆?*/
 function appendDamageModifierLine(
   group: HTMLElement | null,
   mods: DamageModifiers | undefined,
   popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void }
 ): void {
   const net = netBoostPct(mods);
-  if (!mods || net === 0) return;
+  if (!group || !mods || net === 0) return;
   const div = document.createElement('div');
   div.className = 'ev dmg-mod';
   // 寮圭獥缁濆瀹氫綅鐨勫寘鍚潡锛氬繀椤诲湪琛屽唴锛屼笉鑳戒緷璧栨粴鍔ㄥ鍣?.battle-view
   div.style.position = 'relative';
   const verb = net > 0 ? '鎻愬崌' : '闄嶄綆';
   div.append(`姝ゆ浼ゅ鍏辫${verb} `);
   const link = document.createElement('a');
   link.className = 'dmg-link';
   link.href = 'javascript:void(0)';
   link.textContent = `${Math.abs(net)}%`;
   link.onclick = (e) => {
     e.preventDefault();
     e.stopPropagation();
     popupApi.toggle(link, mods);
   };
   div.appendChild(link);
-  group!.appendChild(div);
+  const body = group.querySelector(':scope > .act-body');
+  (body ?? group).appendChild(div);
 }
 
 /** 鏋勫缓銆屽鍑忎激缁熻銆嶅脊绐楋細浼ゅ鎻愬崌鍚堣锛堢鍏靛ぉ闄嶇被鍦ㄥ墠锛屽ぇ璧忎笁鍐涚被鍦ㄥ悗锛? 浼ゅ闄嶄綆鍚堣 */
 function buildModPopup(mods: DamageModifiers, nm: (id: string) => string): HTMLElement {
   const pop = document.createElement('div');
   pop.className = 'dmg-popup';
   const title = document.createElement('div');
   title.className = 'dmg-pop-title';
@@ -580,31 +644,8 @@ function statusName(t: string): string {
     first_aid: '鎸佺画鍨嬫€ユ晳', rest: '浼戞暣',
   };
   return m[t] ?? t;
 }
 
 function dotName(t: string): string {
   return t === 'sorcery' ? '濡栨湳' : t === 'burning' ? '鐕冪儳' : '鎭愭厡';
 }
-
-function renderStatsTable(report: BattleReport): HTMLElement {
-  const wrap = document.createElement('div');
-  wrap.className = 'stats-table';
-  const rows = report.stats
-    .map((s) => `
-      <tr>
-        <td class="side-${s.side}"><img class="stat-avatar" src="${avatarSrc(s.unitId)}" alt="" onerror="this.style.display='none'" />${s.name}</td>
-        <td>${s.attackCount}</td>
-        <td>${s.attackDamage.toLocaleString()}</td>
-        <td>${s.skillCount}</td>
-        <td>${s.skillDamage.toLocaleString()}</td>
-      </tr>`)
-    .join('');
-  wrap.innerHTML = `
-    <table>
-      <thead><tr><th>姝﹀皢</th><th>鏅敾娆℃暟</th><th>鏅敾浼ゅ</th><th>鎴樻硶娆℃暟</th><th>鎴樻硶浼ゅ</th></tr></thead>
-      <tbody>${rows}</tbody>
-    </table>
-    <div class="tip">缁熻鍙ｅ緞锛氭垬娉曟鏁板惈杩藉嚮/鍑嗗鎴樻硶閲婃斁锛涘彈瑙勯伩鍏嶇柅鐨勪激瀹充笉璁°€?/div>
-  `;
-  return wrap;
-}


### web/styles.css
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-4-before/styles.css', LF will be replaced by CRL
F the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-303689f1-c794-4ea5-b801-4deee37703ab.ps1:143 字符: 508
+ ... nue }; $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/styles.css', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-4-before/styles.css b/web/styles.css
index bab78b8..98ad91c 100644
--- a/.superpowers/sdd/snapshots/task-4-before/styles.css
+++ b/web/styles.css
@@ -1068,17 +1068,182 @@ main {
   display: flex;
   flex-direction: column;
 }
 .battle-view {
   margin-top: 2px;
   position: relative;
   flex: 1;
   min-height: 0;
+  min-width: 0;
+  overflow: hidden;
+  display: flex;
+  flex-direction: column;
+  gap: 6px;
+}
+.battle-view > .result-banner {
+  flex-shrink: 0;
+  padding: 6px 12px;
+  margin-bottom: 0;
+  gap: 12px;
+  font-size: 12px;
+}
+.battle-view > .result-banner .res {
+  font-size: 15px;
+  letter-spacing: 2px;
+}
+
+/* 鈹€鈹€ 璇︽儏椤碉紙鍥句笁涓夋爮锛氬嚭鎵嬮『搴?/ 鏃ュ織 / 鍥炲悎杞級鈹€鈹€ */
+.dv {
+  flex: 1;
+  min-height: 0;
+  min-width: 0;
+  display: grid;
+  grid-template-columns: 48px minmax(0, 1fr) 32px;
+  gap: 6px;
+}
+.dv-turns {
+  display: flex;
+  flex-direction: column;
+  gap: 3px;
+  min-height: 0;
+  min-width: 0;
+  overflow: hidden;
+  overflow-x: hidden;
+  padding-right: 8px;
+}
+.turn {
+  position: relative;
+  display: flex;
+  align-items: center;
+  gap: 3px;
+  padding: 2px;
+  border-radius: 6px;
+  background: var(--color-surface);
+  border: 1px solid var(--color-line);
+  min-width: 0;
+  width: 100%;
+  cursor: pointer;
+  color: inherit;
+  font-family: inherit;
+}
+.turn .n {
+  font-size: 10px;
+  color: var(--color-text-muted);
+  width: 10px;
+  text-align: center;
+  flex-shrink: 0;
+}
+.turn.is-on {
+  outline: 2px solid var(--color-gold);
+  outline-offset: 0;
+}
+.turn.is-on::after {
+  content: "";
+  position: absolute;
+  right: -7px;
+  top: 50%;
+  transform: translateY(-50%);
+  border: 5px solid transparent;
+  border-left-color: var(--color-gold);
+}
+.dv-turns .av {
+  position: relative;
+  width: 22px;
+  height: 22px;
+  border-radius: 50%;
+  overflow: hidden;
+  flex-shrink: 0;
+  background: var(--color-surface-2);
+  border: 1px solid var(--color-line);
+  display: grid;
+}
+.dv-turns .av img {
+  position: absolute;
+  inset: 0;
+  width: 100%;
+  height: 100%;
+  object-fit: cover;
+  object-position: 50% 18%;
+}
+.dv-mid {
+  min-width: 0;
+  min-height: 0;
+  display: flex;
+  flex-direction: column;
+  background: var(--color-surface);
+  border: 1px solid var(--color-line);
+  border-radius: var(--radius);
+  border-bottom: var(--card-accent);
+}
+.dv-head {
+  flex: 0 0 auto;
+  display: flex;
+  align-items: center;
+  gap: 8px;
+  padding: 6px 8px;
+  border-bottom: 1px solid var(--color-line);
+}
+.dv-head strong {
+  font-family: var(--font-kai);
+  font-style: normal;
+  font-size: 13px;
+  color: var(--color-gold);
+}
+.dv-log.event-stream {
+  flex: 1;
+  min-height: 0;
+  overflow-x: hidden;
   overflow-y: auto;
+  padding: 6px 8px 8px;
+  background: transparent;
+  border: 0;
+}
+.dv-rail {
+  display: flex;
+  flex-direction: column;
+  align-items: center;
+  gap: 4px;
+  min-height: 0;
+  min-width: 0;
+}
+.dv-rail button {
+  width: 100%;
+  min-height: 22px;
+  padding: 0;
+  font-size: 11px;
+  font-family: inherit;
+  color: var(--color-text-muted);
+  border-radius: 4px;
+  border: 1px solid transparent;
+  background: transparent;
+  cursor: pointer;
+}
+.dv-rail button:disabled { opacity: .35; cursor: not-allowed; }
+.dv-rail button.is-on,
+.dv-rail .rtab.on {
+  color: var(--color-text);
+  background: var(--color-crimson);
+  border-color: transparent;
+}
+.dv-rail .sep {
+  width: 12px;
+  height: 1px;
+  background: var(--color-line);
+  margin: 2px 0;
+  flex-shrink: 0;
+}
+@media (min-width: 900px) {
+  .dv {
+    grid-template-columns: 88px minmax(0, 1fr) 52px;
+    gap: 14px;
+  }
+  .dv-turns .av { width: 36px; height: 36px; }
+  .dv-head strong { font-size: 18px; }
+  .dv-rail button { min-height: 32px; font-size: 13px; }
 }
 .report-view {
   min-width: 0;
   flex: 1;
   min-height: 0;
   display: flex;
   flex-direction: column;
   overflow: hidden;
@@ -1729,16 +1894,35 @@ main {
   border-radius: 50%;
   border: 1px solid var(--line-strong);
   object-fit: cover;
   object-position: 50% 18%;
   flex-shrink: 0;
   background: #000;
 }
 .act-head .phase { color: var(--text-dim); font-size: 11.5px; }
+.act-head .hl { font-weight: 600; color: var(--color-text); }
+.act-head .troops {
+  margin-left: auto;
+  color: var(--color-gold);
+  font-variant-numeric: tabular-nums;
+  font-size: 11px;
+}
+.act-head.red { background: color-mix(in srgb, var(--color-crimson) 22%, var(--color-surface-2)); }
+.act-head.blue { background: color-mix(in srgb, var(--color-blue) 28%, var(--color-surface-2)); }
+.act-body { padding-left: 8px; }
+.dv.is-simple .act-body { display: none; }
+.dv .act-head {
+  border-left: 0;
+  border-radius: 4px;
+  padding: 4px 8px;
+  background: var(--color-surface-2);
+}
+.dv .act-head.red { background: color-mix(in srgb, var(--color-crimson) 22%, var(--color-surface-2)); }
+.dv .act-head.blue { background: color-mix(in srgb, var(--color-blue) 28%, var(--color-surface-2)); }
 .ev { padding: 0 8px 0 26px; font-size: 12px; line-height: 1.8; }
 .ev .hl { font-weight: 600; color: var(--ink); }
 .ev .sub { color: var(--text-weak); font-size: 10.5px; }
 .ev.dmg-phy { color: var(--orange); }
 .ev.dmg-stg { color: var(--purple); }
 .ev.heal { color: var(--green); }
 .ev.status { color: var(--blue); }
 .ev.conflict { color: var(--red); }


### web/mobile.css
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-4-before/mobile.css', LF will be replaced by CRL
F the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-303689f1-c794-4ea5-b801-4deee37703ab.ps1:143 字符: 508
+ ... nue }; $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/mobile.css', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-4-before/mobile.css b/web/mobile.css
index af505ec..840880f 100644
--- a/.superpowers/sdd/snapshots/task-4-before/mobile.css
+++ b/web/mobile.css
@@ -119,28 +119,24 @@
   /* 缁熻椤甸鏋讹細妯睆琛岄珮涓嶅緱鍘嬪彔锛屽ご鍍忓垪绾?44px */
   .st-row {
     min-height: 50px;
     grid-template-columns: 14px 44px minmax(0, 1fr);
     gap: 4px;
   }
   .st-page { grid-template-columns: 28px minmax(0, 1fr); gap: 6px; }
 
-  /* 缁熻 / 璇︽儏琛ㄦ牸 */
-  .stats-table th, .stats-table td { padding: 3px 8px; font-size: 11px; }
-  .stats-share-modal { width: min(96vw, 860px); }
-  .ss-row, .ss-heads { grid-template-columns: 1fr 28px 1fr; gap: 4px; }
-  .ss-pos-mid { font-size: 10px; }
-  .troops-wrap { gap: 8px; margin-bottom: 8px; }
-  .troop-col { padding: 8px 12px; }
-  .troop-row { font-size: 11px; margin-bottom: 5px; }
-  .event-stream { padding: 8px 12px; }
+  /* 璇︽儏涓夋爮锛氭í灞忎繚鎸?48px | 鏃ュ織 | 32px 杞?*/
+  .dv { grid-template-columns: 48px minmax(0, 1fr) 32px; gap: 6px; }
+  .dv-head { padding: 4px 6px; }
+  .dv-head strong { font-size: 12px; }
+  .dv-rail button { min-height: 20px; font-size: 10px; }
+  .dv-log.event-stream { padding: 4px 6px 6px; }
   .act-head { font-size: 11.5px; }
   .ev { font-size: 11px; padding: 0 8px 0 22px; }
-  .round-nav .rlabel { min-width: 96px; font-size: 12px; }
 
   /* 姝﹀皢璇︽儏寮圭獥锛氬乏鐢诲儚缂╁皬 */
   .hero-detail-modal { width: min(860px, 96vw); max-height: 96dvh; }
   .hero-detail-modal .hd-body { padding: 8px 12px; overflow: hidden; }
   .hd-body { padding: 10px 14px; }
   .hd-portrait { width: 110px; }
   .hd-name { font-size: 18px; }
   .hd-stats { gap: 4px 14px; }
@@ -188,17 +184,17 @@
   .sum-result { grid-template-columns: 1fr 84px 1fr; gap: 8px; }
   .stamp { width: 60px; height: 60px; }
   .stamp .stamp-ch { font-size: 24px; }
   .sum-hero { max-width: none; }
   .sum-roster { grid-template-columns: 1fr 64px 1fr; gap: 6px; }
   .vs-badge > span:first-of-type { font-size: 16px; }
   .vs-badge .sum-rounds { font-size: 9px; }
   .vs-badge::before, .vs-badge::after { height: auto; max-height: 20px; }
-  .troops-wrap { grid-template-columns: 1fr; }
+  .dv { min-height: 240px; }
 }
 
 /* 鈹€鈹€ 4. 绐勬闈㈢獥鍙?/ 骞虫澘绔栧睆锛堥珮搴﹀厖瑁曪紝浠呮敹绐勪笁鍒楋級 鈹€鈹€ */
 @media (max-width: 1150px) and (min-height: 521px) {
   .team-editor {
     grid-template-columns: minmax(220px, 1fr) minmax(240px, 1.6fr) minmax(220px, 1fr);
   }
 }


### web/smoke.test.ts
git : warning: in the working copy of '.superpowers/sdd/snapshots/task-4-before/smoke.test.ts', LF will be replaced by 
CRLF the next time Git touches it
所在位置 C:\Users\lai15\AppData\Local\Temp\ps-script-303689f1-c794-4ea5-b801-4deee37703ab.ps1:143 字符: 508
+ ... nue }; $d = git --no-pager diff --no-index -U8 -- $before $f.src 2>&1 ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (warning: in the... Git touches it:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
warning: in the working copy of 'web/smoke.test.ts', LF will be replaced by CRLF the next time Git touches it
diff --git a/.superpowers/sdd/snapshots/task-4-before/smoke.test.ts b/web/smoke.test.ts
index fbe3216..d9423e0 100644
--- a/.superpowers/sdd/snapshots/task-4-before/smoke.test.ts
+++ b/web/smoke.test.ts
@@ -273,19 +273,20 @@ describe('Web 鎴樻枟妯℃嫙鍣ㄥ啋鐑?, () => {
     navBtn('绠€鐣?).click();
     expect(document.querySelector('.battle-summary')).toBeTruthy();
 
     // 鎴樻姤璇︽儏锛堥€愬洖鍚堜簨浠讹級
     navBtn('璇︽儏').click();
     const banner = document.querySelector('.result-banner') as HTMLElement;
     expect(banner, '缁撴灉妯箙搴斿嚭鐜?).toBeTruthy();
     expect(banner.textContent).toMatch(/(鑳滃埄|骞冲眬|澶辫触)/);
-    expect(document.querySelectorAll('.troop-row').length).toBe(4); // 3 绾?+ 1 钃?+    expect(document.querySelector('.dv')).toBeTruthy();
+    expect(document.querySelector('.dv-turns')).toBeTruthy();
+    expect(document.querySelector('.dv-rail')).toBeTruthy();
     expect(document.querySelector('.event-stream')).toBeTruthy();
-    expect(document.querySelector('.stats-table')).toBeTruthy();
     // 鍥炲悎瀵艰埅锛?(濮?~8
     expect(document.querySelectorAll('.rtab').length).toBe(9);
     expect(document.querySelector('.event-stream')!.textContent).toContain('銆愰樀瀹广€?);
     expect(document.querySelector('.event-stream')!.textContent).toContain('銆愬叺绉嶃€?);
     expect(document.querySelector('.event-stream')!.textContent).toContain('銆愭垬娉曘€?);
     expect(document.querySelector('.event-stream')!.textContent).toContain('鏆傛棤鏁堟灉');
   });
 


### web/damageModifier.test.ts
(unchanged)
