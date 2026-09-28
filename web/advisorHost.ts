/**
 * AI 顾问 · 主站宿主适配（**主站侧胶水**，不属于 `web/advisor/*` 核心）
 * ---------------------------------------------------------------------------
 * 核心模块不认识主站；主站通过这两个函数把「红队三槽」交出去、把「方案写回配将区」收回来。
 * 这样 `web/advisor/*` 不 import `main.ts`（避免循环依赖），也便于单测。
 */
import { DEFAULT_DUMMY, PLAN_POSITIONS, normalizePlan, type AdvisorPlan } from './advisor/types';
import type { EditorHandlers, SlotState } from './teamEditor';

/** 应用方案时需要的主站能力（只取用到的那几个 handler） */
export type HostHandlers = Pick<EditorHandlers, 'onPickHero' | 'onAddSkill' | 'onRemoveSkill' | 'onSetLevel'>;

export interface AdvisorHostDeps {
  /** 读当前配将区那一队（红队 = 我方） */
  getTeam(): SlotState[];
  handlers: HostHandlers;
  /** 改完状态后重渲染（`main.ts` 的 refresh） */
  refresh(): void;
  /** 提示文案（`main.ts` 的 showNotice；缺省静默） */
  notify?(msg: string): void;
  team?: 'red' | 'blue';
}

export interface AdvisorHost {
  /** 配将区 → 顾问方案（空槽不返回；`coreUnitIds` 留空 = 让 L2 自动识别核心将） */
  readTeam(): AdvisorPlan;
  /** 方案 → 配将区：逐槽换将 / 改等级 / 重设可学战法；失败**如实回报**（不静默半应用） */
  applyPlan(plan: AdvisorPlan): { ok: boolean; message?: string };
  /** 队伍标签（抽屉标题用） */
  teamLabel: string;
}

export function createAdvisorHost(deps: AdvisorHostDeps): AdvisorHost {
  const team = deps.team ?? 'red';
  const teamLabel = team === 'red' ? '红队（我方）' : '蓝队（敌方）';

  return {
    teamLabel,

    readTeam(): AdvisorPlan {
      const slots = deps
        .getTeam()
        .map((s, i) => ({
          position: PLAN_POSITIONS[i] ?? '中军',
          heroId: s.heroId ?? '',
          level: s.level,
          skillIds: [...s.extraSkillIds],
        }))
        .filter((s) => Boolean(s.heroId));
      return { slots, coreUnitIds: [], dummy: { ...DEFAULT_DUMMY } };
    },

    applyPlan(plan: AdvisorPlan): { ok: boolean; message?: string } {
      const p = normalizePlan(plan);
      const problems: string[] = [];
      p.slots.forEach((slot, i) => {
        if (!slot.heroId || i > 2) return;
        const before = deps.getTeam()[i]?.heroId ?? null;
        if (before !== slot.heroId) {
          deps.handlers.onPickHero(team, i, slot.heroId);
          // onPickHero 可能被互斥 / 重复上阵拦下 → 检查是否真的写进去了
          if ((deps.getTeam()[i]?.heroId ?? null) !== slot.heroId) {
            problems.push(`${slot.position}「${slot.heroId}」没能上阵（互斥 / 重复上阵 / 不在库）`);
            return;
          }
        }
        if (slot.level && deps.getTeam()[i].level !== slot.level) deps.handlers.onSetLevel(team, i, slot.level);
        const cur = deps.getTeam()[i];
        for (const id of [...cur.extraSkillIds]) deps.handlers.onRemoveSkill(team, i, id);
        for (const id of slot.skillIds) deps.handlers.onAddSkill(team, i, id);
      });
      deps.refresh();
      if (problems.length) {
        const message = `部分未应用：${problems.join('；')}`;
        deps.notify?.(message);
        return { ok: false, message };
      }
      deps.notify?.('已把方案写入配将区（红队）');
      return { ok: true };
    },
  };
}
