/**
 * 把 AI 的候选整理成界面能直接读的形态。
 *
 * 服务端算出来的候选本来带着给模型看的整句理由（「整队方案：A、B、C、D、E」），
 * 直接丢给界面会有两个问题：一是同一套阵容被反复打印，二是禁人收益在理由和数字里重复。
 * 这里统一转成结构化字段：pick 模式给 lineup，ban 模式给 banImpact / banTarget。
 */

/** 这些前缀的原句是写给模型看的，界面上已经结构化表达，不再重复 */
const DROPPED_PREFIXES = ['整队方案：', '阻止对手补成：', '禁后对手最佳整队评分下降']

const cleanReasons = (reasons) =>
  (reasons || [])
    .filter((reason) => typeof reason === 'string' && !DROPPED_PREFIXES.some((prefix) => reason.startsWith(prefix)))
    .slice(0, 3)

export function toCandidateView(candidates) {
  if (!Array.isArray(candidates)) return []
  return candidates
    .map((item) => {
      const names = item?.plan?.names
      const target = item?.plan?.before?.names
      return {
        heroId: Number(item?.id),
        name: String(item?.name ?? ''),
        lane: String(item?.lane ?? ''),
        score: Math.round(Number(item?.score) || 0),
        reasons: cleanReasons(item?.reasons),
        lineup: Array.isArray(names) ? names : null,
        banImpact: Number.isFinite(item?.banImpact) ? Number(item.banImpact.toFixed(1)) : null,
        banTarget: Array.isArray(target) ? target : null,
      }
    })
    .sort((left, right) => right.score - left.score)
}
