/**
 * AI 对局决策
 *
 * 思路：先由规则引擎按「阵容结构 + 组合协同 + 赛季数据 + 分路覆盖 + 本局思路」给所有可用英雄打分，
 * 取出前 N 名候选，再交给模型在候选里挑一个。这样模型只负责取舍与理由，
 * 不会选出零前排、五射手的离谱阵容，也不会因为模型抽风导致对局卡死。
 *
 * Ban 与 Pick 共用同一个「这个英雄对我的阵容值多少分」的评估函数：
 * Ban 就把候选放进对方的阵容里算价值，价值越高越该禁。
 *
 * 为了让 AI 不是每局都交同一份答卷，这里有三层差异：
 *   1. 每局抽一个「思路」（shared/styles.mjs），不同思路下什么算好英雄不一样；
 *   2. 按对手/自己的阵容实时调整（对方双开团就抬抗控、我方脆皮就禁切入）；
 *   3. 分数接近的候选按种子打散，同分不再永远按英雄表顺序取第一个。
 */

import { DRAFT_STYLES, seededUnit } from '../shared/styles.mjs'

const LANE_BY_ID = { 1: '对抗路', 2: '打野', 3: '中路', 4: '发育路', 5: '游走' }
const ALL_LANES = ['对抗路', '中路', '发育路', '打野', '游走']
const DAMAGE_LABEL = { phys: '物理', magic: '法术', true: '真实', mixed: '混合' }

const TRAIT_LABEL = {
  front: '前排承伤', engage: '开团', peel: '保护', poke: '消耗',
  burst: '爆发', sustain: '续航', mobility: '机动', control: '控制',
}
const MACRO_LABEL = {
  dps: '持续输出', aoe: '范围伤害', waveclear: '清线', siege: '推进',
  flank: '绕后', lanePressure: '线权', controlResist: '抗控',
}

/** hero-synergy.json 的 traits 是定长数组，这里还原成具名字段 */
function traitsOf(synergy, heroId) {
  const raw = synergy?.traits?.[String(heroId)]
  if (!Array.isArray(raw) || raw.length !== 10) return null
  return {
    front: raw[0], engage: raw[1], peel: raw[2], poke: raw[3], burst: raw[4],
    sustain: raw[5], mobility: raw[6], control: raw[7], phase: raw[8], damage: raw[9],
  }
}

/** hero-macro.json 的 traits 是 7 维定长数组 */
function macroOf(macro, heroId) {
  const raw = macro?.traits?.[String(heroId)]
  if (!Array.isArray(raw) || raw.length !== 7) return null
  return {
    dps: raw[0], aoe: raw[1], waveclear: raw[2], siege: raw[3],
    flank: raw[4], lanePressure: raw[5], controlResist: raw[6],
  }
}

