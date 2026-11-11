import { describe, expect, it } from 'vitest'
import {
  addAction,
  createGame,
  getCurrentStep,
  getGlobalUsedIds,
  getSideHeroIds,
  getSteps,
  getUnavailableReason,
  isDraftComplete,
  undoLastAction,
} from '../src/engine/draft'
import type { Game, Hero, SeriesSettings, Side } from '../src/types'

const heroes: Hero[] = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  name: `英雄${index + 1}`,
  title: '',
  avatar: '',
  classId: 1,
  laneIds: [1],
  pickGroup: `hero-${index + 1}`,
}))
heroes.push({
  id: 101,
  name: '元流之子(法师)',
  title: '',
  avatar: '',
  classId: 2,
  laneIds: [3],
  pickGroup: 'yuanliu',
})
heroes.push({
  id: 102,
  name: '元流之子(坦克)',
  title: '',
  avatar: '',
  classId: 3,
  laneIds: [1],
  pickGroup: 'yuanliu',
})

const globalSettings: SeriesSettings = { mode: 'global', format: 7, ruleset: 'kpl2026' }

function act(game: Game, heroId: number, settings = globalSettings, previousGames: Game[] = []) {
  const step = getCurrentStep(game, settings.ruleset)
  if (!step) throw new Error('当前无可执行回合')
  addAction(game, { ...step, heroId }, previousGames, settings, heroes)
}

function startWithBluePick(game: Game, heroId: number, settings = globalSettings, previousGames: Game[] = []) {
  let banId = 11
  while (getCurrentStep(game, settings.ruleset)?.type === 'ban') {
    act(game, banId, settings, previousGames)
    banId += 1
  }
  act(game, heroId, settings, previousGames)
}

function completeDraft(game: Game, settings = globalSettings, previousGames: Game[] = []) {
  let heroId = 1
  while (!isDraftComplete(game, settings.ruleset)) {
    const step = getCurrentStep(game, settings.ruleset)
    if (!step) break
    const used = new Set(game.actions.map((action) => action.heroId))
    while (used.has(heroId)) heroId += 1
    addAction(game, { ...step, heroId }, previousGames, settings, heroes)
  }
}

describe('KPL 征召顺序', () => {
  it('2026 规则为 5 Ban（3+2）与 5 Pick', () => {
    const steps = getSteps('kpl2026')
    expect(steps).toHaveLength(20)
    expect(steps.filter((step) => step.side === 'blue' && step.type === 'ban')).toHaveLength(5)
    expect(steps.filter((step) => step.side === 'red' && step.type === 'ban')).toHaveLength(5)
    expect(steps.filter((step) => step.type === 'pick')).toHaveLength(10)
    // 阶段一：双方各禁 3 个，蓝红交替
    expect(steps.slice(0, 6).map((step) => step.side)).toEqual(['blue', 'red', 'blue', 'red', 'blue', 'red'])
    expect(steps.slice(0, 6).every((step) => step.type === 'ban')).toBe(true)
    // 阶段二：6 个 Pick
    expect(steps.slice(6, 12).every((step) => step.type === 'pick')).toBe(true)
    // 阶段三：双方各禁 2 个，红蓝交替
    expect(steps.slice(12, 16).map((step) => step.side)).toEqual(['red', 'blue', 'red', 'blue'])
    expect(steps.slice(12, 16).every((step) => step.type === 'ban')).toBe(true)
    // 阶段四：4 个 Pick
    expect(steps.slice(16).map((step) => step.side)).toEqual(['red', 'blue', 'blue', 'red'])
  })

  it('经典规则为 4 Ban（2+2）与 5 Pick', () => {
    const steps = getSteps('classic')
    expect(steps).toHaveLength(18)
    expect(steps.filter((step) => step.type === 'ban')).toHaveLength(8)
    expect(steps.filter((step) => step.type === 'pick')).toHaveLength(10)
    expect(steps.slice(0, 4).map((step) => step.side)).toEqual(['blue', 'red', 'blue', 'red'])
    expect(steps.slice(10, 14).map((step) => step.side)).toEqual(['red', 'blue', 'red', 'blue'])
  })

  it('完成全部操作后自动锁定本局，并可撤销', () => {
    const game = createGame(1, 7)
    completeDraft(game)
    expect(game.completedAt).toBeDefined()
    expect(getSideHeroIds(game, 'blue', 'pick')).toHaveLength(5)
    expect(getSideHeroIds(game, 'red', 'pick')).toHaveLength(5)
    undoLastAction(game)
    expect(game.completedAt).toBeUndefined()
    expect(getCurrentStep(game, 'kpl2026')).toEqual({ side: 'red', type: 'pick' })
  })
})

describe('全局 BP 限制', () => {
  it('每队独立限制历史英雄，对方仍可使用', () => {
    const first = createGame(1, 7)
    startWithBluePick(first, 1)
    const second = createGame(2, 7)
    const blueReason = getUnavailableReason({ hero: heroes[0], side: 'blue', type: 'pick', game: second, previousGames: [first], settings: globalSettings, heroes })
    const redReason = getUnavailableReason({ hero: heroes[0], side: 'red', type: 'pick', game: second, previousGames: [first], settings: globalSettings, heroes })
    expect(blueReason).toBe('本队全局已使用')
    expect(redReason).toBeNull()
    expect([...getGlobalUsedIds([first], 'blue')]).toEqual([1])
  })

  it('普通单局模式不继承历史英雄', () => {
    const first = createGame(1, 3)
    startWithBluePick(first, 1, { ...globalSettings, mode: 'single' })
    const second = createGame(2, 3)
    const reason = getUnavailableReason({ hero: heroes[0], side: 'blue', type: 'pick', game: second, previousGames: [first], settings: { ...globalSettings, mode: 'single' }, heroes })
    expect(reason).toBeNull()
  })

  it('元流之子不同职业在 Pick 时视为同一英雄', () => {
    const game = createGame(1, 7)
    startWithBluePick(game, 101)
    const reason = getUnavailableReason({ hero: heroes[21], side: 'red', type: 'pick', game, previousGames: [], settings: globalSettings, heroes })
    expect(reason).toBe('元流之子同局仅可选择一个职业')
  })
})

describe('巅峰对决', () => {
  it('BO7 第七局自动进入无 Ban 自由征召', () => {
    const game = createGame(7, 7)
    expect(game.isPeak).toBe(true)
    expect(getCurrentStep(game, 'kpl2026')).toBeNull()
  })

  it('允许双方选择同一英雄，但本队不能重复', () => {
    const game = createGame(7, 7)
    addAction(game, { side: 'blue', type: 'pick', heroId: 1 }, [], globalSettings, heroes)
    addAction(game, { side: 'red', type: 'pick', heroId: 1 }, [], globalSettings, heroes)
    expect(getSideHeroIds(game, 'blue', 'pick')).toEqual([1])
    expect(getSideHeroIds(game, 'red', 'pick')).toEqual([1])
    const reason = getUnavailableReason({ hero: heroes[0], side: 'blue', type: 'pick', game, previousGames: [], settings: globalSettings, heroes })
    expect(reason).toBe('本队已选择')
  })

  it('双方各选 5 人后完成', () => {
    const game = createGame(7, 7)
    for (const side of ['blue', 'red'] as Side[]) {
      for (let id = 1; id <= 5; id += 1) {
        addAction(game, { side, type: 'pick', heroId: id }, [], globalSettings, heroes)
      }
    }
    expect(isDraftComplete(game, 'kpl2026')).toBe(true)
  })
})
