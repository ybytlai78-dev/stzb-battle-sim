# -*- coding: utf-8 -*-
"""率土之滨客户端 tcfg 表抽取 —— 武将四维/成长、主战法效果值/成长率、机制码核对。

数据源：MuMu 里已安装客户端的 base.apk（assets 内按 murmur3 路径哈希命名的 *.bin），
也可指向已解包目录（同层有 _paths.txt + 哈希命名的 bin）。

数值口径（与 docs/成长率反推规律速查.md 一致，已用皇裔流离 200016 对拍）：
  效果基值   = constant_param + 0.4 × intel_param
  每点成长率 = intel_param / 200
  发动率     = probability_max ÷ 100
  武将属性   = 整数字段 ÷ 100（四维 / 成长同口径）

用法：
  python scripts/_stzb_tcfg.py --apk base.apk --verify
  python scripts/_stzb_tcfg.py --apk base.apk --hero 刘秀 --out <dir>
  python scripts/_stzb_tcfg.py --apk base.apk --find 刘 --limit 40
  python scripts/_stzb_tcfg.py --dir <unpacked/others> --hero 刘秀 --old-dict <tb_cfg_skill_effect.json>

验收判据（每张表）：键数==行数 ∧ 首字段与键逐位一致 ∧ 数据区残差==0。
"""
import argparse
import json
import os
import re
import struct
import sys
import zipfile

SEED = 0x9747B28C


# ---------------------------------------------------------------- murmur3
def murmur3_x86_32(data: bytes, seed: int = SEED) -> int:
    c1, c2 = 0xCC9E2D51, 0x1B873593
    n = len(data)
    h1 = seed & 0xFFFFFFFF
    r = n & ~3
    for i in range(0, r, 4):
        k1 = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)
        k1 = (k1 * c1) & 0xFFFFFFFF
        k1 = ((k1 << 15) | (k1 >> 17)) & 0xFFFFFFFF
        k1 = (k1 * c2) & 0xFFFFFFFF
        h1 ^= k1
        h1 = ((h1 << 13) | (h1 >> 19)) & 0xFFFFFFFF
        h1 = (h1 * 5 + 0xE6546B64) & 0xFFFFFFFF
    k1 = 0
    t = n & 3
    if t == 3:
        k1 ^= data[r + 2] << 16
    if t >= 2:
        k1 ^= data[r + 1] << 8
    if t >= 1:
        k1 ^= data[r]
        k1 = (k1 * c1) & 0xFFFFFFFF
        k1 = ((k1 << 15) | (k1 >> 17)) & 0xFFFFFFFF
        k1 = (k1 * c2) & 0xFFFFFFFF
        h1 ^= k1
    h1 ^= n
    h1 ^= h1 >> 16
    h1 = (h1 * 0x85EBCA6B) & 0xFFFFFFFF
    h1 ^= h1 >> 13
    h1 = (h1 * 0xC2B2AE35) & 0xFFFFFFFF
    h1 ^= h1 >> 16
    return h1 & 0xFFFFFFFF


# ---------------------------------------------------------------- 表结构
# 字段分组顺序取自反编译的 Tcfg_xxx.ReadFromMemoryPack()，不是猜的。
HERO_SPEC = {
    'key': 'heroid',
    'groups': [
        ('i', ['heroid', 'cost', 'hero_type', 'hit_range', 'attack_base', 'defence_base', 'intel_base',
               'speed_base', 'destroy_base', 'attack_grow', 'defence_grow', 'intel_grow', 'speed_grow',
               'destroy_grow', 'skill_init']),
        ('i', ['base_hero_id', 'icon_hero_id', 'hero_type_feature', 'season', 'book_type', 'valid_time',
               'release_time', 'policy_id', 'title_heroid', 'achieve_heroid',
               'free_forget_skill_activity_id', 'free_forget_skill_time', 'fashion', 'show_priority',
               'balance_activity_id']),
        ('i', ['balance_skill_reset', 'balance_policy_reset', 'balance_policy_time_limit']),
        ('b', ['country', 'quality', 'sex', 'space_type', 'is_season_card', 'is_release', 'is_op',
               'is_sp_card', 'is_memorize_card', 'is_baijia_hero']),
    ],
    'arrays': ['hero_type_availible', 'func_availible'],
    'strings': ['name', 'author', 'description', 'birth_and_death_year', 'second_name',
                'hero_features_availible', 'share_description', 'head_icon_ids', 'tag',
                'facade_ex_hero_id', 'balance_description'],
}

