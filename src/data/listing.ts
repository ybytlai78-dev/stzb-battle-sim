/**
 * 暂时下架名单：受谋略成长率未确认、或主战法尚未实现。
 * 只影响 Web 武将池 / 战法背包 / 伤害实验室；引擎 SKILL_REGISTRY 与测试数据保留，补全后从本表移除即可上线。
 */

/** 主战法有未确认的「受谋略」成长（含取基值）→ 携带该主战法的武将下架 */
export const OFFLINE_MAIN_SKILLS: Record<string, string> = {
  qingqiu_meihuo: '伤害降低 24% 成长 0.15 未确认',
  mimou_dingshu: '减伤/自身增伤成长未确认（恐慌 143%/1.125、诅咒 1.225 已确认）',
  huanshi_xuchi: '触发率 50% 成长 0.15 未确认',
  zhuge_jinnang: '成长率已确认（减伤 0.25 / 增伤 0）；剩余机制缺口：先手、重复触发额外恢复未建模',
  tongchou_dikai: '每层 ±2% 成长 0.01 未确认',
  fushi_yehuo: '受击增伤 16% 成长 0.1 未确认（火攻/燃烧 0.95 已确认）',
  huangtian_dangli: '妖术 180% 成长 1.0 未确认',
  minghui_tongtou: '恢复 168% 成长 1.0 未确认',
  hanyun_kuangye: '伤害降低 30% 成长未确认（取基值）',
  bailou_duwu: '伤害降低 26% 成长未确认（取基值）',
  biyue: '防御 -29 成长未确认',
  shangshun_fani: '策略反击 180% 成长未确认（恢复 65%/0.325 已确认）',
  fenghuo_fuzhou: '火攻 95% 谋略成长未确认',
  hubu_guanyou: '首次攻击 +70% 速度成长未确认',
  wende_jiaofang: '策略增伤 10% 谋略成长未确认',
  // ─── 2026-09-16 补登记：以下 4 个主战法已实现但「受谋略」成长率未确认 ───
  // 官方描述只写「受谋略属性影响」而未给成长系数，引擎按基值不缩放（strategyScaled 在、growthRate 缺/0），
  // 与真实游戏偏差随谋略增大 → 按本表口径先行下架，待用 scripts/derive_growth_rate.mjs 反解确认后移出。
  jiufa_zhongyuan: '策略伤害 90% / 每回合增伤 5% 受谋略成长未确认（按基值不缩放）',
  qiaoyin_huandie: '策略伤害 176% / 燃烧 86% / 恢复 161% / 休整 82% 受谋略成长未确认（按基值不缩放）',
  moumou_weiwo: '策略伤害 171% 段已确认 1.825；剩余：追加 76% 段成长未确认（触发者属性口径已由引擎侧支持：监听类战法按触发者结算）',
  chixi_xingbing: '恢复 200% 受谋略成长未确认（按基值不缩放）',
  // ─── 2026-09-18 批量31：下架武将清单 §1.2「补 1 个机制」逐个实现 ───
  jiding_shanyue: '恐慌 134% / 恢复 98% 受谋略成长未确认（按基值不缩放）',
  weizhen_heshuo: '主动战法伤害提升 20% 受攻击成长未确认（攻击 200% 固定不缩放）',
  jiangxin_bujie: '恐慌 34% / 燃烧 41% / 妖术 44% 受谋略成长未确认（按基值不缩放）',
  quanzhu_weiyi: 'DoT 伤害提升 20% / 策略伤害 197% 受谋略成长未确认（按基值不缩放）',
  juxian_jueji: '恢复 60% / 策略伤害 100% 受谋略成长未确认（按基值不缩放）',
  qixu_rulin: '相邻跳伤比例 15% + 每回合 +5% 受谋略成长未确认（按基值不缩放）',
  huiyan_longfeng: '士气 10 / 每回合增伤 7% / 策略伤害 120% 受谋略成长未确认（按基值不缩放）',
  // ─── 2026-09-18 批量32：§1.2 剩余「补 1 个机制」（7 处歧义已逐条确认）───
  po_huang: '策略攻击 155% / 条件妖术 130% 受谋略成长未确认（按基值不缩放）',
  sanjun_duoshuai: '策略攻击 100% 受谋略成长未确认（按基值不缩放；物理段 180% 与属性 ±10/−5 固定）',
  fengling_hushu: '下 1 次普攻增伤 35% 受攻击 / 下 1 次受击减伤 20% 受防御 成长未确认（按基值不缩放）',
  digong_jiangjun: '策略攻击 136% / 吸取属性 24 受谋略成长未确认（按基值不缩放）',
  xiling_kejin: '策略攻击 150% 受谋略成长未确认 + 恢复率官方未给（按基值 100%，9000 兵力 216 vs 攻略「约 300」待复核）',
  // ─── 2026-09-19 批量33：§1.2 剩余「补 1 个机制」（率尔方雅起）───
  lv_er_fang_ya: '增伤 22% / 策略 180% 受谋略成长未确认（按基值不缩放；10% 攻击伤害与 180% 攻击段固定）',
  luanfeng_heming: '恢复 85% 受谋略成长未确认（按基值不缩放；控制 +1 目标段无数值）',
  cijian_changqu: '再次发动几率 40% 受谋略成长未确认（按基值不缩放；50% 伤害/恢复与自身犹豫/怯战固定）',
  jianhao_tianzi: '玉玺转移比例 32% 受防御成长未确认（按基值不缩放；结转比例 50% 起每回合 +10% 封顶 100%）',
  fuboyangsha: '普攻增伤 25% 受攻击成长未确认（按基值不缩放；层数阈值 40%/上限 20/消耗 4 固定）',
  // ─── 2026-09-19 批量34：§1.3「需补多个机制」（潜谋远计起）───
  qianmou_yuanji: '恢复 100% / 策略 140% / 谋略防御 +15 受谋略成长未确认（按基值不缩放）',
  xinzhan_weishang: '攻心恢复 50% 受谋略成长未确认（按基值不缩放；士气 −5 ×9 固定）',
  juyizangfou: '属性 ±20 受谋略成长未确认（按基值不缩放；控制/先手/洞察 60% 与持续回合固定）',
  cihou_dingchao: '属性 +40 受谋略成长未确认（按基值不缩放；前 3 回合移除与性别分支无数值）',
};

