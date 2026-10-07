import { Rng } from '../../src/engine/rng';
import type { BattleReport } from '../../src/engine/types';
import { ECONOMY, canAfford, createWallet, priceOf, targetWinRate } from '../../src/rogue/economy';
import { beginPull, claimBonus, pickFromPull } from '../../src/rogue/gacha';
import { addHero, createPool } from '../../src/rogue/pool';
import { formatRecruit } from '../../src/rogue/recruit';
import { applyClearReward, isEliteLevel, rollClearReward } from '../../src/rogue/rewards';
import { createRun } from '../../src/rogue/run';
import { buySkill } from '../../src/rogue/shop';
import { SAVE_KEY, loadRun, saveRun, type SaveData, type StorageLike } from '../../src/rogue/save';
import { rollEnemySlots } from '../../src/rogue/enemy';
import { buildMyTeam, settleLevel, type TeamChoice } from '../../src/rogue/loop';
import type { ClearReward } from '../../src/rogue/rewards';
import type { Outcome } from '../../src/rogue/types';
import { freePointBudget } from '../heroes';
import { gachaHtml } from './gacha';
import { poolHtml } from './pool';
import { renderReport } from './report';
import { renderShop, setShopMessage } from './shop';
import { POSITIONS, renderTeam, type TeamDraft } from './team';
import { browserStorage } from './storage';
import { esc } from './dom';
import {
  HERO_RECORDS,
  enemyFromSlots,
  gachaHeroIds,
  gradeCatalogue,
  heroName,
  initialSkillIds,
  makeGeneral,
  portraitOf,
  shopRows,
  skillChoices,
  treasureIds,
  treasureOptions,
} from './catalogue';
import { SKILL_REGISTRY } from '../../src/data/skills';

const deps = { buildGeneral: makeGeneral };

/**
 * 挂上肉鸽这一局。存储可以注入，测试因此不必碰浏览器存储。
 * @param root 页面根节点
 * @param opts 存储与开局种子
 */
