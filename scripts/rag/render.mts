/**
 * 率土包内数据渲染：把 `tb_cfg_*` 的原始行渲染成可检索、可引用的文档。
 *
 * 纯函数、零 IO —— 供 `ingest.mts` 与测试共用。
 * 口径来源：`docs/逆向对拍/对拍结论摘要.md`（换算公式）、
 * `docs/superpowers/specs/2026-10-31-率土包内RAG-design.md` §四。
 *
 * 纪律：分域判不出来就标 `unresolved`，**不猜**。
 */

export type Row = Record<string, any>;

/** 包内数值统一是百分数×100（`attack_base 9900 → 99.0`） */
export const stat = (v: unknown): number => Math.round(Number(v ?? 0)) / 100;

/**
 * 发动率 / 判定率 / 几率字段：包内**本身就是百分数**（举义诛暴 probability_max=40 → 40%），
 * 不再除 100（早先按 ÷100 渲染出「发动率 1%」是错的）。
 */
export const rate = (v: unknown): number => Math.round(Number(v ?? 0));

/**
 * 统率消耗：包内 ×10（曹操 100804 cost=25 → 2.5）。
 * ≥100 是未设置的占位（100:569 条 / 200:622 条，多为非战斗单位），原样标注不换算。
 */
export const heroCost = (v: unknown): { value: number; placeholder: boolean } => {
  const n = Number(v ?? 0);
  return n >= 100 ? { value: n, placeholder: true } : { value: n / 10, placeholder: false };
};

/** 星级 = quality + 1。校准锚点：包内 100042（四星·献刀七星）quality=3 */
export const heroStar = (quality: unknown): number => Number(quality ?? 0) + 1;

/** 势力枚举：由 170 条引擎武将按数值指纹对齐后反推，154/154 无冲突 */
export const COUNTRY: Record<number, string> = { 1: '汉', 2: '魏', 3: '蜀', 4: '吴', 5: '群', 6: '晋' };

/** 兵种枚举：同上（infantry/cavalry/archer 三值全中） */
export const TROOP: Record<number, string> = { 1: '弓', 2: '步', 3: '骑' };

/**
 * 战法类型枚举（推定，锚点：举义诛暴/衣带密诏 skill_type=3 是主动、金匮要略=2 是一类指挥、
 * 同仇敌忾=1 是主战法被动；4 按追击战法占比推定）。
 */
export const SKILL_TYPE: Record<number, string> = { 1: '被动', 2: '指挥', 3: '主动', 4: '追击' };
const ACTIVE_TYPES = new Set([3, 4]);

/** 换算分域（spec §四.3；每类都有包内文案或引擎值的锚点，见下） */
export const DIV_ALL_ATTR = 'all-attr-percent';
export const DIV_PERCENT_FIX = 'percent-point';
export const DIV_STAT_POINT = 'stat-point';
export const DIV_HUGE = 'huge-modifier';
export const DIV_DAMAGE_RATE = 'damage-rate';
export const DIV_SKILL_REF = 'skill-ref';
export const DIV_COUNT = 'count-unit';
export const DIV_FLAG = 'flag';
export const DIV_UNRESOLVED = 'unresolved-division';

/**
 * 分域表 = 机制码 → 单位。**未列出的机制一律 unresolved，不猜。**
 *
 * 实证锚点（`tb_cfg_skill_detail` 原始值 ↔ 官方文案 ↔ 引擎值）：
 * - `percent-point`（值@80 = const + 0.4×intel，单位百分点；成长 intel/200）
 *   522 金匮要略 20077301（10/26 → 20.4%，引擎 `rate: 0.204, growthRate: 0.18`，成长率本身有差异待 diff 报）；
 *   531 同仇敌忾子技能 22300601（1/3 → 2.2%）；
 *   401 金匮 20077303（20/150 → 80%，与引擎 `healRate: 80, healGrowthRate: 0.75` 逐位吻合）
 * - `stat-point`（值 = (const + 0.4×intel)/100，单位「点」；成长 intel/20000）
 *   101 衣带密诏 20000101（1000/2200 → 攻击 +18.8 点，文案「攻击属性提高#effect_01#」无 %）；
 *   201 算无遗策 20001101（1000/3000 → 攻谋 −22 点）
 * - `all-attr-percent`（值 = (const + 0.4×intel)/1e6；成长 intel/2e8）
 *   201 魏武之世 20002301（11,400,000/9,000,000 → 15.0%，文案带 %，全属性）
 */
