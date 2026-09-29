/**
 * 记忆层（web/advisor/memory.ts + prefs.ts）
 * ---------------------------------------------------------------------------
 * 锁的是「harness 四点做法」在本项目的落法：
 *  ① 存储：两把键 + 体积裁剪 + 写失败降级内存（键名写死，改了这里就红）；
 *  ② 时机：轮末原子写 + **幂等**（同轮 id 写两次只有一条）；
 *  ③ 偏好：抽取结果按「标签 + 取值」合并（重复 → 计数 +1，超限淘汰最久未确认）；
 *  ④ 注入：`<advisor_prefs>` 块渲染 + 回灌历史时 `stripInjected` 剥标签（防自我污染）。
 */
import { describe, it, expect } from 'vitest';
import {
  appendTurn,
  clearProfile,
  clearSession,
  createDefaultStore,
  createMemoryStore,
  EVIDENCE_TAG,
  emptySession,
  historyFrom,
  loadProfile,
  loadSession,
  MAX_TURNS,
  mergePreferences,
  normalizePref,
  parseProfile,
  parseSession,
  PROFILE_KEY,
  PROFILE_TAG,
  removePreference,
  renderProfileBlock,
  saveProfile,
  saveSession,
  SESSION_KEY,
  stampText,
  stripInjected,
  toStoredTurn,
  updateTurn,
  type AdvisorSession,
  type PrefProfile,
  type StoredTurn,
} from '../web/advisor/memory';
import { buildExtractInput, createProfileExtractor, parsePrefReply, MAX_EXTRACT_ITEMS, type PrefExtractInput } from '../web/advisor/prefs';
import { createFakeTransport, type ChatRequest } from '../web/advisor/transport';
import type { AdvisorTurn } from '../web/advisor/types';

// ─────────────────────────── 脚手架 ───────────────────────────

const turnOf = (patch: Partial<AdvisorTurn> = {}): AdvisorTurn => ({
  messages: [],
  toolCalls: [],
  plans: [],
  checks: [],
  answer: '结论',
  verdict: { legal: true, verified: true, recomputed: true, apply: { enabled: true } },
  ...patch,
});

const evidenceOf = (id: string, name = 'simulate', battles = 20) => ({
  evidenceId: id,
  name,
  args: { runs: battles },
  summary: `核心将期望 7,317（${id}）`,
  data: { mean: 7317 },
  stats: { battles, ms: 12, seed: 20260929 },
});

const storedTurn = (idx: number, patch: Partial<StoredTurn> = {}): StoredTurn => ({
  ...toStoredTurn(
    turnOf({
      answer: `第 ${idx} 轮结论`,
      toolCalls: idx % 2 === 1 ? [evidenceOf(`ev-${idx}-simulate`)] : [],
    }),
    `第 ${idx} 轮问题`,
    { id: `r${idx}`, at: 1_700_000_000_000 + idx * 1000, mode: '干跑（假传输）' }
  ),
  ...patch,
});

const sessionWith = (n: number): AdvisorSession => {
  let s = emptySession(1_700_000_000_000, 's-test');
  for (let i = 1; i <= n; i += 1) s = appendTurn(s, storedTurn(i));
  return s;
};

// ─────────────────────────── ① 存储 ───────────────────────────

