/**
 * 扫描：主动战法里的 `strategy_damage` 到底分布在哪一层。
 * 目的：确认「只按已知 kind 枚举」的判定/注入会漏掉哪些容器（如 `heal.onHealCast.outputs`），
 * 并列出「泛化遍历」与「枚举遍历」判定不一致的战法（→ 是否影响其它战法结算）。
 *
 * 用法：npx tsx scripts/_scan_weiyu_hooks.mts
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import type { Skill, SkillOutput } from '../src/engine/types';

const KNOWN_KEYS = new Set([
  'schedule_strike:output',
  'conditional:outputs',
  'chance_group:outputs',
  'combo_tag:outputs',
  'random_pick:options',
  'morale_branch:high',
  'morale_branch:low',
]);

/** 枚举式判定（改动前的实现） */
function hasEnum(outs: SkillOutput[]): boolean {
  return outs.some((o) => {
    switch (o.kind) {
      case 'strategy_damage':
        return true;
      case 'schedule_strike':
        return hasEnum(o.output);
      case 'conditional':
        return hasEnum(o.outputs);
      case 'chance_group':
        return hasEnum(o.outputs);
      case 'combo_tag':
        return hasEnum(o.outputs);
      case 'random_pick':
        return o.options.some((g) => hasEnum(g));
      case 'morale_branch':
        return hasEnum(o.high) || hasEnum(o.low);
      default:
        return false;
    }
  });
}

type Path = string;

/** 泛化遍历：返回所有 strategy_damage 的路径（含任意层级的钩子容器） */
function scanPaths(node: unknown, path: string, acc: Path[]): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanPaths(v, `${path}[${i}]`, acc));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.kind === 'strategy_damage') {
    acc.push(path);
    return;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'status' || k === 'label') continue;
    if (v && typeof v === 'object') scanPaths(v, path ? `${path}.${k}` : k, acc);
  }
}

/** 泛化判定：策略伤害是否存在于任意层级 */
function hasGeneric(outs: SkillOutput[]): boolean {
  const acc: Path[] = [];
  scanPaths(outs, '', acc);
  return acc.length > 0;
}

const differ: { id: string; name: string; enumHas: boolean; genericHas: boolean }[] = [];
const hookPaths = new Map<string, string[]>();

for (const skill of Object.values(SKILL_REGISTRY) as Skill[]) {
  if (skill.type !== 'active') continue;
  const outs = 'output' in skill ? skill.output : undefined;
  if (!outs || outs.length === 0) continue;
  const enumHas = hasEnum(outs);
  const genericHas = hasGeneric(outs);
  if (enumHas !== genericHas) differ.push({ id: skill.id, name: skill.name, enumHas, genericHas });

  const acc: Path[] = [];
  scanPaths(outs, '', acc);
  // 找出所有不在 KNOWN_KEYS 白名单里的父容器（= 旧实现会漏掉的位置）
  const orphan = acc
    .map((p) => p.replace(/\[\d+\]/g, '').replace(/\.\d+/g, ''))
    .filter((p) => {
      const parts = p.split('.').slice(0, -1);
      for (let i = parts.length; i > 0; i--) {
        const tail = parts.slice(i - 1).join('.');
        if (KNOWN_KEYS.has(tail)) return false;
      }
      return parts.length > 0;
    });
  if (orphan.length) hookPaths.set(`${skill.id}（${skill.name}）`, [...new Set(orphan)]);
}

console.log('=== 枚举判定 vs 泛化判定 不一致的战法 ===');
console.log(differ.length ? JSON.stringify(differ, null, 1) : '（无 —— 泛化判定不改变任何战法的「是否含策略伤害」结论）');

console.log('\n=== 策略伤害藏在旧注入路径之外的战法（含顶层之外容器） ===');
for (const [k, v] of hookPaths) console.log(`- ${k}: ${v.join(' | ')}`);
if (!hookPaths.size) console.log('（无）');

const gw = SKILL_REGISTRY.guangwu_zhongxing as Extract<Skill, { type: 'active' }>;
const acc: Path[] = [];
scanPaths(gw.output, '', acc);
console.log(`\n光武中兴 strategy_damage 路径（共 ${acc.length}）:`);
for (const p of acc) console.log('  ' + p.replace(/\[\d+\]/g, '[i]'));
