/**
 * 生成 `docs/下架武将清单.md`（官方数据版）
 *
 * 数据源：
 *   - scripts/skill_extra.json  网易战法库（642 条：类型/品质/距离/目标/满级/1级/官方效果标签）
 *   - web/data/heroes.json      武将记录（mainSkillId 空 = 主战法未实现）
 *   - src/data/listing.ts       下架名单（受谋略成长率未确认）
 *
 * 产出：下架武将分类 + 40 个待实现主战法的官方元数据与「所需机制」标定 + 缺失机制聚类（排期依据）。
 * 用法：npx tsx scripts/gen_offline_report.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p) => join(__dirname, '..', p);
const OUT = root('docs/下架武将清单.md');

/** 引擎机制清单：done = 已支持，missing = 待补。依据 src/engine/types.ts 与既有战法实现。 */
const MECHS = {
  // ── 已支持 ──
  physical_damage: ['攻击伤害输出', 'done'],
  strategy_damage: ['谋略伤害输出', 'done'],
  positional_damage: ['按站位选目标伤害', 'done'],
  dot: ['DoT（妖术/燃烧/恐慌）', 'done'],
  dot_detonate: ['DoT 引爆', 'done'],
  curse_ignite: ['妖术诅咒 / 引燃标记', 'done'],
  heal: ['恢复', 'done'],
  first_aid: ['持续型急救（受击触发恢复）', 'done'],
  rest: ['休整（每回合恢复）', 'done'],
  stats_buff: ['四维属性增减', 'done'],
  morale_boost: ['士气提高', 'done'],
  control: ['控制（混乱/暴走/怯战/犹豫）', 'done'],
  counter: ['反击（受普攻后回打）', 'done'],
  cover: ['援护', 'done'],
  taunt: ['挑衅', 'done'],
  evasion_insight: ['规避 / 洞察', 'done'],
  combo: ['连击', 'done'],
  split: ['分兵', 'done'],
  damage_boost: ['增伤/减伤（含来源过滤、charges、stacks）', 'done'],
  damage_reduce: ['减伤（受到伤害降低）', 'done'],
  decay: ['份额衰减（1/8、1/5）', 'done'],
  trigger_boost: ['发动率提升', 'done'],
  ignore: ['无视防御 / 无视兵种相克 / 无视规避', 'done'],
  on_hurt: ['受击触发钩子（含 strategy/basic 过滤、source/steal/victim 落点）', 'done'],
  on_heal: ['受恢复触发钩子', 'done'],
  ally_act: ['友军行动累计触发（二类指挥）', 'done'],
  round_repeat: ['一类指挥每回合重复判定', 'done'],
  delayed_output: ['延迟结算（第 N 回合）', 'done'],
  initial_output: ['准备阶段一次性效果', 'done'],
  battle_start_once: ['战斗开始一次性（标二类指挥）', 'done'],
  round_start_repeat: ['回合前再结算', 'done'],
  dynamic_rate: ['动态发动率（未生效累加）', 'done'],
  repeats: ['多段 / 独立重选目标', 'done'],
  chain: ['连锁发动（衰减概率）', 'done'],
  chance_group: ['概率组（独立发动率）', 'done'],
  move_to_apply: ['属性升降分桶与冲突规则', 'done'],
  ally_recipient: ['友军代打（recipient）', 'done'],
  troop_filter: ['兵种限定结算', 'done'],
  morale_rate: ['士气发动率系数', 'done'],
  round_window: ['回合窗口（startRound / endRound）', 'done'],
  act_layer: ['行动叠层触发', 'done'],
  stack_buff: ['伤害前叠层（属性）', 'done'],
  redirect_ally: ['承担友军伤害', 'done'],
  self_phys_boost: ['自身攻击伤害叠层', 'done'],
  priority_rounds: ['先手（仅指挥战法）', 'done'],
  mark_boost: ['标记型增伤（首次受击 / 攻击降低）', 'done'],
  skip_prep_bound: ['跳过准备（限二回合准备）', 'done'],
  before_active_hook: ['「试图发动主动战法时」触发（运筹决胜）', 'done'],
  after_first_active: ['本回合首次主动战法释放成功后触发（文德椒房）', 'done'],
  // ── 待补 ──
  after_cast_hook: ['发动后触发钩子（普攻/主动/追击后）', 'missing'],
  count_limit_team: ['全队累计次数触发', 'missing'],
  strategy_target_by_strategy: ['「谋略低于自身」的目标过滤', 'missing'],
  troop_ratio: ['兵力比例/阈值条件', 'missing'],
  insight_priority: ['先手/洞察等增益的随机获取', 'missing'],
  morale_compare: ['士气比较（目标士气 vs 自身）', 'missing'],
  morale_reduce: ['士气降低', 'missing'],
  position_cond: ['位置条件（前锋 / 中军 / 大营）', 'missing'],
  range_plus: ['攻击距离 +1', 'missing'],
  special_target: ['特殊目标选择（属性最高/最低、最近/最远）', 'missing'],
  attr_drain: ['属性吸取（主动战法版）', 'missing'],
  heal_on_damage: ['攻心（按造成伤害值恢复）', 'missing'],
  rate_decay: ['发动率递减（每次发动 −N%）', 'missing'],
  before_status_apply: ['施加属性升降「之前」判定', 'missing'],
  adjacent_damage: ['相邻目标额外伤害', 'missing'],
  cond_dot: ['条件 DoT（按兵力阈值触发）', 'missing'],
  mixed_target_pool: ['混合目标池（敌我同池）', 'missing'],
  skill_chain: ['战法链（依次发动其他战法）', 'missing'],
  stacks_consume: ['层数消耗（满 N 层消耗触发）', 'missing'],
  random_stat_pick: ['随机属性/状态选取', 'missing'],
  gender_cond: ['性别/女武将组合条件', 'missing'],
  repeat_cast: ['再次发动友军主动战法', 'missing'],
  highest_ally_strike: ['最高攻击/谋略友军代打', 'missing'],
  control_extra_target: ['控制额外目标', 'missing'],
  multi_delayed: ['多次延迟施加（第 1/3/5 回合分段）', 'missing'],
  decay_by_type: ['按伤害类型分别衰减', 'missing'],
  cond_reduce: ['条件减伤（敌方带某状态时）', 'missing'],
  count_limited: ['触发次数上限（共 N 次）', 'missing'],
  passive_priority: ['被动先手', 'missing'],
  active_on_hurt: ['主动战法的受击后续钩子', 'missing'],
  damage_sharing: ['伤害承担/转移（玉玺）', 'missing'],
  enemy_dot_boost: ['DoT 伤害提升', 'missing'],
};

