/**
 * AI 对局决策
 *
 * 思路：先由规则引擎按「阵容结构 + 组合协同 + 赛季数据 + 分路覆盖」给所有可用英雄打分，
 * 取出前 N 名候选，再交给模型在候选里挑一个。这样模型只负责取舍与理由，
 * 不会选出零前排、五射手的离谱阵容，也不会因为模型抽风导致对局卡死。
 *
 * Ban 与 Pick 共用同一个「这个英雄对我的阵容值多少分」的评估函数：
 * Ban 就把候选放进对方的阵容里算价值，价值越高越该禁。
 */

const LANE_BY_ID = { 1: '对抗路', 2: '打野', 3: '中路', 4: '发育路', 5: '游走' }
const ALL_LANES = ['对抗路', '中路', '发育路', '打野', '游走']
const DAMAGE_LABEL = { phys: '物理', magic: '法术', true: '真实', mixed: '混合' }

export function createDraftAdvisor({ heroes, heroMap, kplStats, synergyEngine }) {
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
   * 评估某个英雄加进 teamPicks 之后，对这套阵容的价值
   * 返回的 reasons 会原样喂给模型，作为它做决定的依据
   */
  function evaluate(heroId, teamPicks, mode = 'pick') {
    const id = Number(heroId)
    const hero = heroMap.get(id)
    const reasons = []
    let score = 0

    const strength = strengthScore(id)
    score += strength.score
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

    const before = synergyEngine.analyzeTeam(teamPicks, [])
    const after = synergyEngine.analyzeTeam([...teamPicks, id], [])

    // 组合协同：这是权重最高的一项，成型搭配直接决定阵容能不能成立
    const beforeKeys = new Set(before.combos.map((combo) => `${combo.name}|${combo.heroes.join('+')}`))
    for (const combo of after.combos) {
      if (beforeKeys.has(`${combo.name}|${combo.heroes.join('+')}`)) continue
      if (combo.tier === 'strong') {
        score += 45 * comboFactor
        if (comboFactor > 0) reasons.push(`与${combo.heroes.filter((name) => name !== hero?.name).join('、')}组成强协同「${combo.name}」`)
      } else {
        score += 16 * comboFactor
        if (comboFactor > 0) reasons.push(`与${combo.heroes.filter((name) => name !== hero?.name).join('、')}形成条件协同「${combo.name}」`)
      }
    }

    // 结构补强只在阵容已有骨架时才有意义；空阵容谈「缺前排」是伪需求，
    // 否则第一手会永远挑坦克辅助
    const hasSkeleton = teamPicks.length > 0

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
    if (teamPicks.length >= 2 && lane) {
      const taken = teamPicks.map(laneOf).filter(Boolean)
      const gaps = ALL_LANES.filter((item) => !taken.includes(item))
      if (gaps.includes(lane)) {
        score += 22
        reasons.push(`补${lane}位`)
      } else if (taken.includes(lane)) {
        score -= 12
      }
    }

    return { id, name: hero?.name || String(id), score, reasons, lane }
  }

  /**
   * @param {object} options
   * @param {number[]} options.teamPicks 评估基准阵容（Pick 时是自己，Ban 时是对方）
   * @param {number[]} options.available 当前可选/可禁的英雄
   * @param {number[]} options.myPicks 我方阵容，用于避免 ban 掉自己要的英雄
   * @param {number} options.limit 候选数量
   */
  function rank({ teamPicks = [], available = [], myPicks = [], limit = 8, mode = 'pick' }) {
    const scored = available.map((heroId) => {
      const result = evaluate(heroId, teamPicks, mode)
      // 只ban 场景才需要「别禁掉我方急需的人」这层修正
      const adjusted = mode === 'ban' && myPicks.length
        ? result.score - evaluate(heroId, myPicks, 'pick').score * 0.55
        : result.score
      return { ...result, adjusted }
    })
    scored.sort((a, b) => b.adjusted - a.adjusted)
    return scored.slice(0, limit)
  }

  return { rank, evaluate, laneOf }
}

/** 把候选与局面拼成模型能直接读的提示 */
export function buildDecisionContext({ type, side, sideName, gameNumber, picks, oppPicks, candidates, banCount }) {
  const label = (item) => {
    const bits = []
    if (item.lane) bits.push(item.lane)
    if (item.reasons.length) bits.push(item.reasons.join('；'))
    // heroId 必须显式写出来，否则模型会自己编一个不存在的编号
    return `heroId ${item.id} = ${item.name}（${bits.join('，') || '常规选择'}）`
  }
  return [
    `当前是 BO 系列赛第 ${gameNumber} 局，${side === 'blue' ? '蓝方' : '红方'}（${sideName}）需要完成第 ${banCount} 手${type === 'ban' ? '禁用' : '选择'}。`,
    `我方已选：${picks.length ? picks.join('、') : '（尚未选人）'}`,
    `对方已选：${oppPicks.length ? oppPicks.join('、') : '（尚未选人）'}`,
    '',
    '规则引擎已按阵容结构、组合协同、分路覆盖与赛季数据筛出以下候选（只能从中选一个）：',
    ...candidates.map((item, index) => `${index + 1}. ${label(item)}`),
  ].join('\n')
}