/**
 * 可学习战法：描述含「受谋略」但成长率未确认（含取基值、0.7/1.0 惯例、次要效果未确认）。
 * 主战法不进本表（由 OFFLINE_MAIN_SKILLS + MAIN_SKILL_IDS 处理）。
 */
export const OFFLINE_LEARNABLE_SKILLS: Record<string, string> = {
  lianzhong_dingqi: '恢复 85% 成长未确认（§七须再问）',
  jijiu: '恢复 108% 成长未确认（§七须再问）',
  baozha: '恢复 98% 成长未确认（§七须再问）',
  xiuzheng: '休整 87% 成长 1.15 占位',
  shoulong: '休整 82% 成长 1.15 占位',
  qixi: '伤害 121% 成长 0.7 未确认',
  fubing: '伤害 105.2% 成长 0.7 未确认',
  huojian: '伤害/燃烧 69% 成长 0.7 未确认',
  langyan: '恐慌 47.6% 成长 0.7 未确认',
  juedao: '伤害 105% / 防御 -6 成长未确认',
  luoshi: '伤害 92.2% / 防御 -5.2 成长未确认',
  jijiao_zhishi: '策略 143% 成长 1.0 未确认',
  chouce_juedao: '伤害 250% / 属性 -25 成长未确认',
  qishu_zhechong: '妖术 116% / 普攻伤害 -20% 成长未确认',
  famou: '属性 -45 成长未确认（伤害 2.175 已确认）',
  sanshu_qimou: '属性 -18 成长未确认（伤害 1.85 已确认）',
  fengsheng_heli: '受策略增伤 12% 成长未确认（恐慌 1.3 已确认）',
  shuiyan_qijun: '攻击 -10 成长未确认（伤害 2.25 已确认）',
  weiya_kunjun: '防御 -7.2 成长未确认（伤害 2.25 已确认）',
  kuidi: '攻击 -10 成长未确认（伤害 0.785 已确认）',
  youji: '动摇 125% 描述未写受谋略，成长 1.0 未确认',
  yuxue: '动摇 75% 描述未写受谋略，成长 1.0 未确认',
  luanzhen: '策略伤害降低 15% 成长未确认（取基值）',
  jiatu: '受攻击伤害提高 13% 成长未确认（取基值）',
  jieliang: '受策略伤害提高 13% 成长未确认（取基值）',
  weiya: '攻击伤害降低 15% 成长未确认（取基值）',
  jinyan: '受策略伤害降低 16% 成长未确认（取基值）',
  jianshou_bingfa: '防御 +28 成长未确认（取基值）',
  qianggong_bingfa: '攻击 +28 成长未确认（取基值）',
  suzhan_bingfa: '速度 +28 成长未确认（取基值）',
  youdi: '攻击 -39 成长未确认（取基值）',
  // ─── 2026-09-16 补登记：以下 4 个通用战法「受谋略」成长率未确认 ───
  heyi: '受谋略成长未确认（按基值不缩放）',
  quanjun_tuji: '受谋略成长未确认（按基值不缩放）',
  sata_ruxing: '受谋略成长未确认（按基值不缩放）',
  bugong: '受谋略成长未确认（按基值不缩放）',
};

/**
 * 武将是否上架：须已实现主战法，且主战法不在未确认成长名单中。
 * @param hero 至少带 mainSkillId 的武将记录（空串 = 主战法未实现）
 */
export function isHeroListed(hero: { mainSkillId: string }): boolean {
  if (!hero.mainSkillId) return false;
  return !OFFLINE_MAIN_SKILLS[hero.mainSkillId];
}

/**
 * 可学习战法是否上架（主战法另由 isMainSkill 排除，不在此判断）。
 * @param skillId 战法 ID
 */
export function isLearnableSkillListed(skillId: string): boolean {
  return !OFFLINE_LEARNABLE_SKILLS[skillId];
}