SKILL_SPEC = {
    'key': 'skill_id',
    'groups': [
        ('i', ['skill_id', 'skill_quality', 'skill_quality_view', 'hit_range', 'prepare',
               'probability_init', 'probability_max', 'main_detail', 'season']),
        ('b', ['skill_type', 'show_skill_type', 'counselor', 'side_only', 'special']),
    ],
    'arrays': [],
    'strings': ['name', 'description', 'target_description', 'skill_mark_type', 'flag',
                'skill_quality_level', 'tag', 'brief_description'],
}

DETAIL_SPEC = {
    'key': 'detail_id',
    'groups': [
        ('i', ['detail_id', 'effect_id', 'effect_param', 'calc_pos', 'calc_param', 'attack_type',
               'select_skill_param', 'target_type', 'select_type', 'flag_add_round', 'available_hit',
               'hit_by_hit', 'init_effect_ratio', 'intel_param', 'constant_param']),
        ('i', ['prob_init_param', 'prob_max_param', 'display_param', 'bind_flag', 'cast_condition',
               'precondition', 'condition', 'lock_flag', 'add_count_max', 'report_show_type',
               'report_id', 'custom_select_flag']),
        ('b', ['buff_type', 'attack_max', 'target_country', 'select_attri', 'delay_round', 'delay_hit',
               'available_round', 'clear_per_hit', 'attri_type', 'select_flag', 'inherent',
               'value_add_max', 'shi_qi_affect', 'hide_conflict']),
    ],
    'arrays': [],
    'strings': ['prob_series', 'calc_type'],
}

EFFECT_SPEC = {
    'key': 'effect_id',
    'groups': [
        ('i', ['effect_id', 'show_priority', 'virtual']),
        ('b', ['buff_type', 'replace_type', 'value_type']),
    ],
    'arrays': [],
    'strings': ['name', 'tips'],
}

EFFECT_MAP_SPEC = {
    'key': 'skill_id',
    'groups': [('i', ['skill_id'])],
    'arrays': [],
    'strings': ['name', 'effect'],
}

TABLES = {
    'hero': ['res/csharp/data/tcfg/default/tb_cfg_hero.bin',
             'res/csharp/data/tcfg/tb_cfg_hero.bin'],
    'skill': ['res/csharp/data/tcfg/default/tb_cfg_skill.bin',
              'res/csharp/data/tcfg/tb_cfg_skill.bin'],
    'detail': ['res/csharp/data/tcfg/tb_cfg_skill_detail.bin',
               'res/csharp/data/tcfg/default/tb_cfg_skill_detail.bin'],
    'effect': ['res/csharp/data/tcfg/tb_cfg_skill_effect.bin',
               'res/csharp/data/tcfg/default/tb_cfg_skill_effect.bin'],
    'effect_map': ['res/csharp/data/tcfg/tb_cfg_skill_effect_map.bin',
                   'res/csharp/data/tcfg/default/tb_cfg_skill_effect_map.bin'],
}

SPECS = {'hero': HERO_SPEC, 'skill': SKILL_SPEC, 'detail': DETAIL_SPEC,
         'effect': EFFECT_SPEC, 'effect_map': EFFECT_MAP_SPEC}


# ---------------------------------------------------------------- 读取层
class ApkSource:
    """base.apk：条目名可能是原始路径，也可能是 murmur3 路径哈希。"""

    def __init__(self, path):
        self.kind = 'apk'
        self.path = path
        self.zf = zipfile.ZipFile(path)
        self.byhash = {}
        self.bytail = {}
        for n in self.zf.namelist():
            base = n.rsplit('/', 1)[-1]
            low = base.lower()
            if low.endswith('.bin'):
                self.byhash.setdefault(low[:-4], n)
            self.bytail.setdefault('/' + n.rsplit('/', 1)[-1].lower(), n)
        self.tail_index = None

    def _read(self, entry):
        return self.zf.read(entry)

    def read(self, res_path):
        rel = res_path[4:] if res_path.startswith('res/') else res_path
        # 1) 原始路径（含 assets/ 前缀的存储）
        cand = self.bytail.get('/' + rel.rsplit('/', 1)[-1].lower())
        if cand and cand.lower().endswith('/' + rel.lower().replace('\\', '/')):
            return self._read(cand)
        # 2) 路径哈希
        for sep in ('\\', '/'):
            for p in (rel, 'res/' + rel):
                h = '%08x' % murmur3_x86_32(p.replace('/', sep).encode('utf-8'))
                if h in self.byhash:
                    return self._read(self.byhash[h])
        return None


