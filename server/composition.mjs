// 体系闭环度：一套阵容能不能「自洽地打完一场团战」，以及它到底有几条能赢的路。
//
// 五轴算的是「这些英雄各自多强」，逐路对位算的是「谁能压谁」，
// 但真正决定团战胜负的是五个齿轮能不能咬上：
// 有人扛、有人开、有人保、伤害打得进去、强势期撞在一起。
// 缺任何一个，另外几个都会打折——前排不够，开团的人开完自己死；
// 没有保人，输出核心一露头就被切；伤害全物理，对面一件反甲就白打。
//
// 所以这里不打分求和，而是逐环节判「能不能成立」，缺口比分数更能说明问题。
//
// 胜利路径是另一件事：闭环度问「这五个人能不能配合」，路径问「配合起来靠什么结束游戏」。
// 一套团队战打得再好，如果对面能靠分推把你拖死，那也只是「能打」，不是「能赢」。

/** 承伤点：前排承伤合计（structure.front）到这个数才算站得住 */
const FRONT_MIN = 6
/** 压制类核心：硬开团至少 1 人，否则只能被动接团 */
const ENGAGE_MIN = 1
/** 保护链：至少 1 个保人型，否则核心没有第二次输出机会 */
const PEEL_MIN = 1
/** 伤害类型集中度：单一类型超过这个人数，对面防装就能针对性针对 */
const DAMAGE_MAX_SAME_TYPE = 3
/** 强势期：至少有 3 人处于同一强势期，节奏才撞得上 */
const PHASE_MIN = 3

// 路径阈值按 133 英雄随机抽 5 人（2 万组）的分布定在 p75 附近：
// 清线 p50=9、推进 p50=6/p75=7、绕后 2 人以上 p50=2、机动均值 p50=1.8。
// 取「高于中位数」当门槛，避免随便一套阵容都能宣称自己有推进路径。
/** 推进路径：清线合计门槛（满五人均 3 时为 15） */
const SIEGE_WAVECLEAR_MIN = 10
/** 推进路径：推进（拆塔）合计门槛 */
const SIEGE_PUSH_MIN = 7
/** 单抓路径：绕后/单带评分 ≥2 的人数门槛 */
const SPLIT_COUNT_MIN = 2
/** 单抓路径：全队机动均值门槛，低于这个数追不上也跑不掉 */
const SPLIT_MOBILITY_MIN = 1.8

// 封死规则：对方在这个差额以上，本方的路就走不通了
/** 对方团战成立的环节比本方多这么多，正面这条路走不通 */
const FRONT_BLOCK_MARGIN = 2
/** 对方清线比本方推进高这么多，兵线推不进去 */
const WAVECLEAR_BLOCK_MARGIN = 2
/** 对方抗控到这个数，切入会被反打 */
const CONTROL_RESIST_BLOCK_MIN = 8
/** 对方抗控到这个数，单抓开始吃亏 */
const CONTROL_RESIST_CONTEST_MIN = 6
/** 单抓路径：对方保人型到这个人数才封死，单人保护只判受制（2 万组随机 5v5：封死率 42.6%→26.3%） */
const SPLIT_PEEL_BLOCK_COUNT = 2

const TIERS = [
  { gap: 0, key: 'S', label: '完整体系' },
  { gap: 1, key: 'A', label: '基本成型' },
  { gap: 2, key: 'B', label: '存在缺口' },
  { gap: Infinity, key: 'C', label: '各自为战' },
]

const tierOf = (total, passed) => TIERS.find((tier) => total - passed <= tier.gap)

export const PATH_LABEL = {
  teamfight: '正面团战',
  siege: '推进拆塔',
  pick: '单抓分带',
}

const STATUS_LABEL = {
  open: '可执行',
  contested: '受制',
  blocked: '被封死',
}

function damageCheck(structure) {
  const mix = structure.damageMix || {}
  const entries = Object.entries(mix).filter(([, count]) => count > 0)
  const top = entries.sort((a, b) => b[1] - a[1])[0]
  const types = entries.length
  const label = entries.map(([type, count]) => `${{ phys: '物理', magic: '法术', true: '真实', mixed: '混合' }[type]}${count}`).join('/')
  const ok = types >= 2 && (top?.[1] ?? 0) <= DAMAGE_MAX_SAME_TYPE
  return {
    ok,
    detail: `伤害分布 ${label || '—'}${ok ? '' : '（类型单一，对手防装可针对性堆叠）'}`,
  }
}

