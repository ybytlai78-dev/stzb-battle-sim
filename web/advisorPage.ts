/**
 * AI配将 · 独立页入口（`advisor.html`）
 * ---------------------------------------------------------------------------
 * 设计口径：`docs/AI配将-页面布局设计.md`（骨架 §9/§17，设置 §6，信息架构 §2）
 *
 * 分工：主站只留一个跳转入口；本页读 `stzb_team_current`（主站落盘的当前队伍）当上下文，
 * 方案写回同一把键，主站靠 `storage` 事件重读 —— 不 import `main.ts`，两页互不依赖。
 */
import './styles.css';
import './mobile.css';
import './advisor.css';
import { mountAdvisor } from './advisor/view';
import { createPageAdvisorHost } from './advisorHost';

export function mountAdvisorPage(root: HTMLElement): { destroy(): void } {
  const view = mountAdvisor(root, { host: createPageAdvisorHost() });
  return { destroy: () => view.destroy() };
}

if (typeof document !== 'undefined') {
  const el = document.getElementById('app');
  if (el) mountAdvisorPage(el);
}
