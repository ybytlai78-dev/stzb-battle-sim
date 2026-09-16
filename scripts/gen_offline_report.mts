/**
 * 生成「下架武将清单」文档（含各自卡点）。
 * 用法：npx tsx scripts/gen_offline_report.mts
 * 产物：docs/下架武将清单.md
 *
 * 数据来源：
 *   - web/data/heroes.json        武将记录（DB 导出产物）
 *   - src/data/listing.ts         下架名单（成长率未确认）
 *   - src/data/skills.ts          SKILL_REGISTRY（主战法是否已实现）
 *   - docs/待补充机制清点.md       缺失机制分组（本脚本仅用关键词初筛，非权威判定）
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import heroesJson from '../web/data/heroes.json' with { type: 'json' };
import { SKILL_REGISTRY, type Skill } from '../src/data/skills';
import { OFFLINE_MAIN_SKILLS, OFFLINE_LEARNABLE_SKILLS, isHeroListed } from '../src/data/listing';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../docs/下架武将清单.md');

interface H {
  id: string;
  name: string;
  mainSkillId: string;
  mainSkillName: string;
  skillDesc: string;
  faction: string;
  troopType: string;
  rarity: string;
}

const heroes = heroesJson as unknown as H[];

/** 关键词 → 疑似缺失机制（初筛用，只提示方向，不当作权威判定） */
const HINTS: Array<[RegExp, string]> = [
  [/受到伤害后|受击|受到(攻击|策略攻击|伤害)时.*(几率|概率)|每受到\d*次?(伤害|攻击)/, '受击触发 on_attacked'],
  [/反击|对(伤害来源|攻击者)发动一次攻击/, '反击 counter'],
  [/攻击距离\s*\+?\s*1|攻击距离提升|有效距离\s*\+?\s*1/, '距离+1 range_plus'],
  [/士气(高昂|一般|低落)|士气.{0,4}(高于|低于|对比)/, '士气比较 morale_compare'],
  [/士气(降低|下降)|使其士气-|士气提升/, '士气调整 morale_reduce'],
  [/移除.{0,6}(有益|增益|正面)/, '移除敌军有益 dispel_enemy'],
  [/低于初始兵力|兵力(最低|最高|最多|最少|低于|高于|百分比)/, '兵力比例/条件 troop_ratio'],
  [/相邻的?敌军/, '相邻目标额外伤害 adjacent_damage'],
  [/每成功发动(普通攻击|普攻|主动|追击)|发动普通攻击、主动战法、追击战法后|成功发动普通攻击、主动及追击战法/, '发动后触发/叠层 after_cast_hook'],
  [/被成功施加(属性|效果)|施加属性(提升|下降)效果前/, '状态施加前触发 before_status_apply'],
  [/由[\u4e00-\u9fa5]{1,8}承担|承担/, '伤害承担/转移 damage_transfer'],
  [/发动率(降低|下降)|每发动一次，其发动率/, '发动率递减 rate_decay'],
  [/共计造成\d+次伤害|累计\d+次|总计\d+次/, '全队累计次数触发 team_count_trigger'],
  [/引发.{0,12}(妖术|燃烧|恐慌)|引爆/, 'DoT 引爆 dot_detonate'],
  [/(燃烧|恐慌|妖术诅咒)伤害提升|被施加的燃烧/, 'DoT 增伤 dot_boost'],
  [/(三次|两次|\d\s*次)(猛烈)?攻击|每次攻击目标独立/, '多段攻击 multi_hit'],
  [/每回合(降低|减少)\s*1\/\d/, '每回合递减 decay'],
  [/优先行动|优先出手/, '优先行动 priority'],
  [/主动.{0,6}发动率提升/, '主动战法发动率提升 active_rate_up'],
  [/对自身以外的随机|随机\d+名武将|若目标为友军/, '混合目标池 mixed_target_pool'],
  [/无视兵种相克/, '无视兵种相克 ignore_counter'],
  [/无视.{0,6}防御/, '无视防御 ignore_def'],
  [/吸取.{0,8}(防御|谋略|攻击|速度|属性)/, '属性吸取 attr_drain'],
  [/依次发动下列战法|发动下列战法/, '战法链 skill_chain'],
  [/随机选取.{0,10}(属性|之一)/, '随机属性选择 random_stat'],
  [/消耗\d+层|效果不足\d+层/, '层数消耗 stacks_consume'],
  [/控制效果.{0,20}额外/, '控制额外目标 control_extra'],
  [/除大营外|位于前锋|前锋或中军|中军\/前锋/, '位置条件 position_cond'],
  [/(防御|谋略|速度|攻击)(属性)?(最低|最高)/, '特殊目标选择 special_target'],
  [/攻城/, '攻城属性 siege_stat'],
  [/援护/, '援护 cover'],
  [/跳过.{0,4}准备/, '准备跳过 prep_skip'],
  [/女武将|女性武将/, '女武将组合 gender_cond'],
  [/从第\s*\d+(、\d+)*\s*回合开始|第\s*\d+\s*回合起/, '特定回合起生效 round_from'],
  [/每回合(开始|行动).{0,12}(叠加|层)/, '每回合叠层 act_layer'],
  [/无法恢复兵力|不能恢复兵力/, '禁疗/无法恢复'],
  [/恢复.{0,8}次(数)?/, '恢复次数递增 heal_count_growth'],
  [/下一次.{0,10}(伤害|攻击).{0,6}(提高|降低|大幅)|下\s*1\s*次/, '下一次攻击增减伤 next_damage'],
  [/大幅度(降低|提高)|大幅度地/, '含「大幅度」无数值（不编造，待调研）'],
];

