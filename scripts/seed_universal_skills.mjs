/**
 * 全量灌入通用战法到 skills 表（199 条，implemented 或 skipped）
 * implemented：来自 SKILL_REGISTRY（name/type/range/triggerRate）＋分类 mechanism_tags
 * skipped：分类 missing_mechanics
 * 用法：npx tsx scripts/seed_universal_skills.mjs
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const classified = JSON.parse(readFileSync(join(__dirname, '_classified.json'), 'utf8'));

const conn = await mysql.createConnection({
  host: 'localhost',
  port: 3306,
  user: 'ybyt',
  password: '123456',
  database: 'stzb战斗系统',
});

const MECHANISM_TAGS = {
  // 通用机制标签（供查询复用）
  '一骑当千': 'damage', '三术奇谋': 'damage,debuff,multi_hit', '妖术': 'status', '伐谋': 'damage,debuff',
  '折戟强攻': 'damage,debuff', '掎角之势': 'damage,dual_damage', '敛众定气': 'heal,cleanse',
  '筹策绝道': 'damage,debuff', '落雷': 'damage,status', '迷阵': 'damage,status', '雄兵破敌': 'damage,debuff',
  '风声鹤唳': 'damage,dot', '危崖困军': 'damage,debuff', '叫阵': 'taunt,buff', '增援': 'heal',
  '声东击西': 'damage', '安抚军心': 'heal,cleanse', '斩铁': 'damage,status', '枪阵': 'damage,debuff',
  '水淹七军': 'damage,debuff', '破胆': 'damage,debuff', '破魂': 'damage,status', '箭岚': 'damage,debuff',
  '车悬': 'damage', '连战': 'buff',
  '伏兵': 'damage', '佯攻': 'status', '冲锋': 'damage,buff', '包扎': 'heal', '反计': 'status',
  '奔袭': 'damage', '截断': 'damage_boost', '拒盾': 'damage_reduce', '毒泉': 'dot', '游击': 'dot',
  '溃堤': 'damage,debuff', '火箭': 'damage,dot', '火辎': 'damage,dot', '狼烟': 'dot', '疑兵': 'status',
  '窃兵': 'damage,heal', '绝道': 'damage,debuff', '落石': 'damage,debuff', '规避': 'evasion',
  '设伏': 'damage', '迫近': 'damage_boost', '退避': 'damage_reduce', '陷阱': 'status', '雀伏': 'damage',
  '齐射': 'damage,debuff', '乱击': 'damage,debuff', '乱阵': 'damage_boost', '假途': 'damage_boost',
  '劫粮': 'damage_boost', '固阵': 'damage_reduce', '坚守': 'damage_reduce', '奋起': 'damage_boost',
  '威压': 'damage_boost', '强攻': 'damage,debuff', '急救': 'heal', '横扫': 'split', '犒劳': 'damage_boost',
  '诱敌': 'taunt,debuff', '谨言': 'damage_reduce', '顽抗': 'cleanse,damage', '飞虹': 'damage,debuff',
  '怯心夺志': 'pursuit,status', '钝兵挫锐': 'pursuit,status', '攻心': 'pursuit,heal', '破甲': 'pursuit,debuff',
  '攻其要害': 'pursuit', '追击': 'pursuit', '奇袭': 'pursuit', '浴血': 'pursuit,dot', '重伤': 'pursuit,debuff',
  '三军齐出': 'passive,split', '愈战愈勇': 'passive,damage_boost,stack', '擅兵不寡': 'passive,heal',
  '深谋远虑': 'passive,damage_boost,stack', '百战精兵': 'passive,attribute_buff', '坚守兵法': 'passive,attribute_buff',
  '强攻兵法': 'passive,attribute_buff', '速战兵法': 'passive,attribute_buff', '坚守突击': 'passive,attribute_buff',
  '成竹在胸': 'passive,attribute_buff', '文韬武略': 'passive,attribute_buff', '疾风突击': 'passive,attribute_buff',
  '运筹帷幄': 'passive,attribute_buff', '速战坚守': 'passive,attribute_buff', '铁壁': 'passive,damage_reduce',
  '击势': 'passive,damage_boost,ignore_def', '兵无常势': 'passive,heal,random_effect',
  '穷追猛打': 'command,combo', '激昂': 'passive,damage_boost',
  '疾击其后': 'pursuit,multi_hit', '扬威': 'pursuit,damage_boost',
  '无心恋战': 'command,damage_boost',
  '重整旗鼓': 'command,heal,rest', '援军秘策': 'command,heal,rest',
  '合流': 'heal', '三军之众': 'heal', '利兵谋胜': 'damage,heal',
  '养精蓄锐': 'heal,rest', '休整': 'heal,rest', '收拢': 'heal,rest',
  // ── 既有战法（数据库原有，补标签）──
  '步步为营': 'passive,heal', '青囊秘要': 'passive,heal',
  '先驱突击': 'command,combo', '共饮避世': 'command,damage_reduce', '大赏三军': 'command,damage_boost',
  '战必断金': 'command,cowardice', '措手不及': 'command,hesitation', '神兵天降': 'command,damage',
  '避其锋芒': 'command,damage_reduce', '长兵方阵': 'command,damage_boost',
  '了如指掌': 'active,damage', '凿穿': 'active,damage', '夹攻': 'active,damage',
  '奇术折冲': 'active,damage', '楚歌四起': 'active,dot', '洞察': 'active,insight',
  '浑水摸鱼': 'active,status', '焰焚箕轸': 'active,dot', '突进': 'active,damage',
  '温酒斩将': 'pursuit,damage',
};

/**
 * 机制键映射（skipped 战法 → 缺失机制稳定键，可多值，逗号分隔）
 * 与 docs/待补充机制清点.md 的 mechanism_key 保持一致。
 * 机制实现后：SELECT * FROM skills WHERE status='skipped' AND FIND_IN_SET('<键>', mechanism_key)
 */