describe('记忆层 · 存储（键名 / 往返 / 降级）', () => {
  it('会话往返：写进 store 再读回来，证据清单不带 data（明细仍归 cache.ts）', () => {
    const store = createMemoryStore();
    const s = saveSession(sessionWith(2), store);
    expect(store.get(SESSION_KEY)).toBeTruthy();
    const back = loadSession(store);
    expect(back?.turns).toHaveLength(2);
    expect(back?.turns[0].userText).toBe('第 1 轮问题');
    expect(back?.turns[0].evidence[0].evidenceId).toBe('ev-1-simulate');
    expect('data' in back!.turns[0].evidence[0]).toBe(false);
    expect(back?.retainedTurns).toBe(2);
    expect(s.updatedAt).toBe(back?.updatedAt);
  });

  it('坏 JSON / 版本不符 / 结构不对 → 当作没有会话（绝不抛）', () => {
    expect(parseSession('{ 不是 json')).toBeNull();
    expect(parseSession(JSON.stringify({ v: 2, turns: [] }))).toBeNull();
    expect(parseSession(JSON.stringify({ v: 1 }))).toBeNull();
    expect(parseSession(null)).toBeNull();
  });

  it('档案容错：坏 JSON → 空档案；非法条目被剔掉', () => {
    expect(parseProfile('nope').items).toEqual([]);
    const p = parseProfile(JSON.stringify({ v: 1, items: [{ key: '口径', value: '只看核心将' }, { key: 1 }, null], updatedAt: 5 }));
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ key: '口径', value: '只看核心将', seen: 1 });
  });

  it('localStorage 写失败（隐私模式 / 配额满）→ 降级内存，本次会话内照常读写', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const store = createDefaultStore(throwing);
    store.set(SESSION_KEY, 'x');
    expect(store.get(SESSION_KEY)).toBe('x');
    store.remove(SESSION_KEY);
    expect(store.get(SESSION_KEY)).toBeNull();
  });

  it('没有 localStorage（node / 原生壳异常）也不崩', () => {
    const store = createDefaultStore(null);
    expect(store.get(SESSION_KEY)).toBeNull();
    store.set(SESSION_KEY, 'y');
    expect(store.get(SESSION_KEY)).toBe('y');
  });

  it('清会话不清档案（两个键互不牵连）', () => {
    const store = createMemoryStore();
    saveSession(sessionWith(1), store);
    saveProfile({ v: 1, items: [{ key: '口径', value: '只看核心将', at: 1, seen: 1 }], updatedAt: 1 }, store);
    clearSession(store);
    expect(store.get(SESSION_KEY)).toBeNull();
    expect(loadProfile(store).items).toHaveLength(1);
    clearProfile(store);
    expect(store.get(PROFILE_KEY)).toBeNull();
  });
});

// ─────────────────────────── ② 落盘时机（幂等 + 上限 + 裁剪） ───────────────────────────

describe('记忆层 · 落盘时机（轮末一次写；幂等；超限裁剪）', () => {
  it('appendTurn 幂等：同一轮 id 写两次只有一条（= harness 的 retainedTurns 游标）', () => {
    const once = appendTurn(emptySession(1, 's'), storedTurn(1));
    const twice = appendTurn(once, storedTurn(1));
    expect(twice.turns).toHaveLength(1);
    expect(twice.retainedTurns).toBe(1);
    expect(twice).toBe(once); // 命中幂等 → 原对象返回
  });

  it('超过轮数上限：丢最旧的，并计数（不静默）', () => {
    let s = emptySession(1, 's');
    for (let i = 1; i <= MAX_TURNS + 3; i += 1) s = appendTurn(s, storedTurn(i));
    expect(s.turns).toHaveLength(MAX_TURNS);
    expect(s.turns[0].userText).toBe('第 4 轮问题');
    expect(s.dropped).toBe(3);
    expect(s.retainedTurns).toBe(MAX_TURNS);
  });

  it('体积兜底：saveSession 超限时裁掉最旧的轮次，返回真正写下去的那份', () => {
    const store = createMemoryStore();
    const big = sessionWith(6);
    const written = saveSession(big, store, 900);
    expect(written.turns.length).toBeLessThan(6);
    expect(written.turns.length).toBeGreaterThan(0);
    expect(loadSession(store)?.turns.length).toBe(written.turns.length);
    expect(written.dropped).toBe(6 - written.turns.length);
  });

  it('updateTurn 回填 note（偏好整理完写回），未命中 id 时原样返回', () => {
    const s = sessionWith(1);
    const patched = updateTurn(s, 'r1', { note: '档案 +1' });
    expect(patched.turns[0].note).toBe('档案 +1');
    expect(updateTurn(s, '不存在', { note: 'x' })).toBe(s);
  });

  it('半成品（partial）也照样落盘，且正文为空时有兜底文案', () => {
    const partial = toStoredTurn(turnOf({ answer: '' }), '中断的问题', { id: 'p1', partial: true });
    const s = appendTurn(emptySession(1, 's'), partial);
    const msgs = historyFrom(s);
    expect(msgs.at(-1)?.role).toBe('assistant');
    expect(msgs.at(-1)?.content).toContain('中断');
  });
});

// ─────────────────────────── ④ 回灌与防污染 ───────────────────────────

