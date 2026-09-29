/**
 * 「我的 box」层（`web/advisor/box.ts`）：识图建 box 的**确定性对齐 + 多档案存储 + 注入块**。
 * 口径见 `docs/AI配将顾问-设计.md` §15：
 *   · 视觉模型只报名字 → 名字到 id 一律走这里（唯一命中才算数；同名多版/未命中**不静默丢**）；
 *   · 每个用户一份 box（多档案，`dsh-advisor-box-v1`）；
 *   · `<advisor_box>` 每轮注入，是配将的**前提条件**。
 */
import { describe, it, expect } from 'vitest';
import { ALL_HEROES, MAIN_SKILL_IDS } from '../web/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { createMemoryStore, stripInjected } from '../web/advisor/memory';
import {
  BOX_KEY,
  DEFAULT_PROFILE_NAME,
  activeProfile,
  addProfile,
  boxAddHeroes,
  boxAddSkills,
  boxCount,
  boxRemoveHero,
  boxRemoveSkill,
  boxSummaryText,
  boxViewOf,
  emptyBox,
  emptyBoxStore,
  heroRows,
  loadBoxStore,
  matchHero,
  matchRecognition,
  matchSkill,
  mergeRecognition,
  normalizeName,
  removeProfile,
  renameProfile,
  renderBoxBlock,
  saveBoxStore,
  searchHeroCandidates,
  searchSkillCandidates,
  setActiveProfile,
  skillRows,
  withBox,
  type AdvisorBox,
} from '../web/advisor/box';

/** 库里第一个「同名多版」的武将（如 吕布 / 曹操 / 刘备）——数据驱动，不写死 */
function duplicatedName(): { name: string; ids: string[] } {
  const byName = new Map<string, string[]>();
  for (const h of ALL_HEROES) byName.set(h.name, [...(byName.get(h.name) ?? []), h.id]);
  const hit = [...byName.entries()].find(([, ids]) => ids.length > 1);
  if (!hit) throw new Error('库里没有同名多版武将（测试前置不成立）');
  return { name: hit[0], ids: hit[1] };
}

const uniqueHero = () => {
  const byName = new Map<string, number>();
  for (const h of ALL_HEROES) byName.set(h.name, (byName.get(h.name) ?? 0) + 1);
  const hit = ALL_HEROES.find((h) => byName.get(h.name) === 1 && h.mainSkillId);
  if (!hit) throw new Error('库里没有唯一名武将（测试前置不成立）');
  return hit;
};

/** 库里第一个「非主战法」的可学习战法 */
const learnable = () => {
  const hit = Object.entries(SKILL_REGISTRY).find(([id]) => !MAIN_SKILL_IDS.has(id));
  if (!hit) throw new Error('库里没有可学习战法（测试前置不成立）');
  return { id: hit[0], name: hit[1].name };
};

const boxWith = (heroIds: string[], skillIds: string[] = []): AdvisorBox => ({ heroIds, skillIds, unmatched: [], meta: null });

