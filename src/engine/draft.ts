import type {
  ActionType,
  DraftAction,
  DraftStep,
  Game,
  Hero,
  MatchFormat,
  RuleSet,
  SeriesSettings,
  Side,
} from '../types'

/** 5 Ban 征召（KPL 2026）：阶段一每队 2 个禁用，蓝→红交替 */
const kplFirstBans: DraftStep[] = [
  { side: 'blue', type: 'ban' },
  { side: 'red', type: 'ban' },
  { side: 'blue', type: 'ban' },
  { side: 'red', type: 'ban' },
]

/** 4 Ban 征召（经典）：阶段一每队 2 个禁用，蓝→红交替 */
const classicFirstBans: DraftStep[] = [
  { side: 'blue', type: 'ban' },
  { side: 'red', type: 'ban' },
  { side: 'blue', type: 'ban' },
  { side: 'red', type: 'ban' },
]

const firstPicks: DraftStep[] = [
  { side: 'blue', type: 'pick' },
  { side: 'red', type: 'pick' },
  { side: 'red', type: 'pick' },
  { side: 'blue', type: 'pick' },
  { side: 'blue', type: 'pick' },
  { side: 'red', type: 'pick' },
]

/** 阶段二禁用（KPL 2026）：每队 3 个，红→蓝交替 */
const kplSecondBans: DraftStep[] = [
  { side: 'red', type: 'ban' },
  { side: 'blue', type: 'ban' },
  { side: 'red', type: 'ban' },
  { side: 'blue', type: 'ban' },
  { side: 'red', type: 'ban' },
  { side: 'blue', type: 'ban' },
]

/** 阶段二禁用（经典）：每队 2 个，红→蓝交替 */
const classicSecondBans: DraftStep[] = [
  { side: 'red', type: 'ban' },
  { side: 'blue', type: 'ban' },
  { side: 'red', type: 'ban' },
  { side: 'blue', type: 'ban' },
]

const finalPicks: DraftStep[] = [
  { side: 'red', type: 'pick' },
  { side: 'blue', type: 'pick' },
  { side: 'blue', type: 'pick' },
  { side: 'red', type: 'pick' },
]

export function getSteps(ruleset: RuleSet): DraftStep[] {
  return [
    ...(ruleset === 'kpl2026' ? kplFirstBans : classicFirstBans),
    ...firstPicks,
    ...(ruleset === 'kpl2026' ? kplSecondBans : classicSecondBans),
    ...finalPicks,
  ]
}

export function isPeakGame(format: MatchFormat, gameNumber: number): boolean {
  return format === 7 && gameNumber === 7
}

export function createGame(number: number, format: MatchFormat): Game {
  return {
    number,
    isPeak: isPeakGame(format, number),
    actions: [],
  }
}

export function getSideActions(game: Game, side: Side, type: ActionType): DraftAction[] {
  return game.actions.filter((action) => action.side === side && action.type === type)
}

export function getSideHeroIds(game: Game, side: Side, type: ActionType): number[] {
  return getSideActions(game, side, type).map((action) => action.heroId)
}

export function getCurrentStep(game: Game, ruleset: RuleSet): DraftStep | null {
  if (game.isPeak || isDraftComplete(game, ruleset)) return null
  return getSteps(ruleset)[game.actions.length] ?? null
}

export function isDraftComplete(game: Game, ruleset: RuleSet): boolean {
  if (game.isPeak) {
    return getSideHeroIds(game, 'blue', 'pick').length === 5
      && getSideHeroIds(game, 'red', 'pick').length === 5
  }
  return game.actions.length >= getSteps(ruleset).length
}

export function getGlobalUsedIds(previousGames: Game[], side: Side): Set<number> {
  return new Set(
    previousGames
      .filter((game) => !game.isPeak)
      .flatMap((game) => getSideHeroIds(game, side, 'pick')),
  )
}

export function getGlobalUsedGroups(previousGames: Game[], side: Side, heroes: Hero[]): Set<string> {
  const heroMap = new Map(heroes.map((hero) => [hero.id, hero]))
  const groups = new Set<string>()
  for (const id of getGlobalUsedIds(previousGames, side)) {
    const hero = heroMap.get(id)
    if (hero) groups.add(hero.pickGroup)
  }
  return groups
}

interface AvailabilityInput {
  hero: Hero
  side: Side
  type: ActionType
  game: Game
  previousGames: Game[]
  settings: SeriesSettings
  heroes: Hero[]
}

export function getUnavailableReason(input: AvailabilityInput): string | null {
  const { hero, side, type, game, previousGames, settings, heroes } = input

  if (game.isPeak) {
    if (type === 'ban') return '巅峰对决无禁用阶段'
    const ownPicks = getSideHeroIds(game, side, 'pick')
    if (ownPicks.includes(hero.id)) return '本队已选择'
    const ownGroups = new Set(
      ownPicks.map((id) => heroes.find((item) => item.id === id)?.pickGroup).filter(Boolean),
    )
    if (ownGroups.has(hero.pickGroup)) return '元流之子每队仅可选择一个职业'
    if (ownPicks.length >= 5) return '本队阵容已满'
    return null
  }

  const heroMap = new Map(heroes.map((item) => [item.id, item]))
  const existingAction = game.actions.find((action) => action.heroId === hero.id)
  if (existingAction) return existingAction.type === 'ban' ? '本局已禁用' : '本局已选择'

  if (type === 'pick') {
    const pickedGroups = new Set(
      game.actions
        .filter((action) => action.type === 'pick')
        .map((action) => heroMap.get(action.heroId)?.pickGroup)
        .filter(Boolean),
    )
    if (pickedGroups.has(hero.pickGroup)) return '元流之子同局仅可选择一个职业'

    if (settings.mode === 'global') {
      const usedGroups = getGlobalUsedGroups(previousGames, side, heroes)
      if (usedGroups.has(hero.pickGroup)) return '本队全局已使用'
    }
  }

  return null
}

export function addAction(
  game: Game,
  action: DraftAction,
  previousGames: Game[],
  settings: SeriesSettings,
  heroes: Hero[],
): void {
  const hero = heroes.find((item) => item.id === action.heroId)
  if (!hero) throw new Error('英雄不存在')
  if (isDraftComplete(game, settings.ruleset)) throw new Error('本局 BP 已完成')

  if (!game.isPeak) {
    const expected = getCurrentStep(game, settings.ruleset)
    if (!expected || expected.side !== action.side || expected.type !== action.type) {
      throw new Error('当前回合与操作不匹配')
    }
  } else if (action.type !== 'pick') {
    throw new Error('巅峰对决仅支持选择英雄')
  }

  const reason = getUnavailableReason({ hero, ...action, game, previousGames, settings, heroes })
  if (reason) throw new Error(reason)

  game.actions.push(action)
  if (isDraftComplete(game, settings.ruleset)) game.completedAt = new Date().toISOString()
}

export function undoLastAction(game: Game): void {
  game.actions.pop()
  delete game.completedAt
}

export function removePeakPick(game: Game, side: Side, heroId: number): void {
  const index = game.actions.findIndex(
    (action) => action.side === side && action.type === 'pick' && action.heroId === heroId,
  )
  if (index >= 0) {
    game.actions.splice(index, 1)
    delete game.completedAt
  }
}

export function getActionOrdinal(game: Game, target: DraftAction): number {
  return game.actions.filter(
    (action) => action.side === target.side && action.type === target.type,
  ).indexOf(target) + 1
}