describe('记忆层 · 回灌给模型的历史（紧凑转录 + 剥注入块）', () => {
  it('只回灌最近 N 轮，且是「提问 / 结论 / 证据一行行」而不是整条协议 trace', () => {
    const s = sessionWith(9);
    const msgs = historyFrom(s, { maxTurns: 3 });
    expect(msgs.filter((m) => m.role === 'user' && !m.content.startsWith(`<${EVIDENCE_TAG}>`))).toHaveLength(3);
    expect(msgs[0].content).toBe('第 7 轮问题');
    expect(msgs.some((m) => m.content.includes(EVIDENCE_TAG))).toBe(true);
    expect(msgs.some((m) => m.content.includes('ev-7-simulate'))).toBe(true);
    // 证据块明确声明"这不是用户的新发言"，避免模型误读
    expect(msgs.find((m) => m.content.includes(EVIDENCE_TAG))?.content).toContain('不是用户的新发言');
  });

  it('字数上限：从最新往回装，至少留 1 轮', () => {
    const s = sessionWith(6);
    const msgs = historyFrom(s, { maxTurns: 6, maxChars: 10 });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.at(-1)?.content).toContain('第 6 轮');
  });

  it('stripInjected：档案块与证据块都被剥掉（= harness 的 stripInjectedMemory）', () => {
    const text = [
      '用户的话',
      `<${PROFILE_TAG}>`,
      '- 口径：只看核心将',
      `</${PROFILE_TAG}>`,
      `<${EVIDENCE_TAG}>`,
      '- 试跑② → 7,317',
      `</${EVIDENCE_TAG}>`,
      '结尾',
    ].join('\n');
    const out = stripInjected(text);
    expect(out).toBe('用户的话\n\n结尾');
  });

  it('历史里若混进注入块（旧数据），回灌前会被剥掉', () => {
    const s = appendTurn(
      emptySession(1, 's'),
      toStoredTurn(turnOf({ answer: `答案\n<${PROFILE_TAG}>\n- 口径：x\n</${PROFILE_TAG}>` }), '问', { id: 'r1' })
    );
    const msgs = historyFrom(s);
    expect(msgs.find((m) => m.role === 'assistant')?.content).toBe('答案');
  });
});

// ─────────────────────────── ③ 偏好合并 ───────────────────────────

describe('记忆层 · 偏好档案（写入 / 合并 / 删除 / 渲染）', () => {
  const at = 1_700_000_000_000;

  it('normalizePref：标签空落「偏好」、超长截断、取值空则丢弃', () => {
    expect(normalizePref('', '  只要输出向  ')).toEqual({ key: '偏好', value: '只要输出向' });
    expect(normalizePref('口径：', '不看总伤。')).toEqual({ key: '口径', value: '不看总伤' });
    expect(normalizePref('口径', '   ')).toBeNull();
    expect(normalizePref('很长很长很长的标签', 'x')?.key.length).toBeLessThanOrEqual(12);
  });

  it('合并：同「标签 + 取值」→ seen+1；新取值新增一条；同标签允许多值', () => {
    let p: PrefProfile = { v: 1, items: [], updatedAt: at };
    const first = mergePreferences(p, [{ key: '口径', value: '只看核心将' }], at);
    expect(first).toMatchObject({ added: 1, bumped: 0 });
    const second = mergePreferences(first.profile, [{ key: '口径', value: '只看核心将' }], at + 1);
    expect(second).toMatchObject({ added: 0, bumped: 1 });
    expect(second.profile.items[0].seen).toBe(2);
    const third = mergePreferences(second.profile, [{ key: '常用', value: '文鸯' }], at + 2);
    expect(third.profile.items).toHaveLength(2);
    p = third.profile;
    expect(p.items.map((i) => `${i.key}:${i.value}`)).toEqual(['口径:只看核心将', '常用:文鸯']);
  });

  it('上限：超条目时淘汰最久未被确认的那条', () => {
    let p: PrefProfile = { v: 1, items: [], updatedAt: 0 };
    for (let i = 0; i < 5; i += 1) p = mergePreferences(p, [{ key: '常用', value: `将${i}` }], 100 + i, { maxItems: 3 }).profile;
    expect(p.items).toHaveLength(3);
    expect(p.items.map((i) => i.value)).toEqual(['将2', '将3', '将4']);
  });

  it('删除：按取值 / 按标签 / 标签=取值', () => {
    const p = { v: 1 as const, items: [
      { key: '口径', value: '只看核心将', at: 1, seen: 1 },
      { key: '常用', value: '文鸯', at: 1, seen: 1 },
      { key: '常用', value: '张辽', at: 1, seen: 1 },
    ], updatedAt: 1 };
    expect(removePreference(p, '文鸯').removed).toBe(1);
    expect(removePreference(p, '常用=张辽').removed).toBe(1);
    expect(removePreference(p, '常用').removed).toBe(2);
    expect(removePreference(p, '').removed).toBe(0);
  });

  it('注入块：空档案不注入；非空带标签与说明；重复确认显示次数；条数/字数有上限', () => {
    expect(renderProfileBlock({ v: 1, items: [], updatedAt: at })).toBe('');
    const block = renderProfileBlock({ v: 1, items: [{ key: '口径', value: '只看核心将', at, seen: 3 }], updatedAt: at });
    expect(block.startsWith(`<${PROFILE_TAG}>`)).toBe(true);
    expect(block).toContain('- 口径：只看核心将（已确认 3 次）');
    expect(block).toContain('与本轮明确要求冲突时以本轮为准');
    const many = { v: 1 as const, items: Array.from({ length: 30 }, (_, i) => ({ key: '常用', value: `将${i}`, at: at + i, seen: 1 })), updatedAt: at };
    const clipped = renderProfileBlock(many, { maxChars: 200 });
    const bullets = clipped.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThan(30);
    expect(clipped).toContain('共 30 条');
    expect(clipped.length).toBeLessThan(280);
  });

  it('stampText：`MM-DD HH:mm`（会话条与档案页脚共用）', () => {
    expect(stampText(new Date(2026, 8, 29, 14, 3).getTime())).toBe('09-29 14:03');
  });
});

