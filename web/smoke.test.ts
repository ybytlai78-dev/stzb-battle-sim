/**
 * Web UI 冒烟测试（jsdom）：初始化 → 选将 → 详情页 → 开始模拟 → 战报渲染
 * 验证浏览器端主链路无运行时错误（引擎已在 Node 侧全量覆盖）。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

async function boot(): Promise<typeof import('./main')> {
  const el = document.createElement('div');
  el.id = 'app';
  document.body.appendChild(el);
  const mod = await import('./main');
  mod.initApp(el);
  return mod;
}

/** 点击红/蓝队第 idx 个槽位 → 武将选择弹窗 → 点击名字含 name 的武将（可选再按主战法名区分同名）→ 详情页 → 点「放入」 */
function pickHeroIntoSlot(
  teamIdx: 'red' | 'blue',
  slotIdx: number,
  heroName: string,
  opts: { skill?: string } = {}
): void {
  const panel = document.querySelector(`.team-panel.${teamIdx}`) as HTMLElement;
  const slot = panel.querySelectorAll('.slot')[slotIdx] as HTMLElement;
  slot.click();
  const modal = document.querySelector('.modal') as HTMLElement;
  expect(modal, '武将选择弹窗应打开').toBeTruthy();
  const cards = Array.from(modal.querySelectorAll('.hero-card')) as HTMLElement[];
  const card = cards.find((c) => {
    if (!c.querySelector('.n')!.textContent!.includes(heroName)) return false;
    // 主战法名不再进卡面（2026-09-19 回退）→ 从卡片 title 判定，用于区分同名武将（关羽 蜀/魏）
    if (opts.skill && !(c.title || '').includes(opts.skill)) return false;
    return true;
  });
  expect(card, `武将「${heroName}」应在弹窗中`).toBeTruthy();
  card!.click();
  // 点击武将 → 弹出武将详情页 → 点「放入」按钮完成放置
  const detail = document.querySelector('.modal') as HTMLElement;
  const placeBtn = detail.querySelector('.btn-place') as HTMLElement;
  expect(placeBtn, '详情页应显示放入按钮').toBeTruthy();
  placeBtn.click();
}

/** 从武将池点击名字含 name 的武将卡（打开详情页，不放入） */
function clickPoolCard(name: string): HTMLElement {
  const cards = Array.from(document.querySelectorAll('.hero-pool .hero-card')) as HTMLElement[];
  const card = cards.find((c) => c.querySelector('.n')!.textContent!.includes(name));
  expect(card, `武将池应有「${name}」`).toBeTruthy();
  card!.click();
  const modal = document.querySelector('.modal') as HTMLElement;
  expect(modal, '详情页应打开').toBeTruthy();
  return modal;
}

function closeModal(): void {
  (document.querySelector('.modal .m-close') as HTMLElement).click();
}

/** 模拟 HTML5 DataTransfer（setData 写入、getData 读出） */
function makeDT(data = '', effectAllowed: 'copy' | 'move' = 'copy'): DataTransfer {
  let stored = data;
  return {
    getData: (t: string) => (t === 'text/plain' ? stored : ''),
    setData: (_t: string, v: string) => { stored = v; },
    dropEffect: effectAllowed,
    effectAllowed,
  } as unknown as DataTransfer;
}

/** 已入队槽位卡 → 另一槽位（队内换位 / 跨队） */
function dragSlotTo(from: HTMLElement, to: HTMLElement): void {
  const dt = makeDT('', 'move');
  const start = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(start, 'dataTransfer', { value: dt });
  from.dispatchEvent(start);
  const over = new Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(over, 'dataTransfer', { value: dt });
  to.dispatchEvent(over);
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dt });
  to.dispatchEvent(drop);
}

/** 已入队槽位卡 → 武将池（卸下） */
function dragSlotToPool(from: HTMLElement): void {
  const pool = document.querySelector('.hero-pool') as HTMLElement;
  dragSlotTo(from, pool);
}