const PERCENT_POINT = new Set([522, 524, 531, 532, 533, 534, 401, 98, 99, 131, 521, 523]);
const STAT_POINT = new Set([101, 102, 103, 104, 105, 201, 202, 203, 204]);
/**
 * 伤害率类：`constant_param` 直接就是百分数（AGENTS.md「解包口径」第一条）。
 * 303 动摇 100/0、304 恐慌 20/100、305 燃烧 20/100、302 策略 35/125 —— 成长 intel/200。
 */
const DAMAGE_RATE = new Set([301, 302, 303, 304, 305]);
/** 子技能引用：值是被触发的 skill_id（122 的子技能 210006 在 skill 表里存在），不是数值 */
const SKILL_REF = new Set([122, 123]);
/** 计数类：攻击距离 +2、标记层数、触发次数 */
const COUNT_UNIT = new Set([77, 106, 151]);
/** 无参数机制：移除效果 / 无视规避 / 预备镇静 —— 原始值恒为 0/0 */
const FLAG = new Set([152, 515, 713]);

export interface Converted {
  /** @80 属性时的取值，单位 = 百分点或属性点（见 division） */
  value: number;
  /** 每点属性带来的成长，与 value 同单位 */
  growth: number;
  division: string;
}

/** 按机制码选分域；同一机制下大额记录（≥1e5）表示全属性百分比刻度 */
export function convertDetail(constParam: number, intelParam: number, effectId?: number): Converted {
  const c = Math.abs(constParam);
  const i = Math.abs(intelParam);
  const big = c >= 1e5 || i >= 1e5;
  const raw = constParam + 0.4 * intelParam;

  if (big && (effectId === undefined || STAT_POINT.has(effectId))) {
    return { value: raw / 1e6, growth: intelParam / 2e8, division: DIV_ALL_ATTR };
  }
  if (effectId !== undefined && PERCENT_POINT.has(effectId)) {
    // 「大幅度降低/提高」哨兵：磐阵善守 / 西乡武功 / 辕门射戟 等 const=9000 或 90000，
    // 语义是「无论对方增伤多高都触伤害下限」，不是 9000% —— 见 AGENTS.md「大幅度降低的取值口径」
    if (Math.abs(raw) >= 1000) return { value: raw, growth: intelParam / 200, division: DIV_HUGE };
    return { value: raw, growth: intelParam / 200, division: DIV_PERCENT_FIX };
  }
  if (effectId !== undefined && STAT_POINT.has(effectId)) {
    return { value: raw / 100, growth: intelParam / 20000, division: DIV_STAT_POINT };
  }
  if (effectId !== undefined && DAMAGE_RATE.has(effectId)) {
    return { value: constParam, growth: intelParam / 200, division: DIV_DAMAGE_RATE };
  }
  if (effectId !== undefined && SKILL_REF.has(effectId)) {
    return { value: constParam, growth: 0, division: DIV_SKILL_REF };
  }
  if (effectId !== undefined && COUNT_UNIT.has(effectId)) {
    return { value: constParam, growth: 0, division: DIV_COUNT };
  }
  if (effectId !== undefined && FLAG.has(effectId)) {
    return { value: 0, growth: 0, division: DIV_FLAG };
  }
  return { value: raw, growth: intelParam / 200, division: DIV_UNRESOLVED };
}

/** 坐标标记：渲染出的每个数字都能回到原始字段 */
export const pkgRef = (table: string, key: string, fields?: string): string =>
  `@pkg:${table}/${key}${fields ? `/{${fields}}` : ''}`;

