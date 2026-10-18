/**
 * 逐机制「包内冲突分类 × 引擎落点 × 伤害乘区」对照矩阵生成器
 *
 * 数据源：
 *  - 包内 `tb_cfg_skill_effect`（206 条）：`C:/Users/lai15/Desktop/rea_stzb/dec/json/tb_cfg_skill_effect.json`
 *    字段 effect_id / replace_type / name / tips
 *  - 引擎 `MECHANISM_DICT`（src/data/mechanisms.ts）：code / name / conflictType
 *  - 引擎状态语义：本文件 BASE 表（机制码 → StatusType / 乘区 / 引擎重挂行为）
 *
 * 输出：docs/包内冲突分类-逐机制对照.md
 *
 * 用法：npx tsx scripts/gen_conflict_matrix.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MECHANISM_DICT } from '../src/data/mechanisms';

const PKG = 'C:/Users/lai15/Desktop/rea_stzb/dec/json/tb_cfg_skill_effect.json';
const OUT = 'docs/包内冲突分类-逐机制对照.md';

const RULE: Record<number, string> = {
  0: '属性替换',
  1: '任何效果都不冲突',
  2: '效果不叠加·数值档',
  3: '效果不叠加·状态档',
};

/** 引擎落点 + 乘区 + 重挂行为 */
interface EngineCell {
  /** 引擎状态类型（或「非状态」说明） */
  engine: string;
  /** 伤害乘区落点 */
  pool: string;
  /** 引擎当前的重挂行为 */
  behavior: string;
  /** 与包内规则相比是否对齐 */
  verdict: '对齐' | '错位' | '部分';
}

const B = (engine: string, pool: string, behavior: string, verdict: EngineCell['verdict']): EngineCell => ({
  engine, pool, behavior, verdict,
});

/** 直接伤害 / 触发 / 标记类：不进状态冲突栈 */
const NONSTATUS = (pool = '—（非状态：直接伤害/触发/参数）') =>
  B('非状态', pool, '不进冲突判定', '对齐');

