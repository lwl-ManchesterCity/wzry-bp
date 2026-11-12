/**
 * BO1 整队规划器。
 *
 * 单英雄评分只回答“谁强”，这里回答“这五个人放在一起是否成立”。
 * 选人：束搜索生成多套五路齐全的阵容，当前候选能进入多强的阵容，就决定它的价值。
 * Ban：分别计算对手“能拿候选”和“候选被禁”后的最佳阵容，分差才是禁用收益。
 */

import { DRAFT_STYLES, seededUnit } from '../shared/styles.mjs'

const LANES = ['对抗路', '打野', '中路', '发育路', '游走']
const COMBO_KIND_BY_STYLE = {
  engage: { engage: 10, protection: 3 },
  protect: { protection: 14, poke: 4 },
  siege: { push: 12, poke: 8, lane: 4 },
  pickoff: { pickoff: 13, engage: 3 },
  counter: { engage: 3, protection: 3, pickoff: 3, push: 3 },
  meta: {},
}

const uniqueIds = (ids) => [...new Set((ids || []).map(Number).filter(Number.isFinite))]
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function macroOf(macro, heroId) {
  const raw = macro?.traits?.[String(heroId)]
  if (!Array.isArray(raw) || raw.length !== 7) return null
  return {
    dps: raw[0], aoe: raw[1], waveclear: raw[2], siege: raw[3],
    flank: raw[4], lanePressure: raw[5], controlResist: raw[6],
  }
}

