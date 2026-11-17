import { ref } from 'vue'
import type { useDraft } from './useDraft'
import type { AiDraftCandidate, AiDraftResult, Hero } from '../types'

type Draft = ReturnType<typeof useDraft>

/**
 * AI 回合编排：取数令牌、超时兜底、连续两手自走。
 * 状态 ref 原样暴露，App 的各 handler 仍按各自语义清空（与拆分前一致）。
 */
export function useAiTurn(heroes: Hero[], draft: Draft) {
  const heroMap = new Map(heroes.map((hero) => [hero.id, hero]))
  const aiThinking = ref(false)
  const aiNote = ref('')
  /** AI 本局思路，由服务端按系列赛种子与局号决定 */
  const aiStyle = ref<{ key: string; label: string; summary: string } | null>(null)
  /** 上一手的候选池（服务端已按整队评分排序），用于说明 AI 为什么选这个 */
  const aiShortlist = ref<AiDraftCandidate[]>([])
  const aiChosenId = ref(0)
  // 每次 AI 请求持有一个令牌，局面变化后旧响应自动作废
  let aiToken = 0

  /** 作废进行中的请求并停止思考态（返回设置时用） */
  function cancelAi() {
    aiToken += 1
    aiThinking.value = false
  }

  async function runAiTurn() {
    if (!draft.aiTurn.value || aiThinking.value) return
    const token = (aiToken += 1)
    const expected = draft.currentGame.value.actions.length
    const side = draft.activeSide.value
    const type = draft.activeType.value
    aiThinking.value = true
    draft.selectedHeroId.value = null

    let advanced = false
    try {
      const available = heroes.filter((hero) => !draft.reasonFor(hero)).map((hero) => hero.id)
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 30000)
      const response = await fetch('/api/ai-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          settings: { ...draft.settings },
          blueName: draft.blueName.value,
          redName: draft.redName.value,
          currentGame: draft.currentGame.value,
          previousGames: draft.previousGames.value,
          available,
          side,
          type,
          seed: draft.seriesSeed.value,
          seriesIndex: draft.seriesIndex.value,
        }),
      }).finally(() => window.clearTimeout(timer))

      const result = (await response.json().catch(() => null)) as AiDraftResult | null
      if (token !== aiToken) return
      if (draft.currentGame.value.actions.length !== expected) return
      if (!response.ok || !result?.heroId) throw new Error(result?.error || 'AI 未返回选择')

      aiNote.value = result.reason || ''
      if (result.style) aiStyle.value = result.style
      // 候选池原样来自服务端：已按整队评分排序，含每人的五人方案或禁用收益
      aiShortlist.value = Array.isArray(result.shortlist) ? result.shortlist : []
      aiChosenId.value = Number(result.heroId)
      draft.confirmHero(Number(result.heroId))
      advanced = draft.currentGame.value.actions.length > expected
      if (draft.currentGame.value.isPeak && draft.sidePicks(draft.aiSide.value).length >= 5) {
        draft.peakSide.value = draft.settings.humanSide
      }
    } catch {
      if (token !== aiToken) return
      // 兜底：宁可随机落子也不让对局卡在 AI 回合
      if (draft.currentGame.value.actions.length === expected) {
        aiNote.value = 'AI 决策超时，已按备用方案落子'
        // 超时兜底不是 AI 的判断，候选池一并清掉，免得把上一次的依据挂在这一次头上
        aiShortlist.value = []
        aiChosenId.value = 0
        const availableHeroes = heroes.filter((hero) => !draft.reasonFor(hero))
        let pool = availableHeroes
        if (type === 'pick') {
          // 选人兜底优先补我方缺的路，别按数据库顺序送第一个英雄
          const aiLanes = new Set(draft.sidePicks(draft.aiSide.value).map((id) => heroMap.get(id)?.laneIds?.[0]))
          const fillsGap = availableHeroes.filter((hero) => hero.laneIds?.[0] != null && !aiLanes.has(hero.laneIds[0]))
          if (fillsGap.length) pool = fillsGap
        }
        const fallback = pool[Math.floor(Math.random() * pool.length)]
        if (fallback) {
          draft.confirmHero(fallback.id)
          advanced = draft.currentGame.value.actions.length > expected
        }
      }
    } finally {
      if (token === aiToken) {
        aiThinking.value = false
        // 对手连续两手时，落子后仍然轮到它，需要接着走
        if (advanced && draft.aiTurn.value) window.setTimeout(() => void runAiTurn(), 260)
      }
    }
  }

  return { aiThinking, aiNote, aiStyle, aiShortlist, aiChosenId, runAiTurn, cancelAi }
}