function phaseCheck(structure) {
  const phase = structure.phaseCount || {}
  const phases = [['前期', phase.early || 0], ['中期', phase.mid || 0], ['后期', phase.late || 0]]
  const [which, top] = phases.reduce((best, item) => (item[1] > best[1] ? item : best), ['中期', 0])
  return {
    ok: top >= PHASE_MIN,
    detail: `强势期分布 前${phase.early || 0}/中${phase.mid || 0}/后${phase.late || 0}${top >= PHASE_MIN ? `（${which} ${top} 人，节奏能对齐）` : '（强势期分散，节奏撞不到一起）'}`,
  }
}

function damageTypes(structure) {
  return Object.values(structure.damageMix || {}).filter((count) => count > 0).length
}

/**
 * 团战路径的四个子条件，与闭环度里的承伤/开团/保护/伤害四项完全同源。
 * 路径判定必须复用同一套尺子，否则「闭环度说红方缺两项、路径却说他团战没问题」会自相矛盾。
 */
function teamfightParts(structure) {
  return {
    front: structure.front >= FRONT_MIN,
    engage: structure.engageCount >= ENGAGE_MIN,
    peel: structure.peelCount >= PEEL_MIN,
    damage: damageCheck(structure).ok,
  }
}

const countPass = (parts) => Object.values(parts).filter(Boolean).length

/**
 * 判一侧的胜利路径。
 *
 * 三条路互斥地覆盖了 KPL 的终局方式：靠团战碾过去、靠兵线拆过去、靠抓人滚过去。
 * 每条路先看自己够不够格（自身结构），再看对方有没有对应的解（对方结构）——
 * 只有「自己能打」且「对方解不掉」才算 open，对方能解但解不干净算 contested。
 *
 * @param {object} structure 本方 structure
 * @param {object|null} opponent 对方 structure，缺失时只做自身判断
 */