/** 39 个待实现主战法的机制需求标定（依据官方 desc + effect 标签 + 引擎现状） */
const ASSESS = {
  '其徐如林': { need: ['strategy_damage', 'adjacent_damage'], note: '策略伤害对相邻敌军额外跳伤' },
  '遗志': { need: ['delayed_output', 'first_aid', 'counter', 'position_cond', 'troop_filter'], note: '官方「恢复极大量兵力」无数值，须先调研', research: true },
  '三军夺帅': { need: ['strategy_damage', 'stats_buff', 'after_cast_hook'], note: '需「发动普攻/主动/追击后触发」钩子' },
  '帝临回光': { need: ['dot', 'split', 'ignore', 'range_plus'], note: '自伤类 DoT 与自己分兵已有，缺攻击距离+1' },
  '举贤决机': { need: ['heal', 'strategy_damage', 'before_status_apply'], note: '需「施加属性升降之前」切面' },
  '僭号天子': { need: ['damage_sharing', 'strategy_damage', 'ignore'], note: '伤害由玉玺承担 + 回合结转，机制全新' },
  '威震河朔': { need: ['physical_damage', 'damage_boost', 'rate_decay'], note: '主动战法伤害提升可做，缺发动率递减' },
  '徽言龙凤': { need: ['morale_boost', 'damage_boost', 'physical_damage', 'strategy_damage', 'count_limit_team'], note: '需「全队累计 N 次伤害后触发」钩子' },
  '破凰': { need: ['strategy_damage', 'dot', 'dot_detonate', 'on_hurt', 'count_limited'], note: '引爆 + 受击引发妖术机制齐备，缺「最多生效 3 次」的次数上限' },
  '缚父临危': { need: ['physical_damage', 'repeats', 'ignore', 'special_target'], note: '缺多段之外的特殊目标选择' },
  '疮痍累身': { need: ['damage_reduce', 'decay_by_type', 'position_cond', 'on_hurt', 'stats_buff', 'cover'], note: '缺「按伤害类型分别 1/12 衰减」与位置条件' },
  '霸王渡江': { need: ['physical_damage', 'repeats', 'control', 'rate_decay'], note: '缺发动率逐次递增' },
  '全主诿异': { need: ['enemy_dot_boost', 'strategy_damage'], note: '缺「被施加的 DoT 伤害提升」' },
  '令明负榇': { need: ['round_repeat', 'damage_boost', 'split', 'delayed_output', 'troop_filter'], note: '✅ 机制齐备：前 3 回合每回合叠增伤 + 第 4 回合起分兵' },
  '人公将军': { need: ['stats_buff', 'counter', 'damage_reduce', 'position_cond', 'cond_reduce'], note: '缺位置条件与条件减伤' },
  '侵掠如火': { need: ['passive_priority', 'trigger_boost', 'chance_group', 'damage_boost'], note: '缺被动先手（先手现仅指挥战法）' },
  '潜谋远计': { need: ['on_hurt', 'first_aid', 'stats_buff', 'round_window', 'position_cond', 'strategy_target_by_strategy'], note: '缺位置条件与「谋略低于自身」过滤' },
  '率尔方雅': { need: ['mixed_target_pool', 'physical_damage', 'strategy_damage', 'damage_boost', 'control'], note: '缺敌我同池随机 3 目标' },
  '酒池肉林': { need: ['damage_reduce', 'damage_boost', 'heal_on_damage', 'round_window'], note: '缺攻心；「大幅度降低」无数值', research: true },
  '四世三公': { need: ['ally_recipient', 'physical_damage', 'special_target'], note: '缺「攻击最高 → 防御最低」目标选择' },
  '计定山越': { need: ['dot', 'move_to_apply', 'heal', 'morale_compare'], note: '缺士气比较分支' },
  '谋谟帷幄': { need: ['strategy_damage', 'before_active_hook', 'troop_ratio'], note: '「试图发动主动战法时」有先例（运筹决胜），缺兵力比例条件' },
  '西陵克晋': { need: ['highest_ally_strike', 'physical_damage', 'strategy_damage', 'heal'], note: '缺「最高攻击/谋略武将代打」' },
  '忠克猛烈': { need: ['ignore', 'physical_damage', 'control', 'active_on_hurt'], note: '缺主动战法施放后的目标受击连锁（最多 2 次）' },
  '迟智难酬': { need: ['strategy_damage', 'damage_reduce'], note: '「大幅降低」无数值，须先调研', research: true },
  '奉令护蜀': { need: ['ally_act', 'damage_boost', 'damage_reduce', 'charges'], note: '缺被动形态的友军行动钩子（现有仅二类指挥）' },
  '伏波扬砂': { need: ['damage_boost', 'combo', 'stacks_consume'], note: '缺层数消耗触发连击' },
  '心战为上': { need: ['morale_reduce', 'heal_on_damage'], note: '缺士气降低与攻心' },
  '赐剑长驱': { need: ['repeat_cast', 'skip_prep_bound', 'control'], note: '缺「友军首次主动战法后 40% 再次发动」' },
  '持玺兴兵': { need: ['on_hurt', 'heal', 'stats_buff', 'troop_ratio', 'count_limited'], note: '缺兵力阈值与总次数上限' },
  '巧音唤蝶': { need: ['strategy_damage', 'cond_dot', 'heal', 'rest', 'troop_ratio'], note: '缺按兵力阈值的条件 DoT' },
  '鸾凤和鸣': { need: ['after_first_active', 'heal', 'control_extra_target'], note: '缺控制额外目标' },
  '地公将军': { need: ['strategy_damage', 'attr_drain', 'stats_buff', 'curse_ignite'], note: '属性吸取可参照黄天余音；「妖术存在则额外附加自身」为条件分支' },
  '连环计': { need: ['skill_chain', 'control', 'strategy_damage', 'stats_buff'], note: '缺战法链' },
  '举抑臧否': { need: ['random_stat_pick', 'stats_buff', 'control', 'insight_priority'], note: '缺随机属性选取与随机增益获取' },
  '辞后定朝': { need: ['move_to_apply', 'gender_cond', 'insight_priority'], note: '缺「移除友方指挥/主动/追击带来的状态」与性别分支' },
  '怀橘遗亲': { need: ['stats_buff', 'position_cond', 'round_start_repeat'], note: '缺大营/非大营位置条件' },
  '匠心不竭': { need: ['dot', 'ignore', 'multi_delayed'], note: '缺第 1/3/5 回合分段施加（delayedOutput 仅单次）' },
};

