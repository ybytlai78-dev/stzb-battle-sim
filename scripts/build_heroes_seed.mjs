/**
 * 从 dateyuan/hero_growth_verified.json 生成全量 seed_heroes.sql
 * 运行：node scripts/build_heroes_seed.mjs
 *
 * 转换规则：
 *  - 兵种：弓→archer / 步→infantry / 骑→cavalry
 *  - rarity：cost>=2.5 → 5星，cost<2.5 → 4星
 *  - id：现有 8 个武将用固定拼音映射（测试引用）；SP姜维 → sp_jiangwei / XP姜维 → xp_jiangwei；其余 h<hero_id>
 *  - mutual_exclusion_group：**白名单制** —— 仅 赵云↔SP赵云、姜维↔SP姜维 不可同队；
 *    其余同名武将（关羽蜀/魏、司马懿魏/晋、吕布汉/群 …）一律可同队，XP 卡不入互斥组（用户 2026-09-16 口径）
 *  - tags：SP 前缀 → 'sp'；其余空
 *  - main_skill_id：中文名命中 SKILL_REGISTRY 的实现战法 → 对应 ID；否则留空（名称/描述仍入库）
 *  - 跳过：冯嫽 / 裴秀（无英雄 id、无战法、无势力，数据不完整）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const heroes = JSON.parse(readFileSync(join(__dirname, '../dateyuan/hero_growth_verified.json'), 'utf8'));

const TROOP_MAP = { 弓: 'archer', 步: 'infantry', 骑: 'cavalry' };
/** 数据不完整需跳过的武将（冯嫽 / 裴秀 已于 2026-09-16 从官网补齐势力/战法数据，移出本表） */
const SKIP = new Set();

