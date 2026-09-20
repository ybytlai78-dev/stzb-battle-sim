/**
 * 率土之滨【稀世】宝物数据（战斗类 36 件 + 锻造词条 36 条 / 11 组）
 *
 * ⚠️ 自动生成，请勿手改 —— 重新生成：`node scripts/gen_treasure_data.mjs`
 *    数据源：`dateyuan/宝物数据.json` ← `node scripts/fetch_gear_data.mjs`（网易官网宝物库服务端 JSON）
 *    背景与口径：`dateyuan/宝物系统调研.md`、`dateyuan/宝物系统方案.md`
 *
 * 数值口径（用户确认）：
 *  - 自带特效 slot1 / slot2 的 `value` = **每次强化的增量**（官方库数值即增量）；slot3 = **固定值**
 *  - 默认 10 级：slot1 = value × 5、slot2 = value × 5、slot3 = value × 1
 *  - 锻造词条数值由玩家在 [min, max] 内任选（滑杆）；`hint` 只作蓝/粉/红**颜色提示**，不限制取值
 *  - 内政类（大吉 / 天禄 与第 12 组词条）不在战斗引擎范围内，已剔除
 */

export type TreasureType = '刀' | '剑' | '长兵' | '弓' | '扇' | '其他';

/** 宝物自带特效（一阶 / 二阶 / 三阶） */
export interface TreasureEffectDef {
  slot: 1 | 2 | 3;
  /** 官方词条名 */
  name: string;
  /** 官方文案（原样，供 UI tooltip） */
  desc: string;
  /** 官方数值：slot1/2 = 每次强化增量，slot3 = 固定值 */
  value: number;
  unit: 'percent' | 'point';
  /** desc 中出现的全部数字（按出现顺序），特殊效果（回合数 / 次数 / 距离）按需取用 */
  numbers: number[];
}

export interface TreasureDef {
  id: number;
  name: string;
  type: TreasureType;
  /** 立绘 / 图标（public/gears） */
  image: string;
  icon: string;
  /** 锻造词条组（1~11；12 = 内政，已剔除） */
  affixGroup: number;
  /** 本宝物**可锻造出**的词条名（6~7 条，官方数据） */
  affixPool: string[];
  /** 自带特效（1~3 条，slot 升序） */
  effects: TreasureEffectDef[];
}

/** 锻造词条（跨宝物按名去重） */
export interface AffixDef {
  name: string;
  /** 官方文案（含 `#min~max#` 区间标记） */
  desc: string;
  /** 官方区间：玩家可选数值范围 */
  min: number;
  max: number;
  unit: 'percent' | 'point' | 'round' | 'count';
  /** 蓝/粉/红颜色提示（社区档位表；仅 UI，不限制取值） */
  hint: { blueMax: number; pinkMin: number; pinkMax: number; red: number | null } | null;
}

/** 宝物默认等级（用户口径：默认按 10 级满强化） */
export const TREASURE_LEVEL_DEFAULT = 10;
/** 默认 10 级下各阶特效的强化次数：一阶 5 次（1→5 级）、二阶 5 次（5→10 级）、三阶固定 */
export const TREASURE_SLOT_STEPS: Record<1 | 2 | 3, number> = { 1: 5, 2: 5, 3: 0 };