const heroes = JSON.parse(readFileSync(root('web/data/heroes.json'), 'utf8'));
const official = JSON.parse(readFileSync(root('scripts/skill_extra.json'), 'utf8'));
const byName = {};
for (const s of official) byName[s.name] = s;

const listing = await import('../src/data/listing.ts');
const OFFLINE_MAIN_SKILLS = listing.OFFLINE_MAIN_SKILLS;
const OFFLINE_LEARNABLE_SKILLS = listing.OFFLINE_LEARNABLE_SKILLS;
const isHeroListed = listing.isHeroListed;

const listed = heroes.filter((h) => isHeroListed(h));
const pending = heroes.filter((h) => !h.mainSkillId);
const growthBlocked = heroes.filter((h) => h.mainSkillId && OFFLINE_MAIN_SKILLS[h.mainSkillId]);

const mechLabel = (k) => MECHS[k]?.[0] ?? k;
const mechState = (k) => MECHS[k]?.[1] ?? 'missing';

function verdict(need, research) {
  const miss = need.filter((k) => mechState(k) === 'missing');
  if (research) return { tag: '❓ 需先调研', miss };
  if (miss.length === 0) return { tag: '✅ 立即可做', miss };
  if (miss.length === 1) return { tag: '⚠️ 补 1 个机制', miss };
  return { tag: `❌ 需补 ${miss.length} 个机制`, miss };
}