class NpkSource:
    """NeoX `.npk` 资源包。

    布局：header 24B = [b'NXPK'][u32 文件数][u32 0][u32 0][u32 0][u32 索引偏移]，
    索引 = 文件数 × 28B 记录 = {u32 路径哈希, u32 偏移, u32 压缩长, u32 原始长, u64 校验, u32 压缩类型}
    （类型 3 = zstd 单帧，0 = 原样存储）。路径哈希 = murmur3(去 res/ 前缀、反斜杠化, seed 0x9747B28C)。
    """

    MAGIC = b'NXPK'

    def __init__(self, path):
        self.kind = 'npk'
        self.path = path
        with open(path, 'rb') as f:
            self.data = f.read()
        if self.data[:4] != self.MAGIC:
            raise SystemExit('不是 NXPK 包：%s' % path)
        self.count = struct.unpack_from('<I', self.data, 4)[0]
        idx_off = struct.unpack_from('<I', self.data, 0x14)[0]
        self.recs = {}
        for k in range(self.count):
            h, off, csz, usz, _c1, _c2, ctype = struct.unpack_from('<7I', self.data, idx_off + k * 28)
            self.recs['%08x' % h] = (off, csz, usz, ctype)
        self._dctx = None

    def read(self, res_path):
        rel = res_path[4:] if res_path.startswith('res/') else res_path
        for sep in ('\\', '/'):
            for p in (rel, 'res/' + rel):
                key = '%08x' % murmur3_x86_32(p.replace('/', sep).encode('utf-8'))
                rec = self.recs.get(key)
                if not rec:
                    continue
                off, csz, usz, ctype = rec
                if csz == 0:
                    return None
                raw = self.data[off:off + csz]
                if ctype == 3:
                    if self._dctx is None:
                        import zstandard
                        self._dctx = zstandard.ZstdDecompressor()
                    return self._dctx.decompressobj().decompress(raw)
                return raw
        return None


class DirSource:
    def __init__(self, root):
        self.kind = 'dir'
        self.path = root
        self.byhash = {}
        self.bytail = {}
        for dp, _dn, fns in os.walk(root):
            for fn in fns:
                full = os.path.join(dp, fn)
                low = fn.lower()
                if low.endswith('.bin'):
                    self.byhash.setdefault(low[:-4], full)
                self.bytail.setdefault('/' + low, full)

    def read(self, res_path):
        rel = res_path[4:] if res_path.startswith('res/') else res_path
        cand = self.bytail.get('/' + rel.rsplit('/', 1)[-1].lower())
        if cand and cand.lower().endswith(os.path.sep + rel.lower().replace('/', os.path.sep)):
            return open(cand, 'rb').read()
        for sep in ('\\', '/'):
            for p in (rel, 'res/' + rel):
                h = '%08x' % murmur3_x86_32(p.replace('/', sep).encode('utf-8'))
                if h in self.byhash:
                    return open(self.byhash[h], 'rb').read()
        return None


# ---------------------------------------------------------------- 解析
def load_pool(d):
    md_len = struct.unpack_from('<I', d, 0)[0]
    st = d[4:4 + md_len]
    o = 0
    cnt = struct.unpack_from('<I', st, o)[0]
    o += 4
    pool = []
    for _ in range(cnt):
        n = struct.unpack_from('<I', st, o)[0]
        o += 4
        pool.append(st[o:o + n * 2].decode('utf-16le', 'replace'))
        o += n * 2
    assert o == len(st), '字符串池未零泄漏: %d != %d' % (o, len(st))
    return pool, 4 + md_len