export function judgeWinPaths(structure, opponent = null) {
  if (!structure) return null
  const opp = opponent || null
  const paths = []

  // 1. 正面团战：核心三件（扛得住/开得起来/打得进去）必须全过，保护算第四项
  {
    const parts = teamfightParts(structure)
    const passes = countPass(parts)
    const core = parts.front && parts.engage && parts.damage
    let status = 'open'
    let detail = `前排 ${structure.front}/15、硬开团 ${structure.engageCount} 人、伤害 ${damageTypes(structure)} 类，团战四环节中 ${passes} 项成立`
    if (!core) {
      status = 'blocked'
      const lacks = []
      if (!parts.front) lacks.push(`前排仅 ${structure.front}/15`)
      if (!parts.engage) lacks.push('无硬开团')
      if (!parts.damage) lacks.push('伤害类型单一')
      detail = `自身条件不足：${lacks.join('、')}`
    } else if (opp) {
      const oppParts = teamfightParts(opp)
      const oppPasses = countPass(oppParts)
      if (oppPasses - passes >= FRONT_BLOCK_MARGIN) {
        status = 'blocked'
        detail = `对方团战 ${oppPasses} 项成立、本方 ${passes} 项，正面对抗差 ${oppPasses - passes} 个环节`
      } else if (oppPasses >= passes) {
        status = 'contested'
        detail = `对方团战 ${oppPasses} 项与本方持平，比的是谁先手、谁少失误`
      }
    }
    paths.push({ key: 'teamfight', label: PATH_LABEL.teamfight, status, statusLabel: STATUS_LABEL[status], detail })
  }

  // 2. 推进拆塔：macro 缺失时不判，避免拿 0 当真实值
  {
    const waveclear = structure.waveclear
    const siege = structure.siege
    if (waveclear === null || siege === null) {
      paths.push({
        key: 'siege',
        label: PATH_LABEL.siege,
        status: 'unknown',
        statusLabel: '缺数据',
        detail: '缺少英雄机制数据，无法判断推进能力',
      })
    } else {
      const own = waveclear >= SIEGE_WAVECLEAR_MIN && siege >= SIEGE_PUSH_MIN
      let status = 'open'
      let detail = `清线 ${waveclear}、推进 ${siege}，兵线能推得动`
      if (!own) {
        status = 'blocked'
        const lacks = []
        if (waveclear < SIEGE_WAVECLEAR_MIN) lacks.push(`清线 ${waveclear} 低于 ${SIEGE_WAVECLEAR_MIN}`)
        if (siege < SIEGE_PUSH_MIN) lacks.push(`推进 ${siege} 低于 ${SIEGE_PUSH_MIN}`)
        detail = `自身条件不足：${lacks.join('、')}`
      } else if (opp && (opp.waveclear || 0) - siege >= WAVECLEAR_BLOCK_MARGIN) {
        status = 'blocked'
        detail = `对方清线 ${opp.waveclear} 高出本方推进 ${siege} 达 ${opp.waveclear - siege}，兵线清完就推不进去`
      } else if (opp && (opp.waveclear || 0) >= siege - WAVECLEAR_BLOCK_MARGIN) {
        status = 'contested'
        detail = `对方清线 ${opp.waveclear} 跟得上本方推进 ${siege}，拆塔要靠抓失误拿人数差`
      }
      paths.push({ key: 'siege', label: PATH_LABEL.siege, status, statusLabel: STATUS_LABEL[status], detail })
    }
  }

  // 3. 单抓分带：靠绕后点抓人，或者一个人带线牵制
  {
    const splitters = structure.splitCount || 0
    const mobility = structure.mobilityAvg || 0
    if (!splitters) {
      paths.push({
        key: 'pick',
        label: PATH_LABEL.pick,
        status: 'blocked',
        statusLabel: STATUS_LABEL.blocked,
        detail: '没有绕后/单带评分 ≥2 的英雄，抓不到人',
      })
    } else {
      const own = splitters >= SPLIT_COUNT_MIN && mobility >= SPLIT_MOBILITY_MIN
      let status = 'open'
      let detail = `${structure.splitters.join('、')} 共 ${splitters} 人可绕后，机动均值 ${mobility}`
      if (!own) {
        status = 'blocked'
        const lacks = []
        if (splitters < SPLIT_COUNT_MIN) lacks.push(`仅 ${splitters} 人可绕后（需 ${SPLIT_COUNT_MIN} 人）`)
        if (mobility < SPLIT_MOBILITY_MIN) lacks.push(`机动均值 ${mobility} 低于 ${SPLIT_MOBILITY_MIN}`)
        detail = `自身条件不足：${lacks.join('、')}`
      } else if (opp && ((opp.strongPeelCount || 0) >= 1 || opp.peelCount >= SPLIT_PEEL_BLOCK_COUNT)) {
        status = 'blocked'
        detail = `对方有 ${opp.protectors.join('、')} 保护，抓不死核心反被接住`
      } else if (opp && (opp.controlResist || 0) >= CONTROL_RESIST_BLOCK_MIN) {
        status = 'blocked'
        detail = `对方抗控合计 ${opp.controlResist}，切入会被控住反打`
      } else if (opp && opp.peelCount >= PEEL_MIN) {
        status = 'contested'
        detail = `对方只有 ${opp.protectors.join('、')} 单人保护，抓单要避开被保的核心`
      } else if (opp && (opp.controlResist || 0) >= CONTROL_RESIST_CONTEST_MIN) {
        status = 'contested'
        detail = `对方抗控 ${opp.controlResist} 偏高，抓单要挑软柿子`
      }
      paths.push({ key: 'pick', label: PATH_LABEL.pick, status, statusLabel: STATUS_LABEL[status], detail })
    }
  }

  const count = (status) => paths.filter((path) => path.status === status).length
  const open = count('open')
  const contested = count('contested')
  const blocked = count('blocked')
  return {
    paths,
    open,
    contested,
    blocked,
    usable: open + contested,
    // 路径分只做两侧比较：可执行 2 分、受制 1 分、被封死 0 分
    score: open * 2 + contested,
  }
}

/**
 * 判一侧的闭环度。
 * @param {object} team synergyEngine.analyzeTeam 的返回值（含 structure 与 combos）
 * @param {object|null} opponent 对方同结构返回值，用于判断路径是否被封死
 */