export function createDraftAdvisor({ heroes, heroMap, kplStats, synergyEngine, synergy, macro }) {
  const laneCache = new Map()

  function statOf(heroId) {
    return kplStats?.heroes?.[String(heroId)] || null
  }

  // 赛季数据的分路比 heroes.json 更贴近职业实际用法，优先使用
  function laneOf(heroId) {
    const key = Number(heroId)
    if (laneCache.has(key)) return laneCache.get(key)
    const stat = statOf(key)
    const hero = heroMap.get(key)
    const lane = stat?.lane || (hero?.laneIds?.length ? LANE_BY_ID[hero.laneIds[0]] : '') || ''
    laneCache.set(key, lane)
    return lane
  }

  function strengthScore(heroId) {
    const stat = statOf(heroId)
    if (!stat || !stat.games) return { score: 12, note: '本赛季未登场' }
    // 出场过少时向中性值收缩，避免「2 场 100%」这种样本被当成版本答案
    const confidence = Math.min(1, stat.games / 20)
    const raw = Math.max(0, Math.min(30, (stat.winRate - 44) * 1.8))
    return {
      score: raw * (0.5 + 0.5 * confidence) + 4,
      note: `${stat.games} 场 ${stat.winRate}%`,
    }
  }

  function dominantDamage(mix) {
    const entries = Object.entries(mix).filter(([, count]) => count > 0)
    if (!entries.length) return null
    const top = entries.sort((a, b) => b[1] - a[1])[0]
    return top[1] >= 4 ? top[0] : null
  }

  /**
   * 本局思路带来的加减分：同一个英雄在不同思路里的价值不同，
   * 这才是「每局 AI 打得不一样」的源头，而不是随机乱选。
   */
  function styleScore(style, heroId, mode) {
    if (!style) return { points: 0, reason: '' }
    const traits = traitsOf(synergy, heroId)
    const macroTraits = macroOf(macro, heroId)
    const traitWeights = (mode === 'ban' ? style.banTraits : style.traits) || {}
    const macroWeights = (mode === 'ban' ? style.banMacro : style.macro) || {}
    let points = 0
    let top = null

    for (const [dim, weight] of Object.entries(traitWeights)) {
      const value = traits?.[dim] ?? 0
      if (!value) continue
      const gain = value * weight
      points += gain
      if (!top || gain > top.gain) top = { gain, label: TRAIT_LABEL[dim] || dim, kind: 'trait' }
    }
    for (const [dim, weight] of Object.entries(macroWeights)) {
      const value = macroTraits?.[dim] ?? 0
      if (!value) continue
      const gain = value * weight
      points += gain
      if (!top || gain > top.gain) top = { gain, label: MACRO_LABEL[dim] || dim, kind: 'macro' }
    }
    if (mode !== 'ban' && style.phaseBias && traits?.phase) {
      points += style.phaseBias[traits.phase] || 0
    }
    if (!top || top.gain < 9) return { points, reason: '' }
    return {
      points,
      reason: mode === 'ban'
        ? `拆掉对手的${top.label}（契合「${style.label}」思路）`
        : `${top.label}契合本局「${style.label}」思路`,
    }
  }

  /** 选人时看对手：对方阵容的长处，决定我们该补什么 */
  function buildCounterPlan(oppPicks, style) {
    if (!synergyEngine || !oppPicks?.length) return []
    const structure = synergyEngine.analyzeTeam(oppPicks, []).structure
    const plan = []
    if (structure.engageCount >= 2) {
      plan.push({
        score: (traits, macroTraits) => (macroTraits?.controlResist ?? 0) * 3,
        note: `对方有 ${structure.engageCount} 个硬开团，抗控英雄能吃住先手反打`,
      })
    }
    if (structure.front >= 9) {
      plan.push({
        score: (traits, macroTraits) => (macroTraits?.dps ?? 0) * 2.5,
        note: '对方前排很厚，需要持续输出而不是只靠爆发',
      })
    }
    if (structure.fragileCarry.length >= 2) {
      plan.push({
        score: (traits, macroTraits) => ((macroTraits?.flank ?? 0) + (traits?.burst ?? 0)) * 1.8,
        note: `对方${structure.fragileCarry.join('、')}是脆皮核心，切入收益高`,
      })
    }
    if (structure.protectors.length >= 2) {
      plan.push({
        score: (traits) => (traits?.poke ?? 0) * 2.6,
        note: '对方有完整保护链，靠消耗拆开阵型比硬开更有效',
      })
    }
    if ((structure.phaseCount?.late ?? 0) >= 2) {
      plan.push({
        score: (traits, macroTraits) => (macroTraits?.lanePressure ?? 0) * 2.2,
        note: '对方偏后期，前期线权更值钱',
      })
    }
    return plan
  }

  /** 禁人时看自己：我方阵容的软肋，决定该禁掉什么 */
  function buildThreatPlan(myPicks) {
    if (!synergyEngine || !myPicks?.length) return []
    const structure = synergyEngine.analyzeTeam(myPicks, []).structure
    const plan = []
    if (structure.fragileCarry.length) {
      plan.push({
        score: (traits, macroTraits) => ((macroTraits?.flank ?? 0) * 2.4 + (traits?.burst ?? 0) * 1.4),
        note: `我方${structure.fragileCarry.join('、')}是脆皮核心，先禁掉切入与爆发`,
      })
    }
    if (structure.engageCount === 0 && structure.front <= 7) {
      plan.push({
        score: (traits) => ((traits?.engage ?? 0) * 2.2 + (traits?.control ?? 0) * 1.2),
        note: '我方既缺开团又怕被打先手，禁掉强开英雄',
      })
    }
    if ((structure.phaseCount?.late ?? 0) >= 2) {
      plan.push({
        score: (traits, macroTraits) => (macroTraits?.lanePressure ?? 0) * 1.8,
        note: '我方偏后期，怕被前期压线滚雪球',
      })
    }
    if (structure.sustainScore <= 3) {
      plan.push({
        score: (traits) => (traits?.poke ?? 0) * 2,
        note: '我方续航薄，怕被远程消耗',
      })
    }
    return plan
  }

  /**
   * 评估某个英雄加进 teamPicks 之后，对这套阵容的价值
   * 返回的 reasons 会原样喂给模型，作为它做决定的依据
   */
  function evaluate(heroId, teamPicks, mode = 'pick', context = {}) {
    const id = Number(heroId)
    const hero = heroMap.get(id)
    const style = context.style || null
    const plan = context.plan || []
    const reasons = []
    let score = 0

    const strength = strengthScore(id)
    score += strength.score * (mode === 'ban' ? style?.banStrength ?? 1 : style?.strength ?? 1)
    if (strength.score >= 20) reasons.push(`版本强度高（${strength.note}）`)

    if (!synergyEngine) return { id, name: hero?.name || String(id), score, reasons, lane: laneOf(id) }

    // 同一分路只有一个出场名额：第二个射手/第二个辅助根本站不上场，
    // 组合协同分必须按「能不能真的出场」折算，否则会算出禁对方第二个射手的荒谬结论
    const lane = laneOf(id)
    const occupant = teamPicks
      .map(Number)
      .find((other) => Number(other) !== id && laneOf(other) === lane)
    const laneBlocked = Boolean(occupant)
    let comboFactor = 1
    if (laneBlocked) {
      // 禁人场景下，若对方该路现有英雄不比候选弱，候选即便被禁也无损失，收益归零
      const upgrade = strength.score - strengthScore(occupant).score
      comboFactor = mode === 'ban' && upgrade <= 0 ? 0 : 0.25
      if (mode === 'ban') {
        reasons.push(`对方${lane}已有${heroMap.get(occupant)?.name || ''}，禁他收益很低`)
      }
    }

    // 本局思路：同一批英雄，换个思路价值就不同。
    // 但站不上的位置不该拿满思路分，否则「保核心」会把两个游走一起选进来
    const styled = styleScore(style, id, mode)
    score += styled.points * comboFactor
    if (styled.reason && comboFactor > 0) reasons.push(styled.reason)

    const before = synergyEngine.analyzeTeam(teamPicks, [])
    const after = synergyEngine.analyzeTeam([...teamPicks, id], [])

    // 组合协同：这是权重最高的一项，成型搭配直接决定阵容能不能成立
    const beforeKeys = new Set(before.combos.map((combo) => `${combo.name}|${combo.heroes.join('+')}`))
    for (const combo of after.combos) {
      if (beforeKeys.has(`${combo.name}|${combo.heroes.join('+')}`)) continue
      // 禁人时这条组合是「对方会成型」，理由必须换一种说法，否则读起来像在帮对手选人
      const partner = combo.heroes.filter((name) => name !== hero?.name).join('、')
      const verb = mode === 'ban' ? '对方会与' : '与'
      if (combo.tier === 'strong') {
        score += 45 * comboFactor * (style?.comboStrong ?? 1)
        if (comboFactor > 0) reasons.push(`${verb}${partner}组成强协同「${combo.name}」`)
      } else {
        score += 16 * comboFactor * (style?.comboConditional ?? 1)
        if (comboFactor > 0) reasons.push(`${verb}${partner}形成条件协同「${combo.name}」`)
      }
    }

    // 结构补强只在阵容已有骨架时才有意义；空阵容谈「缺前排」是伪需求，
    // 否则第一手会永远挑坦克辅助。
    // 禁人时也不适用：那是在评估「对方缺什么」，会把随机一个游走捧成必禁，
    // 于是一到第二阶段就固定禁游走，跟前面的固定答卷是同一类毛病。
    const hasSkeleton = mode !== 'ban' && teamPicks.length > 0

    // 结构补强：缺什么补什么
    if (hasSkeleton && before.structure.front < 8 && after.structure.front > before.structure.front) {
      score += Math.min(after.structure.front - before.structure.front, 4) * 2.5
      reasons.push('补充前排承伤')
    }
    if (hasSkeleton && before.structure.engageCount === 0 && after.structure.engageCount > 0) {
      score += 13
      reasons.push('补上主动开团手段')
    }
    if (
      hasSkeleton
      && before.structure.fragileCarry.length
      && before.structure.protectors.length === 0
      && after.structure.protectors.length > 0
    ) {
      score += 15
      reasons.push(`为${before.structure.fragileCarry.join('、')}提供保护`)
    }
    const beforeDamage = dominantDamage(before.structure.damageMix)
    const afterDamage = dominantDamage(after.structure.damageMix)
    if (hasSkeleton && beforeDamage && !afterDamage) {
      score += 9
      reasons.push('改善伤害类型单一的问题')
    }
    if (hasSkeleton && before.structure.controlScore < 6 && after.structure.controlScore >= before.structure.controlScore + 2) {
      score += 5
      reasons.push('补充控制链')
    }

    // 分路覆盖：前两手之后才开始要求补位，否则没有区分度
    if (mode !== 'ban' && teamPicks.length >= 2 && lane) {
      const taken = teamPicks.map(laneOf).filter(Boolean)
      const gaps = ALL_LANES.filter((item) => !taken.includes(item))
      if (gaps.includes(lane)) {
        score += 22
        reasons.push(`补${lane}位`)
      } else if (taken.includes(lane)) {
        score -= 12
      }
    }

    // 实时针对：对方的长处、我方的软肋，都会让某些英雄突然变值钱
    if (plan.length) {
      const traits = traitsOf(synergy, id)
      const macroTraits = macroOf(macro, id)
      const adapt = style?.adapt ?? 1
      let gain = 0
      const notes = []
      for (const entry of plan) {
        const points = entry.score(traits, macroTraits) || 0
        if (points <= 0.5) continue
        gain += points
        notes.push(entry.note)
      }
      // 单点针对的分不能盖过阵容结构本身
      const capped = Math.min(gain, 24) * adapt
      if (capped > 0) {
        score += capped
        if (notes.length) reasons.push(notes[0])
      }
    }

    return { id, name: hero?.name || String(id), score, reasons, lane }
  }

  /**
   * @param {object} options
   * @param {number[]} options.teamPicks 评估基准阵容（Pick 时是自己，Ban 时是对方）
   * @param {number[]} options.available 当前可选/可禁的英雄
   * @param {number[]} options.myPicks 我方阵容，用于避免 ban 掉自己要的英雄，以及判断我方软肋
   * @param {number[]} options.oppPicks 对方阵容，用于实时针对
   * @param {number[]} options.avoid 前几局用过的英雄，非全局 BP 时降低重复率
   * @param {number} options.limit 候选数量
   * @param {object} options.style 本局思路
   * @param {string} options.seed 系列赛种子，决定同分候选的打散顺序
   * @param {number} options.step 当前手数，让同一局内每手的抖动不同
   */
  function rank({
    teamPicks = [],
    available = [],
    myPicks = [],
    oppPicks = [],
    avoid = [],
    limit = 8,
    mode = 'pick',
    style = DRAFT_STYLES[0],
    seed = 'default',
    step = 0,
  }) {
    const plan = mode === 'ban' ? buildThreatPlan(myPicks) : buildCounterPlan(oppPicks, style)
    const avoidSet = new Set((avoid || []).map(Number))
    const scored = available.map((heroId) => {
      const result = evaluate(heroId, teamPicks, mode, { style, plan })
      // 只ban 场景才需要「别禁掉我方急需的人」这层修正
      let adjusted = mode === 'ban' && myPicks.length
        ? result.score - evaluate(heroId, myPicks, 'pick', { style }).score * 0.55
        : result.score
      if (avoidSet.has(Number(heroId))) adjusted -= mode === 'ban' ? 4 : 14
      // 分数接近时按种子打散：同样的种子必得同样的结果，换一局种子就换一种排法
      const jitter = (seededUnit(seed, mode, step, heroId) * 2 - 1) * (mode === 'pick' ? 7 : 5)
      return { ...result, base: Math.round(adjusted), adjusted: adjusted + jitter }
    })
    scored.sort((a, b) => b.adjusted - a.adjusted)
    return scored.slice(0, limit)
  }

  /** 规则引擎兜底落子：就是抖动后的第一名，保证每次都不一样但都在合理区间 */
  function choose(candidates) {
    return candidates[0] || null
  }

  return { rank, evaluate, laneOf, choose, buildCounterPlan, buildThreatPlan }
}

