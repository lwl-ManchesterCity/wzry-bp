/**
 * 五轴对局模型
 *
 * 复盘不能只停在「前排多少、控制多少」，那些是阵容属性，不是对局优势。
 * 这里把属性重新组织成五个能决定胜负的轴：线上、小规模团战、支援、团战、推进，
 * 并给出逐路对位表与主要贡献者，让每一条结论都能追溯到具体英雄和具体数值。
 */

import { solveLineup, LANE_LABEL } from '../shared/lanes.mjs'

export { LANE_LABEL }
export const AXIS_LABEL = {
  lane: '线上优势',
  skirmish: '小规模团战',
  rotate: '支援能力',
  teamfight: '团战优势',
  siege: '推进能力',
}

// 单人单轴的理论满分，用于把原始分换算成 0-100
const AXIS_MAX = { lane: 15, skirmish: 16.5, rotate: 10.5, teamfight: 33, siege: 15 }

function baseOf(synergy, heroId) {
  const raw = synergy.traits[String(heroId)]
  if (!Array.isArray(raw) || raw.length !== 10) return null
  return {
    front: raw[0], engage: raw[1], peel: raw[2], poke: raw[3],
    burst: raw[4], sustain: raw[5], mobility: raw[6], control: raw[7],
    phase: raw[8], damage: raw[9],
  }
}

function macroOf(macro, heroId) {
  const raw = macro?.traits?.[String(heroId)]
  if (!Array.isArray(raw) || raw.length !== 7) return null
  return {
    dps: raw[0], aoe: raw[1], waveclear: raw[2], siege: raw[3],
    flank: raw[4], lanePressure: raw[5], controlResist: raw[6],
  }
}

const AXIS_FORMULA = {
  lane: (x) => x.m.lanePressure * 3 + x.t.sustain + x.t.poke,
  skirmish: (x) => x.t.control * 2 + x.t.burst * 2 + x.t.mobility * 1.5,
  rotate: (x) => x.t.mobility * 2 + x.m.waveclear * 1.5,
  // 抗控决定前排能不能站住，属于团战范畴：「用身板吃对方关键控制」也算一种价值
  teamfight: (x) => x.t.front * 2 + x.t.engage * 2 + x.t.peel * 1.5 + x.m.dps * 2 + x.m.aoe * 2 + x.m.controlResist * 1.5,
  siege: (x) => x.m.waveclear * 2 + x.m.siege * 2 + x.m.flank,
}

