import { solveLineup } from '../../shared/lanes.mjs'
import type { Hero } from '../types'

export const LANE_ORDER = [1, 2, 3, 4, 5] as const

/** laneId -> heroId；两种下标都是数字，读的时候统一 Number() 一下 */
export type LaneLineup = Record<number, number>

export function resolveLanes(picks: Hero[], manual: LaneLineup = {}): LaneLineup {
  return solveLineup(picks, manual)
}

export function laneOfHero(lineup: LaneLineup, heroId: number): number | null {
  for (const [lane, id] of Object.entries(lineup)) {
    if (Number(id) === Number(heroId)) return Number(lane)
  }
  return null
}

/** heroId -> laneId，交给服务端做手动排布 */
export function invertLineup(lineup: LaneLineup): LaneLineup {
  const out: LaneLineup = {}
  for (const [lane, heroId] of Object.entries(lineup)) out[Number(heroId)] = Number(lane)
  return out
}

/**
 * 拖拽换位：把英雄放到目标分路，原本在那一路的人回到他的旧位置（互换）。
 * 返回完整的 heroId -> laneId 映射，之后整队排布就固定下来，不会再被自动分配挤走。
 */
export function applyLaneDrop(
  picks: Hero[],
  manual: LaneLineup,
  heroId: number,
  laneId: number,
): LaneLineup {
  if (!picks.some((hero) => hero.id === heroId)) return manual
  const current = resolveLanes(picks, manual)
  const from = laneOfHero(current, heroId)
  const occupant = current[laneId]
  // 先把被拖的英雄和原占位者从旧格子里摘出来，避免同一人同时挂在两路
  const next: LaneLineup = {}
  for (const [lane, id] of Object.entries(current)) {
    const numericId = Number(id)
    if (numericId === heroId || numericId === occupant) continue
    next[Number(lane)] = numericId
  }
  next[laneId] = heroId
  if (occupant && occupant !== heroId && from && from !== laneId) next[from] = occupant
  return invertLineup(next)
}