/** 把候选与局面拼成模型能直接读的提示 */
export function buildDecisionContext({
  type, side, sideName, gameNumber, picks, oppPicks, candidates, banCount, style, memory,
}) {
  const label = (item) => {
    const bits = []
    if (item.lane) bits.push(item.lane)
    if (item.reasons.length) bits.push(item.reasons.join('；'))
    // heroId 必须显式写出来，否则模型会自己编一个不存在的编号
    return `heroId ${item.id} = ${item.name}（${bits.join('，') || '常规选择'}）`
  }
  const lines = [
    `当前是 BO 系列赛第 ${gameNumber} 局，${side === 'blue' ? '蓝方' : '红方'}（${sideName}）需要完成第 ${banCount} 手${type === 'ban' ? '禁用' : '选择'}。`,
  ]
  if (style) lines.push(`本局你的执教思路是「${style.label}」：${style.summary}。`)
  if (memory?.length) lines.push(`本系列赛你此前用过的英雄：${memory.join('、')}（除非特别合适，不要整套照抄）。`)
  lines.push(
    `我方已选：${picks.length ? picks.join('、') : '（尚未选人）'}`,
    `对方已选：${oppPicks.length ? oppPicks.join('、') : '（尚未选人）'}`,
    '',
    '规则引擎已按阵容结构、组合协同、分路覆盖、赛季数据与本局思路筛出以下候选（只能从中选一个，顺序不代表推荐度）：',
    ...candidates.map((item, index) => `${index + 1}. ${label(item)}`),
  )
  return lines.join('\n')
}