const MECHANISM_KEY = {
  // 受击触发
  垒实迎击: 'on_attacked', 攻其不备: 'attacked_boost,on_attacked', 诱敌深入: 'counter',
  百战无怯: 'on_attacked,position_cond,on_deal_damage',
  空城: 'on_attacked', 疾风迅雷: 'on_attacked',
  // 兵种限定
  方圆: 'troop_type', 疏数: 'troop_type', 衡轭: 'troop_type', 锋矢: 'troop_type', 鱼鳞: 'troop_type',
  鹤翼: 'troop_type', 白刃: 'troop_type', 全军突击: 'troop_next', 飒沓如星: 'troop_next',
  // 反击
  反击: 'counter', 回马: 'counter', 健卒不殆: 'counter', 反击之策: 'counter',
  // 士气
  望风而降: 'morale_compare', 激水之疾: 'morale_compare', 蓄盈待竭: 'morale_compare', 胜负先征: 'morale_compare',
  及锋而试: 'morale_reduce',
  // 移除敌军有益
  看破: 'dispel_enemy', 索敌: 'dispel_enemy', 驱逐: 'dispel_enemy', 火积: 'dispel_enemy',
  // 距离+1
  远攻秘策: 'range_plus', 远攻之策: 'range_plus', 远攻奇略: 'range_plus', 远攻强化: 'range_plus',
  合纵连横: 'range_plus,faction_range',
  // 兵力
  亡命一搏: 'troop_ratio', 甚陷不惧: 'troop_ratio', 临危: 'troop_ratio', 死士突击: 'troop_ratio',
  // 特定回合起 / 恢复次数递增（重整旗鼓/援军秘策/三军之众/穷追猛打已入库）
  援军之策: 'round_from,pending_strategy_scale',
  胜敌益强: 'heal_count_growth',
  // 下一次攻击增减伤 / 下次结算
  文伐: 'next_damage,pending_strategy_scale', 闪击: 'next_damage',
  翕处还张: 'next_act', 道行险阻: 'next_act',
  // 追击多段
  乘胜追击: 'pursuit_multi', 势无虚动: 'pursuit_hook',
  // 特殊目标
  近攻: 'special_target', 远射: 'special_target', 连环: 'special_target', 兼弱攻昧: 'special_target',
  始计: 'special_target', 铁戟金戈: 'special_target',
  // 攻城
  云梯: 'siege_stat', 投石轰击: 'siege_stat', 毁墙: 'siege_stat',
  // 概率双效果 / 随机
  鸟云山兵: 'round_act_prob,round_prob_multi',
  万箭齐发: 'random_single', 十面埋伏: 'random_single',
  // 性别 / 阵营
  美人计: 'gender_cond',
  // 先手
  长驱直入: 'group_priority', 抢攻: 'active_priority', 先驱: 'priority_chance',
  // 主动伤害降低 / 叠加 hook
  反计之策: 'active_dmg_reduce', 乘间击隙: 'after_cast_stack', 久战熟谋: 'after_cast_stack',
  以直报怨: 'dmg_hook', 勠力同心: 'daying_hook',
  // 准备跳过
  胜兵求战: 'prep_skip', 谋定后动: 'prep_skip_buff',
  // 禁普攻 / 每回合策略攻击 / 试图发动前
  不攻: 'no_basic,per_round_strategy', 众谋不懈: 'before_cast',
  // 额外段
  觑隙: 'extra_hit',
  // 援护
  援护: 'cover_single', 移花接木: 'cover_group', 一夫当关: 'cover_front',
};