// ─────────────────────────── ③ 抽取器 ───────────────────────────

describe('偏好抽取器（prefs.ts）', () => {
  const base: PrefExtractInput = { userText: '以后都按核心将伤害期望排', answer: '好，默认按核心将。', profile: { v: 1, items: [], updatedAt: 0 } };

  it('容错解析：围栏 / 裸 JSON / 坏 JSON / 结构不对', () => {
    expect(parsePrefReply('```json\n{"add":[{"key":"口径","value":"只看核心将"}]}\n```')).toEqual({
      add: [{ key: '口径', value: '只看核心将' }],
      remove: [],
    });
    expect(parsePrefReply('好的：{"add":[],"remove":["旧条目"]}')).toEqual({ add: [], remove: ['旧条目'] });
    expect(parsePrefReply('我抽不出来')).toEqual({ add: [], remove: [] });
    expect(parsePrefReply('{"add":"不是数组"}')).toEqual({ add: [], remove: [] });
    expect(parsePrefReply('')).toEqual({ add: [], remove: [] });
  });

  it('一次最多接受 5 条；缺 value 的条目丢掉', () => {
    const add = Array.from({ length: 9 }, (_, i) => ({ key: '常用', value: `将${i}` }));
    const out = parsePrefReply(JSON.stringify({ add: [...add, { key: 'x' }] }));
    expect(out.add).toHaveLength(MAX_EXTRACT_ITEMS);
  });

  it('送进去的内容带本轮对话 + 现有档案（去重要用）', () => {
    const text = buildExtractInput({ ...base, profile: { v: 1, items: [{ key: '口径', value: '只看核心将', at: 1, seen: 2 }], updatedAt: 1 } });
    expect(text).toContain('【本轮用户】');
    expect(text).toContain('以后都按核心将伤害期望排');
    expect(text).toContain('【本轮顾问回答】');
    expect(text).toContain('- 口径：只看核心将（已确认 2 次）');
  });

  it('抽取器：走 transport.once；没有 once / 抛错时都返回空（旁路永不打断对话）', async () => {
    const noOnce = createFakeTransport([]);
    expect(await createProfileExtractor(noOnce)(base)).toEqual({ add: [], remove: [] });

    const ok = createFakeTransport([], { onceReply: () => '```json\n{"add":[{"key":"流程","value":"长搜索先问我"}]}\n```' });
    expect(await createProfileExtractor(ok)(base)).toEqual({ add: [{ key: '流程', value: '长搜索先问我' }], remove: [] });
    const req = ok.onceRequests[0] as ChatRequest;
    expect(req.tools).toEqual([]);
    expect(req.temperature).toBe(0);
    expect(req.messages[0].content).toContain('偏好档案');

    const boom = createFakeTransport([], {
      onceReply: () => {
        throw new Error('厂商挂了');
      },
    });
    expect(await createProfileExtractor(boom)(base)).toEqual({ add: [], remove: [] });
  });
});