const TROOP_CN = { cavalry: '骑', infantry: '步', archer: '弓' };
const today = new Date().toISOString().slice(0, 10);

const rows = pending.map((h) => {
  const s = byName[h.mainSkillName];
  const a = ASSESS[h.mainSkillName];
  const need = a?.need ?? [];
  const v = a ? verdict(need, a.research) : { tag: '❓ 需先调研', miss: [] };
  return { h, s, a, need, v };
});

const md = [];
md.push('# 下架武将 / 战法清单（官方数据版）');
md.push('');
md.push(`> 生成时间：${today} ｜ 生成命令：\`npx tsx scripts/gen_offline_report.mts\``);
md.push('> 数据来源：\`scripts/skill_extra.json\`（网易战法库 642 条）+ \`web/data/heroes.json\` + \`src/data/listing.ts\`');
md.push('> 术语：率土两种伤害类型 —— **攻击伤害**、**谋略伤害**（本文档已统一，旧「兵刃/物理」表述全部废止）');
md.push('');
md.push('## 总览');
md.push('');
md.push('| 口径 | 数量 |');
md.push('|---|---|');
md.push(`| 武将记录（五星） | ${heroes.length} |`);
md.push(`| 上架（池中可玩） | ${listed.length} |`);
md.push(`| **主战法未实现** | **${pending.length}** |`);
md.push(`| 主战法已实现但因成长率未确认下架 | ${growthBlocked.length} |`);
md.push(`| 下架的可学习战法 | ${Object.keys(OFFLINE_LEARNABLE_SKILLS).length} |`);
md.push('');
const ready = rows.filter((r) => r.v.tag.startsWith('✅'));
const one = rows.filter((r) => r.v.tag.startsWith('⚠️'));
const many = rows.filter((r) => r.v.tag.startsWith('❌'));
const research = rows.filter((r) => r.v.tag.startsWith('❓'));
md.push(
  `**待实现主战法分档**：立即可做 **${ready.length}** ｜ 补 1 个机制 **${one.length}** ｜ 需补多个机制 **${many.length}** ｜ 需先调研 **${research.length}**`
);
md.push('');
md.push('---');
md.push('');
md.push(`## 一、待实现主战法（${pending.length} 个）`);
md.push('');
md.push('| # | 武将 | 战法 | 类型/品质 | 距离 | 目标 | 官方效果 | 结论 |');
md.push('|---|---|---|---|---|---|---|---|');
rows.forEach((r, i) => {
  const s = r.s;
  const c = s ? `${s.type}/${s.zfQuality}` : '—';
  md.push(
    `| ${i + 1} | ${r.h.name} | **${r.h.mainSkillName}** | ${c} | ${s?.distance ?? '—'} | ${s?.targetShow ?? '—'} | ${s?.effect ?? '（无官方数据）'} | ${r.v.tag} |`
  );
});
md.push('');
md.push('### 1.1 立即可做（现有机制齐备）');
md.push('');
if (ready.length === 0) md.push('（无）');
for (const r of ready) {
  md.push(`- **${r.h.mainSkillName}**（${r.h.name}）：${r.a.note}`);
  md.push(`  - 所需机制：${r.need.map((k) => MECHS[k][0]).join('、')}`);
}
md.push('');
md.push('### 1.2 补 1 个机制即可做');
md.push('');
for (const r of one) {
  md.push(`- **${r.h.mainSkillName}**（${r.h.name}）→ 缺：**${r.v.miss.map(mechLabel).join('、')}**`);
  md.push(`  - ${r.a.note}`);
}
md.push('');
md.push('### 1.3 需补多个机制');
md.push('');
for (const r of many) {
  md.push(`- **${r.h.mainSkillName}**（${r.h.name}）→ 缺：${r.v.miss.map(mechLabel).join('、')}`);
  md.push(`  - ${r.a.note}`);
}
md.push('');
md.push('### 1.4 需先调研');
md.push('');
for (const r of research) {
  md.push(`- **${r.h.mainSkillName}**（${r.h.name}）：${r.a ? r.a.note : 'skill_extra.json 无此战法数据（含占位/空槽），需先抓官方数据'}`);
}
md.push('');
md.push('---');
md.push('');
md.push('## 二、缺失机制聚类（排期依据：补 1 个机制解锁几个战法）');
md.push('');
const unlock = {};
for (const r of rows) {
  for (const k of r.v.miss) {
    (unlock[k] ??= []).push(r.h.mainSkillName);
  }
}
md.push('| 缺失机制 | 解锁战法数 | 战法 |');
md.push('|---|---|---|');
Object.entries(unlock)
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([k, list]) => {
    md.push(`| **${mechLabel(k)}** \`${k}\` | ${list.length} | ${list.join('、')} |`);
  });