/** 兵种英文 → 中文（站点显示用） */
const TROOP_CN: Record<string, string> = { cavalry: '骑', infantry: '步', archer: '弓' };

function hintMechanics(desc: string): string {
  if (!desc) return '无描述数据（需先调研）';
  if (/占位|示例/.test(desc)) return '占位描述（需先调研）';
  const hits = HINTS.filter(([re]) => re.test(desc)).map(([, label]) => label);
  return hits.length ? hits.join('；') : '关键词未命中（需人工判读）';
}

const skillName = (id: string): string => SKILL_REGISTRY[id]?.name ?? '';

const unimplemented: H[] = [];
const growthUnconfirmed: Array<{ h: H; reason: string }> = [];
const listed: H[] = [];

for (const h of heroes) {
  if (isHeroListed(h as { mainSkillId: string })) {
    listed.push(h);
    continue;
  }
  const id = h.mainSkillId;
  if (!id || !SKILL_REGISTRY[id]) unimplemented.push(h);
  else growthUnconfirmed.push({ h, reason: OFFLINE_MAIN_SKILLS[id] ?? '未登记原因' });
}

// 下架的可学习战法（listing 表里有、且引擎已定义）
const offlineLearnable = Object.entries(OFFLINE_LEARNABLE_SKILLS)
  .map(([id, reason]) => ({ id, name: skillName(id), reason, defined: Boolean(SKILL_REGISTRY[id]) }))
  .filter((x) => x.defined);

const today = new Date().toISOString().slice(0, 10);
const md: string[] = [];

md.push('# 下架武将 / 战法清单（含卡点）');
md.push('');
md.push(`> 生成时间：${today} ｜ 生成命令：\`npx tsx scripts/gen_offline_report.mts\``);
md.push('> 数据来源：`web/data/heroes.json`（DB 导出）+ `src/data/listing.ts`（下架名单）+ `src/data/skills.ts`（SKILL_REGISTRY）');
md.push('> 说明：**只含五星武将**。下架 = 出现在站点数据里、但被 `listing.ts` 挡在武将池 / 战法背包之外。');
md.push('');
md.push('## 总览');
md.push('');
md.push('| 口径 | 数量 |');
md.push('|---|---|');
md.push(`| 武将记录总数（五星） | ${heroes.length} |`);
md.push(`| 　上架（池中可见） | ${listed.length} |`);
md.push(`| 　下架合计 | ${unimplemented.length + growthUnconfirmed.length} |`);
md.push(`| 　　① 主战法未实现 | ${unimplemented.length} |`);
md.push(`| 　　② 受谋略成长率未确认 | ${growthUnconfirmed.length} |`);
md.push(`| 主战法定义（SKILL_REGISTRY） | ${Object.keys(SKILL_REGISTRY).length} |`);
md.push(`| 下架可学习战法 | ${offlineLearnable.length} |`);
md.push('');
md.push('---');
md.push('');
md.push(`## ① 主战法未实现（${unimplemented.length} 个）`);
md.push('');
md.push('卡点：引擎里没有该主战法的定义（或未挂槽）。需先实现战法机制，再走数据链上线。');
md.push('「疑似缺失机制」为**关键词初筛**（对照 `docs/待补充机制清点.md` 的 mechanism_key），仅供排期参考，实现时以调研文档为准。');
md.push('');
const hintMap = new Map(unimplemented.map((h) => [h.id, hintMechanics(h.skillDesc)]));
const mechCounts: Record<string, number> = {};
for (const v of hintMap.values()) {
  if (v.includes('未命中') || v.includes('无描述') || v.includes('占位')) continue;
  for (const m of v.split('；')) mechCounts[m] = (mechCounts[m] ?? 0) + 1;
}