export function createMatchupModel({ synergy, heroes, macro = null }) {
  const heroMap = new Map(heroes.map((hero) => [Number(hero.id), hero]))
  const detail = (id) => {
    const hero = heroMap.get(Number(id))
    return {
      id: Number(id),
      name: hero?.name || `英雄${id}`,
      laneIds: hero?.laneIds || [],
      classId: hero?.classId,
      t: baseOf(synergy, id),
      m: macroOf(macro, id),
    }
  }

  /**
   * 落位顺序：先吃教练手动排的结果，剩下的按整体最优分配。
   * 五个英雄五个位置一次算完，避免「先选先占路、后选无位可站」。
   */
  function assignLanes(picks, manual = null) {
    const items = picks.map(detail).filter((x) => x.t)
    const byId = new Map(items.map((item) => [item.id, item]))
    const solved = solveLineup(items, manual || {})
    const slots = new Map()
    const assigned = new Set()
    for (const [lane, heroId] of Object.entries(solved)) {
      const item = byId.get(Number(heroId))
      if (!item) continue
      slots.set(Number(lane), item)
      assigned.add(item.id)
    }
    const flex = items.filter((item) => !assigned.has(item.id))
    return { slots, flex }
  }

  /** 单路对线强度：线权 + 消耗 + 续航；打野位看清野转线；游走位看保护与开团 */
  function laneScore(item, lane) {
    if (!item?.t || !item.m) return 0
    if (Number(lane) === 2) return item.m.waveclear * 3 + item.t.mobility * 2 + item.t.burst
    if (Number(lane) === 5) return item.t.peel * 3 + item.t.engage * 2 + item.m.waveclear
    return item.m.lanePressure * 4 + item.t.poke * 2 + item.t.sustain + (item.t.mobility >= 2 ? 1 : 0)
  }

  function laneReasons(item, lane) {
    if (!item?.t || !item.m) return []
    const bits = []
    if (Number(lane) === 2) {
      if (item.m.waveclear >= 3) bits.push('清野转线快')
      if (item.t.mobility >= 2) bits.push('机动高')
      return bits
    }
    if (Number(lane) === 5) {
      if (item.t.peel >= 3) bits.push('保护强')
      if (item.t.engage >= 3) bits.push('开团强')
      if (item.t.peel <= 1 && item.t.engage <= 2) bits.push('辅助手段单一')
      return bits
    }
    if (item.m.lanePressure >= 3) bits.push('对线压制强')
    if (item.t.poke >= 3) bits.push('远程消耗强')
    if (item.t.sustain >= 2) bits.push('续航强')
    if (item.m.lanePressure <= 1) bits.push('对线偏弱')
    return bits
  }

  function axisRaw(picks) {
    const list = picks.map(detail).filter((x) => x.t && x.m)
    const out = {}
    for (const [key, fn] of Object.entries(AXIS_FORMULA)) {
      out[key] = list.reduce((sum, item) => sum + fn(item), 0)
    }
    return out
  }

  /** 每轴给出 0-100 绝对分（相对单人满分的 5 人上限），并列出主要贡献者 */
  function compareAxes(bluePicks, redPicks) {
    const b = axisRaw(bluePicks)
    const r = axisRaw(redPicks)
    const out = {}
    const toScore = (raw, key) => Math.min(100, Math.round((raw / (AXIS_MAX[key] * 5)) * 100))
    for (const key of Object.keys(AXIS_LABEL)) {
      const fn = AXIS_FORMULA[key]
      const drivers = (picks) => picks
        .map(detail)
        .filter((x) => x.t && x.m)
        .map((x) => ({ name: x.name, value: Number(fn(x).toFixed(1)) }))
        .filter((x) => x.value > 0)
        .sort((a, c) => c.value - a.value)
        .slice(0, 2)
        .map((x) => x.name)
      out[key] = {
        blue: toScore(b[key], key),
        red: toScore(r[key], key),
        diff: toScore(b[key], key) - toScore(r[key], key),
        blueRaw: Number(b[key].toFixed(1)),
        redRaw: Number(r[key].toFixed(1)),
        blueDrivers: drivers(bluePicks),
        redDrivers: drivers(redPicks),
      }
    }
    return out
  }

  /** 逐路对位：谁对谁、差多少、差在哪；无人对位时直接给空位结论 */
  function laneMatchups(bluePicks, redPicks, blueManual = null, redManual = null) {
    const blue = assignLanes(bluePicks, blueManual)
    const red = assignLanes(redPicks, redManual)
    const rows = []
    const shape = (item, lane) => (item
      ? {
        name: item.name,
        score: laneScore(item, lane),
        reasons: laneReasons(item, lane),
        // 非主路/副路的落位标出来，模型不该把补位当成常规对位强度
        natural: item.laneIds.includes(Number(lane)),
      }
      : null)
    for (const lane of [1, 3, 4, 2, 5]) {
      const b = blue.slots.get(lane) || null
      const r = red.slots.get(lane) || null
      if (!b && !r) continue
      const bs = laneScore(b, lane)
      const rs = laneScore(r, lane)
      const edge = bs - rs
      rows.push({
        lane: LANE_LABEL[lane],
        blue: shape(b, lane),
        red: shape(r, lane),
        edge,
        leader: !b || !r ? (b ? 'blue' : 'red') : edge === 0 ? 'even' : edge > 0 ? 'blue' : 'red',
        vacant: !b || !r,
        driver: edge > 0 ? laneReasons(b, lane) : edge < 0 ? laneReasons(r, lane) : [],
      })
    }
    return rows
  }

  /** 五轴层面能直接下判断的话，供模型引用 */
  function axisNotes(axes) {
    const notes = []
    for (const key of ['lane', 'skirmish', 'rotate', 'teamfight', 'siege']) {
      const { diff, blue, red } = axes[key]
      if (Math.abs(diff) < 6) {
        notes.push(`${AXIS_LABEL[key]}接近（${blue}:${red}）`)
        continue
      }
      const side = diff > 0 ? '蓝方' : '红方'
      notes.push(`${side}${AXIS_LABEL[key]}占优（${blue}:${red}，差 ${Math.abs(diff)}）`)
    }
    return notes
  }

  return { assignLanes, laneScore, compareAxes, laneMatchups, axisNotes, detail }
}
