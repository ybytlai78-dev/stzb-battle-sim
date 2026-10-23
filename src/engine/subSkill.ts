import type { Skill } from './types';
// `CombatContext` 定义在 action.ts（types.ts 里没有）；action.ts 反过来 import 本文件，
// 故必须用 `import type` —— 编译后被完全擦除，不构成运行时循环依赖。
import type { CombatContext } from './action';

/**
 * 子战法归属 / 标注（连环计 · 河内世泽 等「链式战法」共用；光武中兴的 `combo_tag` 口径同理）。
 *
 * 背景（用户 2026-10-23 报障）：含子战法的战法（王允【连环计】、典藏【河内世泽】…）杀伤统计成 0。
 * 原因 —— 引擎把被引用的子战法（落雷 / 迷阵 / 伐谋 / 火辎…）的 events 记成**子战法自己的 skillId**，
 * 而战报的武将战法栏只有父战法那一格，`SkillStat` 的行对不上 → 数字落在一行看不见的战法上。
 *
 * 口径（与光武中兴一致，用户指定「参照刘秀的战报统计方式」）：
 *  - **归属**：事件 / 状态 / DoT 一律记**父战法**（`skillId` / `skillName` = 父），统计自然归到父战法一行；
 *  - **标识**：子战法名另存 `subSkill`，详情战报显示「河内世泽·火辎」而不是笼统的父战法名。
 */

/**
 * 被引用子战法 → **按父战法归属**的等价战法对象（只改 `id` / `name`）。
 *
 * `range` / `output` / `type` / `targetMode` 等一律沿用被引用战法：选敌距离与结算口径零变更。
 * 状态与 DoT 的 `sourceSkillId` 也随之记父战法 —— 否则火辎 / 毒泉这类 DoT 的后续跳伤
 * （发生在本步之后，事件窗口外）会继续落在子战法那一行，杀伤统计仍然漏。
 * @param parent 父战法（连环计 / 河内世泽）
 * @param ref 注册表里的被引用战法
 */
export function asSubSkillOf<T extends Skill>(parent: Skill, ref: T): T {
  return { ...ref, id: parent.id, name: parent.name };
}

/** 打标签的事件类型：与光武中兴同口径（伤害 / 分兵 / DoT 跳伤 / 恢复 / 状态） */
const LABELLED_EVENT_TYPES = new Set(['damage', 'split_damage', 'dot_tick', 'heal', 'status_inflicted']);

/**
 * 给「链式战法某一步」结算窗口内产生的事件打上子战法标签（同光武中兴 `combo_tag` 口径）。
 *
 * 只处理 `skillId === 父战法` 的事件 —— 窗口内其他战法（受击触发、追击、其它被动）的事件不动；
 * 已带 `subSkill` 的事件不覆盖（嵌套标注以最内层为准）。
 * 状态文案里的「【父战法】」同步替换为「【父战法·子战法】」，文本战报与网页战报同款可读。
 * @param ctx 战斗上下文
 * @param evStart 本步开始前的事件下标
 * @param parent 父战法
 * @param label 子战法名（落雷 / 火辎 …）
 */
export function labelSubSkillEvents(
  ctx: CombatContext,
  evStart: number,
  parent: Skill,
  label: string
): void {
  for (let i = evStart; i < ctx.events.length; i++) {
    const ev = ctx.events[i] as { type: string; skillId?: string; subSkill?: string; detail?: string };
    if (ev.subSkill || ev.skillId !== parent.id) continue;
    if (LABELLED_EVENT_TYPES.has(ev.type)) ev.subSkill = label;
    if (ev.type === 'status_inflicted' && typeof ev.detail === 'string') {
      ev.detail = ev.detail.split(`【${parent.name}】`).join(`【${parent.name}·${label}】`);
    }
  }
}