export const TREASURES: TreasureDef[] = [
    {
      "id": 1009,
      "name": "狰角枪",
      "type": "长兵",
      "image": "/gears/gear_1009.jpg",
      "icon": "/gears/gear_1009_s.jpg",
      "affixGroup": 1,
      "affixPool": [
        "骁锐",
        "陷阵",
        "强击",
        "奔袭",
        "坚毅",
        "无畏"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "无畏",
          "desc": "追击战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "骁锐",
          "desc": "攻击属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 3,
          "name": "陷阵",
          "desc": "普通攻击伤害提高12.0%",
          "value": 12,
          "unit": "percent",
          "numbers": [
            12
          ]
        }
      ]
    },
    {
      "id": 1012,
      "name": "屈卢",
      "type": "长兵",
      "image": "/gears/gear_1012.jpg",
      "icon": "/gears/gear_1012_s.jpg",
      "affixGroup": 1,
      "affixPool": [
        "骁锐",
        "陷阵",
        "强击",
        "奔袭",
        "坚毅",
        "无畏"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "骁锐",
          "desc": "攻击属性提高2.0",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        },
        {
          "slot": 2,
          "name": "无畏",
          "desc": "追击战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "破敌",
          "desc": "造成的攻击伤害无视目标10.0%的防御属性",
          "value": 10,
          "unit": "percent",
          "numbers": [
            10
          ]
        }
      ]
    },
    {
      "id": 1024,
      "name": "戚",
      "type": "其他",
      "image": "/gears/gear_1024.jpg",
      "icon": "/gears/gear_1024_s.jpg",
      "affixGroup": 1,
      "affixPool": [
        "骁锐",
        "陷阵",
        "强击",
        "奔袭",
        "坚毅",
        "无畏"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "骁锐",
          "desc": "攻击属性提高2.0",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        },
        {
          "slot": 2,
          "name": "稳固",
          "desc": "防御属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 3,
          "name": "勇猛",
          "desc": "造成的攻击伤害提高8.0%",
          "value": 8,
          "unit": "percent",
          "numbers": [
            8
          ]
        }
      ]
    },
    {
      "id": 1060,
      "name": "少府",
      "type": "弓",
      "image": "/gears/gear_1060.jpg",
      "icon": "/gears/gear_1060_s.jpg",
      "affixGroup": 1,
      "affixPool": [
        "骁锐",
        "陷阵",
        "强击",
        "奔袭",
        "坚毅",
        "无畏"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "骁锐",
          "desc": "攻击属性提高2.0",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        },
        {
          "slot": 2,
          "name": "陷阵",
          "desc": "前4回合普通攻击伤害提高2.0%",
          "value": 2,
          "unit": "percent",
          "numbers": [
            4,
            2
          ]
        },
        {
          "slot": 3,
          "name": "再战",
          "desc": "第5回合有50%几率获得连击效果",
          "value": 50,
          "unit": "percent",
          "numbers": [
            5,
            50
          ]
        }
      ]
    },
    {
      "id": 1003,
      "name": "彤素",
      "type": "弓",
      "image": "/gears/gear_1003.jpg",
      "icon": "/gears/gear_1003_s.jpg",
      "affixGroup": 2,
      "affixPool": [
        "善谋",
        "坚忍",
        "骁锐",
        "至策",
        "破敌",
        "英勇"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "骁锐",
          "desc": "攻击属性提高2.5",
          "value": 2.5,
          "unit": "point",
          "numbers": [
            2.5
          ]
        },
        {
          "slot": 2,
          "name": "亢厉",
          "desc": "主动及追击武将主战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "奇袭",
          "desc": "与目标距离每提高1，造成的攻击伤害提高3.0%",
          "value": 3,
          "unit": "percent",
          "numbers": [
            1,
            3
          ]
        }
      ]
    },
    {
      "id": 1015,
      "name": "冥山勾月",
      "type": "长兵",
      "image": "/gears/gear_1015.jpg",
      "icon": "/gears/gear_1015_s.jpg",
      "affixGroup": 2,
      "affixPool": [
        "善谋",
        "坚忍",
        "骁锐",
        "至策",
        "破敌",
        "英勇"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 2,
          "name": "亢厉",
          "desc": "主动及追击武将主战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "骁锐",
          "desc": "攻击属性提高8.0%",
          "value": 8,
          "unit": "percent",
          "numbers": [
            8
          ]
        }
      ]
    },
    {
      "id": 1018,
      "name": "惊鲵",
      "type": "长兵",
      "image": "/gears/gear_1018.jpg",
      "icon": "/gears/gear_1018_s.jpg",
      "affixGroup": 2,
      "affixPool": [
        "善谋",
        "坚忍",
        "骁锐",
        "至策",
        "破敌",
        "英勇"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "不移",
          "desc": "受攻击伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "破敌",
          "desc": "造成的攻击伤害无视目标1.5%的防御属性",
          "value": 1.5,
          "unit": "percent",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 3,
          "name": "英才",
          "desc": "攻击、防御属性提高6.0%",
          "value": 6,
          "unit": "percent",
          "numbers": [
            6
          ]
        }
      ]
    },
    {
      "id": 1021,
      "name": "真刚",
      "type": "其他",
      "image": "/gears/gear_1021.jpg",
      "icon": "/gears/gear_1021_s.jpg",
      "affixGroup": 2,
      "affixPool": [
        "善谋",
        "坚忍",
        "骁锐",
        "至策",
        "破敌",
        "英勇"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "破敌",
          "desc": "造成的攻击伤害无视目标1.0%的防御属性",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "骁锐",
          "desc": "攻击属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 3,
          "name": "盛气",
          "desc": "正式回合后，前2回合造成的攻击伤害提高20.0%",
          "value": 20,
          "unit": "percent",
          "numbers": [
            2,
            20
          ]
        }
      ]
    },
    {
      "id": 1027,
      "name": "别鸣",
      "type": "刀",
      "image": "/gears/gear_1027.jpg",
      "icon": "/gears/gear_1027_s.jpg",
      "affixGroup": 3,
      "affixPool": [
        "灵动",
        "机敏",
        "清毅",
        "仁心",
        "坚忍",
        "艮止",
        "惑言"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 2,
          "name": "不移",
          "desc": "受所有伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "英才",
          "desc": "谋略、速度属性提高5.0%",
          "value": 5,
          "unit": "percent",
          "numbers": [
            5
          ]
        }
      ]
    },
    {
      "id": 1048,
      "name": "博浪",
      "type": "其他",
      "image": "/gears/gear_1048.jpg",
      "icon": "/gears/gear_1048_s.jpg",
      "affixGroup": 3,
      "affixPool": [
        "灵动",
        "机敏",
        "清毅",
        "仁心",
        "坚忍",
        "艮止",
        "惑言"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "安贞",
          "desc": "控制状态下受伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "坚忍",
          "desc": "受到的主动战法伤害降低2.0%",
          "value": 2,
          "unit": "percent",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "抖擞",
          "desc": "自身受到的恢复效果提高25.0%",
          "value": 25,
          "unit": "percent",
          "numbers": [
            25
          ]
        }
      ]
    },
    {
      "id": 1054,
      "name": "仁风",
      "type": "扇",
      "image": "/gears/gear_1054.jpg",
      "icon": "/gears/gear_1054_s.jpg",
      "affixGroup": 3,
      "affixPool": [
        "灵动",
        "机敏",
        "清毅",
        "仁心",
        "坚忍",
        "艮止",
        "惑言"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "先知",
          "desc": "受策略伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "灵动",
          "desc": "速度属性提高2.0",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "天资",
          "desc": "谋略属性提高8.0%",
          "value": 8,
          "unit": "percent",
          "numbers": [
            8
          ]
        }
      ]
    },
    {
      "id": 1030,
      "name": "铭鸿",
      "type": "刀",
      "image": "/gears/gear_1030.jpg",
      "icon": "/gears/gear_1030_s.jpg",
      "affixGroup": 4,
      "affixPool": [
        "骁锐",
        "天资",
        "筹算",
        "识破",
        "亢厉",
        "英勇"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 2,
          "name": "英才",
          "desc": "攻击、谋略属性提高1.5",
          "value": 1.5,
          "unit": "point",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 3,
          "name": "亢厉",
          "desc": "主动及追击武将主战法伤害提高10.0%",
          "value": 10,
          "unit": "percent",
          "numbers": [
            10
          ]
        }
      ]
    },
    {
      "id": 1033,
      "name": "锟铻",
      "type": "刀",
      "image": "/gears/gear_1033.jpg",
      "icon": "/gears/gear_1033_s.jpg",
      "affixGroup": 4,
      "affixPool": [
        "骁锐",
        "天资",
        "筹算",
        "识破",
        "亢厉",
        "英勇"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高2.0",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        },
        {
          "slot": 2,
          "name": "亢厉",
          "desc": "主动武将主战法伤害提高2.0%",
          "value": 2,
          "unit": "percent",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "英才",
          "desc": "攻击、谋略、速度属性提高8.0",
          "value": 8,
          "unit": "point",
          "numbers": [
            8
          ]
        }
      ]
    },
    {
      "id": 1036,
      "name": "悬翦",
      "type": "长兵",
      "image": "/gears/gear_1036.jpg",
      "icon": "/gears/gear_1036_s.jpg",
      "affixGroup": 4,
      "affixPool": [
        "骁锐",
        "天资",
        "筹算",
        "识破",
        "亢厉",
        "英勇"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高1.5%",
          "value": 1.5,
          "unit": "percent",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 2,
          "name": "骁锐",
          "desc": "攻击属性提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "亢厉",
          "desc": "主动战法的攻击伤害提高10.0%",
          "value": 10,
          "unit": "percent",
          "numbers": [
            10
          ]
        }
      ]
    },
    {
      "id": 1057,
      "name": "徐氏匕首",
      "type": "其他",
      "image": "/gears/gear_1057.jpg",
      "icon": "/gears/gear_1057_s.jpg",
      "affixGroup": 4,
      "affixPool": [
        "骁锐",
        "天资",
        "筹算",
        "识破",
        "亢厉",
        "英勇"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "灵动",
          "desc": "速度属性提高1.5",
          "value": 1.5,
          "unit": "point",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 2,
          "name": "破敌",
          "desc": "造成的攻击伤害无视目标1.5%的防御属性",
          "value": 1.5,
          "unit": "percent",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 3,
          "name": "英才",
          "desc": "攻击、谋略属性提高5.0%",
          "value": 5,
          "unit": "percent",
          "numbers": [
            5
          ]
        }
      ]
    },
    {
      "id": 1042,
      "name": "旌阳万仞",
      "type": "剑",
      "image": "/gears/gear_1042.jpg",
      "icon": "/gears/gear_1042_s.jpg",
      "affixGroup": 5,
      "affixPool": [
        "灵动",
        "天资",
        "颖悟",
        "驱火",
        "炫惑",
        "筹算"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 2,
          "name": "亢厉",
          "desc": "主动战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "睚眦",
          "desc": "恐慌、妖术、燃烧、火攻伤害提高10.0%",
          "value": 10,
          "unit": "percent",
          "numbers": [
            10
          ]
        }
      ]
    },
    {
      "id": 1045,
      "name": "承影",
      "type": "剑",
      "image": "/gears/gear_1045.jpg",
      "icon": "/gears/gear_1045_s.jpg",
      "affixGroup": 5,
      "affixPool": [
        "灵动",
        "天资",
        "颖悟",
        "驱火",
        "炫惑",
        "筹算"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "骁锐",
          "desc": "攻击属性提高2.5",
          "value": 2.5,
          "unit": "point",
          "numbers": [
            2.5
          ]
        },
        {
          "slot": 2,
          "name": "天资",
          "desc": "谋略属性提高2.5",
          "value": 2.5,
          "unit": "point",
          "numbers": [
            2.5
          ]
        },
        {
          "slot": 3,
          "name": "机先",
          "desc": "正式回合后，前2次造成的策略伤害提高20.0%",
          "value": 20,
          "unit": "percent",
          "numbers": [
            2,
            20
          ]
        }
      ]
    },
    {
      "id": 1051,
      "name": "游飘",
      "type": "扇",
      "image": "/gears/gear_1051.jpg",
      "icon": "/gears/gear_1051_s.jpg",
      "affixGroup": 5,
      "affixPool": [
        "灵动",
        "天资",
        "颖悟",
        "驱火",
        "炫惑",
        "筹算"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "先知",
          "desc": "受策略伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "妙算",
          "desc": "主动战法的策略伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "颖悟",
          "desc": "造成的策略伤害无视目标10.0%的谋略属性",
          "value": 10,
          "unit": "percent",
          "numbers": [
            10
          ]
        }
      ]
    },
    {
      "id": 1063,
      "name": "掩日",
      "type": "长兵",
      "image": "/gears/gear_1063.jpg",
      "icon": "/gears/gear_1063_s.jpg",
      "affixGroup": 6,
      "affixPool": [
        "熟虑",
        "天资",
        "亢厉",
        "至策",
        "骁锐",
        "击虚"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高1.5",
          "value": 1.5,
          "unit": "point",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 2,
          "name": "亢厉",
          "desc": "主动武将主战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "谋断",
          "desc": "第2次发动需要准备的主动武将主战法时，跳过1个准备回合",
          "value": 1,
          "unit": "point",
          "numbers": [
            2,
            1
          ]
        }
      ]
    },
    {
      "id": 1066,
      "name": "乌号",
      "type": "弓",
      "image": "/gears/gear_1066.jpg",
      "icon": "/gears/gear_1066_s.jpg",
      "affixGroup": 6,
      "affixPool": [
        "熟虑",
        "天资",
        "亢厉",
        "至策",
        "骁锐",
        "击虚"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "灵动",
          "desc": "速度属性提高1.5",
          "value": 1.5,
          "unit": "point",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 2,
          "name": "亢厉",
          "desc": "主动及追击武将主战法伤害提高2.0%",
          "value": 2,
          "unit": "percent",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "逐胜",
          "desc": "对兵力最低的敌军造成伤害提高15.0%",
          "value": 15,
          "unit": "percent",
          "numbers": [
            15
          ]
        }
      ]
    },
    {
      "id": 1084,
      "name": "钜黍",
      "type": "弓",
      "image": "/gears/gear_1084.jpg",
      "icon": "/gears/gear_1084_s.jpg",
      "affixGroup": 6,
      "affixPool": [
        "熟虑",
        "天资",
        "亢厉",
        "至策",
        "骁锐",
        "击虚"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "无畏",
          "desc": "追击战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "灵动",
          "desc": "速度属性提高1.0",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "穿杨",
          "desc": "攻击距离+1",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        }
      ]
    },
    {
      "id": 1087,
      "name": "螣蛇",
      "type": "长兵",
      "image": "/gears/gear_1087.jpg",
      "icon": "/gears/gear_1087_s.jpg",
      "affixGroup": 6,
      "affixPool": [
        "熟虑",
        "天资",
        "亢厉",
        "至策",
        "骁锐",
        "击虚"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "灵动",
          "desc": "速度属性提高1.0",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "骁锐",
          "desc": "攻击属性提高2.0",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "豪纵",
          "desc": "主动武将主战法的战法距离+1",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        }
      ]
    },
    {
      "id": 1114,
      "name": "位至三公",
      "type": "其他",
      "image": "/gears/gear_1114.jpg",
      "icon": "/gears/gear_1114_s.jpg",
      "affixGroup": 6,
      "affixPool": [
        "熟虑",
        "天资",
        "亢厉",
        "至策",
        "骁锐",
        "击虚"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 2,
          "name": "炎势",
          "desc": "火攻、燃烧伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "燮理",
          "desc": "正式回合后，自身施加的燃烧效果每回合首次造成伤害后，自身恢复一次兵力（恢复率120.0%)",
          "value": 120,
          "unit": "percent",
          "numbers": [
            120
          ]
        }
      ]
    },
    {
      "id": 1123,
      "name": "金鸠",
      "type": "其他",
      "image": "/gears/gear_1123.jpg",
      "icon": "/gears/gear_1123_s.jpg",
      "affixGroup": 6,
      "affixPool": [
        "熟虑",
        "天资",
        "亢厉",
        "至策",
        "骁锐",
        "击虚"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "破敌",
          "desc": "造成的攻击伤害无视目标1.0%的防御属性",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "亢厉",
          "desc": "主动战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "鸠佑",
          "desc": "主动武将主战法发动后，自身造成的攻击伤害提高6.0%，可叠加",
          "value": 6,
          "unit": "percent",
          "numbers": [
            6
          ]
        }
      ]
    },
    {
      "id": 1072,
      "name": "大将",
      "type": "其他",
      "image": "/gears/gear_1072.jpg",
      "icon": "/gears/gear_1072_s.jpg",
      "affixGroup": 7,
      "affixPool": [
        "机敏",
        "灵动",
        "坚忍",
        "沉稳",
        "稳固",
        "强韧",
        "清毅"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "强韧",
          "desc": "受到的普通攻击伤害降低2.0%",
          "value": 2,
          "unit": "percent",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "护主",
          "desc": "战斗开始后前2回合，援护我军大营",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        }
      ]
    },
    {
      "id": 1075,
      "name": "泰阿",
      "type": "刀",
      "image": "/gears/gear_1075.jpg",
      "icon": "/gears/gear_1075_s.jpg",
      "affixGroup": 7,
      "affixPool": [
        "机敏",
        "灵动",
        "坚忍",
        "沉稳",
        "稳固",
        "强韧",
        "清毅"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "骁锐",
          "desc": "攻击属性提高2.0",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        },
        {
          "slot": 2,
          "name": "明镜",
          "desc": "谋略属性提高2.0，初始统率值低于3的武将防御属性额外提高1.5",
          "value": 1.5,
          "unit": "point",
          "numbers": [
            2,
            3,
            1.5
          ]
        },
        {
          "slot": 3,
          "name": "强固",
          "desc": "正式回合后，每回合首次受到的伤害降低20.0%",
          "value": 20,
          "unit": "percent",
          "numbers": [
            20
          ]
        }
      ]
    },
    {
      "id": 1078,
      "name": "大橹",
      "type": "刀",
      "image": "/gears/gear_1078.jpg",
      "icon": "/gears/gear_1078_s.jpg",
      "affixGroup": 8,
      "affixPool": [
        "稳固",
        "机敏",
        "不屈",
        "济世",
        "威势",
        "艮止",
        "惑言"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "强韧",
          "desc": "受到的普通攻击伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "坚忍",
          "desc": "受到的主动战法伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "避险",
          "desc": "战斗中首次受到伤害后，进入规避状态，免疫下1次受到的伤害",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        }
      ]
    },
    {
      "id": 1096,
      "name": "比翼",
      "type": "扇",
      "image": "/gears/gear_1096.jpg",
      "icon": "/gears/gear_1096_s.jpg",
      "affixGroup": 8,
      "affixPool": [
        "稳固",
        "机敏",
        "不屈",
        "济世",
        "威势",
        "艮止",
        "惑言"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高1.0",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "天资",
          "desc": "谋略属性提高1.5",
          "value": 1.5,
          "unit": "point",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 3,
          "name": "矜节",
          "desc": "女性武将携带时，主战法造成的恢复效果提高30.0%",
          "value": 30,
          "unit": "percent",
          "numbers": [
            30
          ]
        }
      ]
    },
    {
      "id": 1099,
      "name": "障日",
      "type": "扇",
      "image": "/gears/gear_1099.jpg",
      "icon": "/gears/gear_1099_s.jpg",
      "affixGroup": 8,
      "affixPool": [
        "稳固",
        "机敏",
        "不屈",
        "济世",
        "威势",
        "艮止",
        "惑言"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "坚忍",
          "desc": "受到的主动战法伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "不移",
          "desc": "受攻击伤害降低2.0%",
          "value": 2,
          "unit": "percent",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "阵舞",
          "desc": "女性武将携带时，主战法施加控制的目标，受该控制期间受到的所有伤害提高24.0%",
          "value": 24,
          "unit": "percent",
          "numbers": [
            24
          ]
        }
      ]
    },
    {
      "id": 1081,
      "name": "千钧",
      "type": "其他",
      "image": "/gears/gear_1081.jpg",
      "icon": "/gears/gear_1081_s.jpg",
      "affixGroup": 9,
      "affixPool": [
        "机敏",
        "不屈",
        "济世",
        "威势",
        "灵动",
        "惑言",
        "稳固"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高3.0",
          "value": 3,
          "unit": "point",
          "numbers": [
            3
          ]
        },
        {
          "slot": 2,
          "name": "安贞",
          "desc": "控制状态下受伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "破障",
          "desc": "普通攻击后，移除攻击目标由主动或追击战法带来的1种增益效果",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        }
      ]
    },
    {
      "id": 1090,
      "name": "龙鳞",
      "type": "其他",
      "image": "/gears/gear_1090.jpg",
      "icon": "/gears/gear_1090_s.jpg",
      "affixGroup": 10,
      "affixPool": [
        "骁锐",
        "天资",
        "奔袭",
        "坚毅",
        "选锋",
        "蓄锐"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "灵动",
          "desc": "速度属性提高1.5",
          "value": 1.5,
          "unit": "point",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 2,
          "name": "亢厉",
          "desc": "追击武将主战法伤害提高2.0%",
          "value": 2,
          "unit": "percent",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "慑心",
          "desc": "追击武将主战法施加的控制效果增加1回合",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        }
      ]
    },
    {
      "id": 1093,
      "name": "貅猊",
      "type": "其他",
      "image": "/gears/gear_1093.jpg",
      "icon": "/gears/gear_1093_s.jpg",
      "affixGroup": 10,
      "affixPool": [
        "骁锐",
        "天资",
        "奔袭",
        "坚毅",
        "选锋",
        "蓄锐"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "坚忍",
          "desc": "受到的主动战法伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "骁锐",
          "desc": "攻击属性提高2.0",
          "value": 2,
          "unit": "point",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "迅猛",
          "desc": "处于连击状态时，普通攻击伤害提高20.0%",
          "value": 20,
          "unit": "percent",
          "numbers": [
            20
          ]
        }
      ]
    },
    {
      "id": 1102,
      "name": "元戎",
      "type": "弓",
      "image": "/gears/gear_1102.jpg",
      "icon": "/gears/gear_1102_s.jpg",
      "affixGroup": 10,
      "affixPool": [
        "骁锐",
        "天资",
        "奔袭",
        "坚毅",
        "选锋",
        "蓄锐"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "陷阵",
          "desc": "普通攻击伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "无畏",
          "desc": "追击战法伤害提高2.0%",
          "value": 2,
          "unit": "percent",
          "numbers": [
            2
          ]
        },
        {
          "slot": 3,
          "name": "迸发",
          "desc": "首次发动追击主战法时，额外选取攻击距离内1个目标",
          "value": 1,
          "unit": "point",
          "numbers": [
            1
          ]
        }
      ]
    },
    {
      "id": 1105,
      "name": "神锋",
      "type": "弓",
      "image": "/gears/gear_1105.jpg",
      "icon": "/gears/gear_1105_s.jpg",
      "affixGroup": 10,
      "affixPool": [
        "骁锐",
        "天资",
        "奔袭",
        "坚毅",
        "选锋",
        "蓄锐"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "无畏",
          "desc": "追击战法伤害提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "英才",
          "desc": "攻击、谋略属性提高1.5",
          "value": 1.5,
          "unit": "point",
          "numbers": [
            1.5
          ]
        },
        {
          "slot": 3,
          "name": "劲弩",
          "desc": "首回合无法普通攻击，第2回合起首次发动普通攻击时，对攻击距离内敌军全体发动1次普通攻击",
          "value": 1,
          "unit": "point",
          "numbers": [
            2,
            1
          ]
        }
      ]
    },
    {
      "id": 1108,
      "name": "沧海",
      "type": "刀",
      "image": "/gears/gear_1108.jpg",
      "icon": "/gears/gear_1108_s.jpg",
      "affixGroup": 11,
      "affixPool": [
        "戒备",
        "济世",
        "坚忍",
        "不屈",
        "不懈",
        "威势"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高2.5",
          "value": 2.5,
          "unit": "point",
          "numbers": [
            2.5
          ]
        },
        {
          "slot": 2,
          "name": "坚忍",
          "desc": "受到的主动战法伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "破浪",
          "desc": "自身每受到1次伤害，本回合造成所有伤害提升10.0%，最多可叠加10次",
          "value": 10,
          "unit": "percent",
          "numbers": [
            1,
            10,
            10
          ]
        }
      ]
    },
    {
      "id": 1111,
      "name": "星汉",
      "type": "剑",
      "image": "/gears/gear_1111.jpg",
      "icon": "/gears/gear_1111_s.jpg",
      "affixGroup": 11,
      "affixPool": [
        "戒备",
        "济世",
        "坚忍",
        "不屈",
        "不懈",
        "威势"
      ],
      "effects": [
        {
          "slot": 1,
          "name": "稳固",
          "desc": "防御属性提高1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 2,
          "name": "不移",
          "desc": "受所有伤害降低1.0%",
          "value": 1,
          "unit": "percent",
          "numbers": [
            1
          ]
        },
        {
          "slot": 3,
          "name": "归心",
          "desc": "我军全体每发动2次主动战法，自身恢复一定兵力（恢复率150.0%）",
          "value": 150,
          "unit": "percent",
          "numbers": [
            2,
            150
          ]
        }
      ]
    }
  ];

