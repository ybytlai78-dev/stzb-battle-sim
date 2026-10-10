/**
 * 声明（非官方身份 / 素材版权 / 使用限制 / 侵权处理）：把 `NOTICE.md` 的条款搬进页面。
 *
 * 两个入口（`web/main.ts` 接入）：
 *  - 底栏「声明」按钮（随时可查）
 *  - 首次进入自动弹一次（水位 `stzb_disclaimer_seen`）
 *
 * ⚠️ 口径必须与 `NOTICE.md`、`README.md` 顶部「声明」块保持一致（三处同步，见 `NOTICE.md` §八）：
 *    - 非官方：与网易公司及其关联方无关，未获授权；
 *    - 素材（名称 / 立绘 / 标识 / 战法文案 / 数值）版权归权利方，**不适用 MIT**，MIT 只覆盖自编代码；
 *    - 本站与仓库**确实包含**官方素材，仅用于功能演示，不得再分发 / 训练模型；
 *    - 严禁任何形式的盈利；权利人可通过 Issue 联系，收到通知立即下架。
 *
 * 视觉全部复用主站既有骨架与变量：`.modal-mask / .modal / .m-head / .m-close / .m-body`
 * （与公告栏、武将详情、教程、预设同一套）。
 */
import { SITE_VERSION } from './changelog';

/** localStorage 水位：声明**已展示**过（只在第一次进入时自动弹一次） */
export const DISCLAIMER_SEEN_KEY = 'stzb_disclaimer_seen';

/** 仓库与联系入口：权利人异议处理用（只写仓库根，不写死分支名，避免默认分支改名后失效） */
export const REPO_URL = 'https://github.com/ybytlai78-dev/stzb-battle-sim';
export const ISSUE_URL = `${REPO_URL}/issues`;

/** 声明正文（纯函数，便于直接断言） */
export function renderDisclaimerBody(): string {
  return `
    <p class="dp-lead">
      本页是玩家自制的<strong>非官方</strong>技术研究与学习作品，与<strong>网易公司及其关联方</strong>
      （《率土之滨》的开发与运营方，NetEase）<strong>没有任何关系</strong>，未获其授权、认可或赞助；
      它不是游戏客户端、私服或外挂，不提供任何游戏服务，也不冒充官方客户端。
    </p>

    <h4 class="dp-h">一、素材版权</h4>
    <ul class="dp-list">
      <li>《率土之滨》相关的名称、武将、立绘、标识、战法文案、数值与官方数据表等素材，版权归权利方所有。</li>
      <li>这些素材<strong>不适用本项目的 MIT 许可证</strong>；MIT 只覆盖本项目自己编写的代码。</li>
      <li>本站与仓库<strong>确实包含官方素材</strong>（武将立绘与小头像来自网易官方 CDN、官方「率」标识、由官方公开页面与其服务端 JSON 生成的数据与文案），它们仅服务于本项目的功能演示：
        请勿用于本项目以外的用途、请勿单独再分发，也请勿用于训练模型或构建数据集。</li>
    </ul>

    <h4 class="dp-h">二、使用限制</h4>
    <ul class="dp-list">
      <li>仅供学习交流与个人非商业使用；<strong>严禁任何形式的盈利</strong>：售卖本项目或整合包、付费下载或付费分发、收费服务器或收费代开，以及广告 / 打赏 / 会员 / 赞助等任何变现方式与其他商业用途。</li>
      <li>转载或分享请保留本声明与出处链接，不得移除、隐藏或篡改后再分发。</li>
    </ul>

    <h4 class="dp-h">三、权利人异议处理</h4>
    <ul class="dp-list">
      <li>权利人如认为本项目侵犯其权益，请到
        <a href="${ISSUE_URL}" target="_blank" rel="noopener noreferrer">GitHub Issues</a>
        联系并提供权利凭证；收到有效通知后我们会<strong>立即删除 / 下架</strong>相关内容 —— 仓库文件与线上站点一并处理，
        不拿「当前文件已删除」推诿（素材若已进入 git 历史，按权利人要求重写历史或整仓下架）。</li>
    </ul>

    <h4 class="dp-h">四、免责</h4>
    <ul class="dp-list">
      <li>本项目按「现状」提供，不提供任何担保；所有数值、公式与模拟结果都是研究性还原，<strong>不代表官方数据或官方口径</strong>，使用风险自负。</li>
    </ul>

    <p class="dp-foot">
      完整条款与素材清单见仓库根目录的 <strong>NOTICE.md</strong>（
      <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub 仓库</a>）；
      代码许可见 <strong>LICENSE</strong>（MIT）。
    </p>
  `;
}

/**
 * 读水位；存储不可用（隐私模式 / 原生壳异常）时返回 null，不抛错。
 * 注意：读不到 = 按「没看过」处理 → **宁可多提示一次，也不漏提示**（声明是防侵权的凭据）。
 */
function readSeen(): string | null {
  try {
    return localStorage.getItem(DISCLAIMER_SEEN_KEY);
  } catch {
    return null;
  }
}

/** 记下「声明已展示过」（打开弹窗时调用；`web/smoke.test.ts` 的 boot 也先调它，免得抢在别的弹窗前面） */
export function markDisclaimerSeen(): void {
  try {
    localStorage.setItem(DISCLAIMER_SEEN_KEY, SITE_VERSION);
  } catch {
    /* 存储不可用：记不住水位，本次浏览不受影响 */
  }
}

/** 本机是否已经看过声明（存储不可用 → 恒为 false，即每次进入都会提示一次） */
export function hasSeenDisclaimer(): boolean {
  return readSeen() !== null;
}

/**
 * 打开声明弹窗（× 或点遮罩空白处关闭，与主站其它弹窗同款）。
 * **打开即记账**（写水位）→ 之后不再自动弹，但底栏入口随时能再打开。
 */
export function openDisclaimerPanel(): void {
  document.querySelector('.disclaimer-mask')?.remove(); // 重复点不叠面板
  const mask = document.createElement('div');
  mask.className = 'modal-mask page-mask disclaimer-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal disclaimer-modal';
  modal.innerHTML = `
    <div class="m-head">
      <h3>声明<span class="dp-cur">非官方作品 · v${SITE_VERSION}</span></h3>
      <span class="m-close">×</span>
    </div>
    <div class="m-body dp-body">${renderDisclaimerBody()}</div>
  `;
  mask.appendChild(modal);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  markDisclaimerSeen();
}

/**
 * 首次进入自动弹一次声明（规则由 `web/disclaimer.test.ts` 锁定）：
 *  - 已经看过（本机水位）→ 什么都不做；
 *  - 公告弹窗正开着（新版本上线那一次）→ **让路**：本次不弹也**不记账**，下次进入再弹（不叠两个遮罩）；
 *  - 存储不可用 → 每次进入都会提示一次（记不住水位；宁可多提示，也不漏提示）。
 */
export function maybeAutoOpenDisclaimer(): void {
  if (hasSeenDisclaimer()) return;
  if (document.querySelector('.announcement-mask')) return;
  openDisclaimerPanel();
}