/** 已实现的武将主战法（SKILL_REGISTRY 中存在）：中文名 → ID */
const SKILL_ID_BY_NAME = {
  方阵突击: 'fangzhen_tuji',
  玄武洰流: 'xuanwu_fuliu',
  九锡黄龙: 'jiuxi_huanglong',
  持节镇西: 'chijie_zhenxi',
  奇兵拒北: 'qibing_jubei',
  白衣渡江: 'baiyi_dujiang',
  千里单骑: 'qianli_danqi',
  樊渊泅囚: 'fanyuan_qiou',
  枭姬: 'xiaoji',
  上将潘凤: 'shangjiang_panfeng',
  将倾之柱: 'jiangqing_zhizhu',
  血溅黄砂: 'xuejian_huangsha',
  当敌制决: 'dangdi_zhijue',
  虎豹督军: 'hubao_dujun',
  令明负榇: 'lingming_fuchen',
  疮痍累身: 'chuangyi_leishen',
  诸葛锦囊: 'zhuge_jinnang',
  怀橘遗亲: 'huai_ju_yiqin',
  帝临回光: 'diling_huiguang',
  列营守险: 'lieying_shouxian',
  九伐中原: 'jiufa_zhongyuan',
  巧音唤蝶: 'qiaoyin_huandie',
  谋谟帷幄: 'moumou_weiwo',
  持玺兴兵: 'chixi_xingbing',
  闭月: 'biyue',
  金吾飞将: 'jinwu_feijiang',
  奇佐鬼谋: 'qizuo_guimou',
  密谋定蜀: 'mimou_dingshu',
  火势风威: 'huoshi_fengwei',
  辕门射戟: 'yuanmen_sheji',
  平壑拒吴: 'pinghe_juwu',
  金匮要略: 'jinkui_yaolue',
  谋议宏图: 'mouyi_hongtu',
  盛气横凌: 'shengqi_hengling',
  动如雷震: 'dongru_leizhen',
  魏武之泽: 'weiwu_zhi_ze',
  强势: 'qiangshi',
  怒浪伐敌: 'nulang_fadi',
  诸葛锦囊: 'zhuge_jinnang',
  不动如山: 'budong_rushan',
  巾帼战阵: 'jinguo_zhanzhen',
  白楼独舞: 'bailou_duwu',
  汉韵旷野: 'hanyun_kuangye',
  双艳: 'shuangyan',
  逆谋: 'nimou',
  宣威再战: 'xuanwei_zaizhan',
  红颜铁骑: 'hongyan_tieqi',
  其疾如风: 'qiji_rufeng',
  世仇: 'shichou',
  复誓业火: 'fushi_yehuo',
  未笄难言: 'weiji_nanyan',
  魏武之世: 'weiwu_zhishi',
  驱虎吞狼: 'quhu_tunlang',
  定军扬威: 'dingjun_yangwei',
  西乡武功: 'xixiang_wugong',
  国士无双: 'guoshi_wushuang',
  黄天当立: 'huangtian_dangli',
  夔吼象踏: 'kui_xiangta',
  烈火焚舟: 'liehuo_fenzhou',
  将门虎女: 'jiangmen_hunv',
  明慧通透: 'minghui_tongtou',
  险途暗渡: 'xiantu_andu',
  难知如阴: 'nanzhi_ruyin',
  黄天余音: 'huangtian_yuyin',
  奋疾先登: 'fenji_xiandeng',
  皇裔流离: 'huangyi_liuli',
  银龙冲阵: 'yinlong_chongzhen',
  献刀七星: 'xiandao_qixing',
  母仪浮梦: 'muyi_fumeng',
  盲侯奋勇: 'manghou_fenyong',
  陷储立齐: 'xianchu_liqi',
  同仇敌忾: 'tongchou_dikai',
  缓师徐持: 'huanshi_xuchi',
  青丘媚祸: 'qingqiu_meihuo',
  舍身卫主: 'sheshen_weizhu',
  赏顺伐逆: 'shangshun_fani',
  运筹决胜: 'yunchou_juesheng',
  七步释嫌: 'qibu_shixian',
  怀德畏威: 'huaide_weiwei',
  回马: 'huima',
  空城: 'kongcheng',
  攻其不备: 'gongqi_bubei',
  健卒不殆: 'jianzu_budai',
  反击之策: 'fanji_zhice',
  以诱待来: 'yiyou_dailai',
  先声夺人: 'xiansheng_duoren',
  方圆: 'fangyuan',
  疏数: 'shushu',
  衡轭: 'henge',
  锋矢: 'fengshi',
  鱼鳞: 'yulin',
  鹤翼: 'heyi',
  白刃: 'bairen',
  全军突击: 'quanjun_tuji',
  飒沓如星: 'sata_ruxing',
  落首箭: 'luoshou_jian',
  长坂之吼: 'changban_zhihou',
  烽火覆周: 'fenghuo_fuzhou',
  虎步关右: 'hubu_guanyou',
  火兽冲锋: 'huoshou_chongfeng',
  文德椒房: 'wende_jiaofang',
  计定山越: 'jiding_shanyue',
  威震河朔: 'weizhen_heshuo',
  匠心不竭: 'jiangxin_bujie',
  全主诿异: 'quanzhu_weiyi',
  举贤决机: 'juxian_jueji',
  忠克猛烈: 'zhongke_menglie',
  霸王渡江: 'bawang_dujiang',
  人公将军: 'rengong_jiangjun',
  四世三公: 'sishisan_gong',
  其徐如林: 'qixu_rulin',
  徽言龙凤: 'huiyan_longfeng',
  破凰: 'po_huang',
  侵掠如火: 'qinlue_ruhuo',
  三军夺帅: 'sanjun_duoshuai',
  奉令护蜀: 'fengling_hushu',
  地公将军: 'digong_jiangjun',
  西陵克晋: 'xiling_kejin',
  缚父临危: 'fufu_linwei',
  连环计: 'lianhuanji',
  率尔方雅: 'lv_er_fang_ya',
  鸾凤和鸣: 'luanfeng_heming',
  赐剑长驱: 'cijian_changqu',
  僭号天子: 'jianhao_tianzi',
  伏波扬砂: 'fuboyangsha',
  潜谋远计: 'qianmou_yuanji',
  心战为上: 'xinzhan_weishang',
  举抑臧否: 'juyizangfou',
  辞后定朝: 'cihou_dingchao',
  万箭齐发: 'wanjian_qifa',
  文伐: 'wenfa',
  不攻: 'bugong',
  恃强淬锋: 'shiqiang_cuifeng',
  将门有将: 'jiangmen_youjiang',
  二夫之勇: 'erfu_zhiyong',
  雪奋短兵: 'xuefen_duanbing',
  蛮王御众: 'manwang_yuzhong',
  知人待士: 'zhiren_daishi',
  胡笳离愁: 'hujia_lichou',
  断首何怒: 'duanshou_henu',
  勇挚刚毅: 'yongzhi_gangyi',
  奇门遁甲: 'qimen_dunjia',
  定军绝战: 'dingjun_juezhan',
  破阵强袭: 'pozhen_qiangxi',
  万军取首: 'wanjun_qushou',
  兵行巧变: 'bingxing_qiaobian',
  竭忠尽智: 'jiezhong_jinzhi',
  银龙孤胆: 'yinlong_gudan',
  明其虚实: 'mingqi_xushi',
  守静却敌: 'shoujing_quedi',
  持刀从武: 'chidao_congwu',
  计谕废立: 'jiyu_fuili',
  中宫追玺: 'zhonggong_zhuixi',
  抚民励德: 'fumin_lide',
};