export const TREASURES_BY_ID: Record<number, TreasureDef> = Object.fromEntries(
  TREASURES.map((t) => [t.id, t]),
);

/** 锻造词条表（按名索引） */
export const AFFIXES: Record<string, AffixDef> = {
    "奔袭": {
      "name": "奔袭",
      "desc": "追击战法发动率提高#3%~9%#",
      "min": 3,
      "max": 9,
      "unit": "percent",
      "hint": {
        "blueMax": 6,
        "pinkMin": 7,
        "pinkMax": 8,
        "red": 9
      }
    },
    "不屈": {
      "name": "不屈",
      "desc": "每次受到伤害后，本回合受到所有伤害降低#3%-9%#，该效果可叠加",
      "min": 3,
      "max": 9,
      "unit": "percent",
      "hint": {
        "blueMax": 6,
        "pinkMin": 7,
        "pinkMax": 8,
        "red": 9
      }
    },
    "不懈": {
      "name": "不懈",
      "desc": "自身每低于初始兵力15%，受到的恢复效果提升#3%~9%#",
      "min": 3,
      "max": 9,
      "unit": "percent",
      "hint": {
        "blueMax": 6,
        "pinkMin": 7,
        "pinkMax": 8,
        "red": 9
      }
    },
    "沉稳": {
      "name": "沉稳",
      "desc": "受到的指挥战法伤害降低#10%~20%#",
      "min": 10,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 16,
        "pinkMin": 17,
        "pinkMax": 18,
        "red": 20
      }
    },
    "筹算": {
      "name": "筹算",
      "desc": "造成策略伤害的武将主战法发动率提高#5%~15%#",
      "min": 5,
      "max": 15,
      "unit": "percent",
      "hint": {
        "blueMax": 10,
        "pinkMin": 10,
        "pinkMax": 13,
        "red": 15
      }
    },
    "艮止": {
      "name": "艮止",
      "desc": "自身无法普通攻击，谋略属性提高#10~30#",
      "min": 10,
      "max": 30,
      "unit": "point",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "惑言": {
      "name": "惑言",
      "desc": "正式回合后武将主战法成功施加的前#1-4#个控制效果(混乱\\暴走\\怯战\\犹豫)增加1回合",
      "min": 1,
      "max": 4,
      "unit": "round",
      "hint": {
        "blueMax": 2,
        "pinkMin": 3,
        "pinkMax": 3,
        "red": null
      }
    },
    "击虚": {
      "name": "击虚",
      "desc": "正式回合后，目标每存在一种持续性伤害或控制效果，自身对其造成的伤害提升#3%~9%#，最多可计算5种",
      "min": 3,
      "max": 9,
      "unit": "percent",
      "hint": {
        "blueMax": 6,
        "pinkMin": 7,
        "pinkMax": 8,
        "red": 9
      }
    },
    "机敏": {
      "name": "机敏",
      "desc": "武将主战法发动率提高#3%~9%#",
      "min": 3,
      "max": 9,
      "unit": "percent",
      "hint": {
        "blueMax": 6,
        "pinkMin": 7,
        "pinkMax": 8,
        "red": 9
      }
    },
    "济世": {
      "name": "济世",
      "desc": "主战法每造成一次恢复效果，效果目标下一次受到伤害减少#5%~15%#，该效果可叠加",
      "min": 5,
      "max": 15,
      "unit": "percent",
      "hint": {
        "blueMax": 10,
        "pinkMin": 10,
        "pinkMax": 13,
        "red": 15
      }
    },
    "坚忍": {
      "name": "坚忍",
      "desc": "受到的主动战法伤害降低#10%~20%#",
      "min": 10,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 16,
        "pinkMin": 17,
        "pinkMax": 18,
        "red": 20
      }
    },
    "坚毅": {
      "name": "坚毅",
      "desc": "前#2~6#回合免疫混乱及暴走",
      "min": 2,
      "max": 6,
      "unit": "round",
      "hint": {
        "blueMax": 4,
        "pinkMin": 5,
        "pinkMax": 5,
        "red": 6
      }
    },
    "戒备": {
      "name": "戒备",
      "desc": "前2回合受到的所有伤害降低#10%~30%#",
      "min": 10,
      "max": 30,
      "unit": "percent",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "亢厉": {
      "name": "亢厉",
      "desc": "主动及追击武将主战法伤害提高#10%~30%#",
      "min": 10,
      "max": 30,
      "unit": "percent",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "灵动": {
      "name": "灵动",
      "desc": "速度属性提高#10~30#",
      "min": 10,
      "max": 30,
      "unit": "point",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "破敌": {
      "name": "破敌",
      "desc": "造成的攻击伤害无视目标#10%~20%#的防御属性",
      "min": 10,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 16,
        "pinkMin": 17,
        "pinkMax": 18,
        "red": 20
      }
    },
    "强击": {
      "name": "强击",
      "desc": "前#1~5#回合普通攻击不会触发反击",
      "min": 1,
      "max": 5,
      "unit": "round",
      "hint": {
        "blueMax": 3,
        "pinkMin": 4,
        "pinkMax": 4,
        "red": 5
      }
    },
    "强韧": {
      "name": "强韧",
      "desc": "受到的普通攻击伤害降低#10%~20%#",
      "min": 10,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 16,
        "pinkMin": 17,
        "pinkMax": 18,
        "red": 20
      }
    },
    "清毅": {
      "name": "清毅",
      "desc": "第#5~8#回合武将行动时获得洞察状态",
      "min": 5,
      "max": 8,
      "unit": "round",
      "hint": {
        "blueMax": 6,
        "pinkMin": 7,
        "pinkMax": 7,
        "red": 8
      }
    },
    "驱火": {
      "name": "驱火",
      "desc": "燃烧及火攻伤害提高#10%~30%#",
      "min": 10,
      "max": 30,
      "unit": "percent",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "仁心": {
      "name": "仁心",
      "desc": "造成的恢复效果提高#5%~15%#",
      "min": 5,
      "max": 15,
      "unit": "percent",
      "hint": {
        "blueMax": 10,
        "pinkMin": 10,
        "pinkMax": 13,
        "red": 15
      }
    },
    "善谋": {
      "name": "善谋",
      "desc": "第4,6回合，造成攻击伤害的武将主战法发动率提高#10%~30%#",
      "min": 10,
      "max": 30,
      "unit": "percent",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "识破": {
      "name": "识破",
      "desc": "前#1~4#回合，主动及追击武将主战法造成的伤害无视规避",
      "min": 1,
      "max": 4,
      "unit": "round",
      "hint": {
        "blueMax": 2,
        "pinkMin": 3,
        "pinkMax": 3,
        "red": null
      }
    },
    "熟虑": {
      "name": "熟虑",
      "desc": "需要准备的主动武将主战法发动率提升#6%~20%#",
      "min": 6,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 14,
        "pinkMin": 16,
        "pinkMax": 18,
        "red": 20
      }
    },
    "天资": {
      "name": "天资",
      "desc": "谋略属性提高#5%~15%#",
      "min": 5,
      "max": 15,
      "unit": "percent",
      "hint": {
        "blueMax": 10,
        "pinkMin": 10,
        "pinkMax": 13,
        "red": 15
      }
    },
    "威势": {
      "name": "威势",
      "desc": "受到初始统率值低于自身武将的所有伤害降低#10%~20%#",
      "min": 10,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 16,
        "pinkMin": 17,
        "pinkMax": 18,
        "red": 20
      }
    },
    "稳固": {
      "name": "稳固",
      "desc": "防御属性提升#10%~20%#",
      "min": 10,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 16,
        "pinkMin": 17,
        "pinkMax": 18,
        "red": 20
      }
    },
    "无畏": {
      "name": "无畏",
      "desc": "追击战法伤害提高#10%~30%#",
      "min": 10,
      "max": 30,
      "unit": "percent",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "陷阵": {
      "name": "陷阵",
      "desc": "普通攻击伤害提高#10%~30%#",
      "min": 10,
      "max": 30,
      "unit": "percent",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "骁锐": {
      "name": "骁锐",
      "desc": "攻击属性提高#5%~15%#",
      "min": 5,
      "max": 15,
      "unit": "percent",
      "hint": {
        "blueMax": 10,
        "pinkMin": 10,
        "pinkMax": 13,
        "red": 15
      }
    },
    "蓄锐": {
      "name": "蓄锐",
      "desc": "每2次普通攻击后，自身造成追击战法伤害增加#5%~15%#，可叠加",
      "min": 5,
      "max": 15,
      "unit": "percent",
      "hint": {
        "blueMax": 10,
        "pinkMin": 10,
        "pinkMax": 13,
        "red": 15
      }
    },
    "选锋": {
      "name": "选锋",
      "desc": "普通攻击后，自身下一次造成策略伤害提高#10%~30%#",
      "min": 10,
      "max": 30,
      "unit": "percent",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "炫惑": {
      "name": "炫惑",
      "desc": "恐慌及妖术伤害提高#10%~30%#",
      "min": 10,
      "max": 30,
      "unit": "percent",
      "hint": {
        "blueMax": 22,
        "pinkMin": 24,
        "pinkMax": 26,
        "red": 30
      }
    },
    "英勇": {
      "name": "英勇",
      "desc": "造成攻击伤害的武将主战法发动率提高#5%~15%#",
      "min": 5,
      "max": 15,
      "unit": "percent",
      "hint": {
        "blueMax": 10,
        "pinkMin": 10,
        "pinkMax": 13,
        "red": 15
      }
    },
    "颖悟": {
      "name": "颖悟",
      "desc": "造成的策略伤害无视目标#10%~20%#的谋略属性",
      "min": 10,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 16,
        "pinkMin": 17,
        "pinkMax": 18,
        "red": 20
      }
    },
    "至策": {
      "name": "至策",
      "desc": "主动战法伤害提高#10%~20%#",
      "min": 10,
      "max": 20,
      "unit": "percent",
      "hint": {
        "blueMax": 16,
        "pinkMin": 17,
        "pinkMax": 18,
        "red": 20
      }
    }
  };

/** 12 组词条池（组号 → 词条名） */
export const AFFIX_GROUPS: Record<number, string[]> = {
    "1": [
      "骁锐",
      "陷阵",
      "强击",
      "奔袭",
      "坚毅",
      "无畏"
    ],
    "2": [
      "善谋",
      "坚忍",
      "骁锐",
      "至策",
      "破敌",
      "英勇"
    ],
    "3": [
      "灵动",
      "机敏",
      "清毅",
      "仁心",
      "坚忍",
      "艮止",
      "惑言"
    ],
    "4": [
      "骁锐",
      "天资",
      "筹算",
      "识破",
      "亢厉",
      "英勇"
    ],
    "5": [
      "灵动",
      "天资",
      "颖悟",
      "驱火",
      "炫惑",
      "筹算"
    ],
    "6": [
      "熟虑",
      "天资",
      "亢厉",
      "至策",
      "骁锐",
      "击虚"
    ],
    "7": [
      "机敏",
      "灵动",
      "坚忍",
      "沉稳",
      "稳固",
      "强韧",
      "清毅"
    ],
    "8": [
      "稳固",
      "机敏",
      "不屈",
      "济世",
      "威势",
      "艮止",
      "惑言"
    ],
    "9": [
      "机敏",
      "不屈",
      "济世",
      "威势",
      "灵动",
      "惑言",
      "稳固"
    ],
    "10": [
      "骁锐",
      "天资",
      "奔袭",
      "坚毅",
      "选锋",
      "蓄锐"
    ],
    "11": [
      "戒备",
      "济世",
      "坚忍",
      "不屈",
      "不懈",
      "威势"
    ]
  };

/** 该宝物在当前等级下每条自带特效的最终数值（slot1/2 随强化次数线性增长，slot3 固定） */
export function treasureEffectValue(effect: TreasureEffectDef, level: number = TREASURE_LEVEL_DEFAULT): number {
  const step = Math.min(TREASURE_SLOT_STEPS[effect.slot], Math.max(0, level - (effect.slot === 1 ? 0 : 5)));
  const n = effect.slot === 3 ? 1 : Math.min(step, TREASURE_SLOT_STEPS[effect.slot]);
  return Number((effect.value * n).toFixed(4));
}

/** 按 id 取宝物（未知 id 返回 undefined） */
export function getTreasure(id: number): TreasureDef | undefined {
  return TREASURES_BY_ID[id];
}
