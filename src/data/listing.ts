/**
 * 暂时下架名单：受谋略成长率未确认、或主战法尚未实现。
 * 只影响 Web 武将池 / 战法背包 / 伤害实验室；引擎 SKILL_REGISTRY 与测试数据保留，补全后从本表移除即可上线。
 */

/** 主战法有未确认的「受谋略」成长（含取基值）→ 携带该主战法的武将下架 */
export const OFFLINE_MAIN_SKILLS: Record<string, string> = {
  qiji_rufeng: '速度 +41 成长 0.1 未确认',
  qingqiu_meihuo: '伤害降低 24% 成长 0.15 未确认',
  mimou_dingshu: '减伤/自身增伤成长未确认（恐慌 143%/1.125、诅咒 1.225 已确认）',
  huanshi_xuchi: '触发率 50% 成长 0.15 未确认',
  zhuge_jinnang: '减伤 35% / 增伤 14% 成长未确认（取基值）',
  tongchou_dikai: '每层 ±2% 成长 0.01 未确认',
  fushi_yehuo: '受击增伤 16% 成长 0.1 未确认（火攻/燃烧 0.95 已确认）',
  huangtian_dangli: '妖术 180% 成长 1.0 未确认',
  weiwu_zhi_ze: '增伤 15% 成长未确认（取基值）',
  minghui_tongtou: '恢复 168% 成长 1.0 未确认',
  hanyun_kuangye: '伤害降低 30% 成长未确认（取基值）',
  bailou_duwu: '伤害降低 26% 成长未确认（取基值）',
  biyue: '防御 -29 成长未确认',
  shangshun_fani: '策略反击 180% 成长未确认（恢复 65%/0.325 已确认）',
  fenghuo_fuzhou: '火攻 95% 谋略成长未确认',
  hubu_guanyou: '首次攻击 +70% 速度成长未确认',
  wende_jiaofang: '策略增伤 10% 谋略成长未确认',
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