/** 一个槽位的可读摘要 */
export function renderSlot(detail: Row, effectName: string): string {
  const constParam = Number(detail.constant_param ?? 0);
  const intelParam = Number(detail.intel_param ?? 0);
  const effectId = Number(detail.effect_id ?? 0);
  const conv = convertDetail(constParam, intelParam, effectId);
  const parts: string[] = [];

  const wind = Number(detail.available_round ?? 0);
  const prob = Number(detail.prob_max_param ?? 0);
  const target = Number(detail.target_type ?? 0);
  const cond = Number(detail.condition ?? 0);

  if (conv.division === DIV_UNRESOLVED) {
    parts.push(`[${DIV_UNRESOLVED}] 原始值 constant_param=${constParam}, intel_param=${intelParam}（单位未定，不换算）`);
  } else {
    const unit = conv.division === DIV_STAT_POINT ? ' 点' : '%';
    if (conv.division === DIV_FLAG) {
      parts.push('无参数机制（开关型）');
    } else if (conv.division === DIV_SKILL_REF) {
      parts.push(`触发战法 skill:${conv.value}（非数值）`);
    } else if (conv.division === DIV_COUNT) {
      parts.push(`计数 ${conv.value}`);
    } else if (conv.division === DIV_DAMAGE_RATE) {
      const tail = conv.growth ? `，成长 ${conv.growth.toFixed(3)}%/点` : '';
      parts.push(`伤害率 ${conv.value}%${tail}（分域 ${conv.division}）`);
    } else if (conv.division === DIV_HUGE) {
      parts.push(`值 大幅（哨兵常量 ${conv.value}，语义 = 伤害大幅降低/提高，触伤害下限；分域 ${conv.division}）`);
    } else {
      const sign = conv.value < 0 ? '−' : '';
      parts.push(
        `值 ${sign}${Math.abs(conv.value).toFixed(1)}${unit}（受属性影响，成长 ${conv.growth.toFixed(
          3
        )}${unit}/点，分域 ${conv.division}）`
      );
    }
  }
  if (wind > 0) parts.push(`持续 ${wind} 回合`);
  if (prob > 0 && prob !== 100) parts.push(`判定率 ${rate(prob)}%`);
  if (target > 0) parts.push(`target_type=${target}`);
  if (cond > 0) parts.push(`condition=${cond}`);

  return `- 槽 ${detail.detail_id}｜机制 ${effectId} ${effectName}｜${parts.join('｜')}｜${pkgRef(
    'tb_cfg_skill_detail',
    String(detail.detail_id),
    'constant_param,intel_param'
  )}`;
}

export interface RagDoc {
  docId: string;
  kind: 'hero' | 'skill' | 'mechanism' | 'caliber';
  tier: 'package' | 'inferred';
  source: string;
  facets: Record<string, unknown>;
  /** 正文（不含 front matter；序列化时再加） */
  body: string;
}

/** 武将文档：面板 + 成长 + 主战法指针 */
export function renderHeroDoc(hero: Row): RagDoc {
  const star = heroStar(hero.quality);
  const cost = heroCost(hero.cost);
  const lines: string[] = [
    `# ${hero.name}（官方 id ${hero.heroid}）`,
    '',
    `势力 ${COUNTRY[Number(hero.country)] ?? `unknown(${hero.country})`}｜${star} 星｜兵种 ${
      TROOP[Number(hero.hero_type)] ?? `unknown(${hero.hero_type})`
    }｜攻击距离 ${hero.hit_range}｜统率消耗 ${
      cost.placeholder ? `未设置（原始值 ${cost.value}）` : cost.value.toFixed(1)
    }`,
    '',
    '## 面板（初始 / 成长）',
    '',
    '| 属性 | 初始 | 成长 |',
    '|---|---|---|',
    `| 攻击 | ${stat(hero.attack_base)} | ${stat(hero.attack_grow)} |`,
    `| 防御 | ${stat(hero.defence_base)} | ${stat(hero.defence_grow)} |`,
    `| 谋略 | ${stat(hero.intel_base)} | ${stat(hero.intel_grow)} |`,
    `| 速度 | ${stat(hero.speed_base)} | ${stat(hero.speed_grow)} |`,
    `| 攻城 | ${stat(hero.destroy_base)} | ${stat(hero.destroy_grow)} |`,
    '',
    `主战法 id：${hero.skill_init}（见 \`skill:${hero.skill_init}\`）`,
    `可选兵种：${JSON.stringify(hero.hero_type_availible ?? [])}`,
    '',
    pkgRef('tb_cfg_hero', String(hero.heroid), 'attack_base,defence_base,intel_base,speed_base,*_grow'),
  ];
  return {
    docId: `hero:${hero.heroid}`,
    kind: 'hero',
    tier: 'package',
    source: `tb_cfg_hero/${hero.heroid}`,
    facets: {
      kind: 'hero',
      country: Number(hero.country),
      star,
      troop: Number(hero.hero_type),
      range: Number(hero.hit_range),
      cost: cost.placeholder ? null : cost.value,
      mainSkillId: Number(hero.skill_init),
    },
    body: lines.join('\n'),
  };
}