md.push('');
md.push('> 建议顺序 = 解锁数降序；同数时优先实现成本低的（属性/状态类 < 目标选择类 < 全新钩子类）。');
md.push('');
md.push('---');
md.push('');
md.push(`## 三、主战法已实现但因成长率未确认下架（${growthBlocked.length} 个）`);
md.push('');
md.push('卡点：数值含「受谋略/受攻击/受速度影响」而成长率未核实。按仓库规则不取基值不编造 → 暂不上架。');
md.push('核实后从 `src/data/listing.ts` 的 `OFFLINE_MAIN_SKILLS` 移除该条即可上线（无需改引擎）。');
md.push('');
md.push('| # | 武将 | 主战法 | 卡点 |');
md.push('|---|---|---|---|');
growthBlocked.forEach((h, i) => {
  md.push(`| ${i + 1} | ${h.name} | ${h.mainSkillName} | ${OFFLINE_MAIN_SKILLS[h.mainSkillId]} |`);
});
md.push('');
md.push('---');
md.push('');
md.push(`## 四、下架的可学习战法（${Object.keys(OFFLINE_LEARNABLE_SKILLS).length} 个）`);
md.push('');
md.push('| # | 战法 | ID | 卡点 |');
md.push('|---|---|---|---|');
Object.entries(OFFLINE_LEARNABLE_SKILLS).forEach(([id, reason], i) => {
  const s = byName[Object.keys(byName).find((n) => n === id)] ?? null;
  md.push(`| ${i + 1} | ${s?.name ?? '—'} | \`${id}\` | ${reason} |`);
});
md.push('');
md.push('---');
md.push('');
md.push('## 五、上线流程');
md.push('');
md.push('**主战法实现（每个战法一次提交）**');
md.push('1. `src/data/skills.ts` 加定义（tags 齐备）+ `scripts/build_heroes_seed.mjs` 的 `SKILL_ID_BY_NAME` 加映射；');
md.push('2. `node scripts/build_heroes_seed.mjs` → `node scripts/seed_db.mjs` → `node scripts/export_web_data.mjs`；');
md.push('3. `node scripts/gen_skill_data.mjs`（补品级/描述，缺则 `web/dataIntegrity.test.ts` 失败）；');
md.push('4. 写 `tests/main_skills_bN.test.ts`（每战法 3 测试）→ `npx tsc --noEmit` + `npm test`；');
md.push('5. 提交；上线另跑 `bash scripts/deploy-gh-pages.sh`。');
md.push('');
md.push('**成长率核实（②/③/四类）**：核实数值 → 从 `listing.ts` 移除该条 → 跑测试 → 提交。');
md.push('');
md.push('> MySQL 不可用时，可用 `node scripts/sync_hero_mainskill.mjs <heroId> <skillId>` 等效同步导出产物。');
md.push('');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md.join('\n'), 'utf8');
console.log(
  `已生成 → ${OUT}\n待实现 ${pending.length}｜立即可做 ${ready.length}｜补1个 ${one.length}｜需多个 ${many.length}｜需调研 ${research.length}｜缺失机制 ${Object.keys(unlock).length} 类`
);