export function mountRogue(root: HTMLElement, opts: { storage?: StorageLike; seed?: number } = {}): void {
  const storage = opts.storage ?? browserStorage();
  const heroIds = gachaHeroIds();
  const shopCatalogue = gradeCatalogue();
  const allShopRows = shopRows();
  const rewardCatalogue = { skills: shopCatalogue, treasures: treasureIds() };
  const restored = loadRun(storage);
  let data = restored ?? createFresh(opts.seed ?? (Date.now() % 100000 || 1));
  let feedback = '';
  let draft = emptyDraft();
  let settling = false;

  if (!restored) saveRun(storage, data);

  const skillName = (skillId: string) => SKILL_REGISTRY[skillId]?.name ?? skillId;
  const pointsOf = (heroId: string) => (redness: number, level: number) => freePointBudget(heroId, redness, level);

  function createFresh(seed: number): SaveData {
    return {
      run: createRun(seed, ECONOMY.levelCount, ECONOMY.lives),
      pool: createPool({ skills: initialSkillIds() }),
      wallet: createWallet(),
      gacha: null,
      enemy: null,
      enemyLevel: null,
      nonce: 0,
    };
  }

  function emptyDraft(): TeamDraft {
    const heroes = data.pool.heroes.slice(0, 3).map((hero) => hero.heroId);
    while (heroes.length < 3) heroes.push('');
    return {
      heroes,
      skills: [['', ''], ['', ''], ['', '']],
      treasures: ['', '', ''],
      query: '',
      grade: 'ALL',
      type: 'ALL',
      focusSlot: 0,
      focusIndex: 0,
    };
  }

  function persist(): void {
    saveRun(storage, data);
  }

  function peekRng(): Rng {
    return new Rng((data.run.seed + data.nonce * 100003) >>> 0);
  }

  function shell(body: string): string {
    return `
      <div class="rg-app">
        <header class="rg-top">
          <h1>卡牌肉鸽</h1>
          <p>第 ${data.run.level} 关 · 命数 ${data.run.lives} · 玉符 ${data.wallet.jade}</p>
          <nav>
            <button type="button" id="rg-nav-hub">总览</button>
            <button type="button" id="rg-nav-gacha">抽卡</button>
            <button type="button" id="rg-nav-shop">商店</button>
            <button type="button" id="rg-nav-pool">卡池</button>
            <button type="button" id="rg-nav-intel">出战</button>
          </nav>
        </header>
        <div id="rg-view">${body}</div>
        <footer class="rg-foot">本作为个人学习与非商业求职作品，使用《率土之滨》的公开数据与素材做玩法研究与技术演示，不用于商业分发。玩法规则、数值与素材版权归原权利方所有。</footer>
      </div>`;
  }

  function paint(body: string, bind: (view: HTMLElement) => void): void {
    root.innerHTML = shell(body);
    root.setAttribute('data-rogue-ready', '1');
    root.querySelector('#rg-nav-hub')!.addEventListener('click', showHub);
    root.querySelector('#rg-nav-gacha')!.addEventListener('click', showGacha);
    root.querySelector('#rg-nav-shop')!.addEventListener('click', () => showShop());
    root.querySelector('#rg-nav-pool')!.addEventListener('click', showPool);
    root.querySelector('#rg-nav-intel')!.addEventListener('click', showIntel);
    bind(root.querySelector('#rg-view') as HTMLElement);
  }

  function showHub(): void {
    if (data.run.status !== 'playing') {
      showEnd();
      return;
    }
    paint(
      `<section id="rg-hub">
        <p>卡池 ${data.pool.heroes.length} 人。玉符只干两件事：五连抽武将，或者买指定的 A/S 战法。</p>
        <p>${data.gacha ? '有一次五连抽还没走完。' : `开局 ${ECONOMY.startingJade} 玉符，一次五连抽 ${ECONOMY.gachaCost}。`}</p>
      </section>`,
      () => {},
    );
  }

  function showGacha(): void {
    paint(
      gachaHtml({
        pull: data.gacha,
        canPay: canAfford(data.wallet, ECONOMY.gachaCost),
        feedback,
        nameOf: heroName,
        portraitOf,
      }),
      (view) => {
        view.querySelector('#rg-pull')?.addEventListener('click', onPull);
        view.querySelector('#rg-bonus')?.addEventListener('click', onBonus);
        view.querySelectorAll<HTMLButtonElement>('[id^="rg-card-"]').forEach((button) => {
          button.addEventListener('click', () => onPick(Number(button.id.slice('rg-card-'.length))));
        });
      },
    );
  }

  function onPull(): void {
    if (!data.gacha) {
      const began = beginPull(data.wallet, peekRng(), heroIds);
      if (!began) {
        feedback = '玉符不足';
        showGacha();
        return;
      }
      data.nonce += 1;
      data.wallet = began.wallet;
      data.gacha = began.pull;
      feedback = '';
      persist();
    }
    showGacha();
  }

  function onPick(index: number): void {
    if (!data.gacha || data.gacha.picked) return;
    const heroId = data.gacha.shown[index];
    if (!heroId) return;
    data.gacha = pickFromPull(data.gacha, heroId);
    const added = addHero(data.pool, heroId);
    data.pool = added.pool;
    feedback = formatRecruit(heroName(heroId), added.feedback, pointsOf(heroId));
    persist();
    showGacha();
  }

  function onBonus(): void {
    if (!data.gacha?.picked) return;
    const heroId = claimBonus(data.gacha);
    const added = addHero(data.pool, heroId);
    data.pool = added.pool;
    data.gacha = null;
    feedback = formatRecruit(heroName(heroId), added.feedback, pointsOf(heroId));
    persist();
    showGacha();
  }

  function showPool(): void {
    paint(poolHtml({ pool: data.pool, nameOf: heroName, portraitOf }), () => {});
  }

  function showShop(message = ''): void {
    const rows = allShopRows.filter((row) => !data.pool.skills.includes(row.id));
    paint('', (view) => {
      renderShop(view, {
        rows,
        jade: data.wallet.jade,
        priceOf: (grade) => economyPrice(grade),
        onBuy: (skillId) => {
          const result = buySkill(data.wallet, data.pool, skillId, shopCatalogue);
          if (!result.ok) {
            const text = result.reason === 'broke' ? '玉符不足' : result.reason === 'owned' ? '已经拥有' : '未上架';
            setShopMessage(view, text);
            return;
          }
          data.wallet = result.wallet;
          data.pool = result.pool;
          persist();
          showShop('已买入');
        },
      });
      if (message) setShopMessage(view, message);
    });
  }

  function ensureEnemy() {
    if (data.enemy && data.enemyLevel === data.run.level) return data.enemy;
    data.enemy = rollEnemySlots(data.run.seed, data.run.level, heroIds, data.run.levelCount);
    data.enemyLevel = data.run.level;
    persist();
    return data.enemy;
  }

  function showIntel(): void {
    if (data.run.status !== 'playing') {
      showEnd();
      return;
    }
    const slots = ensureEnemy();
    const rate = Math.round(targetWinRate(data.run.level, data.run.levelCount) * 100);
    const rows = slots
      .map((slot) => `<li>${esc(slot.position)}｜${esc(heroName(slot.heroId))}｜${slot.redness} 红｜${slot.level} 级</li>`)
      .join('');
    const ready = data.pool.heroes.length >= 3;
    paint(
      `<section id="rg-intel">
        <h2>第 ${data.run.level} 关 · 敌方情报</h2>
        <p>目标胜率 ${rate}%</p>
        ${isEliteLevel(data.run.level) ? '<p class="rg-note">幕末精英关：突破奖励本版未开放。</p>' : ''}
        <ul>${rows}</ul>
        <button id="rg-to-team" type="button" ${ready ? '' : 'disabled'}>组队</button>
        ${ready ? '' : '<p>卡池至少 3 名武将才能出战。</p>'}
      </section>`,
      (view) => view.querySelector('#rg-to-team')?.addEventListener('click', showTeam),
    );
  }

  function showTeam(): void {
    const owned = new Set(data.pool.heroes.map((hero) => hero.heroId));
    if (draft.heroes.filter((id) => owned.has(id)).length < Math.min(3, data.pool.heroes.length)) {
      draft = emptyDraft();
    }
    paint('<div id="rg-team-host"></div>', (view) => {
      renderTeam(view.querySelector('#rg-team-host') as HTMLElement, {
        heroes: data.pool.heroes,
        nameOf: heroName,
        choices: (query, grade, type) => skillChoices(data.pool.skills, query, grade, type),
        skillName,
        treasures: treasureOptions().filter((treasure) => data.pool.treasures.includes(treasure.id)),
        draft,
        onFight: () => fight(view),
      });
    });
  }

  function fight(view: HTMLElement): void {
    if (settling) return;
    const slots = POSITIONS.map((position, index) => {
      const heroId = (view.querySelector(`#rg-hero-${index}`) as HTMLSelectElement | null)?.value ?? '';
      const treasureId = (view.querySelector(`#rg-trs-${index}`) as HTMLSelectElement | null)?.value ?? '';
      draft.heroes[index] = heroId;
      draft.treasures[index] = treasureId;
      return {
        heroId,
        skillIds: (draft.skills[index] ?? []).filter((id) => id.length > 0),
        position,
        treasureId: treasureId || undefined,
      };
    });
    const error = teamError(slots);
    const errorNode = view.querySelector('#rg-team-error');
    if (error) {
      if (errorNode) errorNode.textContent = error;
      return;
    }
    settling = true;
    try {
      const foughtLevel = data.run.level;
      const choice: TeamChoice = { slots };
      const myTeam = buildMyTeam(data.pool, choice, deps);
      const enemyTeam = enemyFromSlots(ensureEnemy());
      const result = settleLevel(data.run, data.pool, myTeam, enemyTeam, foughtLevel);
      data.run = result.run;
      data.pool = result.pool;
      let reward: ClearReward | null = null;
      if (result.outcome === 'win') {
        reward = rollClearReward(peekRng(), rewardCatalogue, {
          skills: data.pool.skills,
          treasures: data.pool.treasures,
        });
        data.nonce += 1;
        const applied = applyClearReward(data.wallet, data.pool, reward);
        data.wallet = applied.wallet;
        data.pool = applied.pool;
        data.enemy = null;
        data.enemyLevel = null;
      }
      persist();
      showReport(result.report, result.outcome, foughtLevel, reward);
    } catch (caught) {
      if (errorNode) errorNode.textContent = caught instanceof Error ? caught.message : '出战失败';
    } finally {
      settling = false;
    }
  }

  function teamError(slots: TeamChoice['slots']): string | null {
    const ids = slots.map((slot) => slot.heroId);
    if (ids.some((id) => !id) || ids.length < 3) return '请凑齐 3 名武将';
    if (new Set(ids).size !== ids.length) return '同一名武将不能占两个位置';
    const groups = ids
      .map((id) => HERO_RECORDS[id]?.mutualExclusionGroup)
      .filter((group): group is string => Boolean(group));
    if (new Set(groups).size !== groups.length) return '互斥武将不能同时上阵';
    return null;
  }

  function showReport(report: BattleReport, outcome: Outcome, foughtLevel: number, reward: ClearReward | null): void {
    paint('', (view) => {
      renderReport(view, {
        report,
        outcome,
        elite: isEliteLevel(foughtLevel),
        onNext: () => {
          if (reward) showReward(reward);
          else if (data.run.status !== 'playing') showEnd();
          else showIntel();
        },
      });
    });
  }

  function showReward(reward: ClearReward): void {
    const bonus = reward.bonus;
    const extra = !bonus
      ? '没有额外掉落'
      : bonus.kind === 'skill'
        ? `战法 · ${skillName(bonus.id)} · ${bonus.grade}`
        : `宝物 · ${treasureOptions().find((treasure) => treasure.id === bonus.id)?.name ?? bonus.id}`;
    paint(
      `<section id="rg-reward"><h2>通关奖励</h2><p>玉符 +${reward.jade}</p><p>${esc(extra)}</p><button id="rg-next" type="button">继续</button></section>`,
      (view) => {
        view.querySelector('#rg-next')!.addEventListener('click', () => {
          if (data.run.status === 'playing') showIntel();
          else showEnd();
        });
      },
    );
  }

  function showEnd(): void {
    const title = data.run.status === 'cleared' ? '通关！' : '全军覆没';
    paint(
      `<section id="rg-end"><h2>${title}</h2><button id="rg-restart" type="button">再来一局</button></section>`,
      (view) => view.querySelector('#rg-restart')!.addEventListener('click', restart),
    );
  }

  function restart(): void {
    storage.removeItem(SAVE_KEY);
    data = createFresh(opts.seed ?? (Date.now() % 100000 || 1));
    feedback = '';
    draft = emptyDraft();
    persist();
    showHub();
  }

  if (data.run.status === 'playing') showHub();
  else showEnd();
}

/** 商店标价。只有 A/S 会进货架。 */
function economyPrice(grade: string): number {
  return grade === 'S' ? priceOf('S') : priceOf('A');
}

if (typeof document !== 'undefined') {
  const pageRoot = document.querySelector('#rg-root');
  if (pageRoot instanceof HTMLElement) mountRogue(pageRoot);
}
