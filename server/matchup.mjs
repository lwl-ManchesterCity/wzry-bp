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

/**
 * 团战不是五个人的属性相加。
 *
 * 一次能打赢的团战要闭合四个环节：有人先手 → 有人接火 → 有人承伤 → 核心有人保。
 * 只按属性求和，会让「五个人都带点前排和输出」的散装阵容，压过
 * 「一个真坦克 + 一个专业保人」的成型阵容 —— 因为前者凑数多，后者专精。
 * 所以这里按环节是否闭合加减，让「结构」而不是「数值堆叠」决定团战轴。
 */
function teamfightShape(list) {
  const notes = []
  let value = 0
  if (!list.length) return { value, notes }
  const engage = list.filter((x) => x.t.engage >= 3)
  // 接火：有人能在先手后立刻把伤害压进去（爆发或范围伤害）
  const followUp = list.some((x) => x.t.burst >= 3 || x.m.aoe >= 3)
  const peel = list.filter((x) => x.t.peel >= 2)
  // 输出核心：靠 dps 吃饭、自己站不住（前排 0-1）
  const carry = list.filter((x) => x.m.dps >= 3 && x.t.front <= 1)
  // 真承伤点：front>=3 才算能站住吃伤害，战士的 1-2 不算
  const tanks = list.filter((x) => x.t.front >= 3)

  if (engage.length) {
    if (followUp) {
      value += 8
      notes.push('先手有人接火')
    } else {
      value -= 8
      notes.push('先手没人接火')
    }
  }
  if (carry.length) {
    if (peel.length) {
      value += 6
      notes.push('输出核心有保护')
    } else {
      value -= 8
      notes.push('输出核心没人保护')
    }
  }
  if (!tanks.length) {
    value -= 6
    notes.push('没有站得住的承伤点')
  }
  // 伤害类型集中到 4 人以上，对面一件物抗/法抗装就能同时针对整队
  const mix = list.reduce((acc, x) => {
    acc[x.t.damage] = (acc[x.t.damage] || 0) + 1
    return acc
  }, {})
  const dominant = Object.entries(mix).sort((a, b) => b[1] - a[1])[0]
  if (dominant && dominant[1] >= 4) {
    value -= 6
    notes.push(`伤害类型集中在${dominant[0] === 'phys' ? '物理' : dominant[0] === 'magic' ? '法术' : '混伤'}`)
  }
  return { value, notes }
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
    // 团战轴叠加「环节是否闭合」的加减，其余轴仍按属性求和
    const shape = teamfightShape(list)
    out.teamfight += shape.value
    return { raw: out, shape }
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
        blue: toScore(b.raw[key], key),
        red: toScore(r.raw[key], key),
        diff: toScore(b.raw[key], key) - toScore(r.raw[key], key),
        blueRaw: Number(b.raw[key].toFixed(1)),
        redRaw: Number(r.raw[key].toFixed(1)),
        blueDrivers: drivers(bluePicks),
        redDrivers: drivers(redPicks),
        // 结构结论：让模型能说清「为什么团战强/弱」，而不是只念一个分数
        ...(key === 'teamfight' ? { blueShape: b.shape.notes, redShape: r.shape.notes } : {}),
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