export function judgeComposition(team, opponent = null) {
  const structure = team?.structure
  if (!structure) return null

  const strong = (team.combos || []).filter((combo) => combo.tier === 'strong')
  const paths = judgeWinPaths(structure, opponent?.structure || null)
  // 团战四项与路径判定同源，改一处两边一起变，不会出现两套尺子
  const parts = teamfightParts(structure)

  const checks = [
    {
      key: 'front',
      label: '承伤点',
      ok: parts.front,
      detail: `前排承伤 ${structure.front}/15`,
    },
    {
      key: 'engage',
      label: '先手开团',
      ok: parts.engage,
      detail: structure.engageCount ? `硬开团 ${structure.engageCount} 人（${structure.hardEngage.join('、')}）` : '无硬开团，只能被动接团',
    },
    {
      key: 'peel',
      label: '保护链',
      ok: parts.peel,
      detail: structure.peelCount ? `保人型 ${structure.peelCount} 人（${structure.protectors.join('、')}）` : '无保人型，输出核心被开就没人接',
    },
    { key: 'damage', label: '伤害类型', ok: parts.damage, detail: damageCheck(structure).detail },
    { key: 'phase', label: '强势期', ...phaseCheck(structure) },
    {
      key: 'combo',
      label: '成型协同',
      ok: strong.length > 0,
      detail: strong.length ? `成型搭配 ${strong.length} 条（${strong.map((combo) => combo.name).join('、')}）` : '无成型搭配，五人各打各的',
    },
  ]

  // 第七环节：有没有一条走得通的赢法。缺数据时整条不计入，避免用 0 冒充结论
  if (paths) {
    const usableList = paths.paths.filter((path) => path.status === 'open' || path.status === 'contested')
    const blockedList = paths.paths.filter((path) => path.status === 'blocked')
    checks.push({
      key: 'path',
      label: '胜利路径',
      ok: usableList.length > 0,
      detail: usableList.length
        ? `可执行 ${usableList.length} 条（${usableList.map((path) => `${path.label}${path.status === 'contested' ? '·受制' : ''}`).join('、')}）${blockedList.length ? `，另有 ${blockedList.map((path) => path.label).join('、')} 走不通` : '，其余路径不被封死'}`
        : `三条路全部走不通（${blockedList.map((path) => `${path.label}：${path.detail}`).join('；')}）`,
    })
  }

  const passed = checks.filter((check) => check.ok).length
  const tier = tierOf(checks.length, passed)
  return {
    passed,
    total: checks.length,
    tier: tier.key,
    tierLabel: tier.label,
    checks,
    missing: checks.filter((check) => !check.ok).map((check) => check.label),
    paths,
  }
}

/**
 * 版本强度要不要参与判定。
 *
 * 版本强度是「哪些英雄进了能赢的阵容」的聚合统计，和体系闭环度量的是同一件事、
 * 只是抽象层级不同（聚合代理 vs 本局直接测量）。体系差到 2 个环节时，
 * 直接测量已经给出答案，让聚合值反过来改判等于用同一份信息算两遍。
 * 差不足 2 个环节时两者不冲突，版本强度可作为平手裁决依据。
 *
 * 样本不足时同样只作诊断：均分只算有效样本，一两个人代表全队时它没有裁决资格。
 *
 * @param {number} closureGap 两侧通过环节数之差（取绝对值）
 * @param {boolean} sampleReady 双方有效样本是否都达到门槛
 */
export function metaUsagePolicy(closureGap = 0, sampleReady = true) {
  const diagnosticOnly = closureGap >= 2 || !sampleReady
  return {
    diagnosticOnly,
    closureGap,
    sampleReady,
    text: !sampleReady
      ? '有效样本不足（双方各需至少 3 人），版本强度本轮只作诊断依据：可以写进强弱项说明，但不得据此改变胜负倾向'
      : diagnosticOnly
        ? `体系差 ${closureGap} 个环节，版本强度本轮只作诊断依据：可以写进强弱项说明，但不得据此改变胜负倾向`
        : '体系差不足 2 个环节，版本强度可作为平手裁决依据参与判断',
  }
}

/**
 * 两侧对比。gap 用「通过环节数之差」而不是分数差——
 * 环节是硬条件，差两档就意味着少两个齿轮，不是手感问题。
 */
