/**
 * 抓取《率土之滨》官网「宝物库」数据（网易官方 CDN，服务端 JSON，无需 JS 渲染）
 *
 * 官方页面：
 *   https://stzb.163.com/baowu_list.html            宝物库（列表）
 *   https://stzb.163.com/baowulist/{id}.html        单个宝物详情（含「锻造效果」词条组）
 * 官方数据：
 *   https://g0.gph.netease.com/ngsocial/community/stzb/cfg/gear_id.json?gameid=g10
 *     → 全部宝物（114 件：精品 38 / 罕俦 38 / 稀世 38），含 skillName+skillDesc（宝物自带特效）
 *   https://g0.gph.netease.com/ngsocial/community/stzb/cfg/gear_feature_extra.json?gameid=g10
 *     → 12 个「锻造词条组」，每组 6~7 条词条（effectName + effectDesc）
 *   gear_id.json 的 featureGroup == 详情页「锻造效果」的 data-xiaoguo，即该宝物的锻造词条池
 * 官方图片：
 *   https://g0.gph.netease.com/ngsocial/community/stzb/cn/gears/watermark/gear_watermark_{id}.jpg?gameid=g10  150×240
 *   https://g0.gph.netease.com/ngsocial/community/stzb/cn/gears/gear_icon/gear_icon_{id}.jpg?gameid=g10         100×100
 *
 * 输出：dateyuan/宝物数据.json（官方原始字段 + 派生 affixPool / 图片路径）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outFile = path.join(root, 'dateyuan/宝物数据.json');

const CFG = 'https://g0.gph.netease.com/ngsocial/community/stzb/cfg';
const LIST_URL = `${CFG}/gear_id.json?gameid=g10`;
const FEATURE_URL = `${CFG}/gear_feature_extra.json?gameid=g10`;
const IMG_WM = 'https://g0.gph.netease.com/ngsocial/community/stzb/cn/gears/watermark';
const IMG_ICON = 'https://g0.gph.netease.com/ngsocial/community/stzb/cn/gears/gear_icon';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const [gears, featureGroups] = await Promise.all([getJson(LIST_URL), getJson(FEATURE_URL)]);

const groupById = new Map(featureGroups.map((g) => [g.groupId, g]));
const affixGroups = [...featureGroups]
  .sort((a, b) => a.groupId - b.groupId)
  .map((g) => ({
    groupId: g.groupId,
    affixCount: g.featureInfo.length,
    affixes: g.featureInfo.map((f) => ({ name: f.effectName, desc: f.effectDesc })),
  }));

const treasures = [...gears]
  .sort((a, b) => a.featureGroup - b.featureGroup || a.id - b.id)
  .map((g) => {
    const pool = groupById.get(g.featureGroup)?.featureInfo ?? [];
    return {
      id: g.id,
      name: g.name,
      quality: g.quality, // 精品 / 罕俦 / 稀世
      type: g.type, // 刀 / 剑 / 长兵 / 弓 / 扇 / 其他
      // 宝物自带特效（未锻造；随突破 5 级 / 10 级逐条开启）
      skillName: g.skillName,
      skillDesc: g.skillDesc,
      // 内政类宝物（type=其他）用政策代替特效
      policyName: g.policyName,
      policyDesc: g.policyDesc,
      obtain: g.obtain,
      condition: g.condition,
      desc: g.desc,
      // 锻造相关
      featureGroup: g.featureGroup,
      affixPool: pool.map((f) => f.effectName), // 该宝物的锻造词条池（详情页「锻造效果」）
      // 官方原始字段（含义待考，勿臆断）
      woodAdvance: g.woodAdvance,
      ironAdvance: g.ironAdvance,
      woodForge: g.woodForge,
      ironForge: g.ironForge,
      woodEnchant: g.woodEnchant,
      ironEnchant: g.ironEnchant,
      // 图片（本地 public/ 路径 + 官方 CDN）
      imageUrl: `${IMG_WM}/gear_watermark_${g.id}.jpg?gameid=g10`,
      iconUrl: `${IMG_ICON}/gear_icon_${g.id}.jpg?gameid=g10`,
      image: `/gears/gear_${g.id}.jpg`,
      icon: `/gears/gear_${g.id}_s.jpg`,
      detailPage: `https://stzb.163.com/baowulist/${g.id}.html`,
    };
  });

const byQuality = {};
for (const t of treasures) byQuality[t.quality] = (byQuality[t.quality] ?? 0) + 1;

const out = {
  source: {
    listPage: 'https://stzb.163.com/baowu_list.html',
    detailPage: 'https://stzb.163.com/baowulist/{id}.html',
    treasureListJson: LIST_URL,
    forgeAffixGroupJson: FEATURE_URL,
    imageCdn: { watermark: `${IMG_WM}/gear_watermark_{id}.jpg?gameid=g10`, icon: `${IMG_ICON}/gear_icon_{id}.jpg?gameid=g10` },
    note: '网易官网「宝物库」服务端 JSON 快照。featureGroup 即该宝物详情页「锻造效果」词条组；affixPool 为其全部可选词条。',
  },
  stats: { total: treasures.length, byQuality, affixGroups: affixGroups.length },
  affixGroups,
  treasures,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${path.relative(root, outFile)}：宝物 ${treasures.length}（${JSON.stringify(byQuality)}），词条组 ${affixGroups.length}`);
