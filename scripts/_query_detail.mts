/**
 * 查询包内 `tb_cfg_skill_detail`：给定技能 sid（或中文名），列出全部段与成长率反解。
 * 跑法：npx tsx scripts/_query_detail.mts <名字或sid> [...]
 */
import { readFileSync } from 'node:fs';

const DIR = 'C:/Users/lai15/Desktop/rea_stzb/dec/json/';
const read = (f: string): Record<string, unknown>[] => {
  const rows = JSON.parse(readFileSync(DIR + f, 'utf8')).rows;
  return Array.isArray(rows) ? rows : Object.values(rows);
};
const details = read('tb_cfg_skill_detail.json');
const skills = read('tb_cfg_skill.json');

const ATTR: Record<number, string> = { 0: '谋略', 1: '攻击', 2: '防御', 4: '速度' };

const args = process.argv.slice(2);
for (const q of args) {
  const asNum = Number(q);
  const skill = Number.isFinite(asNum)
    ? skills.find((s) => s.skill_id === asNum)
    : skills.find((s) => s.name === q && String(s.skill_id).startsWith('2'));
  if (!skill) {
    console.log(`${q}: 未找到技能行`);
    continue;
  }
  const sid = Number(skill.skill_id);
  console.log(`\n=== ${skill.name} sid=${sid} type=${skill.skill_type} prob=${skill.probability_init}/${skill.probability_max}`);
  const rows = details.filter((d) => Math.floor(Number(d.detail_id) / 100) === sid);
  for (const d of rows) {
    const constP = Number(d.constant_param);
    const intel = Number(d.intel_param);
    const attr = ATTR[Number(d.attri_type)] ?? `attr${d.attri_type}`;
    // 百分比类：值@80 = (const + 0.4×intel)/100，成长 = intel/200
    const pct = (constP + 0.4 * intel) / 100;
    // 点数类：值@80 = (const + 0.4×intel)/100，成长 = intel/20000
    const pts = (constP + 0.4 * intel) / 100;
    console.log(
      `  detail=${d.detail_id} eff=${d.effect_id} const=${constP} intel=${intel} attri=${attr}` +
        ` ⇒ 百分比 ${pct.toFixed(2)}% / 成长 ${(intel / 200).toFixed(4)}` +
        ` | 点数 ${pts.toFixed(2)} / 成长 ${(intel / 20000).toFixed(5)}` +
        ` | add_max=${d.value_add_max} round=${d.available_round}`
    );
  }
}
