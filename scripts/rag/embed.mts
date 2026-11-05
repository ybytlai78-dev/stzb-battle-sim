#!/usr/bin/env tsx
/**
 * 云端 embedding（OpenAI 兼容 /v1/embeddings，bge-m3 1024 维）。
 *
 * 只发**渲染后的正文**，不发原始 .bin / JSON —— 原始数据表不出本机（见设计 §五）。
 * key 从环境变量读，绝不写进仓库：`EMBED_KEY=sk-xxx npx tsx scripts/rag/embed.mts`
 *
 * 用法：
 *   npx tsx scripts/rag/embed.mts --limit 200        # 小样验证
 *   npx tsx scripts/rag/embed.mts                    # 全量（断点续传）
 *   npx tsx scripts/rag/embed.mts --check            # 只报告缺口，不发请求
 */
import { existsSync, openSync, readFileSync, writeFileSync, writeSync, closeSync } from 'node:fs';

export interface EmbedConfig {
  url: string;
  model: string;
  key: string;
  dim: number;
}

export const DEFAULT_URL = 'https://api.siliconflow.cn/v1/embeddings';
export const DEFAULT_MODEL = 'BAAI/bge-m3';

/** bge-m3 单条上限 8192 token；中文约 1.5 token/字，取 2000 字符留足余量 */
export const MAX_CHARS = 2000;

export function readConfig(env: Record<string, string | undefined> = process.env): EmbedConfig {
  const key = env.EMBED_KEY ?? env.OPENAI_API_KEY ?? '';
  return {
    url: env.EMBED_URL ?? DEFAULT_URL,
    model: env.EMBED_MODEL ?? DEFAULT_MODEL,
    key,
    dim: Number(env.EMBED_DIM ?? 1024),
  };
}

export function embedInput(doc: { docId: string; body: string }): string {
  // 标题行已经含名称与 id，正文截断后仍保留可检索前缀
  const text = String(doc.body ?? '').replace(/\s+/g, ' ').trim();
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

/** 单批调用；失败按指数退避重试，最终抛错由调用方记录 */
export async function embedBatch(texts: string[], cfg: EmbedConfig, retries = 3): Promise<number[][]> {
  if (!cfg.key) throw new Error('缺少 EMBED_KEY 环境变量');
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, input: texts, encoding_format: 'float' }),
      });
      if (!res.ok) {
        const body = await res.text();
        // 429 / 5xx 可重试；4xx 其余直接失败，避免浪费额度
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
        throw Object.assign(new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`), { fatal: true });
      }
      const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      const vecs = (json.data ?? []).map((d) => d.embedding);
      if (vecs.length !== texts.length) throw new Error(`返回条数不符：${vecs.length} ≠ ${texts.length}`);
      return vecs;
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) throw e;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface EmbedResult {
  vectors: Float32Array[];
  /** vectors 每项在输入里的原始下标 —— 有失败项时不能靠顺序推断，否则向量与文档会错位 */
  index: number[];
  failed: Array<{ docId: string; error: string }>;
  tokens: number;
}

/** 批量 + 并发；单条失败不影响整批，缺口写进 failed */
export async function embedDocs(
  docs: Array<{ docId: string; body: string }>,
  cfg: EmbedConfig,
  opt: { batch?: number; concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<EmbedResult> {
  const batch = opt.batch ?? 16;
  const concurrency = Math.max(1, opt.concurrency ?? 4);
  const batches: Array<Array<{ i: number; text: string }>> = [];
  for (let i = 0; i < docs.length; i += batch) {
    batches.push(docs.slice(i, i + batch).map((d, k) => ({ i: i + k, text: embedInput(d) })));
  }

  const out: Array<Float32Array | null> = new Array(docs.length).fill(null);
  const failed: Array<{ docId: string; error: string }> = [];
  let done = 0;
  let cursor = 0;
  let tokens = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = cursor++;
      if (idx >= batches.length) return;
      const b = batches[idx];
      try {
        const vecs = await embedBatch(
          b.map((x) => x.text),
          cfg
        );
        for (let k = 0; k < b.length; k++) out[b[k].i] = Float32Array.from(vecs[k]);
        tokens += b.reduce((s, x) => s + x.text.length, 0);
      } catch (e) {
        for (const x of b) failed.push({ docId: docs[x.i].docId, error: e instanceof Error ? e.message : String(e) });
      }
      done += b.length;
      opt.onProgress?.(done, docs.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length || 1) }, worker));
  const index: number[] = [];
  const vectors: Float32Array[] = [];
  out.forEach((v, i) => {
    if (v) {
      index.push(i);
      vectors.push(v);
    }
  });
  return { vectors, index, failed, tokens };
}

/** 把向量按行铺成 Float32Array 二进制（n × dim），配合 meta.json 的顺序使用 */
export function writeVectors(path: string, vectors: Float32Array[]): void {
  const dim = vectors[0]?.length ?? 0;
  const fd = openSync(path, 'w');
  try {
    for (const v of vectors) writeSync(fd, Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  } finally {
    closeSync(fd);
    void dim;
  }
}

export function readVectors(path: string): { data: Float32Array; count: number; dim: number } {
  const buf = readFileSync(path);
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const dim = Number(process.env.EMBED_DIM ?? 1024);
  return { data, count: data.length / dim, dim };
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string, d: string): string => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const docsPath = flag('--docs', '.rag/docs.jsonl');
  const outPath = flag('--out', '.rag/vectors.f32');
  const metaPath = flag('--meta', '.rag/vectors.meta.json');
  const limit = Number(flag('--limit', '0')) || 0;
  const checkOnly = argv.includes('--check');

  if (!existsSync(docsPath)) {
    console.error(`找不到 ${docsPath}，先跑 npm run rag:build`);
    process.exit(1);
  }
  const docs = readFileSync(docsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { docId: string; body: string });
  const target = limit ? docs.slice(0, limit) : docs;

  if (checkOnly) {
    const have = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')) as { count: number }).count : 0;
    console.log(`语料 ${docs.length} 篇 | 已嵌入 ${have} 篇 | 缺口 ${docs.length - have} 篇`);
    return;
  }

  const cfg = readConfig();
  if (!cfg.key) {
    console.error('缺少 EMBED_KEY。用法：EMBED_KEY=sk-xxx npx tsx scripts/rag/embed.mts');
    process.exit(1);
  }

  const t0 = Date.now();
  let lastPrint = 0;
  const res = await embedDocs(target, cfg, {
    onProgress: (done, total) => {
      const now = Date.now();
      if (now - lastPrint > 3000 || done === total) {
        lastPrint = now;
        console.log(`  ${done}/${total}  ${((now - t0) / 1000).toFixed(0)}s`);
      }
    },
  });

  writeVectors(outPath, res.vectors);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        model: cfg.model,
        url: cfg.url,
        dim: res.vectors[0]?.length ?? 0,
        count: res.vectors.length,
        total: target.length,
        chars: res.tokens,
        generatedAt: new Date().toISOString(),
        docIds: res.index.map((i) => target[i].docId),
      },
      null,
      2
    )
  );

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `完成 ${res.vectors.length}/${target.length} 篇 | ${secs}s | 失败 ${res.failed.length} | 字符 ${res.tokens} → ${outPath}`
  );
  for (const f of res.failed.slice(0, 10)) console.log(`  ✗ ${f.docId}: ${f.error}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/rag/embed.mts')) void main();
