// 版本强度（meta strength）：把 KPL 赛季的出场次数与胜率压成一个 0-100 的分。
//
// 为什么不单看胜率：虞姬 9 场 66.7% 和曹操 75 场 61.3% 的说服力差一个量级，
// 出场次数本身就是职业队对版本的一次投票——没人拿的英雄，再高的胜率也只是样本噪声。
//
// 为什么不给「未登场」一个低分：0 场是「没有样本」而不是「弱」。
// 新英雄（如元流之子各形态）刚进池子，职业队还没拿出来用，把它按弱处理会误伤阵容；
// 老英雄 0 场才是版本弃子。所以未登场一律记 null，由调用方按「不可评估」处理，
// 团队均分只用有效样本，并把未登场名单单独列出来给模型看。

/** 分档阈值：出场与胜率都拉满才会进 T0 */
const TIER_T0 = 80
const TIER_T1 = 65
const TIER_T2 = 50

/** 分档区间：25（几乎不上场且胜率低）到 100（出场最多且胜率最高） */
const SCORE_BASE = 25
const PRIORITY_WEIGHT = 50
const PERF_WEIGHT = 25

/** 出场基准的下限：赛季刚开始时避免最高出场只有 3 场，把基准压得极低 */
const MAX_GAMES_FLOOR = 20

/** 胜率折算区间：45% 记 0 分，65% 及以上记满分 */
const PERF_FLOOR_RATE = 45
const PERF_SPAN = 20

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

function tierOf(score) {
  if (score >= TIER_T0) return 'T0'
  if (score >= TIER_T1) return 'T1'
  if (score >= TIER_T2) return 'T2'
  return 'T3'
}

/**
 * @param {object} options
 * @param {object} options.stats  kpl-stats.json 全文
 * @param {Array}  options.heroes heroes.json（用于补全未收录英雄的名字）
 */
export function createMetaModel({ stats, heroes = [] }) {
  if (!stats?.heroes) return null

  const rows = new Map(
    Object.entries(stats.heroes).map(([id, row]) => [Number(id), row]),
  )
  const heroById = new Map(heroes.map((hero) => [hero.id, hero]))
  const maxGames = Math.max(
    MAX_GAMES_FLOOR,
    ...Object.values(stats.heroes).map((row) => Number(row.games) || 0),
  )

  /** 单个英雄的版本强度；未收录或 0 场返回 score=null */
  function scoreOf(heroId) {
    const id = Number(heroId)
    const row = rows.get(id)
    const hero = heroById.get(id)
    const name = row?.name || hero?.name || `#${id}`
    const games = Number(row?.games) || 0

    if (!row || games === 0) {
      return { id, name, games, winRate: null, score: null, tier: 'NA', note: '本赛季未登场' }
    }

    const priority = Math.min(1, games / maxGames)
    const perf = clamp(((Number(row.winRate) || 0) - PERF_FLOOR_RATE) / PERF_SPAN, 0, 1)
    const score = Math.round(SCORE_BASE + PRIORITY_WEIGHT * priority + PERF_WEIGHT * perf)
    return {
      id,
      name,
      games,
      winRate: Number(row.winRate),
      score,
      tier: tierOf(score),
      note: games < 15 ? '样本有限' : '',
    }
  }

  /**
   * 一方的版本强度。均分只算有效样本，未登场单独列出——
   * 否则「新英雄没上场」会被当成「拖后腿」，与事实相反。
   */
  function team(heroIds) {
    const members = heroIds.map(scoreOf)
    const known = members.filter((item) => item.score !== null)
    const noSample = members.filter((item) => item.score === null)
    const avg = known.length
      ? Math.round(known.reduce((sum, item) => sum + item.score, 0) / known.length)
      : null
    const byScore = known.slice().sort((a, b) => b.score - a.score)
    return {
      avg,
      knownCount: known.length,
      noSample: noSample.map((item) => item.name),
      members,
      strongest: byScore[0] || null,
      weakest: byScore[byScore.length - 1] || null,
    }
  }

  /**
   * 两侧对比。diff 只在双方都有有效样本时给出，避免一方全无样本时算出一个假差距。
   */
  function compare(bluePicks, redPicks) {
    const blue = team(bluePicks)
    const red = team(redPicks)
    const diff = blue.avg !== null && red.avg !== null ? blue.avg - red.avg : null
    const evenNoSample = blue.noSample.length === red.noSample.length

    let leader = 'even'
    if (diff !== null && Math.abs(diff) >= 10) leader = diff > 0 ? 'blue' : 'red'

    return { blue, red, diff, leader, evenNoSample }
  }

  return { scoreOf, team, compare, maxGames }
}

/** 把一侧的成员写成人读的一行，例如「司空震 T1 72（50场/56%）」 */
export function describeMembers(team) {
  return team.members
    .map((item) => (item.score === null
      ? `${item.name} 未登场`
      : `${item.name} ${item.tier} ${item.score}（${item.games}场/${item.winRate}%）`))
    .join('、')
}