/** 现有 8 个武将固定拼音 id（测试直接引用 HERO_REGISTRY.<id>） */
const FIXED_IDS = {
  太史慈: 'taishici',
  周瑜: 'zhouyu',
  孙权: 'sunquan',
  卫瓘: 'weiguan',
  魏延: 'weiyan',
  吕蒙: 'lvmeng',
  赵云: 'zhaoyun',
  SP赵云: 'sp_zhaoyun',
};

/**
 * 互斥组**白名单**（用户 2026-09-16 口径，按游戏内实际规则）：
 * 只有下面这些武将不可同队，其余同名/同基础名武将**可同队**。
 *   - 赵云 ↔ SP赵云
 *   - 姜维（蜀·步）↔ SP姜维（蜀·弓）
 * 明确可同队的例子（此前按「同名自动成组」被误判互斥，现全部放开）：
 *   关羽蜀/魏、司马懿魏/晋、吕布汉/群、貂蝉汉/群、曹操汉/魏、荀彧魏/汉、袁绍汉/群、董卓汉/群；
 *   **XP姜维 与其基础名版本可同队**（XP 卡不入任何互斥组）。
 */
const MUTEX_GROUP_BY_NAME = {
  赵云: '赵云',
  SP赵云: '赵云',
  姜维: '姜维',
  SP姜维: '姜维',
};

const groupOf = (name) => MUTEX_GROUP_BY_NAME[name] ?? null;

const mutexGroupNames = [...new Set(Object.values(MUTEX_GROUP_BY_NAME))];
console.log(
  '互斥组（白名单）:',
  mutexGroupNames
    .map((g) => `${g} 组(${Object.keys(MUTEX_GROUP_BY_NAME).filter((n) => MUTEX_GROUP_BY_NAME[n] === g).length})`)
    .join('  |  ')
);

// 2) 分配 id（直接传 hero 对象，避免重名武将 find 命中第一个）
const idOf = (h) => {
  if (FIXED_IDS[h.name]) return FIXED_IDS[h.name];
  if (h.name === 'SP姜维') return 'sp_jiangwei';
  if (h.name === 'XP姜维') return 'xp_jiangwei';
  return `h${h.hero_id}`;
};

const esc = (s) => (s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "''");

/** 官方描述清洗：部分主战法描述是两个版本拼接（如魏武之世「攻击距离+1」+「主动战法距离+1」）。
 *  检测前 6 字第二次出现：后半是前半完整超集 → 取后半；否则取前半（第一个完整效果）。 */
const dedupeDesc = (d) => {
  if (!d) return d;
  const head = d.slice(0, 6);
  const idx = d.indexOf(head, 2);
  if (idx <= 0 || idx >= d.length - 6) return d;
  const a = d.slice(0, idx);
  const b = d.slice(idx);
  return b.startsWith(a) ? b : a;
};

const rows = heroes
  .filter((h) => !SKIP.has(h.name))
  .filter((h) => h.cost >= 2.5) // 初版只做五星武将（四星不入库）
  .map((h) => {
    const rarity = '5星';
    const tags = h.name.startsWith('SP') ? 'sp' : '';
    const skillId = SKILL_ID_BY_NAME[h.skill_name] ?? '';
    // 缺失成长值兜底为 1.0（建表默认值），并提示
    for (const k of ['growth_attack', 'growth_defense', 'growth_strategy', 'growth_speed']) {
      if (h[k] == null) console.warn(`[warn] ${h.name}(${h.faction}) ${k} 缺失，默认 1.0`);
    }
    return {
      id: idOf(h),
      name: h.name,
      rarity,
      cost: h.cost,
      faction: h.faction,
      tags,
      mutualExclusionGroup: groupOf(h.name),
      troopType: TROOP_MAP[h.troop_type],
      attackRange: h.attack_range,
      baseAttack: h.base_attack,
      baseDefense: h.base_defense,
      baseStrategy: h.base_strategy,
      baseSpeed: h.base_speed,
      growthAttack: h.growth_attack ?? 1.0,
      growthDefense: h.growth_defense ?? 1.0,
      growthStrategy: h.growth_strategy ?? 1.0,
      growthSpeed: h.growth_speed ?? 1.0,
      mainSkillId: skillId,
      mainSkillName: h.skill_name,
      skillDesc: dedupeDesc(h.default_skill_desc ?? ''),
    };
  });

// 3) 附加现有 SP 赵云（JSON 无数据，保持测试引用的 sp_zhaoyun + 互斥组 zhaoyun_group）
//    兵种按官方口径 = 步（_official_hero.json hero_id 102001 hero_type=2；skill_extra.json 200704 soldierType=步），
//    旧值 cavalry 为本地旧数据（策略 A①：官方现页 > 本地旧数据）。主战法银龙孤胆已实现。
rows.push({
  id: 'sp_zhaoyun',
  name: 'SP赵云',
  rarity: '5星',
  cost: 3.5,
  faction: '蜀',
  tags: 'sp',
  mutualExclusionGroup: '赵云',
  troopType: 'infantry',
  attackRange: 3,
  baseAttack: 101,
  baseDefense: 92,
  baseStrategy: 78,
  baseSpeed: 65,
  growthAttack: 2.27,
  growthDefense: 2.23,
  growthStrategy: 1.12,
  growthSpeed: 1.14,
  mainSkillId: 'yinlong_gudan',
  mainSkillName: '银龙孤胆',
  skillDesc: '1回合准备，对随机敌军单体发动7次攻击（首次伤害率80.0%），每次目标独立判定，每次伤害率都递增7%',
});