describe('box · 档案存储（多档案，每个用户一份）', () => {
  it('默认就是一份「我的号」空档案；存取往返一致', () => {
    const store = createMemoryStore();
    const s0 = loadBoxStore(store);
    expect(s0.profiles).toHaveLength(1);
    expect(activeProfile(s0).name).toBe(DEFAULT_PROFILE_NAME);
    expect(activeProfile(s0).box).toEqual(emptyBox());

    const hero = uniqueHero();
    const s1 = withBox(s0, s0.activeId, boxAddHeroes(emptyBox(), [hero.id]));
    saveBoxStore(s1, store);
    const back = loadBoxStore(store);
    expect(activeProfile(back).box.heroIds).toEqual([hero.id]);
  });

  it('新建 / 切换 / 改名 / 删除：至少留一份，删掉当前档案自动切到剩下那份', () => {
    let s = emptyBoxStore();
    const first = s.activeId;
    s = addProfile(s, '朋友的号');
    expect(s.profiles).toHaveLength(2);
    expect(activeProfile(s).name).toBe('朋友的号');

    s = renameProfile(s, s.activeId, '小号');
    expect(activeProfile(s).name).toBe('小号');
    expect(renameProfile(s, s.activeId, '   ')).toBe(s); // 空名不改

    s = setActiveProfile(s, first);
    expect(activeProfile(s).name).toBe(DEFAULT_PROFILE_NAME);

    s = removeProfile(s, first);
    expect(s.profiles).toHaveLength(1);
    expect(activeProfile(s).name).toBe('小号');
    expect(activeProfile(s).id).toBe(s.activeId);

    // 删最后一份 → 重置成一份空档案（不崩、不留 0 档）
    s = removeProfile(s, s.activeId);
    expect(s.profiles).toHaveLength(1);
    expect(activeProfile(s).box.heroIds).toEqual([]);
  });

  it('两份档案互不影响（按用户区分：切换档案 = 换一整套 box）', () => {
    const hero = uniqueHero();
    const skill = learnable();
    let s = emptyBoxStore();
    const a = s.activeId;
    s = withBox(s, a, { ...emptyBox(), heroIds: [hero.id] });
    s = addProfile(s, '朋友的号');
    const b = s.activeId;
    s = withBox(s, b, { ...emptyBox(), skillIds: [skill.id] });

    expect(activeProfile(s).box.skillIds).toEqual([skill.id]);
    s = setActiveProfile(s, a);
    expect(activeProfile(s).box.heroIds).toEqual([hero.id]);
    expect(activeProfile(s).box.skillIds).toEqual([]);
  });

  it('容错：坏 JSON / 结构不对 / 条目去重；写盘键名固定', () => {
    expect(loadBoxStore(createMemoryStore({ [BOX_KEY]: '{坏 JSON' })).profiles).toHaveLength(1);
    expect(loadBoxStore(createMemoryStore({ [BOX_KEY]: '{"profiles":"nope"}' })).profiles).toHaveLength(1);
    const hero = uniqueHero();
    const store = createMemoryStore({
      [BOX_KEY]: JSON.stringify({
        v: 1,
        activeId: 'p1',
        profiles: [{ id: 'p1', name: '我的号', box: { heroIds: [hero.id, hero.id, ''], skillIds: [], unmatched: [] }, updatedAt: 1 }],
      }),
    });
    const s = loadBoxStore(store);
    expect(activeProfile(s).box.heroIds).toEqual([hero.id]);
    expect(s.activeId).toBe('p1');
  });

  it('增删：并集去重；删不存在的 id 不报错', () => {
    const hero = uniqueHero();
    const skill = learnable();
    let b = emptyBox();
    b = boxAddHeroes(b, [hero.id, hero.id]);
    b = boxAddSkills(b, [skill.id]);
    expect(boxCount(b)).toEqual({ heroes: 1, skills: 1 });
    b = boxRemoveHero(b, hero.id);
    b = boxRemoveHero(b, 'not-exist');
    b = boxRemoveSkill(b, skill.id);
    expect(boxCount(b)).toEqual({ heroes: 0, skills: 0 });
  });
});