export function compareComposition(blue, red) {
  if (!blue || !red) return null
  const gap = blue.passed - red.passed
  const active = Math.abs(gap) >= 2
  const side = gap > 0 ? 'blue' : 'red'

  // 路径对比独立于环节差：5 条环节全过但一条赢法都没有，仍然赢不了
  const pathGap = (blue.paths?.score ?? 0) - (red.paths?.score ?? 0)
  const pathSide = pathGap === 0 ? null : pathGap > 0 ? 'blue' : 'red'
  const brief = (paths) => `${paths.open} 可执行、${paths.contested} 受制、${paths.blocked} 被封死`
  const pathText = !blue.paths || !red.paths
    ? null
    : pathGap === 0
      ? `双方路径质量相当（蓝方 ${brief(blue.paths)}；红方 ${brief(red.paths)}）`
      : `${pathSide === 'blue' ? '蓝方' : '红方'}路径更稳（蓝方 ${brief(blue.paths)}；红方 ${brief(red.paths)}）`

  return {
    blue,
    red,
    gap,
    paths: blue.paths && red.paths
      ? { blue: blue.paths, red: red.paths, gap: pathGap, side: pathSide, text: pathText }
      : null,
    hint: {
      active,
      side: active ? side : null,
      text: active
        ? `体系差 ${Math.abs(gap)} 个环节，按体系优先原则，${side === 'blue' ? '蓝方' : '红方'}的线上领先不足以单独定胜负，整体倾向应跟随体系差`
        : '体系完整度接近，胜负仍由线上、团战与推进的分段结论决定',
    },
  }
}

const SIDE_NAME = { blue: '蓝方', red: '红方' }

/**
 * 校验模型的 verdict 有没有违背程序已经算出的结论。
 *
 * 倾向与百分比仍由模型给——「谁更可能赢」是解释，不是事实。
 * 但体系差、路径对比、版本强度的用法是程序算出来的硬结论，
 * 模型逆着它们写时必须让用户看见，而不是悄悄采信。所以这里只标记，不改数字。
 *
 * @param {object} review normalizeReview 之后的复盘（用到 verdict / keyFactors / 双方强弱项）
 * @param {object|null} closure compareComposition 的结果
 * @param {object|null} meta 带 policy 的版本强度对比
 */
export function checkVerdictConsistency(review, closure = null, meta = null) {
  const verdict = review?.verdict
  if (!verdict) return { ok: true, issues: [] }
  const issues = []
  const side = verdict.favoredSide
  const blue = Number(verdict.blueWinRate)
  const red = Number(verdict.redWinRate)
  const named = SIDE_NAME[side] || '双方接近'

  if (side === 'blue' && blue < 50) issues.push(`倾向蓝方，百分比却是蓝方 ${blue}%`)
  if (side === 'red' && blue > 50) issues.push(`倾向红方，百分比却是红方 ${red}%`)
  if (side === 'even' && blue !== 50) issues.push(`判双方接近，百分比却是 ${blue}:${red}`)

  const hint = closure?.hint
  if (hint?.active && hint.side && side !== hint.side) {
    issues.push(`体系差 ${Math.abs(closure.gap)} 个环节应跟随${SIDE_NAME[hint.side]}，模型判的是${named}`)
  }

  const pathSide = closure?.paths?.side
  if (pathSide && side !== 'even' && side !== pathSide) {
    issues.push(`路径质量${SIDE_NAME[pathSide]}更稳，模型倾向却给了${named}`)
  }

  const factors = (review.keyFactors || []).filter((text) => String(text).includes('版本'))
  if (factors.length) {
    issues.push(`版本强度写进了决定胜负的因素（${factors.length} 条），它只允许出现在强弱项说明里`)
  }

  if (meta?.policy && meta.policy.sampleReady === false) {
    const texts = [
      verdict.summary,
      ...(review.blue?.strengths || []), ...(review.blue?.weaknesses || []),
      ...(review.red?.strengths || []), ...(review.red?.weaknesses || []),
      ...(review.keyFactors || []),
    ]
    if (texts.some((text) => /版本(层|强度)?占优/.test(String(text)))) {
      issues.push('有效样本不足，仍写出「版本层占优」')
    }
  }

  return { ok: issues.length === 0, issues }
}

export {
  FRONT_MIN,
  ENGAGE_MIN,
  PEEL_MIN,
  DAMAGE_MAX_SAME_TYPE,
  PHASE_MIN,
  SIEGE_WAVECLEAR_MIN,
  SIEGE_PUSH_MIN,
  SPLIT_COUNT_MIN,
  SPLIT_MOBILITY_MIN,
}
