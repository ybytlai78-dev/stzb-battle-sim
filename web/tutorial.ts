/**
 * 引擎使用指南（教程）：顶栏「教程」入口 → 带截图的步骤弹窗。
 *
 * 图片在 `public/tutorial/`，由仓库根目录 `引擎使用指南/` 的原图（2640×1216，共 ~6MB）
 * 压到 1400px 宽生成（8 张共 ~820KB），命名沿用原图序号：1~7 + 61（第 6 点的第二张：
 * 6.jpg=战法统计、61.jpg=武将统计 → step6.jpg / step6b.jpg）。
 *
 * 说明文字 = 用户给的 7 个要点（第 6 点含两个视图）。
 */
import { asset } from './assets';

export interface TutorialStep {
  /** public/tutorial/ 下的文件名 */
  img: string;
  title: string;
  desc: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    img: 'step1.jpg',
    title: '① 配将：筛选 · 拖拽 · 拼音搜索',
    desc: '中间武将池可按势力 / 兵种筛选，也可直接输入中文名或拼音快速定位（lb → 吕布、刘备；lvbu → 吕布）。把武将卡拖到红 / 蓝队的大营 / 中军 / 前锋槽位即可上阵，也可以点槽位选将。',
  },
  {
    img: 'step2.jpg',
    title: '② 点武将 → 详情：配战法 · 配属性',
    desc: '点任意武将卡进详情页，三个板块：详情（装配主战法与可学习战法、看四维与成长）、配点（把自由属性点分到攻击 / 防御 / 谋略 / 速度）、兵种（骑 / 步 / 弓切换）。',
  },
  {
    img: 'step3.jpg',
    title: '③ 战法背包：按品级与类别找战法',
    desc: '顶栏「战法」打开背包：按品级（S / A / B / C）与类别（被动 / 指挥 / 主动 / 追击）筛选，也可搜战法名；右下角显示可装配战法总数。',
  },
  {
    img: 'step4.jpg',
    title: '④ 伤害测试实验室：配队伍 + 打桩',
    desc: '顶栏「伤害测试」进入实验室：左边是我方测试队伍（纯立绘，拖拽或点选配将），右边「木桩侍卫」可自由设定兵种与攻 / 防 / 谋 / 速 / 兵力 —— 造任意极端的靶子来验数值。',
  },
  {
    img: 'step5.jpg',
    title: '⑤ 打桩结果：伤害占比饼图',
    desc: '点「模拟一次 / 十次」出结果。伤害分析页每位武将一张卡：饼图是他的普攻 / 主战法 / 携带战法一 / 携带战法二 伤害占比，下方是总伤害、单场最高 / 最低、标准差、变异系数、中位数、场均承伤与场均治疗。',
  },
  {
    img: 'step6.jpg',
    title: '⑥ 统计：战法统计（次数 ｜ 杀伤）',
    desc: '战报底部「统计」页 —— 战法统计逐将列出普攻与每个装配战法的发动次数与杀伤，能看出谁在出力、哪个战法在划水。',
  },
  {
    img: 'step6b.jpg',
    title: '⑥ 统计：武将统计（伤害 / 恢复 / 控制占比）',
    desc: '同一页切到武将统计：每位武将的伤害占比、恢复占比、控制占比条形图，一眼看出输出核心与辅助。',
  },
  {
    img: 'step7.jpg',
    title: '⑦ 详细战报：逐回合明细',
    desc: '「详情」页按回合展开：谁发动了什么战法、目标是谁、打出多少伤害。带「共计提升 / 降低 x%」的行可以点开，查看增减伤的来源明细（哪个战法贡献了多少）。',
  },
];

/** 打开教程弹窗：× 或点遮罩空白处关闭（与武将详情等弹窗同一套 .modal-mask 模式） */
export function openTutorialPanel(): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal tutorial-modal';
  modal.innerHTML = `
    <div class="m-head"><h3>引擎使用指南</h3><span class="m-close">×</span></div>
    <div class="m-body tut-body">
      <ol class="tut-steps">
        ${TUTORIAL_STEPS.map(
          (s, i) => `
        <li class="tut-step">
          <div class="tut-cap"><b>${s.title}</b><span>${s.desc}</span></div>
          <img class="tut-img" src="${asset(`/tutorial/${s.img}`)}" alt="教程 ${i + 1}：${s.title}" loading="lazy" />
        </li>`,
        ).join('')}
      </ol>
    </div>
  `;
  mask.appendChild(modal);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
}