// 赵云主战法银龙冲阵已实现（SKILL_ID_BY_NAME 自动装配 main_skill_id）；
// SP赵云 为手动附加 → 与 SP赵云 同组互斥
const zhaoyun = rows.find((r) => r.id === 'zhaoyun');
if (zhaoyun) {
  zhaoyun.mutualExclusionGroup = '赵云';
}

const values = rows
  .map(
    (r) => `('${esc(r.id)}', '${esc(r.name)}', '${r.rarity}', ${r.cost}, '${esc(r.faction)}', '${esc(r.tags)}', ${r.mutualExclusionGroup ? `'${esc(r.mutualExclusionGroup)}'` : 'NULL'}, '${r.troopType}', ${r.attackRange}, ${r.baseAttack}, ${r.baseDefense}, ${r.baseStrategy}, ${r.baseSpeed}, ${r.growthAttack}, ${r.growthDefense}, ${r.growthStrategy}, ${r.growthSpeed}, '${esc(r.mainSkillId)}', '${esc(r.mainSkillName)}', '${esc(r.skillDesc)}')`
  )
  .join(',\n');

const sql = `-- 武将全量种子数据（由 scripts/build_heroes_seed.mjs 从 hero_growth_verified.json 生成，勿手改）
-- 数据库：stzb战斗系统（MySQL 8.0.12）
-- 注意：站位（大营/中军/前锋）由用户装配阵容时决定，不属于武将固有数据，故不入库。
-- 互斥组：白名单制 —— 仅 赵云↔SP赵云、姜维↔SP姜维 不可同队；其余同名武将（含 XP 卡）可同队。

CREATE TABLE IF NOT EXISTS heroes (
  id                    VARCHAR(64)     NOT NULL PRIMARY KEY,
  name                  VARCHAR(32)     NOT NULL,
  rarity                ENUM('4星','5星') NOT NULL DEFAULT '5星',
  cost                  DECIMAL(3,1)    NOT NULL,
  faction               VARCHAR(8)      NOT NULL,
  tags                  VARCHAR(128)    NOT NULL DEFAULT '',
  mutual_exclusion_group VARCHAR(64)    NULL,
  troop_type            ENUM('cavalry','infantry','archer') NOT NULL,
  attack_range          TINYINT         NOT NULL,
  base_attack           INT             NOT NULL,
  base_defense          INT             NOT NULL,
  base_strategy         INT             NOT NULL,
  base_speed            INT             NOT NULL,
  growth_attack         DECIMAL(5,2)    NOT NULL DEFAULT 1.0,
  growth_defense        DECIMAL(5,2)    NOT NULL DEFAULT 1.0,
  growth_strategy       DECIMAL(5,2)    NOT NULL DEFAULT 1.0,
  growth_speed          DECIMAL(5,2)    NOT NULL DEFAULT 1.0,
  main_skill_id         VARCHAR(64)     NOT NULL DEFAULT '',
  main_skill_name       VARCHAR(32)     NOT NULL DEFAULT '',
  skill_desc            TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 清空后重灌（开发期幂等）
DELETE FROM heroes;

INSERT INTO heroes
  (id, name, rarity, cost, faction, tags, mutual_exclusion_group, troop_type, attack_range,
   base_attack, base_defense, base_strategy, base_speed,
   growth_attack, growth_defense, growth_strategy, growth_speed,
   main_skill_id, main_skill_name, skill_desc) VALUES
${values};

-- 全量 ${rows.length} 武将（含 SP 变体）
`;

writeFileSync(join(__dirname, 'seed_heroes.sql'), sql, 'utf8');
console.log(`已生成 seed_heroes.sql，共 ${rows.length} 行`);

// 统计
const four = rows.filter((r) => r.rarity === '4星');
const mutexGroups = new Set(rows.map((r) => r.mutualExclusionGroup).filter(Boolean));
const sp = rows.filter((r) => r.tags === 'sp');
const implemented = rows.filter((r) => r.mainSkillId);
console.log(`4星:${four.length}  5星:${rows.length - four.length}  互斥组:${mutexGroups.size}(${[...mutexGroups].join(',')})  SP:${sp.map((r) => r.name).join(',')}  已实现主战法:${implemented.length}`);
