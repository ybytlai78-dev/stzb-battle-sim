/**
 * 把 2026-11-04 热更新的 12 件宝物（1124~1135，4 条线路 × 三阶）并入 `dateyuan/宝物数据.json`。
 *
 * 为什么需要本脚本：官网宝物库（`fetch_gear_data.mjs` 抓的 `gear_id.json`）仍是 114 件、不含这批，
 * 所以它们的字段只能从**客户端热更包 P0 表**取：
 *   - `tb_cfg_gear`（本轮 219 → 231 行）：id / 名 / 兵种 / 形制 / 阶 / 描述 / 来历 / 自带技能串
 *   - `tb_cfg_skill` + `tb_cfg_skill_detail`：词条与特技的官方文案与 `constant_param`（见开发文档）
 * 取证与换算口径：`docs/逆向对拍/宝物与曹仁加强取证-2026-11-04.md`。
 *
 * ⚠️ 已知缺口（不猜）：`forgeGroup` / `affixPool` 留空 —— 锻造词条池来自客户端的池表（非 `tb_cfg_gear_feature`，
 *    那是锻造特化），本轮未展开解析；生成器据此产出 `affixGroup: 0` + `affixPool: []`，UI 会显示「暂无锻造词条」。
 *
 * 幂等：已存在的 id 跳过；新条目**追加在末尾**（官网快照的原有顺序不动，避免整文件抖动）。用法 `node scripts/import_gear_20261104.mjs`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'dateyuan/宝物数据.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

/** 兵种（`tb_cfg_gear.gear_kind`）：1 剑 / 3 长兵 / 6 其他 */
const KIND_TYPE = { 1: '剑', 2: '刀', 3: '长兵', 4: '弓', 5: '扇', 6: '其他' };
/** 阶（`tb_cfg_gear.phase`）→ 官网品级 */
const PHASE_QUALITY = { 1: '精品', 2: '罕俦', 3: '稀世' };

/**
 * 词条 / 特技的官方文案（渲染后形态，取自 `tb_cfg_skill.desc` 把 `#effect_01#`、`@X@` 换成本次强化增量）。
 * 值 = 每次强化增量（`constant_param × calc_type[1]` 再按 effect 做单位换算，见取证文档 §2.3 / §4.2）。
 */
const SKILL_TEXT = {
  400017: { name: '破敌', desc: '造成的攻击伤害无视目标1.5%的防御属性' },
  400035: { name: '骁锐', desc: '攻击属性提高1.0%' },
  400001: { name: '骁锐', desc: '攻击属性提高2.5' },
  400016: { name: '不移', desc: '受攻击伤害降低1.0%' },
  400026: { name: '不移', desc: '受所有伤害降低1.0%' },
  400044: { name: '天资', desc: '谋略属性提高2.5' },
  400077: { name: '坚忍', desc: '受到的主动战法伤害降低1.0%' },
  400099: { name: '英才', desc: '攻击、谋略属性提高1.0' },
  400128: { name: '观星', desc: '自身首次发动主战法施加的犹豫效果有40.0%几率额外持续1回合' },
  400129: { name: '虎啸', desc: '行动时主战法每为自身提供30.0%的攻击伤害提升效果，本回合追击战法发动率提升1.0%' },
  400130: { name: '奋武', desc: '自身的普通攻击伤害提升效果大于250.0%时，普通攻击无视规避' },
  400131: { name: '穿影', desc: '自身每对敌军造成4次攻击伤害，下次行动前对3距离内敌军单体发动1次攻击（伤害率20.0%）' },
};