def parse_rows(buf, spec):
    pool, doff = load_pool(buf)
    data = buf[doff:]
    prop = data[0]
    nkeys = struct.unpack_from('<I', data, 1)[0]
    keys = list(struct.unpack_from('<%dI' % nkeys, data, 5))
    i = 5 + nkeys * 4
    nrows = struct.unpack_from('<I', data, i)[0]
    i += 4
    rows = []
    for _ in range(nrows):
        oh = data[i]
        i += 1
        rec = {'__objHdr': oh}
        for ctype, names in spec['groups']:
            if ctype == 'i':
                for nm in names:
                    rec[nm] = struct.unpack_from('<i', data, i)[0]
                    i += 4
            else:
                for nm in names:
                    rec[nm] = struct.unpack_from('<b', data, i)[0]
                    i += 1
        for nm in spec['arrays']:
            n = struct.unpack_from('<I', data, i)[0]
            i += 4
            rec[nm] = list(struct.unpack_from('<%di' % n, data, i))
            i += n * 4
        for nm in spec['strings']:
            idx = struct.unpack_from('<i', data, i)[0]
            i += 4
            rec[nm] = None if idx == -1 else pool[idx]
        rows.append(rec)
    return {
        'keys': keys, 'rows': rows, 'nKeys': nkeys, 'nRows': nrows,
        'pool': len(pool), 'propCount': prop, 'residual': len(data) - i,
        'objHdrs': sorted({r['__objHdr'] for r in rows}) if rows else [],
    }


def load_table(src, name, quiet=False):
    for res_path in TABLES[name]:
        buf = src.read(res_path)
        if buf is None:
            continue
        try:
            r = parse_rows(buf, SPECS[name])
        except Exception as ex:  # 结构变更时给出可诊断信息，而不是静默空表
            print('  [FAIL] %s <- %s: %s: %s' % (name, res_path, type(ex).__name__, ex))
            continue
        r['src'] = res_path
        r['keyField'] = SPECS[name]['key']
        align = sum(1 for k, row in zip(r['keys'], r['rows']) if row[SPECS[name]['key']] == k)
        r['keyAlign'] = align
        r['ok'] = (align == r['nKeys'] and r['residual'] == 0)
        if not quiet:
            print('  %-10s <- %s' % (name, res_path))
            print('    键=%d 行=%d 对齐=%d/%d 残差=%d 池=%d objHdr=%s  %s'
                  % (r['nKeys'], r['nRows'], align, r['nKeys'], r['residual'], r['pool'],
                     r['objHdrs'], 'OK' if r['ok'] else 'FAIL'))
        return r
    print('  [MISS] %s: 未在数据源中找到（试过 %d 个路径）' % (name, len(TABLES[name])))
    return None


# ---------------------------------------------------------------- 展示
QL = {1: '一星', 2: '二星', 3: '三星', 4: '四星', 5: '五星'}
COUNTRY = {0: '无', 1: '魏', 2: '蜀', 3: '吴', 4: '群', 5: '晋', 6: '汉', 7: '他'}
SKILL_TYPE = {0: '无', 1: '指挥', 2: '被动', 3: '主动', 4: '追击', 5: '内政'}
BASE_TROOP = {1: '弓', 2: '步', 3: '骑'}
CODE_TO_TROOP = {
    11: '长弓兵', 21: '弩兵', 31: '死士', 12: '重步兵', 22: '长枪兵', 32: '禁卫',
    42: '藤甲兵', 52: '蛮兵', 13: '重骑兵', 23: '轻骑兵', 33: '弓骑兵', 43: '铁骑兵',
    53: '象兵', 101: '解烦兵', 102: '白毦兵', 153: '西凉铁骑', 172: '白衣死士',
    173: '木牛流马',
}


def h100(v):
    """整数百分位字段 → 两位小数字符串。"""
    if v is None:
        return 'None'
    return ('%.2f' % (v / 100.0)).rstrip('0').rstrip('.')


def growth(intel_param):
    """intel_param → 每点成长率（0.005 整数倍）。"""
    return intel_param / 200.0


def fmt_rate(v):
    return '%.4g%%' % (v / 100.0)