describe('box · 识图结果 → 库内 id（确定性对齐）', () => {
  it('唯一名 → ok；空名 → unknown', () => {
    const h = uniqueHero();
    const m = matchHero({ name: h.name });
    expect(m.status).toBe('ok');
    expect(m.id).toBe(h.id);
    expect(matchHero({ name: '  ' }).status).toBe('unknown');
  });

  it('同名多版：不给线索 → ambiguous（列候选，绝不猜）；给了阵营/兵种 → 消歧成唯一', () => {
    const dup = duplicatedName();
    const vague = matchHero({ name: dup.name });
    expect(vague.status).toBe('ambiguous');
    expect(vague.candidates?.length).toBe(dup.ids.length);

    const target = ALL_HEROES.find((h) => h.id === dup.ids[0])!;
    const troopChar = { cavalry: '骑', infantry: '步', archer: '弓' }[target.troopType] ?? '';
    const picked = matchHero({ name: dup.name, faction: target.faction, troopType: troopChar });
    expect(picked.status).toBe('ok');
    expect(picked.id).toBe(target.id);
    expect(picked.note).toContain('消歧');
  });

  it('近似名（SP / XP 前缀差异）→ 能对上的对上并记 note；库里没有 → unknown', () => {
    const sp = ALL_HEROES.find((h) => h.name.startsWith('SP'));
    if (sp) {
      const m = matchHero({ name: sp.name.replace(/^SP/, '') });
      // 库里若同时存在不带前缀的原版 → 精确命中原版；否则近似命中 SP 版
      expect([sp.id, ...ALL_HEROES.filter((h) => h.name === sp.name.replace(/^SP/, '')).map((h) => h.id)]).toContain(m.id);
    }
    const miss = matchHero({ name: '根本不存在的武将名' });
    expect(miss.status).toBe('unknown');
    expect(miss.note).toContain('库里没有');
  });

  it('战法：唯一名 → ok（带品级）；武将主战法 → main_skill 跳过；未命中 → unknown', () => {
    const sk = learnable();
    const m = matchSkill({ name: sk.name }, SKILL_REGISTRY, MAIN_SKILL_IDS);
    expect(m.status).toBe('ok');
    expect(m.id).toBe(sk.id);

    const hero = uniqueHero();
    const main = matchSkill({ name: hero.mainSkillName }, SKILL_REGISTRY, MAIN_SKILL_IDS);
    expect(main.status).toBe('main_skill');
    expect(main.note).toContain('主战法');

    expect(matchSkill({ name: '根本不存在的战法名' }, SKILL_REGISTRY, MAIN_SKILL_IDS).status).toBe('unknown');
  });

  it('matchRecognition：确定的进清单、分不出的进待确认、重复条目去重、主战法只记一条说明', () => {
    const hero = uniqueHero();
    const dup = duplicatedName();
    const sk = learnable();
    const res = matchRecognition(
      {
        heroes: [
          { name: hero.name },
          { name: hero.name },
          { name: dup.name },
          { name: '压根没有的将' },
        ],
        skills: [{ name: sk.name }, { name: sk.name }, { name: hero.mainSkillName }, { name: '压根没有的战法' }],
      },
      { mainSkills: MAIN_SKILL_IDS }
    );
    expect(res.heroIds).toEqual([hero.id]);
    expect(res.skillIds).toEqual([sk.id]);
    expect(res.pendingHeroes.map((p) => p.raw.name).sort()).toEqual([dup.name, '压根没有的将'].sort());
    expect(res.pendingSkills.map((p) => p.raw.name)).toEqual(['压根没有的战法']);
    expect(res.notes.some((n) => n.includes('主战法'))).toBe(true);
  });

  it('mergeRecognition：并集 + 去重 + unmatched 累积（不静默丢）+ meta 落盘', () => {
    const hero = uniqueHero();
    const sk = learnable();
    const first = mergeRecognition(emptyBox(), matchRecognition({ heroes: [{ name: hero.name }] }, { mainSkills: MAIN_SKILL_IDS }), {
      at: 100,
      images: 3,
      model: 'ds-flash',
    });
    const second = mergeRecognition(first, matchRecognition({ skills: [{ name: sk.name }], heroes: [{ name: '没这个将' }] }, { mainSkills: MAIN_SKILL_IDS }), {
      at: 200,
      images: 2,
      model: 'ds-flash',
    });
    expect(second.heroIds).toEqual([hero.id]);
    expect(second.skillIds).toEqual([sk.id]);
    expect(second.unmatched).toEqual(['没这个将']);
    expect(second.meta).toEqual({ at: 200, images: 2, model: 'ds-flash' });
    expect(boxSummaryText({ id: 'p', name: '我的号', box: second, updatedAt: 200 })).toContain('武将 1 · 战法 1');
  });
});