export function createTeamPlanner({
  heroes,
  heroMap,
  synergyEngine,
  synergy,
  macro,
  laneOf,
  strengthScore,
  styleScore,
}) {
  const nameOf = (id) => heroMap.get(Number(id))?.name || `英雄${id}`

  function metricsOf(picks) {
    const analysis = synergyEngine.analyzeTeam(picks, [])
    const macros = {
      dps: 0, aoe: 0, waveclear: 0, siege: 0,
      flank: 0, lanePressure: 0, controlResist: 0,
    }
    for (const id of picks) {
      const values = macroOf(macro, id)
      if (!values) continue
      for (const key of Object.keys(macros)) macros[key] += values[key]
    }
    return { analysis, structure: analysis.structure, macros }
  }

  /** 对手已暴露的长处，只有放进整队评分，才不会被某个高分英雄盖掉 */
  function matchupScore(structure, macros, oppPicks) {
    if (!oppPicks.length) return { points: 0, note: '' }
    const opp = synergyEngine.analyzeTeam(oppPicks, []).structure
    let points = 0
    let note = ''
    if (opp.engageCount >= 2) {
      points += clamp(macros.controlResist * 1.3, -4, 11)
      if (macros.controlResist <= 3) points -= 7
      note = '抗控与反手能接住对方先手'
    }
    if (opp.front >= 9) {
      points += clamp(macros.dps * 1.05, 0, 10)
      if (macros.dps < 5) points -= 5
      note = '持续输出足以处理对方厚前排'
    }
    if (opp.fragileCarry.length) {
      points += clamp(macros.flank * 1.1 + structure.burstCount * 2.2, 0, 11)
      note = '切入与爆发能威胁对方脆皮核心'
    }
    if (opp.protectors.length >= 2) {
      points += clamp(structure.pokeScore * 0.75, 0, 8)
      note = '远程消耗可以拆开对方保护链'
    }
    if ((opp.phaseCount?.late ?? 0) >= 2) {
      points += clamp(macros.lanePressure * 0.8, 0, 8)
      note = '前期线权可以压缩对方后期核心的发育空间'
    }
    return { points: clamp(points, -15, 28), note }
  }

  /**
   * 完整阵容评分。partial 用于束搜索的中途排序，此时只奖励已经形成的协同，
   * 不提前惩罚“还没补的前排/开团”，避免搜索被辅助英雄绑死。
   */
  function scoreLineup(picks, {
    style = DRAFT_STYLES[0],
    oppPicks = [],
    final = true,
    comboWeight = 1,
    counterWeight = 1,
  } = {}) {
    const ids = uniqueIds(picks)
    if (!ids.length || !synergyEngine) return { score: -999, notes: [], metrics: null }
    const { analysis, structure, macros } = metricsOf(ids)
    const list = ids.map((id) => ({ id, name: nameOf(id) }))
    const notes = []

    const strengthAvg = list.reduce((sum, item) => sum + strengthScore(item.id).score, 0) / list.length
    const styleTotal = list.reduce((sum, item) => sum + Math.min(32, styleScore(style, item.id, 'pick').points), 0)
    let score = strengthAvg * (style?.strength ?? 1) * 1.15 + styleTotal * 0.24

    const comboBonus = COMBO_KIND_BY_STYLE[style?.key] || {}
    const comboPoints = analysis.combos.slice(0, 5).reduce((sum, combo) => {
      return sum + (combo.tier === 'strong' ? 22 : 8) + (comboBonus[combo.kind] || 0)
    }, 0)
    score += Math.min(66, comboPoints) * comboWeight
    if (analysis.combos.some((combo) => combo.tier === 'strong')) {
      notes.push(`成型组合：${analysis.combos.find((combo) => combo.tier === 'strong').name}`)
    }

    const lanes = ids.map(laneOf).filter(Boolean)
    const laneSet = new Set(lanes)
    const duplicateLanes = lanes.length - laneSet.size
    if (final) {
      const covered = LANES.every((lane) => laneSet.has(lane))
      score += ids.length === 5 && covered ? 24 : -80 - duplicateLanes * 20
      if (covered) notes.push('五路完整')
    } else {
      score -= duplicateLanes * 48
      // 已选部分的结构只作轻量引导，真正的门槛在五人完整评分
      score += structure.front * 0.35 + structure.engageScore * 0.25 + structure.controlScore * 0.2
      return { score, notes, metrics: { structure, macros, lanes } }
    }

    const frontTarget = { engage: 9, protect: 9, siege: 7, pickoff: 6, counter: 8, meta: 8 }[style?.key] ?? 8
    score += 16 - Math.abs(structure.front - frontTarget) * 2.2
    if (structure.front < 5) notes.push('前排偏薄')
    else if (structure.front >= frontTarget) notes.push('正面承伤足够')

    const engageTarget = style?.key === 'engage' ? 2 : style?.key === 'pickoff' ? 0 : 1
    if (engageTarget === 2) {
      score += structure.engageCount >= 2 ? 18 : structure.engageCount === 1 ? 3 : -17
    } else if (engageTarget === 1) {
      score += structure.engageCount >= 1 ? 10 : -8
    } else {
      score += structure.engageCount >= 1 ? 4 : 2
    }
    if (structure.engageCount >= 2) notes.push('双重先手与控制链')

    // 开团必须有人接火；保护核心也必须真的有核心可保
    if (structure.engageCount > 0) {
      const followUp = structure.burstCount > 0 || macros.aoe >= 6
      score += followUp ? 12 : -11
      if (followUp) notes.push('开团后有人接火')
    }
    if (structure.fragileCarry.length) {
      if (structure.peelCount > 0) {
        score += style?.key === 'protect' ? 21 : 13
        notes.push('后排核心有保护')
      } else {
        score -= 22
        notes.push('后排核心缺保护')
      }
    }
    if (style?.key === 'protect') {
      const hasCore = ids.some((id) => {
        const raw = synergy?.traits?.[String(id)]
        return raw?.[8] === 'late' && (macroOf(macro, id)?.dps ?? 0) >= 2
      })
      score += hasCore ? 9 : -15
      score += Math.min(2, structure.peelCount) * 5
      if (!hasCore) notes.push('保核心体系缺少后期大核')
    }

    const damageEntries = Object.entries(structure.damageMix).filter(([, count]) => count > 0)
    const topDamage = damageEntries.sort((a, b) => b[1] - a[1])[0]
    if (topDamage?.[1] >= 4) {
      score -= 19
      notes.push('伤害类型单一')
    } else if (structure.damageMix.phys > 0 && structure.damageMix.magic > 0) {
      score += 13
      notes.push('物理与法术伤害兼备')
    }

    if (structure.controlScore < 5 && structure.engageCount > 0) score -= 9
    score += Math.min(10, structure.controlScore) * 0.9
    if (structure.phaseCount.late >= 3) {
      score -= 15
      notes.push('整体发育周期偏长')
    }
    if (structure.phaseCount.early >= 3 && structure.phaseCount.late === 0) score -= 8
    if (style?.key === 'protect' && structure.phaseCount.late >= 1 && structure.phaseCount.late <= 2) score += 7
    if (style?.key === 'siege' && structure.phaseCount.early + structure.phaseCount.mid >= 3) score += 7

    if (style?.key === 'siege') {
      score += Math.min(9, macros.waveclear) + Math.min(6, macros.siege) * 1.4 + Math.min(8, macros.lanePressure) * 0.5
      if (macros.waveclear >= 8 && macros.siege >= 4) notes.push('清线与推进形成闭环')
    } else if (style?.key === 'pickoff') {
      score += Math.min(8, macros.flank) * 1.4 + structure.burstCount * 3
      if (macros.flank >= 6 && structure.burstCount >= 2) notes.push('多点切入与收割')
    } else if (style?.key === 'engage') {
      score += Math.min(9, macros.aoe) * 0.9
    } else if (style?.key === 'protect') {
      score += Math.min(9, macros.dps) * 0.8
    }

    const matchup = matchupScore(structure, macros, oppPicks)
    score += matchup.points * counterWeight
    if (matchup.note && matchup.points >= 6) notes.push(matchup.note)

    return { score, notes: [...new Set(notes)], metrics: { structure, macros, lanes } }
  }

  /**
   * 束搜索：每一步每路只保留少量有潜力的候选，再保留 width 套最优部分阵容。
   * 五路重复的方案会被重罚，最终只交付五人、五路齐全的完整阵容。
   */
  function buildLineups(teamPicks, available, {
    style = DRAFT_STYLES[0],
    oppPicks = [],
    seed = 'default',
    width = 14,
    perLane = 8,
    keep = 16,
  } = {}) {
    if (!synergyEngine) return []
    const fixed = uniqueIds(teamPicks)
    if (fixed.length > 5) return []
    const fixedSet = new Set(fixed)
    const pool = uniqueIds(available).filter((id) => !fixedSet.has(id) && heroMap.has(id))
    if (fixed.length + pool.length < 5) return []
    const fixedLanes = fixed.map(laneOf).filter(Boolean)
    if (new Set(fixedLanes).size !== fixedLanes.length) return []

    const byLane = new Map()
    for (const lane of LANES) {
      const candidates = pool
        .filter((id) => laneOf(id) === lane)
        .map((id) => ({
          id,
          anchor: strengthScore(id).score * (style?.strength ?? 1)
            + styleScore(style, id, 'pick').points * 0.6
            + seededUnit(seed, 'anchor', style?.key, id) * 2,
        }))
        .sort((a, b) => b.anchor - a.anchor)
        .slice(0, perLane)
        .map((item) => item.id)
      byLane.set(lane, candidates)
    }

    let states = [{ picks: fixed, search: scoreLineup(fixed, { style, oppPicks, final: false }).score }]
    while (states.length && states[0].picks.length < 5) {
      const expanded = []
      const seen = new Set()
      for (const state of states) {
        const used = new Set(state.picks)
        const taken = new Set(state.picks.map(laneOf))
        for (const lane of LANES) {
          if (taken.has(lane)) continue
          for (const id of byLane.get(lane) || []) {
            if (used.has(id)) continue
            const picks = [...state.picks, id]
            const key = [...picks].sort((a, b) => a - b).join('+')
            if (seen.has(key)) continue
            seen.add(key)
            const evaluated = scoreLineup(picks, { style, oppPicks, final: false })
            expanded.push({
              picks,
              search: evaluated.score + seededUnit(seed, 'beam', state.picks.length, id) * 0.35,
            })
          }
        }
      }
      expanded.sort((a, b) => b.search - a.search)
      states = expanded.slice(0, width)
    }

    return states
      .map((state) => {
        const evaluated = scoreLineup(state.picks, { style, oppPicks, final: true })
        return {
          picks: state.picks,
          names: state.picks.map(nameOf),
          score: evaluated.score,
          notes: evaluated.notes,
          metrics: evaluated.metrics,
          styleKey: style?.key,
        }
      })
      .filter((plan) => plan.metrics && new Set(plan.metrics.lanes).size === 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, keep)
  }

  /** 从对手已选英雄推断其体系，而不是拿 AI 自己的思路替对手做梦 */
  function inferOpponentStyle(oppPicks, seed = 'default') {
    // 第一手还没任何对方信息时，保留几种合理预期；种子固定则推演可复现，
    // 换一场系列赛不会都按同一套“理想 meta 阵容”去禁同一个人。
    if (!oppPicks.length) {
      const plausible = DRAFT_STYLES.filter((style) => style.key !== 'counter')
      return plausible[Math.floor(seededUnit(seed, 'opponent-style') * plausible.length)]
    }
    let best = DRAFT_STYLES.find((style) => style.key === 'meta')
    let bestScore = -Infinity
    for (const style of DRAFT_STYLES) {
      if (style.key === 'counter') continue
      const value = oppPicks.reduce((sum, id) => sum + styleScore(style, id, 'pick').points, 0)
      if (value > bestScore) {
        best = style
        bestScore = value
      }
    }
    return best
  }

  /** 第一层生成完整阵容，第二层再把完整阵容价值映射回当前候选 */
  function planPicks({ baseScored, teamPicks, available, myPicks, oppPicks, style, seed }) {
    const plans = buildLineups(teamPicks, available, { style, oppPicks, seed })
    if (!plans.length) return baseScored
    const fixed = new Set(teamPicks.map(Number))
    const bestOverall = plans[0].score
    return baseScored.map((item) => {
      const matches = plans.filter((plan) => !fixed.has(item.id) && plan.picks.includes(item.id))
      const best = matches.slice().sort((a, b) => b.score - a.score)[0] || null
      const planScore = best ? best.score + Math.min(4, matches.length) * 1.1 : bestOverall - 26
      const reasons = best
        ? [...new Set([
            `整队方案：${best.names.join('、')}`,
            ...best.notes.slice(0, 2),
            ...item.reasons,
          ])]
        : item.reasons
      return {
        ...item,
        score: planScore,
        adjusted: planScore + item.adjusted * 0.2,
        reasons,
        plan: best ? { ...best, support: matches.length } : null,
      }
    })
  }

  /** Ban 收益 = 对手能拿候选时的最佳整队评分 - 候选被禁后的最佳整队评分 */
  function planBans({ baseScored, teamPicks, available, myPicks, oppPicks, style, seed, step = 0 }) {
    const opponentStyle = inferOpponentStyle(teamPicks, seed)
    const baseline = buildLineups(teamPicks, available, {
      style: opponentStyle, oppPicks: myPicks, seed, width: 12, perLane: 8, keep: 12,
    })
    if (!baseline.length) return baseScored

    // 个体榜只负责缩小计算范围，最终名次完全由整队损失重新排序
    const shortlist = new Set(
      [...baseScored].sort((a, b) => b.adjusted - a.adjusted).slice(0, 10).map((item) => item.id),
    )
    for (const plan of baseline) {
      for (const id of plan.picks) {
        if (!teamPicks.map(Number).includes(id)) shortlist.add(id)
      }
    }

    return baseScored.map((item) => {
      if (!shortlist.has(item.id)) {
        return { ...item, score: item.adjusted * 0.35, adjusted: item.adjusted * 0.35, banImpact: 0 }
      }
      const without = available.filter((id) => Number(id) !== item.id)
      const occupiedLanes = new Set(teamPicks.map(laneOf))
      const laneBlocked = occupiedLanes.has(laneOf(item.id))
      const withCandidate = laneBlocked ? null : buildLineups([...teamPicks, item.id], without, {
        style: opponentStyle, oppPicks: myPicks, seed,
        width: 8, perLane: 7, keep: 1,
      })[0]
      const afterBan = buildLineups(teamPicks, without, {
        style: opponentStyle, oppPicks: myPicks, seed,
        width: 8, perLane: 7, keep: 1,
      })[0]
      const rawImpact = withCandidate && afterBan ? Math.max(0, withCandidate.score - afterBan.score) : 0
      // 名次仍由「对手损失多少」决定，但损失接近的两只英雄不该每场都禁同一只。
      // 只在 ±8% 内浮动：分差明显的候选照样排前面，同档的按种子换人。
      const tilt = 1 + (seededUnit(seed, 'ban-impact', step, item.id) * 2 - 1) * 0.08
      const impact = rawImpact * tilt
      const adjusted = impact * 5 + item.adjusted * 0.35
      const reasons = withCandidate && rawImpact > 0.5
        ? [...new Set([
            `禁后对手最佳整队评分下降 ${rawImpact.toFixed(1)}`,
            `阻止对手补成：${withCandidate.names.join('、')}`,
            ...withCandidate.notes.slice(0, 1),
            ...item.reasons,
          ])]
        : item.reasons
      return {
        ...item,
        score: adjusted,
        adjusted,
        reasons,
        banImpact: rawImpact,
        opponentStyle: opponentStyle?.key,
        plan: withCandidate ? { before: withCandidate, after: afterBan } : null,
      }
    })
  }

  return { scoreLineup, buildLineups, inferOpponentStyle, planPicks, planBans }
}
