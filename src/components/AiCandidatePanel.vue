<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bot, ChevronDown } from 'lucide-vue-next'
import type { AiDraftCandidate, Hero, Side } from '../types'

const props = defineProps<{
  note: string
  style: { key: string; label: string; summary: string } | null
  shortlist: AiDraftCandidate[]
  chosenId: number
  side: Side
  name: string
  heroes: Hero[]
}>()

const heroMap = new Map(props.heroes.map((hero) => [hero.id, hero]))
const candOpen = ref(false)
const avatarOf = (heroId: number) => heroMap.get(heroId)?.avatar || ''

// 候选池按整队评分排过序，名次差与分差能说明模型有没有偏离程序给出的最优解
const chosenRank = computed(() => {
  const index = props.shortlist.findIndex((item) => item.heroId === props.chosenId)
  return index < 0 ? 0 : index + 1
})
const scoreGap = computed(() => {
  const top = props.shortlist[0]
  const chosen = props.shortlist.find((item) => item.heroId === props.chosenId)
  return top && chosen ? Math.max(0, top.score - chosen.score) : 0
})
const candCaption = computed(() => {
  const total = props.shortlist.length
  if (!total) return ''
  if (!chosenRank.value) return `共 ${total} 个候选`
  // 同一套五人方案会推出多个同分候选，名次在这些同分项之间没有意义，按分差说更准确
  const ties = props.shortlist.filter((item) => item.score === props.shortlist[0].score).length
  if (scoreGap.value > 0) {
    return `共 ${total} 个候选 · 按整队评分排序，AI 选中第 ${chosenRank.value}，比最高分低 ${scoreGap.value}`
  }
  return ties > 1
    ? `共 ${total} 个候选 · AI 选中最高分（与另外 ${ties - 1} 个同分）`
    : `共 ${total} 个候选 · AI 选中的就是最高分`
})

// 多个候选常常指向同一套五人阵容（谁先拿都行），整套方案重复打印反而看不清，只标一次。
// 键要先排序：同一套阵容在不同候选里出场顺序可能不同，直接拼接会判成两套。
const planKeyOf = (cand: AiDraftCandidate) => [...(cand.lineup || cand.banTarget || [])].sort().join('|')
const isDuplicatePlan = (index: number) => {
  const key = planKeyOf(props.shortlist[index])
  if (!key) return false
  return props.shortlist.slice(0, index).some((item) => planKeyOf(item) === key)
}
</script>

<template>
  <div v-if="note" class="ai-note-line" :class="side">
    <Bot :size="13" />
    <span class="ai-note-text"><b>{{ name }}</b> 上一手：{{ note }}</span>
    <button
      v-if="shortlist.length"
      class="ai-cand-toggle"
      :class="{ open: candOpen }"
      :title="candOpen ? '收起候选依据' : '看看它在哪几个里挑的'"
      @click="candOpen = !candOpen"
    >
      候选依据 {{ shortlist.length }}<ChevronDown :size="11" />
    </button>
    <span v-if="style" class="ai-style-chip" :title="style.summary">本局思路 · {{ style.label }}</span>
  </div>

  <div v-if="candOpen && shortlist.length" class="ai-cand-panel" :class="side">
    <div class="ai-cand-head">
      <span>{{ candCaption }}</span>
      <span class="ai-cand-hint">评分是五人整队综合分，不是单个英雄强度</span>
    </div>
    <ul class="ai-cand-list">
      <li
        v-for="(cand, index) in shortlist"
        :key="cand.heroId"
        class="ai-cand-row"
        :class="{ chosen: cand.heroId === chosenId }"
      >
        <span class="ai-cand-rank">{{ index + 1 }}</span>
        <img class="ai-cand-avatar" :src="avatarOf(cand.heroId)" :alt="cand.name" loading="lazy" />
        <span class="ai-cand-name">{{ cand.name }}</span>
        <span class="ai-cand-lane">{{ cand.lane }}</span>
        <span class="ai-cand-score">{{ cand.score }}</span>
        <span v-if="cand.heroId === chosenId" class="ai-cand-badge">AI 选中</span>
        <span v-if="cand.banImpact !== null" class="ai-cand-impact">禁后对手整队 −{{ cand.banImpact }}</span>
        <p class="ai-cand-body">
          <span v-if="isDuplicatePlan(index) && (cand.lineup || cand.banTarget)" class="ai-cand-plan dup">同一套五人阵容</span>
          <span v-else-if="cand.lineup" class="ai-cand-plan">凑成：{{ cand.lineup.join('、') }}</span>
          <span v-else-if="cand.banTarget" class="ai-cand-plan">对手原本能凑成：{{ cand.banTarget.join('、') }}</span>
          <span v-if="cand.reasons.length" class="ai-cand-reasons">{{ cand.reasons.join('；') }}</span>
        </p>
      </li>
    </ul>
  </div>
</template>