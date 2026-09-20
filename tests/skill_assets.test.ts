/**
 * 战法图标素材落地校验（与 `web/heroes.ts` 的路径函数联动）：
 *  1. 品级圆环 / 品级角标 S~D 五档、类型图标四种（指挥·主动·被动·追击）、未装配加号——引用到的文件必须真实存在；
 *  2. 类型 → 图标一一对应（回归：2026-09-18 之前靠 `tactics_0N` 序号猜映射，改名后文件名直写类型）。
 * 改 `public/skills/` 文件名或 `heroes.ts` 的路径函数后，本测试即时报错。
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_REGISTRY } from '../src/data/skills';
import { skillTypeIcon, gradeFrame, gradeRibbon, gradePlate, factionIconSrc } from '../web/heroes';

const SKILLS_DIR = fileURLToPath(new URL('../public/skills/', import.meta.url));

/** asset() 会按 BASE_URL 加前缀，这里只取 /skills/ 之后的文件名再落到磁盘路径 */
function diskPath(src: string): string {
  const name = src.split('/').pop() ?? '';
  expect(name, `资源路径异常：${src}`).toMatch(/^[\w-]+\.png$/);
  return join(SKILLS_DIR, name);
}

describe('战法图标素材（public/skills）', () => {
  it('品级圆环 + 品级角标：S/A/B/C/D 五档文件齐备', () => {
    for (const g of ['S', 'A', 'B', 'C', 'D']) {
      const ring = gradeFrame(g);
      const badge = gradeRibbon(g);
      expect(ring).toContain(`grade-ring-${g.toLowerCase()}.png`);
      expect(badge).toContain(`grade-badge-${g.toLowerCase()}.png`);
      expect(existsSync(diskPath(ring)), `缺品级圆环 ${ring}`).toBe(true);
      expect(existsSync(diskPath(badge)), `缺品级角标 ${badge}`).toBe(true);
    }
  });

  it('类型图标：指挥/主动/被动/追击各自对应自己的文件（不靠序号猜映射）', () => {
    const types = ['command', 'active', 'passive', 'pursuit'] as const;
    for (const t of types) {
      const id = Object.entries(SKILL_REGISTRY).find(([, s]) => s.type === t)?.[0];
      expect(id, `注册表缺少 ${t} 类型战法`).toBeTruthy();
      const src = skillTypeIcon(id!);
      expect(src).toContain(`skill-type-${t}.png`);
      expect(existsSync(diskPath(src)), `缺类型图标 ${src}`).toBe(true);
    }
  });

  it('未装配加号素材存在（slot-add.png：白底 JPG 已抠成透明 PNG）', () => {
    expect(existsSync(join(SKILLS_DIR, 'slot-add.png'))).toBe(true);
  });

  it('五星武将卡框素材存在（card-frame-5.png：白底已抠透，画像位/竖带为半透明遮罩）', () => {
    expect(existsSync(join(SKILLS_DIR, 'card-frame-5.png'))).toBe(true);
  });

  it('势力图标：汉/魏/蜀/吴/群/晋 六张行书彩字素材齐备（卡面左上角用图不用字）', () => {
    for (const f of ['汉', '魏', '蜀', '吴', '群', '晋']) {
      const src = factionIconSrc(f);
      expect(src).toContain('faction-');
      expect(existsSync(diskPath(src)), `缺势力图标 ${src}`).toBe(true);
    }
    expect(factionIconSrc('未知')).toBe('');   // 未知势力返回空串，不造坏路径
  });

  it('战法名背景框：S/A/B 三档有素材，C/D 明确无素材（返回空串而非坏路径 → CSS 芯片兜底）', () => {
    for (const g of ['S', 'A', 'B']) {
      const src = gradePlate(g);
      expect(src).toContain(`grade-plate-${g.toLowerCase()}.png`);
      expect(existsSync(diskPath(src)), `缺战法名背景框 ${src}`).toBe(true);
    }
    expect(gradePlate('C')).toBe('');
    expect(gradePlate('D')).toBe('');
  });
});