def detail_family(details, root_detail_id, max_depth=3):
    """按 detail_id//100 归族，递归展开 122/123（子技能容器）引用的 constant_param 族。"""
    seen = set()
    out = []

    def walk(family, depth):
        if depth > max_depth or family in seen:
            return
        seen.add(family)
        rows = sorted([d for did, d in details.items() if did // 100 == family],
                      key=lambda x: x['detail_id'])
        for r in rows:
            out.append((depth, r))
            if r['effect_id'] in (122, 123) and r['constant_param'] > 0:
                walk(r['constant_param'], depth + 1)

    walk(root_detail_id // 100, 0)
    if not out:
        root = details.get(root_detail_id)
        if root:
            out.append((0, root))
    return out


def print_hero(src, target, out_dir, old_dict_path, repo_root, tables):
    hero_t, skill_t, detail_t, effect_t, map_t = tables['hero'], tables['skill'], tables['detail'], \
        tables['effect'], tables['effect_map']
    if not hero_t:
        return None
    hits = [r for r in hero_t['rows'] if r['name'] and target in r['name']]
    print('\n=== 命中武将：%s ===' % ('、'.join(h['name'] for h in hits) if hits else '无'))
    if not hits:
        return None

    skills = {r['skill_id']: r for r in skill_t['rows']} if skill_t else {}
    details = {r['detail_id']: r for r in detail_t['rows']} if detail_t else {}
    effects = {r['effect_id']: r for r in effect_t['rows']} if effect_t else {}
    emap = {r['skill_id']: r for r in map_t['rows']} if map_t else {}

    repo_codes = set()
    mech_path = os.path.join(repo_root, 'src', 'data', 'mechanisms.ts')
    if os.path.exists(mech_path):
        txt = open(mech_path, encoding='utf-8').read()
        repo_codes = {int(m) for m in re.findall(r'code:\s*(\d+)', txt)}

    old_codes = set()
    if old_dict_path and os.path.exists(old_dict_path):
        od = json.load(open(old_dict_path, encoding='utf-8'))
        rows = od.get('rows', od)
        old_codes = {int(k) for k in rows.keys()}

    bundle = {'target': target, 'heroes': [], 'repoCodes': sorted(repo_codes)}
    for h in hits:
        print('\n--- heroid=%d  name=%s  second_name=%s' % (h['heroid'], h['name'], h['second_name']))
        print('    阵营=%s 品质=%s 兵种=%s(%s) 可用=%s 统率=%s 攻击距离=%s 赛季=%s'
              % (COUNTRY.get(h['country'], h['country']), QL.get(h['quality'], h['quality']),
                 BASE_TROOP.get(h['hero_type'], h['hero_type']), h['hero_type'],
                 ','.join(CODE_TO_TROOP.get(c, str(c)) for c in h['hero_type_availible']) or '-',
                 h['cost'], h['hit_range'], h['season']))
        print('    四维  攻击 %s(+%s)  防御 %s(+%s)  谋略 %s(+%s)  速度 %s(+%s)  攻城 %s(+%s)'
              % (h100(h['attack_base']), h100(h['attack_grow']),
                 h100(h['defence_base']), h100(h['defence_grow']),
                 h100(h['intel_base']), h100(h['intel_grow']),
                 h100(h['speed_base']), h100(h['speed_grow']),
                 h100(h['destroy_base']), h100(h['destroy_grow'])))
        print('    标记  is_sp=%s is_season=%s is_release=%s is_op=%s is_memorize=%s is_baijia=%s '
              'release_time=%s base_hero_id=%s'
              % (h['is_sp_card'], h['is_season_card'], h['is_release'], h['is_op'],
                 h['is_memorize_card'], h['is_baijia_hero'], h['release_time'], h['base_hero_id']))
        print('    生平  %s' % (h['birth_and_death_year'] or '-'))
        print('    tag=%s  立绘=%s' % (h['tag'], h['head_icon_ids']))
        print('    描述  %s' % (h['description'] or ''))

        entry = {'hero': h, 'skill': None, 'details': [], 'effectMap': None}
        sk = skills.get(h['skill_init'])
        if not sk:
            print('\n    [主战法 %s 未在 skill 表命中]' % h['skill_init'])
        else:
            entry['skill'] = sk
            print('\n    == 主战法 %d %s ==' % (sk['skill_id'], sk['name']))
            print('       类型=%s(%s) 品质=%s 距离=%s 准备=%s 发动率=%s~%s  main_detail=%s 技能类型=%s'
                  % (SKILL_TYPE.get(sk['skill_type'], sk['skill_type']), sk['skill_type'],
                     sk['skill_quality'], sk['hit_range'], sk['prepare'],
                     fmt_rate(sk['probability_init']), fmt_rate(sk['probability_max']),
                     sk['main_detail'], sk['show_skill_type']))
            print('       目标=%s' % (sk['target_description'] or ''))
            print('       描述=%s' % (sk['description'] or ''))
            print('       简版=%s' % (sk['brief_description'] or ''))
            print('       mark=%s flag=%s grade=%s tag=%s'
                  % (sk['skill_mark_type'], sk['flag'], sk['skill_quality_level'], sk['tag']))

            print('\n       -- 效果明细树（detail_id//100 归族，122/123 递归 constant_param）--')
            for depth, d in detail_family(details, sk['main_detail']):
                eff = effects.get(d['effect_id'])
                name = eff['name'] if eff else '??'
                rt = eff['replace_type'] if eff else None
                base = d['constant_param'] + 0.4 * d['intel_param'] if d['effect_id'] not in (122, 123) else None
                pad = '   ' * depth
                print('       %s%11d effect=%-4d %-14s 基值=%-8s 成长/点=%-6s 概率=%s/%s 目标=%s 次数=%-3s '
                      '回合=%s 条件=%s 前置=%s 施法=%s replace=%s buff=%s 参=%s 常=%s'
                      % (pad, d['detail_id'], d['effect_id'], name,
                         ('%.2f' % base) if base is not None else '-',
                         ('%.3f' % growth(d['intel_param'])) if d['intel_param'] else '0',
                         d['prob_init_param'], d['prob_max_param'], d['target_type'],
                         d['attack_max'], d['available_round'], d['condition'],
                         d['precondition'], d['cast_condition'], rt, d['buff_type'],
                         d['effect_param'], d['constant_param']))
                if eff and eff.get('tips'):
                    print('       %s    tips: %s' % (pad, eff['tips']))
                entry['details'].append({'depth': depth, 'detail': d,
                                         'effectName': name,
                                         'effect': eff,
                                         'base': base,
                                         'growthPerPoint': growth(d['intel_param'])})

            em = emap.get(sk['skill_id'])
            entry['effectMap'] = em
            print('\n       -- 机制码（tb_cfg_skill_effect_map）--')
            if not em:
                print('        [effect_map 未命中该战法]')
            else:
                codes = [c for c in re.split(r'[;,\s]+', em['effect'] or '') if c]
                print('        raw=%r' % em['effect'])
                for c in codes:
                    cid = int(c)
                    eff = effects.get(cid)
                    tags = []
                    if cid not in effects:
                        tags.append('★字典缺该码')
                    if repo_codes and cid not in repo_codes:
                        tags.append('★仓库 mechanisms.ts 无此码')
                    if old_codes and cid not in old_codes:
                        tags.append('★旧包字典无此码(=新机制)')
                    print('        %-6s %-16s replace=%-3s buff=%-3s value=%-3s tips=%-40s %s'
                          % (c, (eff['name'] if eff else '??')[:16],
                             eff['replace_type'] if eff else '-', eff['buff_type'] if eff else '-',
                             eff['value_type'] if eff else '-',
                             (str(eff['tips'])[:40] if eff and eff.get('tips') else ''),
                             ' '.join(tags)))
        bundle['heroes'].append(entry)

    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        p = os.path.join(out_dir, 'hero_%s.json' % target)
        json.dump(bundle, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('\n[写出] %s' % p)
    return bundle


def dict_report(effect_t, old_dict_path, out_dir):
    if not effect_t:
        return
    codes = {r['effect_id']: r for r in effect_t['rows']}
    print('\n=== 效果字典 tb_cfg_skill_effect：%d 条 ===' % len(codes))
    dist = {}
    for r in effect_t['rows']:
        dist[r['replace_type']] = dist.get(r['replace_type'], 0) + 1
    print('    replace_type 分布：%s' % dict(sorted(dist.items())))
    if old_dict_path and os.path.exists(old_dict_path):
        od = json.load(open(old_dict_path, encoding='utf-8'))
        old_rows = od.get('rows', od)
        old = {int(k): v for k, v in old_rows.items()}
        print('   旧包字典 %d 条（%s）' % (len(old), old_dict_path))
        add = sorted(set(codes) - set(old))
        rem = sorted(set(old) - set(codes))
        print('   新增码 %d 个：' % len(add))
        for c in add:
            e = codes[c]
            print('     + %-5d %-18s replace=%s buff=%s tips=%s'
                  % (c, (e['name'] or '')[:18], e['replace_type'], e['buff_type'],
                     (str(e['tips'])[:48] if e['tips'] else '')))
        print('   删除码 %d 个：%s' % (len(rem), rem[:40]))
        chg = [c for c in sorted(set(codes) & set(old))
               if (codes[c]['name'] or '') != (old[c].get('name') or '')]
        print('   改名 %d 个：%s' % (len(chg), [(c, old[c].get('name'), codes[c]['name']) for c in chg[:20]]))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        p = os.path.join(out_dir, 'tb_cfg_skill_effect.json')
        json.dump({'table': 'tb_cfg_skill_effect', 'count': len(codes),
                   'rows': {str(r['effect_id']): {k: v for k, v in r.items() if k != '__objHdr'}
                            for r in effect_t['rows']}},
                  open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('[写出] %s' % p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk')
    ap.add_argument('--dir')
    ap.add_argument('--npk', help='NeoX 资源包（如 assets/others.npk）')
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--hero')
    ap.add_argument('--find', help='按子串列出武将（名字/描述命中）')
    ap.add_argument('--limit', type=int, default=40)
    ap.add_argument('--out')
    ap.add_argument('--old-dict')
    ap.add_argument('--repo', default=os.getcwd())
    ap.add_argument('--dump-dict', action='store_true')
    ap.add_argument('--dump-all', action='store_true')
    args = ap.parse_args()

    if not args.apk and not args.dir and not args.npk:
        ap.error('需要 --apk / --dir / --npk 之一')

    if args.apk:
        src = ApkSource(args.apk)
    elif args.npk:
        src = NpkSource(args.npk)
    else:
        src = DirSource(args.dir)
    print('数据源：%s %s' % (src.kind, src.path))

    tables = {}
    for name in ('hero', 'skill', 'detail', 'effect', 'effect_map'):
        tables[name] = load_table(src, name)

    ok = all(t and t['ok'] for t in tables.values() if t)
    print('\n验收：%s（%s）' % ('PASS' if ok else 'FAIL',
                             ' '.join('%s=%s' % (k, 'OK' if (v and v['ok']) else 'FAIL/MISS')
                                      for k, v in tables.items())))

    if args.dump_dict:
        dict_report(tables['effect'], args.old_dict, args.out)
    if args.find and tables['hero']:
        pat = args.find
        hits = [r for r in tables['hero']['rows']
                if (r['name'] and pat in r['name']) or (r['description'] and pat in r['description'])
                or (r['second_name'] and pat in r['second_name'])]
        print('\n=== 含「%s」的武将 %d 条 ===' % (pat, len(hits)))
        for r in hits[:args.limit]:
            print('   %6d %-10s %s 品质%s 阵营%s 技能%s  %s'
                  % (r['heroid'], r['name'], BASE_TROOP.get(r['hero_type'], r['hero_type']),
                     r['quality'], COUNTRY.get(r['country'], r['country']), r['skill_init'],
                     '' if (r['name'] and pat in r['name']) else '(仅描述命中)'))
    if args.hero:
        print_hero(src, args.hero, args.out, args.old_dict, args.repo, tables)
    if args.dump_all and args.out:
        os.makedirs(args.out, exist_ok=True)
        for name, t in tables.items():
            if not t:
                continue
            p = os.path.join(args.out, 'tb_cfg_%s.json' % name)
            json.dump({'table': name, 'count': t['nRows'],
                       'verified': {k: t[k] for k in ('nKeys', 'nRows', 'keyAlign', 'residual')},
                       'rows': {str(r[t['keyField']]): {k: v for k, v in r.items() if k != '__objHdr'}
                                for r in t['rows']}},
                      open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print('[写出] %s (%d 行)' % (p, t['nRows']))

    return 0 if ok else 2


if __name__ == '__main__':
    sys.exit(main())
