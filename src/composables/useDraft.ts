import { computed, reactive, ref } from 'vue'
import {
  addAction,
  createGame,
  getCurrentStep,
  getGlobalUsedIds,
  getSideHeroIds,
  getUnavailableReason,
  isDraftComplete,
  removePeakPick,
  undoLastAction,
} from '../engine/draft'
import { applyLaneDrop, invertLineup, resolveLanes, type LaneLineup } from '../engine/lineup'
import type {
  ActionType,
  Game,
  Hero,
  SeriesSettings,
  Side,
} from '../types'

/** laneId -> heroId，由选择结果算出的默认分路 */
type LaneMap = LaneLineup

/** 每场系列赛换一个种子：AI 的思路与同分排序都由它决定，换一场就不是同一份答卷 */
function newSeriesSeed() {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * 第几场系列赛记在本地：刷新页面也不会让 AI 退回第一种打法，
 * 否则每次重开浏览器都从同一个思路开始，看起来还是固定套路。
 */
const SERIES_KEY = 'wzry-bp-series-index'

function readSeriesIndex() {
  try {
    const raw = Number(window.localStorage.getItem(SERIES_KEY))
    return Number.isFinite(raw) && raw > 0 ? raw : 0
  } catch {
    return 0
  }
}

function bumpSeriesIndex() {
  const next = readSeriesIndex() + 1
  try {
    window.localStorage.setItem(SERIES_KEY, String(next))
  } catch {
    // 隐私模式下 localStorage 不可写，退化成内存计数
  }
  return next
}

export function useDraft(heroes: Hero[]) {
  const settings = reactive<SeriesSettings>({
    mode: 'global',
    format: 7,
    ruleset: 'kpl2026',
    opponent: 'human',
    humanSide: 'blue',
  })
  const previousGames = ref<Game[]>([])
  const seriesSeed = ref(newSeriesSeed())
  /** 第几场系列赛：AI 的思路按它轮转，保证每开一场新系列赛就换打法 */
  const seriesIndex = ref(readSeriesIndex())
  const currentGame = ref<Game>(createGame(1, settings.format))
  const blueName = ref('蓝色方')
  const redName = ref('红色方')
  const selectedHeroId = ref<number | null>(null)
  const peakSide = ref<Side>('blue')
  const peakRevealed = ref(false)
  const error = ref('')
  /** 手动排布的分路：heroId -> laneId，只存被拖过的整队结果 */
  const manualLanes = reactive<Record<Side, LaneLineup>>({ blue: {}, red: {} })

  const currentStep = computed(() => getCurrentStep(currentGame.value, settings.ruleset))
  const activeSide = computed<Side>(() => (
    currentGame.value.isPeak ? peakSide.value : currentStep.value?.side ?? 'blue'
  ))
  const activeType = computed<ActionType>(() => (
    currentGame.value.isPeak ? 'pick' : currentStep.value?.type ?? 'pick'
  ))
  const complete = computed(() => isDraftComplete(currentGame.value, settings.ruleset))
  const hasProgress = computed(() => previousGames.value.length > 0 || currentGame.value.actions.length > 0)
  /** 人机对战时模型执掌的一方 */
  const aiSide = computed<Side>(() => (settings.humanSide === 'blue' ? 'red' : 'blue'))
  /** 当前这一步是否轮到模型出手 */
  const aiTurn = computed(() => {
    if (settings.opponent !== 'ai' || complete.value) return false
    if (currentGame.value.isPeak) {
      // 巅峰对决双方各自秘密选满 5 人，模型也需要把自己的阵容选完
      return peakSide.value === aiSide.value && getSideHeroIds(currentGame.value, aiSide.value, 'pick').length < 5
    }
    return activeSide.value === aiSide.value
  })

  function clearTransientState() {
    selectedHeroId.value = null
    peakSide.value = 'blue'
    peakRevealed.value = false
    error.value = ''
    manualLanes.blue = {}
    manualLanes.red = {}
  }

  function resetSeries() {
    previousGames.value = []
    seriesSeed.value = newSeriesSeed()
    seriesIndex.value = bumpSeriesIndex()
    currentGame.value = createGame(1, settings.format)
    clearTransientState()
  }

  function changeSetting<K extends keyof SeriesSettings>(key: K, value: SeriesSettings[K]) {
    if (settings[key] === value) return
    if (hasProgress.value && !window.confirm('更改赛制或规则将清空当前系列赛，是否继续？')) return
    settings[key] = value
    resetSeries()
  }

  function reasonFor(hero: Hero, side = activeSide.value, type = activeType.value) {
    if (complete.value) return '本局 BP 已完成'
    return getUnavailableReason({
      hero,
      side,
      type,
      game: currentGame.value,
      previousGames: previousGames.value,
      settings,
      heroes,
    })
  }

  function confirmHero(heroId: number) {
    error.value = ''
    try {
      addAction(currentGame.value, {
        heroId,
        side: activeSide.value,
        type: activeType.value,
      }, previousGames.value, settings, heroes)
      selectedHeroId.value = null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
    }
  }

  function undo() {
    if (!currentGame.value.actions.length) return
    undoLastAction(currentGame.value)
    selectedHeroId.value = null
    error.value = ''
  }

  function resetCurrentGame() {
    if (!currentGame.value.actions.length) return
    if (!window.confirm('仅清空当前小局的 BP 操作，是否继续？')) return
    currentGame.value = createGame(currentGame.value.number, settings.format)
    clearTransientState()
  }

  function nextGame() {
    if (!complete.value || currentGame.value.number >= settings.format) return
    const finishedGame = JSON.parse(JSON.stringify(currentGame.value)) as Game
    previousGames.value.push(finishedGame)
    currentGame.value = createGame(finishedGame.number + 1, settings.format)
    clearTransientState()
  }

  function removePeakHero(side: Side, heroId: number) {
    if (!currentGame.value.isPeak) return
    removePeakPick(currentGame.value, side, heroId)
  }

  function globalUsed(side: Side) {
    return settings.mode === 'global' ? getGlobalUsedIds(previousGames.value, side) : new Set<number>()
  }

  function sidePicks(side: Side) {
    return getSideHeroIds(currentGame.value, side, 'pick')
  }

  function picksOf(side: Side) {
    return sidePicks(side)
      .map((id) => heroes.find((hero) => hero.id === id))
      .filter((hero): hero is Hero => Boolean(hero))
  }

  /** 当前分路落位：手动结果优先，其余按主路自动分配 */
  function laneMap(side: Side): LaneMap {
    return resolveLanes(picksOf(side), manualLanes[side])
  }

  /** 拖拽换位，整队排布一次固定 */
  function assignLane(side: Side, laneId: number, heroId: number) {
    manualLanes[side] = applyLaneDrop(picksOf(side), manualLanes[side], heroId, laneId)
  }

  /** 回到自动排布 */
  function autoLanes(side: Side) {
    manualLanes[side] = {}
  }

  function hasManualLanes(side: Side) {
    return Object.keys(manualLanes[side]).length > 0
  }

  /** 发给复盘的 heroId -> laneId，双方都带上，服务端不再自己猜 */
  function lineupPayload() {
    return {
      blue: invertLineup(laneMap('blue')),
      red: invertLineup(laneMap('red')),
    }
  }

  function sideBans(side: Side) {
    return getSideHeroIds(currentGame.value, side, 'ban')
  }

  function exportSeries() {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings,
      teams: { blue: blueName.value, red: redName.value },
      previousGames: previousGames.value,
      currentGame: currentGame.value,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `kpl-draft-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return {
    settings,
    previousGames,
    seriesSeed,
    seriesIndex,
    currentGame,
    blueName,
    redName,
    selectedHeroId,
    peakSide,
    peakRevealed,
    error,
    currentStep,
    activeSide,
    activeType,
    complete,
    aiSide,
    aiTurn,
    reasonFor,
    confirmHero,
    undo,
    resetCurrentGame,
    resetSeries,
    nextGame,
    changeSetting,
    removePeakHero,
    globalUsed,
    sidePicks,
    sideBans,
    laneMap,
    assignLane,
    autoLanes,
    hasManualLanes,
    lineupPayload,
    exportSeries,
  }
}