describe('Web 战斗模拟器冒烟', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('初始化渲染头部 + 两队槽位 + 武将池', async () => {
    await boot();
    // 品牌标题（率土之滨 · 战斗模拟器）已按要求删除，顶栏位置让给武将池搜索框
    expect(document.querySelector('header.app h1')).toBeNull();
    expect(document.querySelector('header.app .sub')).toBeNull();
    const headerSearch = document.querySelector('header.app #pool-search-slot input') as HTMLInputElement;
    expect(headerSearch).toBeTruthy();
    expect(headerSearch.placeholder).toContain('搜索武将名');
    // 搜索框已搬出武将池；筛选行（势力/兵种）留在池内接替它的位置
    expect(document.querySelector('.hero-pool .toolbar')).toBeNull();
    expect(document.querySelector('.hero-pool .filter-tag')).toBeTruthy();
    expect(document.querySelector('.team-panel.red h2')!.textContent).toBe('红队');
    expect(document.querySelector('.team-panel.blue h2')!.textContent).toBe('蓝队');
    expect(document.querySelectorAll('.nav-link').length).toBe(3); // 战报 / 战法 / 伤害测试
    expect(document.querySelectorAll('.team-panel.red .slot').length).toBe(3);
    expect(document.querySelectorAll('.team-panel.blue .slot').length).toBe(3);
    expect(document.querySelectorAll('.hero-card').length).toBeGreaterThan(20);
    // 空槽「点击选择」用素材加号（public/skills/slot-add.png），不再是文字 +
    const emptySlot = document.querySelector('.slot.empty') as HTMLElement;
    expect(emptySlot.textContent).toContain('点击选择');
    expect(emptySlot.textContent).not.toContain('+');
    const addIcon = emptySlot.querySelector('.slot-add-icon') as HTMLImageElement;
    expect(addIcon).toBeTruthy();
    expect(addIcon.src).toMatch(/\/skills\/slot-add\.png$/);
    expect(addIcon.alt).toBe('');
    // 武将卡＝官方卡框（wujiang5）：画像铺满 + 左上势力字/竖排名 + 右上五星 + 底部 Lv·兵种·主战法
    const card = document.querySelector('.hero-pool .hero-card') as HTMLElement;
    const frame = card.querySelector('.frame') as HTMLElement;
    expect(frame, '武将卡应有卡框层').toBeTruthy();
    expect(frame.style.backgroundImage).toContain('card-frame-5.png');
    expect((card.querySelector('.art') as HTMLElement).style.backgroundImage).toContain('/portraits/');
    expect(card.querySelector('.fac')!.textContent).toMatch(/^(汉|魏|蜀|吴|群|晋)$/);
    expect(card.querySelector('.n')!.textContent!.length).toBeGreaterThan(1);   // 竖排名
    expect(card.querySelector('.stars')!.textContent).toBe('★★★★★');
    expect(card.querySelector('.bar .lv')!.textContent).toContain('Lv.40');      // 未上阵 = 默认 40 级
    expect(card.querySelector('.bar .troop')!.textContent).toMatch(/^(骑|步|弓)$/); // 兵种（无图标素材→文字）
    // 主战法名不进卡面（2026-09-19 决策回退）：卡面只 势力/姓名/星级/Lv/兵种，战法名+描述走 title
    const liubei = Array.from(document.querySelectorAll('.hero-pool .hero-card')).find(
      (c) => (c.querySelector('.n') as HTMLElement).textContent === '刘备',
    ) as HTMLElement;
    expect(liubei, '武将池应有刘备').toBeTruthy();
    expect(liubei.title).toContain('皇裔流离');
    expect(liubei.querySelector('.plate')!.textContent).not.toContain('皇裔流离');
    expect(card.querySelector('.bar .s')).toBeNull();
  });

  it('武将池搜索支持拼音：首字母 l / lb 与全拼 lvbu、lubu 都能命中', async () => {
    await boot();
    const input = document.querySelector('header.app #pool-search-slot input') as HTMLInputElement;
    const names = () =>
      Array.from(document.querySelectorAll('.hero-pool .hero-card .n')).map((e) => e.textContent ?? '');
    const all = names();
    expect(all.length).toBeGreaterThan(50); // 未筛选时是全场武将

    const type = (v: string) => {
      input.value = v;
      input.dispatchEvent(new Event('input'));
      return names();
    };

    // ① 单字母首字母：l 开头的一批（吕布 / 刘备 / 灵帝 …），但不是全场
    const l = type('l');
    expect(l.length).toBeGreaterThan(3);
    expect(l.length).toBeLessThan(all.length);
    expect(l.some((n) => n.includes('吕布'))).toBe(true);
    expect(l.some((n) => n.includes('刘备'))).toBe(true);

    // ② 两字母首字母：lb → 吕布 + 刘备（灵帝是 ld，不该命中）
    const lb = type('lb');
    expect(lb.some((n) => n.includes('吕布'))).toBe(true);
    expect(lb.some((n) => n.includes('刘备'))).toBe(true);
    expect(lb.some((n) => n.includes('灵帝'))).toBe(false);

    // ③ 全拼：lvbu（ü 记作 v）与 lubu（ü 打不出时用 u）都能命中吕布
    expect(type('lvbu').some((n) => n.includes('吕布'))).toBe(true);
    expect(type('lubu').some((n) => n.includes('吕布'))).toBe(true);
    expect(type('liubei').some((n) => n.includes('刘备'))).toBe(true);

    // ④ 中文名搜索不受影响
    expect(type('吕布').some((n) => n.includes('吕布'))).toBe(true);
  });

  it('顶栏「伤害测试」导航：进入 lab 视图 / 再点返回配将', async () => {
    await boot();
    const labNav = document.querySelector('.nav-link[data-nav="lab"]') as HTMLElement;
    expect(labNav).toBeTruthy();
    // 进入伤害测试
    labNav.click();
    const shell = document.querySelector('.lab-shell') as HTMLElement;
    expect(shell).toBeTruthy();
    expect(shell.style.display).not.toBe('none');
    expect((document.querySelector('main > .team-editor') as HTMLElement).style.display).toBe('none'); // 配将区隐藏
    expect((document.querySelector('#app > .control-bar') as HTMLElement).style.display).toBe('none'); // 主站底栏隐藏
    // 再点导航返回配将
    labNav.click();
    expect(shell.style.display).toBe('none');
    expect((document.querySelector('main > .team-editor') as HTMLElement).style.display).not.toBe('none');
    expect((document.querySelector('#app > .control-bar') as HTMLElement).style.display).not.toBe('none');
  });

  it('拖拽武将池卡牌到红队/蓝队槽位（Drop-Zone）：配将成功、池子保留原卡', async () => {
    await boot();
    const card = document.querySelector('.hero-pool .hero-card') as HTMLElement;
    const heroId = card.dataset.heroId!;
    const heroName = card.querySelector('.n')!.textContent!.trim();
    expect(heroId).toBeTruthy();
    const dt = {
      getData: (t: string) => (t === 'text/plain' ? heroId : ''),
      setData: () => {},
      dropEffect: 'copy',
      effectAllowed: 'copy',
    } as unknown as DataTransfer;
    // 拖到红队大营
    const redSlot = document.querySelector('.team-panel.red .slots .slot') as HTMLElement;
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: dt });
    redSlot.dispatchEvent(over);
    expect(redSlot.classList.contains('drag-over')).toBe(true); // 拖拽高亮
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dt });
    redSlot.dispatchEvent(drop);
    expect(redSlot.classList.contains('drag-over')).toBe(false);
    // 投放触发 refresh 重渲染 → 重新查询槽位
    const redSlot2 = document.querySelector('.team-panel.red .slots .slot') as HTMLElement;
    expect(redSlot2.querySelector('.hero-name')!.textContent).toContain(heroName);
    // 拖到蓝队前锋（主站全局唯一：红队原槽被清空）
    const blueSlot = document.querySelectorAll('.team-panel.blue .slots .slot')[2] as HTMLElement;
    const drop2 = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop2, 'dataTransfer', { value: dt });
    blueSlot.dispatchEvent(drop2);
    const blueSlot2 = document.querySelectorAll('.team-panel.blue .slots .slot')[2] as HTMLElement;
    expect(blueSlot2.querySelector('.hero-name')!.textContent).toContain(heroName);
    expect((document.querySelector('.team-panel.red .slots .slot') as HTMLElement).classList.contains('empty')).toBe(true); // 全局唯一：原槽清空
    // 武将池保留原卡
    expect((document.querySelector('.hero-pool .hero-card') as HTMLElement).dataset.heroId).toBe(heroId);
  });

  it('已入队武将卡可自由拖动：队内换位 / 跨队移动 / 拖回武将池', async () => {
    await boot();
    pickHeroIntoSlot('red', 0, '孙权');
    pickHeroIntoSlot('red', 1, '周瑜');
    const redSlots = () => document.querySelectorAll('.team-panel.red .slots .slot') as NodeListOf<HTMLElement>;
    const blueSlots = () => document.querySelectorAll('.team-panel.blue .slots .slot') as NodeListOf<HTMLElement>;
    expect(redSlots()[0].draggable).toBe(true);
    expect(redSlots()[0].querySelector('.hero-name')!.textContent).toContain('孙权');
    expect(redSlots()[1].querySelector('.hero-name')!.textContent).toContain('周瑜');

    // 1. 队内：红大营孙权 ↔ 红中军周瑜
    dragSlotTo(redSlots()[0], redSlots()[1]);
    expect(redSlots()[0].querySelector('.hero-name')!.textContent).toContain('周瑜');
    expect(redSlots()[1].querySelector('.hero-name')!.textContent).toContain('孙权');

    // 2. 跨队到已占槽：红中军孙权 ↔ 蓝中军太史慈
    pickHeroIntoSlot('blue', 1, '太史慈');
    dragSlotTo(redSlots()[1], blueSlots()[1]);
    expect(blueSlots()[1].querySelector('.hero-name')!.textContent).toContain('孙权');
    expect(redSlots()[1].querySelector('.hero-name')!.textContent).toContain('太史慈');
    expect(redSlots()[0].querySelector('.hero-name')!.textContent).toContain('周瑜');

    // 3. 跨队到空槽：红大营周瑜 → 蓝大营
    dragSlotTo(redSlots()[0], blueSlots()[0]);
    expect(blueSlots()[0].querySelector('.hero-name')!.textContent).toContain('周瑜');
    expect(redSlots()[0].classList.contains('empty')).toBe(true);

    // 4. 拖回武将池
    dragSlotToPool(blueSlots()[1]);
    expect(blueSlots()[1].classList.contains('empty')).toBe(true);
    expect(blueSlots()[0].querySelector('.hero-name')!.textContent).toContain('周瑜');
    expect(document.querySelector('.hero-pool .hero-card')).toBeTruthy();
  });

  it('武将详情页：三板块（详情 / 配点 / 兵种）+ 四维成长 + 战法栏', async () => {
    await boot();
    // 男性武将：40 点自由属性（孙权）
    let modal = clickPoolCard('孙权');
    expect(modal.querySelector('.hd-portrait img')).toBeTruthy();           // 画像
    // 三板块切换条，默认停在「详情」
    expect(modal.querySelectorAll('.hd-tab').length).toBe(3);
    expect(modal.querySelector('.hd-tab.on')!.textContent).toBe('详情');
    // 板块 1 应有四样：兵种 / 攻击距离 / 四维与成长 / 战法栏
    const meta = modal.querySelector('.hd-meta-row')!.textContent!;
    expect(meta).toContain('兵种');
    expect(meta).toContain('攻击距离');
    expect(modal.querySelectorAll('.stat-row').length).toBe(4);             // 四维
    expect(modal.textContent).toContain('（+1.62）');                       // 谋略成长 1.62
    expect(modal.textContent).toContain('自由属性剩余');                    // 加点预算
    expect(modal.textContent).toContain('40');                              // 男性预算 40
    expect(modal.querySelectorAll('.skill-slot-row').length).toBe(3);       // 三战法栏
    expect(modal.querySelector('.skill-slot-row.main .sslot-name')!.textContent).toContain('九锡黄龙'); // 主战法固定
    // 两个未携带槽：素材加号 slot-add.png + 「可学习」
    const addRows = Array.from(modal.querySelectorAll('.skill-slot-row.add')) as HTMLElement[];
    expect(addRows.length).toBe(2);
    for (const row of addRows) {
      const img = row.querySelector('img.sslot-add') as HTMLImageElement;
      expect(img, '未携带战法应渲染素材加号').toBeTruthy();
      expect(img.src).toMatch(/\/skills\/slot-add\.png$/);
      expect(row.textContent).toContain('可学习');
      expect(row.textContent).not.toContain('＋');
    }
    // 板块 2「配点」：四项 ×（− / ＋ / 最大）+ 重置（未放入阵容 → 全禁用）
    (modal.querySelector('.hd-tab[data-tab="points"]') as HTMLElement).click();
    expect(modal.querySelectorAll('.pt-row').length).toBe(4);
    expect(modal.querySelectorAll('.pt-btn[data-max]').length).toBe(4);
    expect(modal.querySelector('.pt-reset')).toBeTruthy();
    expect((modal.querySelector('.pt-btn[data-max]') as HTMLButtonElement).disabled).toBe(true);
    // 板块 3「兵种」：转换还没做 → 灰色占位
    (modal.querySelector('.hd-tab[data-tab="troop"]') as HTMLElement).click();
    expect(modal.textContent).toContain('未开放');
    closeModal();

    // 女性武将：60 点自由属性（马云禄）
    modal = clickPoolCard('马云禄');
    expect(modal.textContent).toContain('60');
    closeModal();
  });

  it('武将详情 · 配点：「最大」把剩余点数全加进该项，「重置」全部返还', async () => {
    await boot();
    pickHeroIntoSlot('red', 0, '孙权');
    (document.querySelector('.team-panel.red .slots .slot') as HTMLElement).click();
    const modal = document.querySelector('.modal') as HTMLElement;
    (modal.querySelector('.hd-tab[data-tab="points"]') as HTMLElement).click();

    const remain = () => (modal.querySelector('.pt-remain b') as HTMLElement).textContent;
    const attackAdd = () => (modal.querySelector('.pt-row .pt-d') as HTMLElement).textContent!;
    expect(remain()).toBe('40');                 // 男性 40 级：40 点自由属性
    expect(attackAdd()).toContain('+0');

    // 「最大」→ 剩余 40 点一次性全加到攻击
    (modal.querySelector('.pt-btn[data-max="attack"]') as HTMLElement).click();
    expect(remain()).toBe('0');
    expect(attackAdd()).toContain('+40');
    expect((modal.querySelector('.pt-btn[data-max="attack"]') as HTMLButtonElement).disabled).toBe(true);

    // 「重置」→ 四项归零、点数全部返还
    (modal.querySelector('.pt-reset') as HTMLElement).click();
    expect(remain()).toBe('40');
    expect(attackAdd()).toContain('+0');
  });

  it('选将 → 开始模拟 → 默认简略战报，可切换统计/战报详情', async () => {
    await boot();
    // 红队：前锋=太史慈、中军=周瑜、大营=孙权；蓝队：前锋=魏延
    pickHeroIntoSlot('red', 2, '太史慈');
    pickHeroIntoSlot('red', 1, '周瑜');
    pickHeroIntoSlot('red', 0, '孙权');
    pickHeroIntoSlot('blue', 2, '魏延');
    // 槽位填充确认
    const redPanel = document.querySelector('.team-panel.red') as HTMLElement;
    expect(redPanel.querySelectorAll('.slot .hero-name')[2].textContent).toContain('太史慈');
    // 配将槽位卡＝官方卡面（左：卡框 + 画像铺满 + 势力字/竖排名 + 底部 Lv·兵种）+ 信息列（右）
    const slotCard = redPanel.querySelectorAll('.slot')[2].querySelector('.slot-card') as HTMLElement;
    expect(slotCard, '槽位卡应有官方卡面').toBeTruthy();
    expect((slotCard.querySelector('.frame') as HTMLElement).style.backgroundImage).toContain('card-frame-5.png');
    expect(slotCard.querySelector('.fac')!.textContent).toBe('吴');                 // 太史慈 = 吴
    expect(slotCard.querySelector('.hero-name')!.textContent).toBe('太史慈');       // 左竖排名
    expect(slotCard.querySelector('.card-bar .lv')!.textContent).toContain('Lv.40');
    expect(slotCard.querySelector('.card-bar .troop')!.textContent).toBe('弓');     // 太史慈 = 弓兵
    // 战法芯片：太史慈主战法方阵突击（追击）
    expect(redPanel.querySelectorAll('.slot')[2].textContent).toContain('方阵突击');
    expect(redPanel.textContent).not.toContain('点击查看详情');
    expect(redPanel.querySelector('.team-clear')!.textContent).toContain('清空本队');

    (document.querySelector('#start') as HTMLButtonElement).click();
    // 默认展示简略战报：总兵力条 + 双方画像 + 结果印章 + VS
    const summary = document.querySelector('.battle-summary') as HTMLElement;
    expect(summary, '简略战报应出现').toBeTruthy();
    expect(summary.querySelectorAll('.sum-side .troopbar').length).toBe(2); // 蓝红总兵力条
    expect(summary.querySelector('.stamp')).toBeTruthy();                    // 胜败平印章
    const stampImg = summary.querySelector('.stamp .stamp-ch') as HTMLImageElement;
    expect(stampImg, '结果书法字应是图片').toBeTruthy();
    expect(stampImg.src).toMatch(/\/stamps\/(win|loss|draw)\.png$/);
    expect(stampImg.alt).toMatch(/^(胜|败|平)$/);
    expect(summary.querySelector('.vs-badge')).toBeTruthy();                 // VS 图标
    expect(summary.querySelectorAll('.sum-hero').length).toBe(4);            // 3 红 + 1 蓝
    expect(summary.querySelectorAll('.sh-stars').length).toBe(4);            // 星级/红度
    // 简略战报卡＝官方卡面：卡框 + 画像铺满 + 左上势力字/竖排名 + 右上红度 + 底部 Lv·兵种；兵力条留在卡面外
    const shCard = summary.querySelector('.sum-hero .sh-card') as HTMLElement;
    expect(shCard, '简略战报卡应有官方卡面').toBeTruthy();
    expect((shCard.querySelector('.frame') as HTMLElement).style.backgroundImage).toContain('card-frame-5.png');
    expect((shCard.querySelector('img.sh-art') as HTMLImageElement).src).toContain('/portraits/');
    expect(shCard.querySelector('.sh-name')!.textContent!.length).toBeGreaterThan(1);
    expect(shCard.querySelector('.card-bar .lv')!.textContent).toContain('Lv.');
    expect(shCard.querySelector('.card-bar .troop')!.textContent).toMatch(/^(骑|步|弓)$/);
    expect(summary.querySelector('.sum-hero .troopbar'), '兵力条在卡面外').toBeTruthy();
    expect(summary.textContent).toContain('Lv.');
    expect(summary.textContent).toMatch(/(红队胜利|蓝队胜利|双方平局|红胜|蓝胜|平局)/);
    // 单屏布局：底部不再重复「统计/战报详情」；回合/种子收进 VS 列，避免盖住画像
    expect(document.querySelector('.report-toolbar')).toBeFalsy();
    expect(summary.querySelector('.sum-foot')).toBeFalsy();
    expect(summary.querySelector('.vs-badge')!.textContent).toContain('回合');
    expect(summary.querySelector('.vs-badge')!.textContent).toContain('种子');
    // 战报页无顶栏页签：返回配将 / 简略 / 统计 / 详情 在底栏
    const dock = document.querySelector('.report-dock') as HTMLElement;
    expect(dock, '战报底栏应出现').toBeTruthy();
    expect(dock.textContent).toContain('返回配将');
    expect(dock.textContent).toContain('简略');
    expect(dock.textContent).toContain('统计');
    expect(dock.textContent).toContain('详情');
    expect(document.querySelector('.report-nav')).toBeFalsy();
    const navBtn = (label: string) =>
      Array.from(dock.querySelectorAll('button')).find((b) => b.textContent!.includes(label)) as HTMLElement;
    navBtn('统计').click();
    const stats = document.querySelector('.stats-view') as HTMLElement;
    expect(stats, '统计视图应出现').toBeTruthy();
    expect(stats.querySelector('table')).toBeFalsy();
    expect(stats.querySelectorAll('.st-row').length).toBe(4); // 3 红 + 1 蓝
    const labels = Array.from(stats.querySelectorAll('.pos-tag')).map((el) => el.textContent);
    expect(labels).toEqual(['大营', '中军', '前锋', '前锋']); // 红三站位后接蓝前锋
    expect(stats.querySelector('[data-stats="skill"]')).toBeTruthy();
    // 默认战法统计：普攻 + 次数在 .sk-row（不再用 td）
    expect(stats.querySelector('.sk-row')!.textContent).toContain('普攻');
    expect(stats.querySelector('.sk-row')!.textContent).toContain('次数');
    expect(stats.textContent).toContain('九锡黄龙');
    // 「次数 X」必须与所属战法名称同格（.sk-c 紧跟 .sk-n），避免右对齐后被误读成下一格的次数
    const skCells = Array.from(stats.querySelectorAll('.sk'));
    expect(skCells.length).toBeGreaterThan(0);
    for (const cell of skCells) {
      const name = cell.querySelector('.sk-n');
      const count = cell.querySelector('.sk-c');
      expect(name && count, '每格都应有名称与次数').toBeTruthy();
      expect(name!.nextElementSibling).toBe(count);
    }
    (stats.querySelector('[data-stats="hero"]') as HTMLButtonElement).click();
    expect(stats.querySelector('.sh-row')).toBeTruthy();
    expect(stats.textContent).toContain('伤害');
    // 底栏页签一键返回简略
    navBtn('简略').click();
    expect(document.querySelector('.battle-summary')).toBeTruthy();

    // 战报详情（逐回合事件）
    navBtn('详情').click();
    const banner = document.querySelector('.result-banner') as HTMLElement;
    expect(banner, '结果横幅应出现').toBeTruthy();
    expect(banner.textContent).toMatch(/(胜利|平局|失败)/);
    const bannerGlyph = banner.querySelector('.res-glyph') as HTMLImageElement;
    expect(bannerGlyph, '详情横幅应有胜败平书法字').toBeTruthy();
    expect(bannerGlyph.alt).toMatch(/^(胜|败|平)$/);
    expect(document.querySelector('.dv')).toBeTruthy();
    expect(document.querySelector('.dv-turns')).toBeTruthy();
    expect(document.querySelector('.dv-rail')).toBeTruthy();
    expect(document.querySelector('.event-stream')).toBeTruthy();
    // 回合导航：0(始)~8
    expect(document.querySelectorAll('.rtab').length).toBe(9);
    expect(document.querySelector('.event-stream')!.textContent).toContain('【阵容】');
    expect(document.querySelector('.event-stream')!.textContent).toContain('【兵种】');
    expect(document.querySelector('.event-stream')!.textContent).toContain('【战法】');
    expect(document.querySelector('.event-stream')!.textContent).toContain('暂无效果');
  });

  it('底栏：随机种子自动不可调、最大回合固定 8、双方士气默认 120 可调', async () => {
    await boot();
    const bar = document.querySelector('.control-bar') as HTMLElement;
    // 种子/回合不可调整：无输入控件，只读展示
    expect(bar.querySelector('input#seed')).toBeFalsy();
    expect(bar.querySelector('select#rounds')).toBeFalsy();
    expect(bar.textContent).toContain('8（固定）');
    expect(bar.querySelector('#seed-info')!.textContent).toBe('自动');
    // 士气默认 120，可调
    const mRed = bar.querySelector('#morale-red') as HTMLInputElement;
    const mBlue = bar.querySelector('#morale-blue') as HTMLInputElement;
    expect(mRed.value).toBe('120');
    expect(mBlue.value).toBe('120');
    mRed.value = '130';
    mRed.dispatchEvent(new Event('change'));
    expect(mRed.value).toBe('130');
    // 越界值被钳制回 80~140
    mBlue.value = '999';
    mBlue.dispatchEvent(new Event('change'));
    expect(mBlue.value).toBe('140');
    mBlue.value = '1';
    mBlue.dispatchEvent(new Event('change'));
    expect(mBlue.value).toBe('80');

    // 开始模拟：种子自动生成并展示，两次模拟种子自动变化
    pickHeroIntoSlot('red', 2, '太史慈');
    pickHeroIntoSlot('blue', 0, '魏延');
    (document.querySelector('#start') as HTMLButtonElement).click();
    const seedInfo = bar.querySelector('#seed-info') as HTMLElement;
    const s1 = seedInfo.textContent;
    expect(s1).not.toBe('自动');
    expect(Number(s1)).toBeGreaterThanOrEqual(0);
    (document.querySelector('#start') as HTMLButtonElement).click();
    expect(seedInfo.textContent).not.toBe(s1);
  });

  it('buildGeneral：携带兵力公式（等级×100+5000+红度×200）与等级/士气透传', async () => {
    const { buildGeneral, troopCapacity, HEROES } = await import('./heroes');
    // 公式：40 级白板 9000；50 级白板 10000；50 级满红 11000
    expect(troopCapacity(40, 0)).toBe(9000);
    expect(troopCapacity(50, 0)).toBe(10000);
    expect(troopCapacity(50, 5)).toBe(11000);
    expect(troopCapacity(45, 2)).toBe(4500 + 5000 + 400); // 9900
    const rec = HEROES.find((h) => h.name === '太史慈')!;
    const g = buildGeneral(rec.id, [], {}, '前锋', 5, 50, 130);
    expect(g.maxTroops).toBe(11000);
    expect(g.morale).toBe(130);
    expect(g.level).toBe(50);
    expect(g.redness).toBe(5);
    // 属性按成长率更新：初始 + (50-1)×成长
    expect(g.attack).toBe(Math.round(rec.baseAttack + 49 * rec.growthAttack));
    // 默认士气 120、40 级白板兵力 9000
    const g40 = buildGeneral(rec.id, [], {}, '前锋');
    expect(g40.maxTroops).toBe(9000);
    expect(g40.morale).toBe(120);
    expect(g40.level).toBe(40);
  });

  it('等级 40~50 可调：详情页属性随成长更新、携带兵力自动重算并展示', async () => {
    await boot();
    pickHeroIntoSlot('red', 2, '太史慈');
    let redPanel = document.querySelector('.team-panel.red') as HTMLElement;
    const slotEl = redPanel.querySelectorAll('.slot')[2] as HTMLElement;
    // 槽位展示默认 40 级（卡面底部栏 Lv.）、兵力 9000
    expect(slotEl.textContent).toContain('Lv.40');
    expect(slotEl.textContent).toContain('兵力9000');
    // 打开详情页
    slotEl.click();
    let modal = document.querySelector('.modal') as HTMLElement;
    const levelInp = modal.querySelector('[data-level]') as HTMLInputElement;
    expect(levelInp).toBeTruthy();
    expect(levelInp.value).toBe('40');
    expect(levelInp.min).toBe('40');
    expect(levelInp.max).toBe('50');
    expect(modal.textContent).toContain('携带兵力');
    expect(modal.textContent).toContain('9000');
    // 40 级男性自由属性预算 40
    expect(modal.textContent).toContain('/ 40 点');
    // 升到 50 级：兵力 → 10000、预算 → 50、属性按成长更新
    levelInp.value = '50';
    levelInp.dispatchEvent(new Event('change'));
    modal = document.querySelector('.modal') as HTMLElement;
    expect(modal.textContent).toContain('10000');
    expect(modal.textContent).toContain('/ 50 点');
    const { HEROES } = await import('./heroes');
    const rec = HEROES.find((h) => h.name === '太史慈')!;
    expect(modal.textContent).toContain(String(Math.round(rec.baseAttack + 49 * rec.growthAttack)));
    // 满红 + 50 级 → 携带兵力 11000
    (modal.querySelectorAll('.redness-pick i')[4] as HTMLElement).click();
    modal = document.querySelector('.modal') as HTMLElement;
    expect(modal.textContent).toContain('11000');
    expect(modal.textContent).toContain('/ 100 点');
    // 槽位同步显示 50 级 兵力 11000
    redPanel = document.querySelector('.team-panel.red') as HTMLElement;
    expect((redPanel.querySelectorAll('.slot')[2] as HTMLElement).textContent).toContain('Lv.50');
    expect((redPanel.querySelectorAll('.slot')[2] as HTMLElement).textContent).toContain('兵力11000');
  });

  it('互斥校验：关羽（魏）+ 关羽（蜀）同队**不再被拒**（2026-09-16 互斥改白名单制）', async () => {
    await boot();
    pickHeroIntoSlot('red', 0, '关羽', { skill: '千里单骑' });
    pickHeroIntoSlot('red', 1, '关羽', { skill: '樊渊泅囚' });
    // 白名单只剩 赵云↔SP赵云、姜维↔SP姜维；同名不同势力（关羽蜀/魏）可同队
    // 注：这两组互斥成员含下架武将（SP赵云/SP姜维），UI 池里选不到 → 互斥拦截至此仅由单元/引擎测试覆盖
    expect(document.querySelector('.app-notice')?.textContent ?? '').not.toContain('互斥冲突');
    const redPanel = document.querySelector('.team-panel.red') as HTMLElement;
    const slot1 = redPanel.querySelectorAll('.slot')[1] as HTMLElement;
    expect(slot1.textContent).toContain('樊渊泅囚');
    expect(slot1.textContent).not.toContain('点击选择');
  });

  it('装配上限：主战法不占位，可装 2 个装配战法（共 3 个）', async () => {
    await boot();
    pickHeroIntoSlot('red', 2, '太史慈');
    // 点击已放入槽位 → 打开详情页（可编辑）
    const redPanel = document.querySelector('.team-panel.red') as HTMLElement;
    (redPanel.querySelectorAll('.slot')[2] as HTMLElement).click();
    let modal = document.querySelector('.modal') as HTMLElement;
    expect(modal.textContent).not.toContain('判定顺序');
    expect(modal.textContent).toContain('方阵突击'); // 主战法
    expect(modal.querySelectorAll('.skill-slot-row').length).toBe(3); // 主战法不占位，仍有 2 个装配槽

    // 装配第 1 个：温酒斩将
    const addBtn = modal.querySelector('.add') as HTMLElement;
    addBtn.click();
    const picker = Array.from(document.querySelectorAll('.modal')).at(-1) as HTMLElement; // 战法库弹窗（后追加）
    const items = Array.from(picker.querySelectorAll('.skill-pick-item')) as HTMLElement[];
    (items.find((i) => i.textContent!.includes('温酒斩将')) as HTMLElement).click();

    // 装配第 2 个：突进
    modal = document.querySelector('.modal') as HTMLElement; // 详情页仍在
    const addBtn2 = modal.querySelector('.add') as HTMLElement;
    expect(addBtn2, '还能再装配 1 个').toBeTruthy();
    addBtn2.click();
    const picker2 = Array.from(document.querySelectorAll('.modal')).at(-1) as HTMLElement;
    const items2 = Array.from(picker2.querySelectorAll('.skill-pick-item')) as HTMLElement[];
    (items2.find((i) => i.textContent!.includes('突进')) as HTMLElement).click();

    // 3 个战法：主战法 + 2 装配，添加按钮消失
    modal = document.querySelector('.modal') as HTMLElement;
    expect(modal.querySelectorAll('.skill-slot-row').length).toBe(3);
    expect(modal.querySelector('.add')).toBeFalsy();
    // 详情页里两个装配战法都出现
    expect(modal.textContent).toContain('温酒斩将');
    expect(modal.textContent).toContain('突进');
    (modal.querySelector('.m-close') as HTMLElement).click();

    const filled = document.querySelector('.team-panel.red') as HTMLElement;
    const slotSkills = Array.from(filled.querySelectorAll('.slot')[2].querySelectorAll('.slot-skill')) as HTMLElement[];
    expect(slotSkills.map((c) => c.querySelector('.slot-skill-name')!.textContent)).toEqual(['方阵突击', '温酒斩将', '突进']);
    expect(slotSkills[0].textContent).not.toContain('主');
    expect(slotSkills[0].className).toContain('grade-a');
    expect(slotSkills[1].className).toContain('grade-a');
    expect(slotSkills[2].className).toContain('grade-d');
    expect(slotSkills[0].querySelector('.sslot-icon .ti')).toBeTruthy();
    expect(slotSkills[0].querySelector('.sslot-icon .kf')).toBeTruthy();
    expect(slotSkills[0].querySelector('.sslot-icon .rb')).toBeTruthy();
    // 三战法均为追击 → skill-type-pursuit；品级圆环走 grade-ring-*
    expect((slotSkills[0].querySelector('.ti') as HTMLImageElement).getAttribute('src')).toContain('skill-type-pursuit');
    expect((slotSkills[0].querySelector('.kf') as HTMLImageElement).getAttribute('src')).toContain('grade-ring-a');
    expect((slotSkills[2].querySelector('.kf') as HTMLImageElement).getAttribute('src')).toContain('grade-ring-d');
    // 战法名背景框：A 级有官方色板（has-plate + 内联 background-image）；D 级无素材 → 半透明芯片兜底
    const aName = slotSkills[0].querySelector('.slot-skill-name') as HTMLElement;
    expect(aName.className).toContain('has-plate');
    expect(aName.style.backgroundImage).toContain('grade-plate-a.png');
    const dName = slotSkills[2].querySelector('.slot-skill-name') as HTMLElement;
    expect(dName.className).not.toContain('has-plate');
    expect(dName.style.backgroundImage).toBe('');
  });

  it('模拟 → 返回配将 → 再次模拟：第二次战报正常渲染', async () => {
    await boot();
    pickHeroIntoSlot('red', 2, '太史慈');
    pickHeroIntoSlot('blue', 0, '魏延');

    const start = () => (document.querySelector('#start') as HTMLButtonElement).click();
    const summary = () => document.querySelector('.battle-summary') as HTMLElement;

    // 第一次模拟
    start();
    expect(summary(), '第一次战报应出现').toBeTruthy();
    expect(document.querySelectorAll('.sum-hero').length).toBe(2);

    // 返回配将
    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent!.includes('返回配将')) as HTMLElement).click();
    expect(document.querySelector('.team-panel.red') as HTMLElement).toBeTruthy();
    expect(summary()).toBeFalsy(); // 战报已清空

    // 第二次模拟（回归：battleRoot 曾被 remove 导致第二次空白）
    start();
    expect(summary(), '第二次战报应出现').toBeTruthy();
    expect(document.querySelectorAll('.sum-hero').length).toBe(2);
  });

  it('红度：满红五红为 5 红星，一红为 1 红星 + 4 金星；每红 +10 自由属性点', async () => {
    await boot();
    pickHeroIntoSlot('red', 2, '太史慈');
    const redPanel = document.querySelector('.team-panel.red') as HTMLElement;
    (redPanel.querySelectorAll('.slot')[2] as HTMLElement).click();
    const modal = document.querySelector('.modal') as HTMLElement;

    // 默认 0 红：5 金星；男性预算 40
    expect(modal.querySelectorAll('.redness-pick i.on').length).toBe(0);
    expect((modal.querySelector('.hd-stars') as HTMLElement).title).toContain('红度 0/5');
    expect(modal.textContent).toContain('/ 40 点');
    // 点击第 3 颗星 → 3 红 2 金，预算 40+30=70
    (modal.querySelectorAll('.redness-pick i')[2] as HTMLElement).click();
    expect(modal.querySelectorAll('.redness-pick i.on').length).toBe(3);
    expect((modal.querySelector('.hd-stars') as HTMLElement).title).toContain('红度 3/5');
    expect(modal.textContent).toContain('/ 70 点');
    expect(modal.textContent).toContain('（含红度 +30）');
    // 点击第 5 颗星 → 满红 5 红，预算 40+50=90
    (modal.querySelectorAll('.redness-pick i')[4] as HTMLElement).click();
    expect(modal.querySelectorAll('.redness-pick i.on').length).toBe(5);
    expect((modal.querySelector('.hd-stars') as HTMLElement).title).toContain('红度 5/5');
    expect(modal.textContent).toContain('/ 90 点');
    expect(modal.textContent).toContain('（含红度 +50）');
    // 槽位同步显示红度（refresh 会重建槽位 DOM，需重新查询）
    const redPanel2 = document.querySelector('.team-panel.red') as HTMLElement;
    const slot2 = redPanel2.querySelectorAll('.slot')[2] as HTMLElement;
    expect((slot2.querySelector('.hero-stars') as HTMLElement).title).toContain('红度 5/5');
  });

  it('武将筛选：势力/兵种多选（跨类别 AND，同类别 OR），重置恢复', async () => {
    await boot();
    const cards = () => Array.from(document.querySelectorAll('.hero-pool .hero-card')) as HTMLElement[];
    const clickTag = (v: string) => {
      const tag = Array.from(document.querySelectorAll('.hero-pool .filter-tag')).find(
        (t) => (t as HTMLElement).dataset.v === v
      ) as HTMLElement;
      expect(tag, `筛选 tag「${v}」应存在`).toBeTruthy();
      tag.click();
    };

    // 初始：全部武将（数据随调研持续补全，只断言下限）
    expect(cards().length).toBeGreaterThan(20);
    // 点「魏」→ 全是魏国
    clickTag('魏');
    const weiNames = new Set(['曹操', '张辽', '司马懿', '荀彧', '曹仁', '夏侯惇']);
    expect(cards().length).toBeGreaterThan(0);
    // 卡框版卡片：势力字在左上 .fac、兵种在底部栏 .bar .troop
    expect(cards().every((c) => c.querySelector('.fac')!.textContent === '魏')).toBe(true);
    // 再点「骑」→ 同时是魏且骑兵（交集）
    clickTag('骑');
    const weiCav = cards();
    expect(weiCav.length).toBeGreaterThan(0);
    expect(weiCav.every((c) => c.querySelector('.fac')!.textContent === '魏')).toBe(true);
    expect(weiCav.every((c) => c.querySelector('.bar .troop')!.textContent === '骑')).toBe(true);
    expect(weiNames.has('张辽')).toBe(true); // 魏骑代表
    // 取消骑、加吴 → 魏或吴（并集）
    clickTag('骑');
    clickTag('吴');
    const weiOrWu = cards();
    expect(weiOrWu.length).toBeGreaterThan(0);
    expect(weiOrWu.every((c) => {
      const fac = c.querySelector('.fac')!.textContent!;
      return fac === '魏' || fac === '吴';
    })).toBe(true);
    // 重置 → 全部恢复
    (document.querySelector('.hero-pool .hf-reset') as HTMLElement).click();
    expect(cards().length).toBeGreaterThan(20);
  });

  it('顶栏「战报」：查看历史战斗并可查看详情', async () => {
    await boot();
    // 先打一场
    pickHeroIntoSlot('red', 2, '太史慈');
    pickHeroIntoSlot('blue', 0, '魏延');
    (document.querySelector('#start') as HTMLButtonElement).click();
    expect(document.querySelector('.battle-summary')).toBeTruthy();

    // 打开战报面板
    (document.querySelector('.nav-link[data-nav="history"]') as HTMLElement).click();
    const panel = Array.from(document.querySelectorAll('.modal')).at(-1) as HTMLElement;
    expect(panel.querySelector('.m-head h3')!.textContent).toContain('战报');
    const items = Array.from(panel.querySelectorAll('.hist-item')) as HTMLElement[];
    expect(items.length).toBeGreaterThan(0);
    // 详情默认展示简略战报（画像 + 总兵力条），点击后展开详细
    expect(panel.querySelector('.hist-detail .battle-summary')).toBeTruthy();
    expect(panel.querySelector('.hist-detail .sum-hero')).toBeTruthy();
    expect(panel.querySelector('.hist-detail .result-banner')).toBeFalsy();
    (Array.from(panel.querySelectorAll('button')).find((b) => b.textContent!.includes('展开详细战报')) as HTMLElement).click();
    expect(panel.querySelector('.hist-detail .result-banner')).toBeTruthy();
    expect(panel.querySelector('.hist-detail .event-stream')).toBeTruthy();
    // 关闭
    (panel.querySelector('.m-close') as HTMLElement).click();
  });

  it('战法背包：品级与类别可各选一个并同时生效', async () => {
    await boot();
    (document.querySelector('.nav-link[data-nav="skills"]') as HTMLElement).click();
    const panel = Array.from(document.querySelectorAll('.modal')).at(-1) as HTMLElement;
    expect(panel.querySelector('.skill-filter'), '应有品级+类别筛选栏').toBeTruthy();
    const clickChip = (dim: string, v: string) => {
      const el = panel.querySelector(`.skill-filter .tagf[data-dim="${dim}"][data-v="${v}"]`) as HTMLElement;
      expect(el, `筛选芯片 ${dim}=${v || '全部'} 应存在`).toBeTruthy();
      el.click();
    };
    clickChip('grade', 'S');
    const afterS = Array.from(panel.querySelectorAll('.bag-item')) as HTMLElement[];
    expect(afterS.length).toBeGreaterThan(0);
    expect(afterS.length).toBeLessThan(50);
    afterS.forEach((it) => expect(it.querySelector('.grade')!.textContent).toBe('S'));
    clickChip('type', 'command');
    const afterBoth = Array.from(panel.querySelectorAll('.bag-item')) as HTMLElement[];
    expect(afterBoth.length).toBeGreaterThan(0);
    afterBoth.forEach((it) => {
      expect(it.querySelector('.grade')!.textContent).toBe('S');
      expect(it.textContent).toContain('指挥');
    });
    expect(panel.querySelector('.bag-grid')!.textContent).toContain('大赏三军'); // S 指挥
    expect(panel.querySelector('.bag-grid')!.textContent).not.toContain('温酒斩将'); // A 追击
  });

  it('装配战法：品级与类别可各选一个并同时生效', async () => {
    await boot();
    pickHeroIntoSlot('red', 2, '太史慈');
    (document.querySelectorAll('.team-panel.red .slot')[2] as HTMLElement).click();
    (document.querySelector('.modal .add') as HTMLElement).click();
    const picker = Array.from(document.querySelectorAll('.modal')).find((m) =>
      m.querySelector('h3')?.textContent?.includes('装配战法')
    ) as HTMLElement;
    expect(picker.querySelector('.skill-filter'), '装配弹窗应有品级+类别筛选栏').toBeTruthy();
    const clickChip = (dim: string, v: string) => {
      (picker.querySelector(`.skill-filter .tagf[data-dim="${dim}"][data-v="${v}"]`) as HTMLElement).click();
    };
    clickChip('grade', 'A');
    clickChip('type', 'pursuit');
    const items = Array.from(picker.querySelectorAll('.skill-pick-item')) as HTMLElement[];
    expect(items.length).toBeGreaterThan(0);
    items.forEach((it) => {
      expect(it.querySelector('.grade')!.textContent).toBe('A');
      expect(it.textContent).toContain('追击');
    });
    expect(picker.querySelector('.skill-pick-list')!.textContent).toContain('温酒斩将');
    expect(picker.querySelector('.skill-pick-list')!.textContent).not.toContain('大赏三军');
  });

  it('顶栏「战法」：战法背包展示可携带战法（主战法除外），点击弹详情', async () => {
    await boot();
    (document.querySelector('.nav-link[data-nav="skills"]') as HTMLElement).click();
    const panel = Array.from(document.querySelectorAll('.modal')).at(-1) as HTMLElement;
    expect(panel.querySelector('.m-head h3')!.textContent).toContain('战法背包');
    const items = Array.from(panel.querySelectorAll('.bag-item')) as HTMLElement[];
    expect(items.length).toBeGreaterThan(20); // 上架可学习战法
    // 不含武将主战法（方阵突击为太史慈主战法）
    expect(panel.textContent).not.toContain('方阵突击');
    // 点击战法 → 详情弹窗
    items[0].click();
    const detail = Array.from(document.querySelectorAll('.modal')).at(-1) as HTMLElement;
    expect(detail.querySelector('.sd-name')).toBeTruthy();
    expect(detail.textContent).toContain('满级效果');
    (detail.querySelector('.m-close') as HTMLElement).click();
  });

  it('战法：点击已装战法弹详情（官方描述），右上角「−」卸下', async () => {
    await boot();
    pickHeroIntoSlot('red', 2, '太史慈');
    const redPanel = document.querySelector('.team-panel.red') as HTMLElement;
    (redPanel.querySelectorAll('.slot')[2] as HTMLElement).click();
    let modal = document.querySelector('.modal') as HTMLElement;

    // 装配温酒斩将
    (modal.querySelector('.add') as HTMLElement).click();
    const picker = Array.from(document.querySelectorAll('.modal')).find((m) =>
      m.querySelector('h3')?.textContent?.includes('装配战法')
    ) as HTMLElement;
    const items = Array.from(picker.querySelectorAll('.skill-pick-item')) as HTMLElement[];
    expect(picker.querySelector('.skill-pick-list')!.textContent).not.toContain('方阵突击'); // 装配列表不含武将主战法
    expect(picker.textContent).toContain('温酒斩将');
    (items.find((i) => i.textContent!.includes('温酒斩将')) as HTMLElement).click();
    modal = document.querySelector('.modal') as HTMLElement;
    expect(modal.textContent).toContain('温酒斩将');

    // 点击已装战法 → 战法详情（含官方描述）
    (modal.querySelector('.skill-slot-row.equipped') as HTMLElement).click();
    const detail = Array.from(document.querySelectorAll('.modal')).at(-1) as HTMLElement;
    expect(detail.querySelector('.sd-name')!.textContent).toContain('温酒斩将');
    expect(detail.textContent).toContain('满级效果');
    expect(detail.textContent).toContain('猛攻'); // 官方描述文本
    (detail.querySelector('.m-close') as HTMLElement).click();

    // 右上角「−」卸下
    modal = document.querySelector('.modal') as HTMLElement;
    (modal.querySelector('.sslot-rm') as HTMLElement).click();
    expect(modal.textContent).not.toContain('温酒斩将');
    expect(modal.querySelectorAll('.skill-slot-row.equipped').length).toBe(0);
    expect(modal.querySelector('.add')).toBeTruthy(); // 空槽恢复可装配
  });

  it('红蓝部队加成入口只看本队，三吴显示阵营加成（率土手游复刻弹窗）', async () => {
    await boot();
    pickHeroIntoSlot('red', 0, '孙权');
    pickHeroIntoSlot('red', 1, '周瑜');
    pickHeroIntoSlot('red', 2, '太史慈');
    pickHeroIntoSlot('blue', 0, '魏延');

    const redBtn = document.querySelector('.team-panel.red .team-bonus') as HTMLElement;
    const blueBtn = document.querySelector('.team-panel.blue .team-bonus') as HTMLElement;
    expect(redBtn.textContent).toContain('部队加成');
    expect(blueBtn.textContent).toContain('部队加成');

    redBtn.click();
    const modal = document.querySelector('.bonus-modal') as HTMLElement;
    expect(modal).toBeTruthy();
    // 三栏并列卡片：阵营 / 称号 / 兵种
    expect(modal.querySelectorAll('.bm-card').length).toBe(3);
    expect(modal.textContent).toContain('阵营加成-吴'); // 三吴 → 阵营标题带阵营名
    expect(modal.textContent).toContain('战斗中生效');
    expect(modal.textContent).toContain('称号加成');
    expect(modal.textContent).toContain('全局生效');
    expect(modal.textContent).toContain('配置指定武将组合可激活'); // 称号未激活提示
    expect(modal.textContent).toContain('太史慈');
    // 属性格：图标 + 绿色数字（+N）
    const stat = modal.querySelector('.bm-stat.on i');
    expect(stat).toBeTruthy();
    expect(stat!.textContent!.startsWith('+')).toBe(true);
    expect(modal.textContent).not.toContain('魏延'); // 只看本队
    (modal.querySelector('.bm-close') as HTMLElement).click();

    blueBtn.click();
    const blueModal = document.querySelector('.bonus-modal') as HTMLElement;
    expect(blueModal.textContent).toContain('未激活'); // 单将无阵营加成
    expect(blueModal.textContent).not.toContain('太史慈');
    expect(blueModal.querySelector('.bm-tag.global')).toBeTruthy();
  });
});
