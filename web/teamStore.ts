/**
 * 跨页队伍状态（主站 ⇄ AI配将独立页）
 * ---------------------------------------------------------------------------
 * 设计口径：`docs/AI配将-页面布局设计.md` §2（依赖共享）/ §13（跨页写回的风险与做法）。
 *
 * 主站每次 `refresh()` 落一份到 `stzb_team_current`；独立页读它当上下文，把方案写回同一把键；
 * 主站监听 `storage` 事件（另一个标签页写盘时触发）→ 重读 + 重渲染，
 * 避免出现"方案应用了、主站还显示旧队"。
 */
import { emptySlot, mutualConflict, type EditorState, type SlotState } from './teamEditor';
import { normalizePlan, type AdvisorPlan } from './advisor/types';
import { getHeroById } from './heroes';

export const TEAM_KEY = 'stzb_team_current';

/** 读主站落盘的队伍（没有 / 坏档 → null，调用方自己决定空态） */
export function readTeamState(): EditorState | null {
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<EditorState>;
    if (!Array.isArray(p.red) || !Array.isArray(p.blue)) return null;
    return { ...(p as EditorState), red: p.red as SlotState[], blue: p.blue as SlotState[] };
  } catch {
    return null;
  }
}

/** 写回（失败返回 false：隐私模式 / 配额满；调用方如实告知，不静默） */
export function writeTeamState(state: EditorState): boolean {
  try {
    localStorage.setItem(TEAM_KEY, JSON.stringify({ red: state.red, blue: state.blue }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 把方案写进某一队（**与 `web/advisorHost.ts` 同一套规则**：同名/SP 互斥、队内不重复、最多 2 个装配战法）。
 * 返回新的槽位数组 + 人话错误；不抛错。
 */
export function applyPlanToTeam(
  slots: SlotState[],
  plan: AdvisorPlan
): { ok: boolean; message?: string; slots: SlotState[] } {
  const next = slots.map((s) => ({ ...s, extraSkillIds: [...s.extraSkillIds], freePoints: { ...s.freePoints } }));
  const problems: string[] = [];
  const p = normalizePlan(plan);

  p.slots.forEach((slot, i) => {
    if (!slot.heroId || i > 2) return;
    const cur = next[i] ?? emptySlot();
    if (!getHeroById(slot.heroId)) {
      problems.push(`${slot.position}「${slot.heroId}」不在武将库里`);
      return;
    }
    if (cur.heroId !== slot.heroId) {
      /* 队内唯一（与主站 onPickHero 同口径）：同一武将在本队别的槽位 → **原槽让位**，不是报错。
         必须先让位再查互斥 —— 否则「把同一个武将挪到另一个槽」会被自己判成同名/SP 互斥。 */
      next.forEach((s, j) => {
        if (j !== i && s.heroId === slot.heroId) next[j] = emptySlot();
      });
      const rest = next.filter((_, j) => j !== i);
      const conflict = mutualConflict(rest, slot.heroId);
      if (conflict) {
        problems.push(`${slot.position}「${getHeroById(slot.heroId)?.name ?? slot.heroId}」与「${conflict}」互斥（同名/SP）`);
        return;
      }
      /* 换将：加点清零、兵种取本体（与主站 onPickHero 同口径） */
      next[i] = { ...emptySlot(), heroId: slot.heroId };
    }
    if (slot.level && next[i].level !== slot.level) next[i].level = slot.level;
    next[i].extraSkillIds = [...new Set(slot.skillIds)].slice(0, 2);
  });

  if (problems.length) return { ok: false, message: `部分未应用：${problems.join('；')}`, slots: next };
  return { ok: true, slots: next };
}
