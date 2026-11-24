/**
 * 武将皮肤外观（2026-11-17）。
 *
 * 数据源 `web/data/skins.json`：{ [heroKey]: { heroId, skins: SkinDef[] } }，
 * 素材在 `public/skins/`（从客户端 `card_2d_videos/big_<hid>_<n>.nbs` 解出的 webm + 封面 webp）。
 *
 * 「默认」永远是第 0 项，不需要素材（用 portraitSrc 的卡面立绘）。
 * 玩家的选择按武将存 localStorage —— 换皮肤后配将页大图、战报页都跟着换。
 */
import skinsJson from './data/skins.json';
import assetVerJson from './data/asset_ver.json';
import { asset } from './assets';
import { portraitSrc } from './heroes';

export interface SkinDef {
  /** 'default' 或皮肤 id */
  id: string;
  name: string;
  /** 封面（静态，也用作 <video poster>） */
  poster: string;
  /** 循环段视频（静音自动播放），空串 = 静态立绘 */
  loop: string;
  /** 入场段视频（可选，播完接 loop） */
  intro: string;
  /** 小尺寸循环段（配将页槽位卡只有 56px 宽，用 216×314 的版本省解码开销） */
  small: string;
  /** 单独的 CG 动画（可选，横版，详情页可点开全屏看） */
  cg: string;
  /** 风尚值（游戏内展示用，纯展示） */
  cost?: number;
}

interface RawSkin {
  id: string;
  name: string;
  poster?: string;
  loop?: string;
  intro?: string;
  small?: string;
  cg?: string;
  cost?: number;
}

const RAW = skinsJson as {
  heroes: Record<
    string,
    {
      heroId: number;
      /** 默认外观自带的动态段（客户端外观页里默认卡也在播，没有则退回静态立绘） */
      defaultMedia?: { loop?: string; intro?: string; small?: string };
      skins: RawSkin[];
    }
  >;
};

const SKIN_VER: string | undefined = (assetVerJson as Record<string, string>).skins;

/** 素材指纹：public/skins/ 的 webm/webp 文件名不带 hash，必须拼 ?v= 才会在换素材后失效 */
function withVer(url: string): string {
  if (!url) return '';
  if (!SKIN_VER) return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(SKIN_VER);
}

const cache = new Map<string, SkinDef[]>();

/** 该武将可选的外观列表；第 0 项恒为「默认」，无皮肤时长度为 1 */
export function skinsOf(heroId: string): SkinDef[] {
  const hit = cache.get(heroId);
  if (hit) return hit;
  const entry = RAW.heroes[heroId];
  const media = entry?.defaultMedia;
  const list: SkinDef[] = [
    {
      id: 'default',
      name: '原画像',
      poster: portraitSrc(heroId),
      loop: withVer(asset(media?.loop ?? '')),
      intro: withVer(asset(media?.intro ?? '')),
      small: withVer(asset(media?.small ?? '')),
      cg: '',
    },
  ];
  for (const s of entry?.skins ?? []) {
    list.push({
      id: s.id,
      name: s.name,
      poster: withVer(asset(s.poster ?? '')),
      loop: withVer(asset(s.loop ?? '')),
      intro: withVer(asset(s.intro ?? '')),
      small: withVer(asset(s.small ?? '')),
      cg: withVer(asset(s.cg ?? '')),
      cost: s.cost,
    });
  }
  cache.set(heroId, list);
  return list;
}

/** 是否值得显示「外观」板块：有额外皮肤，或默认外观自带动态段 */
export function hasSkins(heroId: string): boolean {
  const list = skinsOf(heroId);
  return list.length > 1 || !!list[0].loop;
}

const KEY = (heroId: string) => `stzb_skin_${heroId}`;

/** 当前选中的皮肤 id（存的是 id 不是下标，数据增删不会错位） */
export function activeSkinId(heroId: string): string {
  try {
    const id = localStorage.getItem(KEY(heroId));
    if (id && skinsOf(heroId).some((s) => s.id === id)) return id;
  } catch {
    /* 隐私模式禁用 localStorage：退回默认 */
  }
  return 'default';
}

export function setActiveSkin(heroId: string, skinId: string): void {
  try {
    if (skinId === 'default') localStorage.removeItem(KEY(heroId));
    else localStorage.setItem(KEY(heroId), skinId);
  } catch {
    /* 同上，静默失败：本次会话内仍按 state 走 */
  }
}

/** 当前应展示的外观（默认项也返回，统一调用方逻辑） */
export function currentSkin(heroId: string): SkinDef {
  const list = skinsOf(heroId);
  const id = activeSkinId(heroId);
  return list.find((s) => s.id === id) ?? list[0];
}

/**
 * 配将页大图 / 战报页要用的静态图：选中的皮肤封面，未选皮肤时返回空串让调用方沿用原立绘。
 * （视频只在详情页「外观」板块播放，列表与战报用封面，避免几十个 video 同时解码。）
 */
export function skinPosterSrc(heroId: string): string {
  const s = currentSkin(heroId);
  return s.id === 'default' ? '' : s.poster;
}
