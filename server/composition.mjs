// 体系闭环度：一套阵容能不能「自洽地打完一场团战」。
//
// 五轴算的是「这些英雄各自多强」，逐路对位算的是「谁能压谁」，
// 但真正决定团战胜负的是五个齿轮能不能咬上：
// 有人扛、有人开、有人保、伤害打得进去、强势期撞在一起。
// 缺任何一个，另外几个都会打折——前排不够，开团的人开完自己死；
// 没有保人，输出核心一露头就被切；伤害全物理，对面一件反甲就白打。
//
// 所以这里不打分求和，而是逐环节判「能不能成立」，缺口比分数更能说明问题。

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

const TIERS = [
  { min: 6, key: 'S', label: '完整体系' },
  { min: 5, key: 'A', label: '基本成型' },
  { min: 4, key: 'B', label: '存在缺口' },
  { min: 0, key: 'C', label: '各自为战' },
]

const tierOf = (passed) => TIERS.find((tier) => passed >= tier.min)

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

/**
 * 判一侧的闭环度。
 * @param {object} team synergyEngine.analyzeTeam 的返回值（含 structure 与 combos）
 */
export function judgeComposition(team) {
  const structure = team?.structure
  if (!structure) return null

  const strong = (team.combos || []).filter((combo) => combo.tier === 'strong')
  const checks = [
    {
      key: 'front',
      label: '承伤点',
      ok: structure.front >= FRONT_MIN,
      detail: `前排承伤 ${structure.front}/15`,
    },
    {
      key: 'engage',
      label: '先手开团',
      ok: structure.engageCount >= ENGAGE_MIN,
      detail: structure.engageCount ? `硬开团 ${structure.engageCount} 人（${structure.hardEngage.join('、')}）` : '无硬开团，只能被动接团',
    },
    {
      key: 'peel',
      label: '保护链',
      ok: structure.peelCount >= PEEL_MIN,
      detail: structure.peelCount ? `保人型 ${structure.peelCount} 人（${structure.protectors.join('、')}）` : '无保人型，输出核心被开就没人接',
    },
    { key: 'damage', label: '伤害类型', ...damageCheck(structure) },
    { key: 'phase', label: '强势期', ...phaseCheck(structure) },
    {
      key: 'combo',
      label: '成型协同',
      ok: strong.length > 0,
      detail: strong.length ? `成型搭配 ${strong.length} 条（${strong.map((combo) => combo.name).join('、')}）` : '无成型搭配，五人各打各的',
    },
  ]

  const passed = checks.filter((check) => check.ok).length
  const tier = tierOf(passed)
  return {
    passed,
    total: checks.length,
    tier: tier.key,
    tierLabel: tier.label,
    checks,
    missing: checks.filter((check) => !check.ok).map((check) => check.label),
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
  return {
    blue,
    red,
    gap,
    hint: {
      active,
      side: active ? side : null,
      text: active
        ? `体系差 ${Math.abs(gap)} 个环节，按体系优先原则，${side === 'blue' ? '蓝方' : '红方'}的线上领先不足以单独定胜负，整体倾向应跟随体系差`
        : '体系完整度接近，胜负仍由线上、团战与推进的分段结论决定',
    },
  }
}

export { FRONT_MIN, ENGAGE_MIN, PEEL_MIN, DAMAGE_MAX_SAME_TYPE, PHASE_MIN }