md.push('| # | 武将 | id | 势力·兵种 | 主战法名 | 疑似缺失机制（初筛） |');
md.push('|---|---|---|---|---|---|');
unimplemented.forEach((h, i) => {
  const nm = h.mainSkillName && !/占位|示例/.test(h.mainSkillName) ? h.mainSkillName : '（无 / 占位）';
  md.push(`| ${i + 1} | ${h.name} | \`${h.id}\` | ${h.faction}·${TROOP_CN[h.troopType] ?? h.troopType} | ${nm} | ${hintMap.get(h.id)} |`);
});
md.push('');
md.push('### ① 类缺失机制分布（按受影响武将数排序，作排期依据）');
md.push('');
md.push('| 疑似缺失机制 | 武将数 |');
md.push('|---|---|');
Object.entries(mechCounts)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .forEach(([k, v]) => md.push(`| ${k} | ${v} |`));
md.push('');
md.push(`> 共 ${Object.keys(mechCounts).length} 类疑似机制、覆盖 ${Object.values(mechCounts).reduce((a, b) => a + b, 0)} 个武将条目（单武将可命中多机制，故合计 > 41）。`);
md.push('> 与 `docs/待补充机制清点.md`（通用战法口径）合并看：受击触发 / 特殊目标选择 / 距离+1 / 兵力条件 等为两处共同高需求。');
md.push('');
md.push('---');
md.push('');
md.push(`## ② 受谋略成长率未确认（${growthUnconfirmed.length} 个）`);
md.push('');
md.push('卡点：主战法**已实现**，但数值含「受谋略属性影响」而成长率未核实。按仓库规则不取基值不编造 → 暂不上架。');
md.push('核实成长率后，从 `src/data/listing.ts` 的 `OFFLINE_MAIN_SKILLS` 移除该条即可上线（无需改引擎）。');
md.push('');
md.push('| # | 武将 | id | 主战法 | 卡点（原文） |');
md.push('|---|---|---|---|---|');
growthUnconfirmed.forEach(({ h, reason }, i) => {
  md.push(`| ${i + 1} | ${h.name} | \`${h.id}\` | ${skillName(h.mainSkillId)} \`${h.mainSkillId}\` | ${reason} |`);
});
md.push('');
md.push('---');
md.push('');
md.push(`## ③ 下架的可学习战法（${offlineLearnable.length} 个）`);
md.push('');
md.push('卡点：描述含「受谋略」但成长率未确认（含取基值、惯例值）。核实后从 `OFFLINE_LEARNABLE_SKILLS` 移除即可进战法背包。');
md.push('');
md.push('| # | 战法 | id | 卡点（原文） |');
md.push('|---|---|---|---|');
offlineLearnable.forEach((x, i) => {
  md.push(`| ${i + 1} | ${x.name || '（未知）'} | \`${x.id}\` | ${x.reason} |`);
});
md.push('');
md.push('---');
md.push('');
md.push('## 解除下架的流程');
md.push('');
md.push('**② / ③ 类（只差数值）**');
md.push('1. 核实成长率（官方技能库 / 调研文档交叉验证），写入 `主战法` 的 `growthRate`；');
md.push('2. 从 `src/data/listing.ts` 对应表移除该条；');
md.push('3. `npx tsc --noEmit && npm test` 全绿；');
md.push('4. 部署：`bash scripts/deploy-gh-pages.sh`（武将池即时 +1）。');
md.push('');
md.push('**① 类（缺战法）**');
md.push('1. 按 `docs/待补充机制清点.md` 补引擎机制 → 实现战法（`src/data/skills.ts` 定义 + tags + 每战法 3 测试）；');
md.push('2. `node scripts/build_heroes_seed.mjs` → `node scripts/seed_db.mjs` → `node scripts/export_web_data.mjs`（挂 `main_skill_id`）；');
md.push('3. `npx tsc --noEmit && npm test` 全绿 → 部署。');
md.push('');
md.push('> 注意：`web/data/heroes.json` 由 DB 导出，DB 未重灌时导出会丢挂槽；MySQL 未启动时跳过第 2 步会保留现状。');
md.push('');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md.join('\n'), 'utf8');

console.log(`已生成 → ${OUT}`);
console.log(`上架 ${listed.length} ｜ ① 未实现 ${unimplemented.length} ｜ ② 成长未确认 ${growthUnconfirmed.length} ｜ ③ 下架战法 ${offlineLearnable.length}`);
