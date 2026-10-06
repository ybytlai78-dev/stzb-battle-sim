/**
 * AI 配将顾问 · 界面文案与「一行轨迹」
 * ---------------------------------------------------------------------------
 * 用户口径（2026-09-29）：**工具调用压成一行**，界面**尽量中文**、不要一堆英文标识符。
 * 于是：模型看到的函数名照旧（协议要求），**人看到的一律中文**；轨迹不再是「每步一行 + 轮次分隔」，
 * 而是一条随进度原地刷新的单行摘要。
 */

/** 工具 → 中文名（界面显示用；协议里的函数名不变） */
export const TOOL_ZH: Record<string, string> = {
  get_config: '读配置',
  validate_plan: '校验方案',
  simulate: '试跑',
  simulate_many: '批量对拍',
  optimize_skills: '搜战法',
  optimize_mates: '搜队友',
  optimize_both: '整体搜最优',
  search_hero: '查武将',
  hero_detail: '武将档案',
  search_skill: '查战法',
  list_skills: '战法清单',
  skill_detail: '战法详情',
  list_opponent_pool: '对手池',
  add_opponent_from_preset: '加入对手',
  remove_user_opponent: '移出对手',
  matchup_pool: '打对手池',
  compare_variants: '前后对比',
  optimize_winrate: '胜率搜索',
  // 常驻层（工具面分档，见设计文档 §16）：模型查目录 / 查参数 / 申请开档，界面上也要有中文
  tools_catalog: '查工具面',
  tools_help: '查工具用法',
  route_task: '申请开档',
};

export const toolZh = (name: string): string => TOOL_ZH[name] ?? name;

const n = (v: number): string => Math.round(v).toLocaleString('en-US');

export interface TraceStep {
  name: string;
  state: 'run' | 'ok' | 'err';
  battles?: number;
  ms?: number;
  cached?: boolean;
  error?: string;
  done?: number;
  total?: number;
  label?: string;
}

/** 一行轨迹：`⚙ 读配置 ✔ · 试跑 ✔ 20 场 · 搜战法 ⏳ 3,200/8,062（40%）` */
export class TraceLine {
  private steps: TraceStep[] = [];

  start(name: string): void {
    this.steps.push({ name, state: 'run' });
  }

  end(name: string, info: { battles?: number; ms?: number; cached?: boolean; error?: string } = {}): void {
    const step = [...this.steps].reverse().find((s) => s.name === name && s.state === 'run');
    if (!step) {
      this.steps.push({ name, state: info.error ? 'err' : 'ok', ...info });
      return;
    }
    step.state = info.error ? 'err' : 'ok';
    Object.assign(step, info);
  }

  progress(name: string, done: number, total: number, label?: string): void {
    const step = [...this.steps].reverse().find((s) => s.name === name && s.state === 'run');
    if (!step) return;
    step.done = done;
    step.total = total;
    if (label) step.label = label;
  }

  get count(): number {
    return this.steps.length;
  }

  /** 一行摘要 */
  text(): string {
    if (!this.steps.length) return '';
    return this.steps
      .map((s) => {
        const mark = s.state === 'run' ? '⏳' : s.state === 'err' ? '✘' : '✔';
        let tail = '';
        if (s.state === 'run' && s.done !== undefined && s.total) {
          tail = ` ${n(s.done)}/${n(s.total)}（${Math.round((s.done / s.total) * 100)}%）`;
        } else if (s.state === 'ok') {
          tail = s.cached ? '（用上次结果）' : s.battles ? ` ${n(s.battles)} 场` : '';
        } else if (s.state === 'err') {
          tail = ` ${s.error ?? '失败'}`;
        }
        return `${mark} ${toolZh(s.name)}${tail}`;
      })
      .join(' · ');
  }
}

/** 证据编号 → 中文短标（如 `ev-2-simulate` →「试跑②」）：卡片上不再出现英文编号 */
export function evidenceZh(id: string, seq?: Map<string, number>): string {
  const m = /^ev-(\d+)-(.+)$/.exec(id);
  if (!m) return id;
  const idx = Number(m[1]);
  const ordinal = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'][idx] ?? `第${idx}次`;
  void seq;
  return `${toolZh(m[2])}${ordinal}`;
}
