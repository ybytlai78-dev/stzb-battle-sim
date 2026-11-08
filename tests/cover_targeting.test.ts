/**
 * 援护（cover）选敌契约 —— 2026-10-17 用户报障（曹操【大将·护主】「援護」了敌方典韦 / 袁术「援護」了敌方曹操）
 *
 * 口径（`src/engine/types.ts` 的 cover 定义）：
 *  - `cover` 状态挂在**保护者**身上，`protectId` 指向被保护者；缺省 = 援护友军全体；
 *  - 敌人普攻被保护者 → 改由保护者承接（战法伤害不转移，只有普攻）；
 *  - 承接者**只能**是受击方阵营的单位 —— 把保护者从攻击者自家队伍里挑，会让普攻打到队友身上。
 *
 * 旧实现的三个错误（已修）：① 判「本次选中的目标自己带 cover 状态」（cover 其实在保护者身上）；
 * ② 保护者从 `allies`（攻击者本方）里找；③ 不看 `protectId`，任意 cover 持有者都会顶替。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

interface MkOpts {
  attack?: number;
  defense?: number;
  strategy?: number;
  speed?: number;
  attackRange?: number;
  maxTroops?: number;
  commandSkillIds?: string[];
  activeSkillIds?: string[];
  passiveSkillIds?: string[];
  pursuitSkillIds?: string[];
  treasureId?: number;
}

function mk(id: string, name: string, position: Position, opts: MkOpts = {}): General {
  return {
    id,
    name,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: opts.attack ?? 60,
    defense: opts.defense ?? 100,
    strategy: opts.strategy ?? 60,
    speed: opts.speed ?? 50,
    attackRange: opts.attackRange ?? 2,
    maxTroops: opts.maxTroops ?? 20000,
    mainSkillName: '',
    skillDesc: '',
    commandSkillIds: opts.commandSkillIds ?? [],
    activeSkillIds: opts.activeSkillIds ?? [],
    passiveSkillIds: opts.passiveSkillIds ?? [],
    pursuitSkillIds: opts.pursuitSkillIds ?? [],
    morale: 100,
    ...(opts.treasureId ? { treasure: { treasureId: opts.treasureId, level: 10 } } : {}),
  };
}

/** 大将（1072）三阶 = 护主：前 2 回合援护我军大营 */
const DAJIANG = 1072;

function sideOf(id: string): 'my' | 'enemy' {
  return id.startsWith('red') ? 'my' : 'enemy';
}