/** 12 件新宝物：`[id, 名, gear_type, phase, gear_kind, 自带技能串, 描述, 来历]`（P0 直采） */
const ROWS = [
  [1124, '粗铁钺', 14, 1, 3, '400017', '铁未尽炼，锋刃多缺。乡兵夜铸，虽不能断甲，击马足则骑者莫敢近。', '由宝物工匠打造而成'],
  [1125, '坚铁钺', 14, 2, 3, '400017|400035', '百炼成形，沉而不钝。郡国募勇士持之，阵前一挥，甲叶俱陷，悍卒见而辟易。', '由粗铁钺进阶而成'],
  [1126, '山君', 14, 3, 3, '400017|400035|400129', '取寒山玄铁，铸以虎脊之势。旧传猛士持此入阵，所向如山君下岭，三军闻名，未战先惊。', '由坚铁钺进阶而成'],
  [1127, '木栻盘', 13, 1, 6, '400016', '古人行军，先以木栻推辰候气，虽粗朴不饰，然占风定向，未尝失期。', '由宝物工匠打造而成'],
  [1128, '石栻盘', 13, 2, 6, '400016|400044', '吴中良工以丹漆饰栻，昼承日晷，夜应星躔；军中视之以决进退，故能涉险而不迷。', '由木栻盘进阶而成'],
  [1129, '天问', 13, 3, 6, '400016|400044|400128', '旧传禹王治水，常以玄玉为盘，记山川水势，问风候晴雨。后世军中沿用此制，用以辨方位、察地形、定行军路线，虽为器具，制作极精。', '由石栻盘进阶而成'],
  [1130, '短匕首', 15, 1, 1, '400077', '刃短不过掌，铁色黯然。军中卒伍常佩之，近身突刺，虽不能陷坚，亦足以断喉。', '由宝物工匠打造而成'],
  [1131, '雕纹匕首', 15, 2, 1, '400077|400099', '匕首之良者，镌兽纹于脊，淬青泉之水。吴越剑师谓之“袖里雷”，出鞘三寸，寒气先至，壮士莫敢逼视。', '由短匕首进阶而成'],
  [1132, '镂影', 15, 3, 1, '400077|400099|400131', '古有异匕，薄若秋霜，镂影其上，日照而纹不见，夜行则寒光自生。传言持之者可断甲缝、裂铁环，刺客得此，百步之内无人能察。', '由雕纹匕首进阶而成'],
  [1133, '粗铁戟', 16, 1, 3, '400001', '铁未尽炼，锋刃多缺。乡卒持以拒盗，虽不能穿甲，奋力一击，亦足使贼胆寒。', '由宝物工匠打造而成'],
  [1134, '坚铁戟', 16, 2, 3, '400001|400026', '百炼成形，刃坚而沉。郡国武吏尝以刺坚木，入尺有余，贼闻其名，未战先却。', '由粗铁戟进阶而成'],
  [1135, '奋髯', 16, 3, 3, '400001|400026|400130', '戟长而锋烈，挥之如怒蛟出水。旧传猛士奋髯持此，阵前连破重骑，所向之处，甲胄皆裂。', '由坚铁戟进阶而成'],
];

const CDN = 'https://g0.gph.netease.com/ngsocial/community/stzb/cn/gears';
let added = 0;
for (const [id, name, _gearType, phase, kind, skills, desc, obtain] of ROWS) {
  if (data.treasures.some((t) => t.id === id)) continue;
  const ids = skills.split('|');
  const texts = ids.map((sid) => {
    const row = SKILL_TEXT[sid];
    if (!row) throw new Error(`缺 skill 文案：${sid}`);
    return row;
  });
  data.treasures.push({
    id,
    name,
    quality: PHASE_QUALITY[phase],
    type: KIND_TYPE[kind],
    skillName: texts.map((t) => t.name).join('；'),
    skillDesc: texts.map((t) => t.desc).join('；'),
    policyName: '',
    policyDesc: '',
    obtain,
    condition: '武将等级达到20级',
    desc,
    // 锻造词条池：客户端池表本轮未解析 → 留 0 / 空（见文件头「已知缺口」）
    featureGroup: 0,
    affixPool: [],
    woodAdvance: 0,
    ironAdvance: 0,
    woodForge: 0,
    ironForge: 0,
    woodEnchant: 'yes',
    ironEnchant: 'yes',
    imageUrl: `${CDN}/watermark/gear_watermark_${id}.jpg?gameid=g10`,
    iconUrl: `${CDN}/gear_icon/gear_icon_${id}.jpg?gameid=g10`,
    image: `/gears/gear_${id}.jpg`,
    icon: `/gears/gear_${id}_s.jpg`,
    detailPage: `https://stzb.163.com/baowulist/${id}.html`,
    /** 数据来源标注：官网库暂无这 4 条线路 → 客户端热更 P0 表直采 */
    source: 'client-hot-20261104',
  });
  added += 1;
}

fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(`宝物数据：新增 ${added} 件，现有 ${data.treasures.length} 件`);