function qualityOf(name) {
  const c = classified.find((x) => x.name === name);
  return c ? c.quality : '';
}
function mechanismTags(name) {
  const c = classified.find((x) => x.name === name);
  return (c && c.status === 'implemented') ? (MECHANISM_TAGS[name] ?? '') : '';
}
function missingMechanics(name) {
  const c = classified.find((x) => x.name === name);
  return (c && c.status === 'skipped') ? (c.missingMechanics ?? '') : '';
}
function mechanismKey(name) {
  return (MECHANISM_KEY[name] ?? '');
}

const registryEntries = Object.entries(SKILL_REGISTRY);
const registryByName = new Map(registryEntries.map(([id, s]) => [s.name, id]));

const implementedRows = classified
  .filter((c) => c.status === 'implemented')
  .map((c) => {
    const id = registryByName.get(c.name);
    const skill = id ? SKILL_REGISTRY[id] : null;
    if (!skill) throw new Error(`implemented 战法「${c.name}」不在 SKILL_REGISTRY`);
    return {
      id,
      name: c.name,
      quality: c.quality,
      type: skill.type,
      skill_range: skill.range ?? c.range,
      trigger_rate: skill.triggerRate != null ? String(skill.triggerRate) : (c.triggerRate != null ? String(c.triggerRate) : null),
      target_desc: c.targetDesc,
      effect_desc: c.effectDesc,
      sources: c.sources,
      mechanism_tags: mechanismTags(c.name),
      status: 'implemented',
      missing_mechanics: '',
    };
  });

const skippedRows = classified
  .filter((c) => c.status === 'skipped')
  .map((c) => ({
    id: 'skip_' + c.name,
    name: c.name,
    quality: c.quality,
    type: c.type,
    skill_range: c.range,
    trigger_rate: c.triggerRate != null ? String(c.triggerRate) : null,
    target_desc: c.targetDesc,
    effect_desc: c.effectDesc,
    sources: c.sources,
    mechanism_tags: '',
    status: 'skipped',
    missing_mechanics: c.missingMechanics,
    mechanism_key: mechanismKey(c.name),
  }));

console.log(`implemented ${implementedRows.length} 条，skipped ${skippedRows.length} 条，共 ${implementedRows.length + skippedRows.length} 条`);

try {
  const [cols] = await conn.query(
    "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skills' AND COLUMN_NAME = 'mechanism_key'"
  );
  if (cols[0].c === 0) {
    await conn.query('ALTER TABLE skills ADD COLUMN mechanism_key VARCHAR(255) NOT NULL DEFAULT ""');
  }
  await conn.query('TRUNCATE TABLE skills');
  const sql =
    'INSERT INTO skills (id, name, quality, type, skill_range, trigger_rate, target_desc, effect_desc, sources, mechanism_tags, status, missing_mechanics, mechanism_key) VALUES ?';
  await conn.query(sql, [
    [...implementedRows, ...skippedRows].map((r) => [
      r.id, r.name, r.quality, r.type, r.skill_range, r.trigger_rate,
      r.target_desc, r.effect_desc, r.sources, r.mechanism_tags, r.status, r.missing_mechanics, r.mechanism_key ?? '',
    ]),
  ]);
  const [rows] = await conn.query(
    "SELECT status, COUNT(*) AS cnt FROM skills GROUP BY status"
  );
  console.log('灌入完成，按状态统计：');
  for (const r of rows) console.log(`  - ${r.status}: ${r.cnt}`);
  const [impl] = await conn.query('SELECT id, name, quality, type FROM skills WHERE status = "implemented" ORDER BY type, quality, name');
  console.log(`implemented 明细（${impl.length} 条）：`);
  for (const r of impl) console.log(`  - ${r.id}\t${r.name}\t${r.quality}\t${r.type}`);
} catch (e) {
  console.error('执行失败：', e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