/** 战法文档：官方文案 + 全部槽位（槽位不单独成篇，见 spec §四.1） */
export function renderSkillDoc(skill: Row, details: Row[], effectName: (id: number) => string, effectCodes: number[]): RagDoc {
  const typeNum = Number(skill.skill_type);
  const typeName = SKILL_TYPE[typeNum] ?? `类型${typeNum}`;
  const isActive = ACTIVE_TYPES.has(typeNum);
  const lines: string[] = [
    `# ${skill.name}（战法 id ${skill.skill_id}）`,
    '',
    `品级 ${skill.skill_quality_level}｜战法类型 ${typeName}｜攻击距离 ${skill.hit_range}｜${
      isActive
        ? `${Number(skill.prepare) > 0 ? '需要准备 1 回合' : '瞬发'}｜发动率 ${rate(skill.probability_max)}%`
        : `生效几率 ${rate(skill.probability_max)}%（非主动战法，无发动率概念）`
    }`,
    '',
    '## 官方描述',
    '',
    String(skill.description ?? '').trim() || '（包内无描述）',
    '',
    String(skill.brief_description ?? '').trim() ? `> ${skill.brief_description}` : '',
    '',
    `## 槽位（${details.length} 个，detail_id 前缀 ${skill.skill_id}）`,
    '',
    ...details.map((d) => renderSlot(d, effectName(Number(d.effect_id)))),
    '',
    effectCodes.length ? `机制码（tb_cfg_skill_effect_map）：${effectCodes.join(';')}` : '',
    '',
    pkgRef('tb_cfg_skill', String(skill.skill_id)),
  ];
  return {
    docId: `skill:${skill.skill_id}`,
    kind: 'skill',
    tier: 'package',
    source: `tb_cfg_skill/${skill.skill_id}`,
    facets: {
      kind: 'skill',
      quality: String(skill.skill_quality_level ?? ''),
      range: Number(skill.hit_range),
      prepare: Number(skill.prepare) > 0,
      rate: rate(skill.probability_max),
      skillType: Number(skill.skill_type),
      effectCodes,
      slotIds: details.map((d) => Number(d.detail_id)),
    },
    body: lines.filter((l) => l !== '').join('\n'),
  };
}

/** 机制字典文档：206 条，每条是「这个效果码在包里是什么」 */
export function renderMechanismDoc(effect: Row, skillNames: string[]): RagDoc {
  const lines = [
    `# 机制 ${effect.effect_id}：${effect.name}`,
    '',
    `tips：${effect.tips || '（无）'}`,
    '',
    `- replace_type = ${effect.replace_type}（冲突分类，见 docs/包内冲突分类-审计.md）`,
    `- value_type = ${effect.value_type}`,
    `- buff_type = ${effect.buff_type}`,
    `- virtual = ${effect.virtual}｜show_priority = ${effect.show_priority}`,
    '',
    skillNames.length ? `引用该机制的战法（前 20）：${skillNames.slice(0, 20).join('、')}` : '（无战法引用）',
    '',
    pkgRef('tb_cfg_skill_effect', String(effect.effect_id), 'replace_type,value_type'),
  ];
  return {
    docId: `mechanism:${effect.effect_id}`,
    kind: 'mechanism',
    tier: 'package',
    source: `tb_cfg_skill_effect/${effect.effect_id}`,
    facets: {
      kind: 'mechanism',
      replaceType: Number(effect.replace_type),
      valueType: Number(effect.value_type),
      buffType: Number(effect.buff_type),
    },
    body: lines.join('\n'),
  };
}

/** 序列化成 docs.jsonl 的一行（front matter + 正文） */
export function toJsonl(doc: RagDoc): string {
  return JSON.stringify(doc);
}
