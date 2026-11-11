/**
 * 分路落位算法（前后端共用）
 *
 * 旧实现只认 laneIds[0]：元流之子(坦克)与司空震都是「对抗路/打野」，
 * 先选中的那个占了对抗路，后选中的直接被丢掉，于是复盘里出现「打野 无人」，
 * 但对面打野明明存在，整条对位线就废了。
 *
 * 这里的做法是把五个分路当成一次整体分配：每个英雄必须落且只落一路，
 * 主路优先、副路次之，未列出的路只在凑不满五人时才用。
 * 五个英雄最多 120 种排法，直接回溯求总分最优，不需要启发式。
 */

export const LANE_IDS = [1, 2, 3, 4, 5]
export const LANE_LABEL = { 1: '对抗路', 2: '打野', 3: '中路', 4: '发育路', 5: '游走' }

// 职业对分路的天然偏好，只在同分时用来裁决（例如战士和坦克都能打对抗路时，对抗路归战士）
const CLASS_AFFINITY = {
  1: { 1: 8 }, // 战士
  2: { 3: 8 }, // 法师
  3: { 1: 2 }, // 坦克
  4: { 2: 8 }, // 刺客
  5: { 4: 8 }, // 射手
  6: { 5: 8 }, // 辅助
}

const OFF_LANE = 6

/** 单个英雄打某一路的适配分：主路 100、副路 55、第三路 30、未列出 6 */
export function laneFit(hero, lane) {
  const laneIds = Array.isArray(hero?.laneIds) ? hero.laneIds.map(Number) : []
  const index = laneIds.indexOf(Number(lane))
  const base = index === 0 ? 100 : index === 1 ? 55 : index === 2 ? 30 : index >= 0 ? 20 : OFF_LANE
  const bias = CLASS_AFFINITY[Number(hero?.classId)]?.[Number(lane)] || 0
  return base + bias
}

/**
 * @param {Array<{id:number, laneIds:number[], classId?:number}>} heroes
 * @param {Record<string|number, number>} [fixed] 手动指定的 heroId -> laneId，优先生效
 * @returns {Record<number, number>} laneId -> heroId
 */
export function solveLineup(heroes, fixed = {}) {
  const list = (Array.isArray(heroes) ? heroes : []).filter((hero) => hero && hero.id !== undefined)
  const taken = new Map()
  const placed = new Set()

  for (const hero of list) {
    const lane = Number(fixed?.[hero.id] ?? fixed?.[String(hero.id)])
    if (!LANE_IDS.includes(lane) || taken.has(lane) || placed.has(hero.id)) continue
    taken.set(lane, hero)
    placed.add(hero.id)
  }

  const rest = list.filter((hero) => !placed.has(hero.id))
  const free = LANE_IDS.filter((lane) => !taken.has(lane))
  // 英雄比空位多时（正常 BP 不会出现），多出来的先不落位
  const queue = rest.slice(0, free.length)

  let best = null
  if (queue.length) {
    const walk = (index, used, score, choice) => {
      if (index === queue.length) {
        if (!best || score > best.score) best = { score, choice: [...choice] }
        return
      }
      for (const lane of free) {
        if (used.has(lane)) continue
        used.add(lane)
        choice.push([lane, queue[index]])
        walk(index + 1, used, score + laneFit(queue[index], lane), choice)
        choice.pop()
        used.delete(lane)
      }
    }
    walk(0, new Set(), 0, [])
  }

  const out = {}
  for (const [lane, hero] of taken) out[lane] = Number(hero.id)
  for (const [lane, hero] of best?.choice || []) out[lane] = Number(hero.id)
  return out
}
