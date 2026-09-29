/**
 * 识图层（`web/advisor/vision.ts`）：截图 → 原始清单（名字级），**不做库内对齐**（那是 box.ts 的事）。
 * 锁：JSON 容错解析、多批合并去重、图片压缩的退让路径、干跑示例可解析。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { AdvisorError, createFakeTransport } from '../web/advisor/transport';
import {
  IMAGE_MAX_BYTES,
  MAX_IMAGES,
  SAMPLE_BOX_REPLY,
  fileToDataUrl,
  filesToDataUrls,
  mergeRecognitions,
  normalizeRecognition,
  parseBoxReply,
  recognizeBox,
} from '../web/advisor/vision';

const img = (name = 'shot.png'): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

describe('vision · 返回解析（容错，但不编造）', () => {
  it('围栏 JSON / 裸 JSON / 夹在说明文字里的 JSON 都认', () => {
    const payload = '{"heroes":[{"name":"曹操","faction":"魏","troopType":"骑"}],"skills":[{"name":"大赏三军","grade":"S"}]}';
    expect(parseBoxReply('```json\n' + payload + '\n```').heroes?.[0].name).toBe('曹操');
    expect(parseBoxReply(payload).skills?.[0].name).toBe('大赏三军');
    expect(parseBoxReply(`我看到了这些：\n${payload}\n以上。`).heroes?.length).toBe(1);
  });

  it('字符串数组也认（模型偶尔只给名字）', () => {
    const raw = parseBoxReply('{"heroes":["曹操","刘备"],"skills":["大赏三军"]}');
    expect(raw.heroes?.map((h) => h.name)).toEqual(['曹操', '刘备']);
    expect(raw.heroes?.[0].faction).toBeNull();
  });

  it('完全不是 JSON → 抛 format 错（带原文），绝不当成"识别到 0 个"', () => {
    expect(() => parseBoxReply('我看不清这张图')).toThrowError(AdvisorError);
    expect(() => parseBoxReply('我看不清这张图')).toThrowError(/不是能认的 JSON/);
    expect(() => parseBoxReply('{"heroes":[],"skills":[]}')).toThrowError(/不是能认的 JSON/);
  });

  it('normalizeRecognition：脏字段被清掉、奇怪的键名也认、超量截断', () => {
    const norm = normalizeRecognition({
      heroes: ['曹操', { heroName: '刘备', camp: '蜀', arm: '步' }, { name: '' }, 42, null],
      skills: [{ skillName: '大赏三军', quality: 'S' }, { nope: 1 }],
      unrecognized: ['模糊头像', { raw: '第二处' }],
    });
    expect(norm.heroes?.map((h) => h.name)).toEqual(['曹操', '刘备']);
    expect(norm.heroes?.[1]).toMatchObject({ faction: '蜀', troopType: '步' });
    expect(norm.skills?.map((s) => s.name)).toEqual(['大赏三军']);
    expect(norm.unrecognized).toEqual(['模糊头像', '第二处']);
  });

  it('mergeRecognitions：多批同名去重，缺的阵营/兵种用后一批补上', () => {
    const merged = mergeRecognitions([
      { heroes: [{ name: '曹操' }], skills: [{ name: '大赏三军' }] },
      { heroes: [{ name: '曹操', faction: '魏', troopType: '骑' }, { name: '刘备', faction: '蜀' }], skills: [{ name: '大赏三军' }] },
    ]);
    expect(merged.heroes).toHaveLength(2);
    expect(merged.heroes?.[0]).toMatchObject({ name: '曹操', faction: '魏', troopType: '骑' });
    expect(merged.skills).toHaveLength(1);
  });
});

describe('vision · 图片处理（压不了就退回原图，绝不丢图）', () => {
  it('jsdom 没有 canvas → 原样返回 data URL；非图片 / 超大图明确拒绝', async () => {
    const url = await fileToDataUrl(img());
    expect(url.startsWith('data:image/png;base64,')).toBe(true);

    await expect(fileToDataUrl(new Blob(['hello'], { type: 'text/plain' }))).rejects.toThrowError(/不是图片/);
    const huge = new Blob([new Uint8Array(8)], { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: IMAGE_MAX_BYTES + 1 });
    await expect(fileToDataUrl(huge)).rejects.toThrowError(/上限/);
  });

  it('filesToDataUrls：按上限截断（多的不收，不报错）', async () => {
    const urls = await filesToDataUrls([img(), img(), img()], { maxImages: 2 });
    expect(urls).toHaveLength(2);
  });
});

describe('vision · 识图调用（同一条传输层）', () => {
  it('单批：一次 once 请求，消息里带 image_url 段 + 系统提示词', async () => {
    const transport = createFakeTransport([], { onceReply: () => '```json\n{"heroes":[{"name":"曹操","faction":"魏","troopType":"骑"}]}\n```' });
    const res = await recognizeBox({ images: ['data:image/png;base64,AAA'], transport });
    expect(res.raw.heroes?.[0].name).toBe('曹操');
    expect(transport.onceRequests).toHaveLength(1);
    const req = transport.onceRequests[0];
    expect(req.tools).toEqual([]);
    expect(req.messages[0].content).toContain('读图员');
    expect(req.messages[1].images).toEqual(['data:image/png;base64,AAA']);
    expect(req.messages[1].content).toContain('1 张');
  });

  it('多批：`perRequest:1` → 逐张请求并合并，进度回调走完', async () => {
    let n = 0;
    const transport = createFakeTransport([], {
      onceReply: () => {
        n += 1;
        return `{"heroes":[{"name":"第${n}将"}]}`;
      },
    });
    const seen: number[] = [];
    const res = await recognizeBox({
      images: ['data:image/png;base64,A', 'data:image/png;base64,B'],
      transport,
      perRequest: 1,
      onProgress: (p) => seen.push(p.done),
    });
    expect(transport.onceRequests).toHaveLength(2);
    expect(res.raw.heroes?.map((h) => h.name)).toEqual(['第1将', '第2将']);
    expect(seen.at(-1)).toBe(2);
  });

  it('传输层没有 once() → 退回 chat() 拼文本（测试的假传输同样支持）', async () => {
    const transport = createFakeTransport([{ text: '{"skills":[{"name":"大赏三军"}]}' }]);
    const res = await recognizeBox({ images: ['data:image/png;base64,A'], transport });
    expect(res.raw.skills?.[0].name).toBe('大赏三军');
  });

  it('没有图 / 超过张数上限 → 明确报错；模型答非所问 → format 错', async () => {
    const transport = createFakeTransport([], { onceReply: () => '随便说点什么' });
    await expect(recognizeBox({ images: [], transport })).rejects.toThrowError(/没有可识别的截图/);
    await expect(recognizeBox({ images: Array(MAX_IMAGES + 1).fill('data:image/png;base64,A'), transport })).rejects.toThrowError(/最多识别/);
    await expect(recognizeBox({ images: ['data:image/png;base64,A'], transport })).rejects.toThrowError(/不是能认的 JSON/);
  });

  it('干跑示例回复可以被解析（界面上的干跑链路演示要用它）', () => {
    const raw = parseBoxReply(SAMPLE_BOX_REPLY);
    expect(raw.heroes?.length).toBe(4);
    expect(raw.skills?.length).toBe(2);
    // 混了一条"不存在的将" → 会在 box.ts 的对齐里落到待确认（这里只锁解析层）
    expect(raw.heroes?.some((h) => h.name === '不存在的将')).toBe(true);
  });
});