describe('box · 只读视图 + 注入块', () => {
  it('boxViewOf：空 box 不算严格（什么都没识别 ≠ 什么都不许用）；有内容且严格 → strict', () => {
    const hero = uniqueHero();
    const empty = activeProfile(emptyBoxStore());
    expect(boxViewOf(empty, true).strict).toBe(false);
    expect(boxViewOf(empty, true).empty).toBe(true);

    const filled = { ...empty, box: boxWith([hero.id]) };
    expect(boxViewOf(filled, true).strict).toBe(true);
    expect(boxViewOf(filled, false).strict).toBe(false);
    expect(boxViewOf(filled, true).heroIds.has(hero.id)).toBe(true);
  });

  it('renderBoxBlock：空 box → 空态提示（先要截图，别假设）；不做成空白块', () => {
    const empty = activeProfile(emptyBoxStore());
    const block = renderBoxBlock(boxViewOf(empty, true));
    expect(block).toContain('<advisor_box>');
    expect(block).toContain('还没有 box');
    expect(block).toContain('我的 box');
    expect(block).not.toContain('武将 1：');
  });

  it('renderBoxBlock：有内容 → 档案名 / 计数 / id / 严格模式；超长截断并提示 get_my_box', () => {
    const hero = uniqueHero();
    const sk = learnable();
    const p = { id: 'p', name: '朋友的号', box: boxWith([hero.id], [sk.id]), updatedAt: 1 };
    const block = renderBoxBlock(boxViewOf(p, true), { now: Date.UTC(2026, 8, 29, 6, 3) });
    expect(block).toContain('朋友的号');
    expect(block).toContain(`武将 1：${hero.name}(${hero.id}`);
    expect(block).toContain(`战法 1：${sk.name}(${sk.id}`);
    expect(block).toContain('严格模式：开');
    expect(block).toContain('</advisor_box>');

    const tight = renderBoxBlock(boxViewOf(p, true), { maxChars: 200 });
    expect(tight).toContain('get_my_box');

    const loose = renderBoxBlock(boxViewOf(p, false));
    expect(loose).toContain('严格模式：关');
  });

  it('stripInjected 会把 <advisor_box> 一并剥掉（防注入内容回灌自我污染）', () => {
    const text = ['<advisor_box>', '武将 1：曹操(h23)', '</advisor_box>', '这是用户的原话'].join('\n');
    expect(stripInjected(text)).toBe('这是用户的原话');
  });
});

describe('box · 界面用的可读清单', () => {
  it('heroRows / skillRows：带上「库内暂时用不了」的标注', () => {
    const noSkill = ALL_HEROES.find((h) => !h.mainSkillId);
    const offline = ALL_HEROES.find((h) => h.mainSkillId && Boolean(heroRows({ heroIds: [h.id] })[0].warn));
    const ids = [uniqueHero().id, ...(noSkill ? [noSkill.id] : [])].filter(Boolean);
    const rows = heroRows({ heroIds: ids });
    expect(rows[0].name).toBe(uniqueHero().name);
    expect(rows[0].sub).toMatch(/[汉魏蜀吴群晋]·[骑步弓]/);
    if (noSkill) expect(rows[1].warn).toContain('主战法未实现');

    const offlineSkill = Object.keys(SKILL_REGISTRY).find((id) => !MAIN_SKILL_IDS.has(id) && skillRows({ skillIds: [id] })[0].warn);
    if (offlineSkill) expect(skillRows({ skillIds: [offlineSkill] })[0].warn).toContain('已下架');
    expect(offline).toBeDefined();
  });

  it('候选检索：按名字能找到，且**不把武将主战法**塞进可学战法候选', () => {
    const hero = uniqueHero();
    const hits = searchHeroCandidates(hero.name, 10);
    expect(hits.map((h) => h.id)).toContain(hero.id);

    const sk = learnable();
    const sHits = searchSkillCandidates(sk.name, 10, MAIN_SKILL_IDS);
    expect(sHits.map((s) => s.id)).toContain(sk.id);
    const main = searchSkillCandidates(hero.mainSkillName, 20, MAIN_SKILL_IDS);
    expect(main.map((s) => s.id)).not.toContain(hero.mainSkillId);
  });

  it('normalizeName：全角空格 / 书名号 / 大小写差异都归一到同一个键', () => {
    expect(normalizeName(' ＳＰ 赵云 ')).toBe(normalizeName('sp赵云'));
    expect(normalizeName('「大赏三军」')).toBe(normalizeName('大赏三军'));
  });
});