function hits(events: BattleEvent[]): Extract<BattleEvent, { type: 'attack_hit' }>[] {
  return events.filter((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit');
}

describe('援护选敌契约', () => {
  it('双方都有援护持有者时，普攻绝不落到攻击者本方阵营（报障回归）', () => {
    // 红：大营(被袁术护主保护) / 中军 袁术(大将·护主) / 前锋 典韦(一夫当关·援护友军全体)
    const red: General[] = [
      mk('red-back', '红大营', '大营'),
      mk('red-mid', '红中军', '中军', { treasureId: DAJIANG }),
      mk('red-front', '红前锋', '前锋', { commandSkillIds: ['yifudangguan'] }),
    ];
    // 蓝：大营(被曹操护主保护) / 中军 / 前锋 曹操(大将·护主)
    const blue: General[] = [
      mk('blue-back', '蓝大营', '大营'),
      mk('blue-mid', '蓝中军', '中军'),
      mk('blue-front', '蓝前锋', '前锋', { treasureId: DAJIANG }),
    ];
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      // 本文件只验援护改判/追击跟随：关设施，避免随机规避把首次普攻吞掉、改判目标偏移。
      const { events } = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 4, facilities: false });
      for (const h of hits(events)) {
        checked++;
        expect(sideOf(h.sourceId)).not.toBe(sideOf(h.targetId));
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('护主（大将）：只代受「我军大营」的普攻，大营不会成为普攻目标', () => {
    const red: General[] = [
      mk('red-back', '红大营', '大营'),
      mk('red-mid', '红中军', '中军', { treasureId: DAJIANG }),
      mk('red-front', '红前锋', '前锋'),
    ];
    const blue: General[] = [
      mk('blue-front', '蓝前锋', '前锋', { attackRange: 5, attack: 70, speed: 71 }),
      mk('blue-mid', '蓝中军', '中军', { attackRange: 5, attack: 70, speed: 70 }),
      mk('blue-back', '蓝大营', '大营', { attackRange: 5, attack: 70, speed: 69 }),
    ];
    let hitsOnBack = 0;
    let hitsTotal = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { events } = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 2 });
      for (const h of hits(events)) {
        if (sideOf(h.sourceId) !== 'enemy') continue; // 只看蓝方发起的普攻
        hitsTotal++;
        if (h.targetId === 'red-back') hitsOnBack++;
      }
    }
    expect(hitsTotal).toBeGreaterThan(30);
    expect(hitsOnBack).toBe(0);
  });

  it('援护友军全体（一夫当关）：护主回合内所有敌方普攻都落在援护者身上', () => {
    const red: General[] = [
      mk('red-back', '红大营', '大营'),
      mk('red-mid', '红中军', '中军'),
      mk('red-front', '红前锋', '前锋', { commandSkillIds: ['yifudangguan'] }),
    ];
    const blue: General[] = [
      mk('blue-front', '蓝前锋', '前锋', { attackRange: 5, attack: 70, speed: 71 }),
      mk('blue-mid', '蓝中军', '中军', { attackRange: 5, attack: 70, speed: 70 }),
      mk('blue-back', '蓝大营', '大营', { attackRange: 5, attack: 70, speed: 69 }),
    ];
    let hitsTotal = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { events } = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 2 });
      for (const h of hits(events)) {
        if (sideOf(h.sourceId) !== 'enemy') continue;
        hitsTotal++;
        expect(h.targetId).toBe('red-front');
      }
    }
    expect(hitsTotal).toBeGreaterThan(30);
  });

  it('舍身卫主【承担攻击伤害】：物理战法伤害改判给典韦，谋略战法伤害不改判（m00521 口径）', () => {
    // 红：典韦(前锋) 带舍身卫主；蓝：中军 一骑当千（物理·全体 280%）
    const redPhys: General[] = [
      mk('red-back', '红大营', '大营'),
      mk('red-mid', '红中军', '中军'),
      mk('red-front', '典韦', '前锋', { passiveSkillIds: ['sheshen_weizhu'] }),
    ];
    const bluePhys: General[] = [
      mk('blue-back', '蓝大营', '大营'),
      mk('blue-mid', '蓝中军', '中军', { activeSkillIds: ['yiji_dangqian'] }),
      mk('blue-front', '蓝前锋', '前锋'),
    ];
    let physHits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { events } = runBattle({ myTeam: redPhys, enemyTeam: bluePhys, seed, maxRounds: 4 });
      let round = 0;
      for (const ev of events) {
        if (ev.type === 'round_start') { round = ev.round; continue; }
        if (ev.type === 'damage' && ev.skillId === 'yiji_dangqian' && round <= 3) {
          physHits++;
          expect(ev.targetId).toBe('red-front');
        }
      }
    }
    expect(physHits).toBeGreaterThan(10);

    // 蓝：中军 驱虎吞狼（谋略·全体 153%）→ 不应该被承担，伤害仍分布在三名友军上
    const blueStrat: General[] = [
      mk('blue-back', '蓝大营', '大营'),
      mk('blue-mid', '蓝中军', '中军', { activeSkillIds: ['quhu_tunlang'] }),
      mk('blue-front', '蓝前锋', '前锋'),
    ];
    const spread = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const { events } = runBattle({ myTeam: redPhys, enemyTeam: blueStrat, seed, maxRounds: 4 });
      for (const ev of events) {
        if (ev.type === 'damage' && ev.skillId === 'quhu_tunlang') spread.add(ev.targetId);
      }
    }
    expect(spread.size).toBeGreaterThan(1);
    expect([...spread].some((id) => id !== 'red-front')).toBe(true);
  });

  it('连击：每一刀普攻都受援护约束（第二刀不得回落到被保护者）', () => {
    // 红前锋带【红颜铁骑】= 每回合开始给自己连击 → 每次行动两刀普攻
    const red: General[] = [
      mk('red-back', '红大营', '大营'),
      mk('red-mid', '红中军', '中军'),
      mk('red-front', '红前锋', '前锋', {
        attack: 200,
        speed: 200,
        attackRange: 5,
        passiveSkillIds: ['hongyan_tieqi'],
      }),
    ];
    // 蓝前锋【一夫当关】= 援护友军全体 2 回合
    const blue: General[] = [
      mk('blue-back', '蓝大营', '大营', { defense: 50 }),
      mk('blue-mid', '蓝中军', '中军', { defense: 50 }),
      mk('blue-front', '蓝前锋', '前锋', { defense: 50, commandSkillIds: ['yifudangguan'] }),
    ];
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { events } = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 2 });
      for (const h of hits(events)) {
        if (h.sourceId !== 'red-front') continue;
        total++;
        expect(h.targetId).toBe('blue-front');
      }
    }
    expect(total).toBeGreaterThan(30);
  });

  it('追击战法跟随普攻的实际目标（承担改判之后）', () => {
    // 蓝前锋典韦【舍身卫主】：物理承接到前锋；红前锋的三段追击必须跟着打到典韦
    const red: General[] = [
      mk('red-back', '红大营', '大营'),
      mk('red-mid', '红中军', '中军'),
      mk('red-front', '红前锋', '前锋', {
        attack: 200,
        speed: 200,
        attackRange: 5,
        pursuitSkillIds: ['fangzhen_tuji', 'shengqi_hengling', 'shichou'],
      }),
    ];
    const blue: General[] = [
      mk('blue-back', '蓝大营', '大营', { defense: 50 }),
      mk('blue-mid', '蓝中军', '中军', { defense: 50 }),
      mk('blue-front', '典韦', '前锋', { defense: 50, passiveSkillIds: ['sheshen_weizhu'] }),
    ];
    const PURSUIT = ['fangzhen_tuji', 'shengqi_hengling', 'shichou'];
    let pursuitHits = 0;
    for (let seed = 1; seed <= 30; seed++) {
      // 本文件只验援护改判/追击跟随：关设施，避免随机规避把首次普攻吞掉、改判目标偏移。
      const { events } = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 4, facilities: false });
      let lastBasic: string | null = null;
      for (const ev of events) {
        if (ev.type === 'attack_hit' && ev.sourceId === 'red-front') {
          lastBasic = ev.targetId;
          continue;
        }
        if (ev.type === 'damage' && ev.sourceId === 'red-front' && ev.skillId && PURSUIT.includes(ev.skillId)) {
          pursuitHits++;
          // 追击永远打「本刀普攻实际结算的目标」——普攻被承担改判到典韦后，追击也必须是典韦
          if (lastBasic) expect(ev.targetId).toBe(lastBasic);
        }
      }
    }
    expect(pursuitHits).toBeGreaterThan(20);
  });
});