const BASE: Record<number, EngineCell> = {
  // ── 0xx 普攻/元参数 ────────────────────────────────────────────
  77: NONSTATUS('—（标记）'),
  79: NONSTATUS('—（模拟普攻）'),
  80: NONSTATUS('—（模拟普攻）'),
  81: NONSTATUS('—（合击）'),
  82: NONSTATUS('—（伤害率波动）'),
  83: NONSTATUS('—（伤害率波动）'),
  88: NONSTATUS('—（共用次数）'),
  98: B('damage_boost(taken·兵种)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  99: B('damage_boost(taken·兵种)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),

  // ── 1xx 属性/距离/上限 ─────────────────────────────────────────
  101: B('attack_buff', '攻击属性（属性段）', '同类型取较高 · 跨类型各自入栈', '错位'),
  102: B('defense_buff', '防御属性（防御段）', '同类型取较高 · 跨类型各自入栈', '错位'),
  103: B('strategy_buff', '谋略属性（谋略段）', '同类型取较高 · 跨类型各自入栈', '错位'),
  104: B('speed_buff', '速度（出手序，非伤害）', '同类型取较高 · 跨类型各自入栈', '错位'),
  105: B('—（不实装）', '—（攻城维度引擎无）', '—', '对齐'),
  106: B('attack_range_buff', '攻击距离（非伤害）', '同类型取较高', '错位'),
  107: B('max_troops_buff', '兵力上限（非乘区）', '同类型取较高', '错位'),
  111: NONSTATUS('—（额外参数）'),
  112: NONSTATUS('—（数值变化）'),
  113: B('morale_boost', '士气（→发动率，非伤害乘区）', '正负两侧都不冲突（逐实例相加）', '对齐'),
  114: B('morale_boost', '士气（→发动率，非伤害乘区）', '正负两侧都不冲突（逐实例相加）', '对齐'),
  115: NONSTATUS('—（战法等级）'),
  116: B('control_immune', '—（状态开关）', '同类型先施加者', '部分'),
  117: NONSTATUS('—（目标数）'),
  118: B('？未实现', '—（抵御）', '—', '错位'),
  120: NONSTATUS('—（目标限制）'),
  121: NONSTATUS('—（指挥免疫）'),
  122: NONSTATUS('—（子技能容器）'),
  123: NONSTATUS('—（子技能容器）'),
  125: NONSTATUS('—（傀儡）'),
  126: NONSTATUS('—（傀儡）'),
  127: B('damage_share', '受到乘区（分摊改判）', '同类型先施加者', '部分'),
  128: NONSTATUS('—（远攻）'),
  129: NONSTATUS('—（再次发动）'),
  130: NONSTATUS('—（再次发动）'),
  131: B('trigger_boost', '发动率（非伤害乘区）', '同类型取较高 · 跨类型累加', '错位'),
  132: NONSTATUS('—（解锁）'),
  133: NONSTATUS('—（替换效果）'),
  134: NONSTATUS('—（替换战法）'),
  141: B('trigger_boost', '发动率（非伤害乘区）', '同类型取较高 · 跨类型累加', '错位'),
  149: NONSTATUS('—（额外触发）'),
  150: NONSTATUS('—（触发效果）'),
  151: NONSTATUS('—（触发效果）'),
  152: NONSTATUS('—（移除效果）'),
  153: NONSTATUS('—（触发效果）'),
  161: B('break_def', '无视防御（属性段）', '同类型先施加者', '部分'),
  171: B('skill_range_buff', '战法距离（非伤害）', '同类型取较高', '错位'),
  181: B('skill_range_buff', '战法距离（非伤害）', '同类型取较高', '错位'),
  190: B('taunt(目标锁)', '—（选取）', '同类型先施加者', '部分'),
  193: B('taunt(目标锁)', '—（选取）', '同类型先施加者', '部分'),
  194: B('taunt(目标锁)', '—（选取）', '同类型先施加者', '部分'),
  199: B('？未实现', '—（幻化）', '—', '错位'),

  // ── 2xx ────────────────────────────────────────────────────────
  200: B('combo', '—（普攻次数）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  201: B('attack_buff', '攻击属性（属性段）', '同类型取较高 · 跨类型各自入栈', '错位'),
  202: B('defense_buff', '防御属性（防御段）', '同类型取较高 · 跨类型各自入栈', '错位'),
  203: B('strategy_buff', '谋略属性（谋略段）', '同类型取较高 · 跨类型各自入栈', '错位'),
  204: B('speed_buff', '速度（出手序，非伤害）', '同类型取较高 · 跨类型各自入栈', '错位'),
  205: B('—（不实装）', '—（攻城维度引擎无）', '—', '对齐'),
  206: B('attack_range_buff', '攻击距离（非伤害）', '同类型取较高', '错位'),
  207: B('heal_reduce', '恢复（不乘伤害）', '同类型取较高', '错位'),
  210: NONSTATUS('—（命名 flag）'),
  220: B('siege_blocked 免疫', '—（控制免疫）', '同类型先施加者', '部分'),
  225: B('damage_boost(taken·燃烧)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  231: B('trigger_boost', '发动率（非伤害乘区）', '同类型取较高 · 跨类型累加', '错位'),
  235: B('damage_boost(taken·燃烧)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  241: B('trigger_boost', '发动率（非伤害乘区）', '同类型取较高 · 跨类型累加', '错位'),
  251: B('damage_boost(caused·特殊)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  252: B('damage_boost(caused·特殊)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  261: B('damage_boost(taken·特殊)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  262: B('damage_boost(taken·特殊)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  271: B('heal_out_boost', '恢复（不乘伤害）', '同类型取较高 · 跨类型累加', '错位'),
  272: B('heal_out_boost', '恢复（不乘伤害）', '同类型取较高 · 跨类型累加', '错位'),
  281: B('heal_boost', '恢复（不乘伤害）', '同类型取较高 · 跨类型累加', '错位'),
  282: B('heal_boost', '恢复（不乘伤害）', '同类型取较高 · 跨类型累加', '错位'),

  // ── 3xx 直接伤害 / DoT / 战法类增伤 ────────────────────────────
  301: NONSTATUS('—（直接伤害）'),
  302: NONSTATUS('—（直接伤害）'),
  303: B('sorcery', 'DoT（挂上时冻结）', '同源刷新数值 · 跨类型各挂一条', '部分'),
  304: B('panic', 'DoT（挂上时冻结）', '同源刷新数值 · 跨类型各挂一条', '部分'),
  305: B('burning', 'DoT（挂上时冻结）', '同源刷新数值 · 跨类型各挂一条', '部分'),
  306: B('curse', 'DoT（挂上时冻结）', '同源刷新数值 · 跨类型各挂一条', '部分'),
  307: NONSTATUS('—（火攻：直接伤害）'),
  311: B('control_extend', '—（控制时长）', '同类型先施加者', '部分'),
  312: B('control_extend', '—（控制时长）', '同类型先施加者', '部分'),
  313: NONSTATUS('—（减少次数）'),
  321: B('damage_boost(caused·普攻)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  322: B('damage_boost(caused·主动)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  323: B('damage_boost(caused·被动)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  324: B('damage_boost(caused·指挥)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  325: B('damage_boost(caused·追击)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  331: B('damage_boost(caused·普攻)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  332: B('damage_boost(caused·主动)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  333: B('damage_boost(caused·被动)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  334: B('damage_boost(caused·指挥)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  335: B('damage_boost(caused·追击)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  341: B('damage_boost(taken·普攻)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  342: B('damage_boost(taken·主动)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  343: B('damage_boost(taken·被动)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  344: B('damage_boost(taken·指挥)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  345: B('damage_boost(taken·追击)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  351: B('damage_boost(taken·普攻)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  352: B('damage_boost(taken·主动)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  353: B('damage_boost(taken·被动)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  354: B('damage_boost(taken·指挥)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  355: B('damage_boost(taken·追击)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),

  // ── 4xx ────────────────────────────────────────────────────────
  401: B('first_aid', '恢复（不乘伤害）', '同类指挥互斥（先施加者） · 跨类型各挂一条', '错位'),
  402: B('rest', '恢复（不乘伤害）', '同类型取较高', '错位'),
  404: B('control_spread', '—（控制目标 +1）', '不冲突（消耗制）', '对齐'),
  405: NONSTATUS('—（时长 +1）'),
  406: NONSTATUS('—（次数 +1）'),
  407: B('damage_absorb', '受到乘区（吸收）', '同类型先施加者', '部分'),
  408: B('damage_release', '受到乘区（释放）', '同类型先施加者', '部分'),
  409: NONSTATUS('—（同心）'),
  411: B('damage_boost(taken·条件混乱)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  412: B('damage_boost(taken·条件犹豫)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  413: B('damage_boost(taken·条件暴走)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  414: B('damage_boost(taken·条件怯战)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  421: B('damage_boost(taken·条件混乱)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  422: B('damage_boost(taken·条件犹豫)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  423: B('damage_boost(taken·条件暴走)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  424: B('damage_boost(taken·条件怯战)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),

  // ── 5xx 控制 / 状态 / 增减伤 ───────────────────────────────────
  501: B('confusion', '—（控制）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  502: B('hesitation', '—（控制）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  503: B('rampage', '—（控制）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  504: B('cover', '—（援护改判）', '同类型先施加者', '部分'),
  505: B('taunt', '—（挑衅）', '同类型先施加者', '部分'),
  506: B('redirectAllyPhysical', '—（承担）', '同类型先施加者', '部分'),
  511: B('insight', '—（状态开关）', '同类型先施加者', '部分'),
  512: B('break_def', '无视防御（属性段）', '同类型先施加者', '部分'),
  513: B('soothe', '—（状态开关）', '同类型先施加者', '部分'),
  514: B('evasion', '—（规避）', '无差别互斥（先施加者，入口级）', '对齐'),
  515: B('ignore_evasion', '—（消耗制）', '只刷新不叠加', '对齐'),
  521: B('damage_boost(taken·攻击)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  522: B('damage_boost(taken·攻击)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  523: B('damage_boost(taken·策略)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  524: B('damage_boost(taken·策略)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  525: B('damage_boost(taken·友军)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  526: B('damage_boost(taken·友军)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  527: B('damage_boost(taken·友军)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  528: B('damage_boost(taken·友军)', '受到乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  531: B('damage_boost(caused·攻击)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  532: B('damage_boost(caused·攻击)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  533: B('damage_boost(caused·策略)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  534: B('damage_boost(caused·策略)', '造成乘区加算池', '同类型取较高 · 跨类型同池加算', '错位'),
  541: B('reflect', '受到乘区（反射）', '同类型先施加者', '部分'),
  542: B('lifesteal', '—（攻心）', '同类型先施加者', '部分'),
  543: B('priorityRounds', '—（出手序）', '同类型先施加者', '部分'),
  544: B('combo', '—（普攻次数）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  545: B('split', '分兵（不乘主乘区）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  546: NONSTATUS('—（株杀）'),
  551: B('counter', '—（反击）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  552: B('cowardice', '—（控制）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  553: B('no_retaliate', '—（状态开关）', '同类型先施加者', '部分'),
  561: B('priorityRounds', '—（出手序）', '同类型先施加者', '部分'),
  571: NONSTATUS('—（无视相克）'),
  581: B('jump_prep', '—（准备跳过）', '只刷新不叠加', '对齐'),
  582: B('jump_prep', '—（准备跳过）', '只刷新不叠加', '对齐'),
  583: NONSTATUS('—（准备延长）'),
  591: B('control_immune', '—（免疫）', '同类型先施加者', '部分'),
  592: B('control_immune', '—（免疫）', '同类型先施加者', '部分'),
  593: B('control_immune', '—（免疫）', '同类型先施加者', '部分'),
  594: B('control_immune', '—（免疫）', '同类型先施加者', '部分'),
  601: NONSTATUS('—（资源收益）'),
  602: NONSTATUS('—（资源收益）'),
  603: NONSTATUS('—（资源收益）'),
  604: NONSTATUS('—（资源收益）'),
  605: NONSTATUS('—（资源收益）'),
  607: NONSTATUS('—（经验收益）'),
  621: B('damage_reduce(弓兵)', '减伤池', '同类型取较高 · 跨类型同池加算', '错位'),
  622: B('damage_reduce(步兵)', '减伤池', '同类型取较高 · 跨类型同池加算', '错位'),
  623: B('damage_reduce(骑兵)', '减伤池', '同类型取较高 · 跨类型同池加算', '错位'),
  631: NONSTATUS('—（对 NPC 伤害）'),

  // ── 9xx ────────────────────────────────────────────────────────
  901: B('confusion(无法行动)', '—（控制）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  902: B('hesitation', '—（控制）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  903: B('rampage', '—（控制）', '同类型先施加者 · 跨类型各挂一条', '部分'),
  952: B('cowardice', '—（控制）', '同类型先施加者 · 跨类型各挂一条', '部分'),
};

/** 场景变体（7xx / 8xx）映射回主码：700→500、800→500 */
function baseCodeOf(code: number): number {
  if (code >= 700 && code < 800) return code - 200;
  if (code >= 800 && code < 900) return code - 300;
  return code;
}

interface Row {
  code: number;
  name: string;
  rule: number;
  cell: EngineCell;
}

function loadPkg(): Map<number, { name: string; tips: string }> {
  const raw = JSON.parse(readFileSync(PKG, 'utf8')) as {
    rows: Record<string, { effect_id: number; name: string; tips: string }>;
  };
  const m = new Map<number, { name: string; tips: string }>();
  for (const r of Object.values(raw.rows)) m.set(r.effect_id, { name: r.name, tips: r.tips });
  return m;
}

const pkg = loadPkg();
const rows: Row[] = MECHANISM_DICT.map((m) => {
  const cell = BASE[m.code] ?? BASE[baseCodeOf(m.code)] ?? B('？未登记', '—', '—', '错位');
  const p = pkg.get(m.code);
  const name = (m.name || p?.name || '(无名)').trim();
  return { code: m.code, name, rule: m.conflictType, cell };
});

// ── 汇总 ────────────────────────────────────────────────────────
// 后处理：① 增减伤池的重挂键带「过滤维」（damageKind / skillTypes / attackOnly …），
// 同类型同过滤维才取较高；② replace_type=2（不叠加·数值档）在「同类型内」其实已对齐，
// 只有跨战法类型会进同一加算池 → 判定降级为「部分」（错位留给 0 类：取较高 ≠ 替换）。
for (const r of rows) {
  if (r.cell.pool.includes('乘区加算池') || r.cell.pool === '减伤池') {
    r.cell = { ...r.cell, behavior: '同类型+同过滤维取较高 · 跨类型同池加算' };
  }
  if (r.rule === 2 && r.cell.verdict === '错位') r.cell = { ...r.cell, verdict: '部分' };
}

const byVerdict = new Map<string, number>();
const byPool = new Map<string, Map<string, number>>();
for (const r of rows) {
  byVerdict.set(r.cell.verdict, (byVerdict.get(r.cell.verdict) ?? 0) + 1);
  const pool = r.cell.pool;
  if (!byPool.has(pool)) byPool.set(pool, new Map());
  const m = byPool.get(pool)!;
  m.set(r.cell.verdict, (m.get(r.cell.verdict) ?? 0) + 1);
}

const DAMAGE_POOLS = ['造成乘区加算池', '受到乘区加算池', '减伤池'];

const lines: string[] = [];
lines.push('# 逐机制对照：包内冲突分类 × 引擎落点 × 伤害乘区');
lines.push('');
lines.push('> 生成器：`scripts/gen_conflict_matrix.mts`（数据源 `tb_cfg_skill_effect` 206 条 + `src/data/mechanisms.ts`）。');
lines.push('> 结论性说明见 `docs/包内冲突分类-审计.md`；本文件是**逐机制**明细（每一条机制自己的落点/乘区/重挂行为）。');
lines.push('> 判定口径：`对齐` = 引擎行为符合该 `replace_type` 语义；`部分` = 同类型符合、跨战法类型不符合；`错位` = 行为与该语义相反（如应替换却取较高/累加）。');
lines.push('');
lines.push('## 一、总览');
lines.push('');
lines.push(`- 机制总数 **${rows.length}**；判定分布：` +
  ['对齐', '部分', '错位'].map((k) => `${k} **${byVerdict.get(k) ?? 0}**`).join(' · ') + '。');
lines.push('');
lines.push('| 乘区落点 | 条数 | 对齐 | 部分 | 错位 |');
lines.push('|---|---|---|---|---|');
for (const [pool, m] of [...byPool.entries()].sort((a, b) => {
  const sum = (x: Map<string, number>) => [...x.values()].reduce((s, v) => s + v, 0);
  return sum(b[1]) - sum(a[1]);
})) {
  const sum = [...m.values()].reduce((s, v) => s + v, 0);
  lines.push(`| ${pool} | ${sum} | ${m.get('对齐') ?? 0} | ${m.get('部分') ?? 0} | ${m.get('错位') ?? 0} |`);
}
lines.push('');
const damageRows = rows.filter((r) => DAMAGE_POOLS.includes(r.cell.pool));
lines.push(`### 伤害乘区（造成/受到/减伤）共 **${damageRows.length}** 条机制`);
lines.push('');
lines.push('### 引擎冲突键的粒度（读表前必看）');
lines.push('');
lines.push('- 域：`sourceSkillType`（主动/指挥/被动/追击）——**跨战法类型一律各自入栈**；');
lines.push('- 同类型内：`damage_boost` / `damage_reduce` 再按「过滤维」细分（`damageKind` / `skillTypes` / `dotTypes` / `skillIds` / `attackOnly` / `charges`…，`sameDamageBoostFilter`），');
lines.push('  即【攻击伤害提高】与【主动战法伤害提高】是两条独立轨，互不取较高（用户 2026-09-16 口径）；');
lines.push('- `trigger_boost`（发动率/生效几率）在同类型内取较高、跨类型**逐条相加**（`action.ts:522` 注释）。');
lines.push('');
lines.push('这三池是伤害公式里**唯一的加算区**（`mult = clamp(1 + Σcaused + Σtaken − Σreduce, 0.1)`），');
lines.push('包内对它们全部标 `2`（效果不叠加·数值档）——即**同类只保留一份（取较高）**，引擎现状是');
lines.push('「同类型取较高、跨战法类型进同一池累加」。差异只在跨类型，量级 = 两条来源之和。');
lines.push('');
lines.push('## 二、逐机制明细（206 条）');
lines.push('');
lines.push('| 机制码 | 机制名 | replace_type | 规则 | 引擎落点 | 乘区 | 引擎重挂行为 | 判定 |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  lines.push(
    `| ${r.code} | ${r.name} | ${r.rule} | ${RULE[r.rule] ?? '?'} | ${r.cell.engine} | ${r.cell.pool} | ${r.cell.behavior} | ${r.cell.verdict} |`,
  );
}
lines.push('');
lines.push('## 三、待补（本表暴露的实现缺口）');
lines.push('');
lines.push('| 机制码 | 机制名 | 现状 |');
lines.push('|---|---|---|');
for (const r of rows.filter((x) => x.cell.engine.includes('未实现') || x.cell.engine.includes('未登记'))) {
  lines.push(`| ${r.code} | ${r.name} | ${r.cell.engine} |`);
}
lines.push('');

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`wrote ${OUT}: ${rows.length} rows`);
console.log([...byVerdict.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`damage-pool rows: ${damageRows.length}`);
