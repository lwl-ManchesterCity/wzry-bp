<script setup lang="ts">
import { computed } from 'vue'
import { EyeOff, History, ShieldBan, X } from 'lucide-vue-next'
import { CLASS_NAMES, LANE_NAMES, LANES } from '../data/meta'
import type { ActionType, Hero, Side } from '../types'

const props = defineProps<{
  side: Side
  name: string
  picks: Hero[]
  bans: Hero[]
  globalUsed: Hero[]
  banCount: number
  active: boolean
  actionType: ActionType
  isPeak: boolean
  hidden: boolean
  revealPending: boolean
}>()

const emit = defineEmits<{
  updateName: [name: string]
  remove: [heroId: number]
}>()

const pickSlots = computed(() => Array.from({ length: 5 }, (_, index) => props.picks[index] ?? null))
const banSlots = computed(() => Array.from({ length: props.banCount }, (_, index) => props.bans[index] ?? null))
/** 两套规则阶段一都是每队 2 个禁用：KPL 2026 为 2 + 3，经典为 2 + 2 */
const banSplit = 2
const sideLabel = computed(() => props.side === 'blue' ? 'BLUE SIDE' : 'RED SIDE')
const laneCoverage = computed(() => {
  const covered = new Set(props.picks.flatMap((hero) => hero.laneIds))
  return LANES.filter((lane) => lane.id !== 0).map((lane) => ({ ...lane, covered: covered.has(lane.id) }))
})

function onNameInput(event: Event) {
  emit('updateName', (event.target as HTMLInputElement).value)
}

/** 侧栏英雄也能拖到分路面板上，避免只能从面板内部拖 */
function onDragStart(event: DragEvent, hero: Hero) {
  const payload = `${props.side}:${hero.id}`
  event.dataTransfer?.setData('application/x-bp-hero', payload)
  event.dataTransfer?.setData('text/plain', payload)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
</script>

<template>
  <aside class="team-panel" :class="[side, { active, concealed: hidden }]">
    <div class="team-accent" />
    <header class="team-header">
      <div class="team-identity">
        <span class="team-side-label">{{ sideLabel }}</span>
        <span v-if="active" class="active-tag" :class="actionType"><i />{{ actionType === 'ban' ? '正在禁用' : '正在选择' }}</span>
      </div>
      <input
        class="team-name"
        :value="name"
        :aria-label="`${side === 'blue' ? '蓝方' : '红方'}队伍名称`"
        maxlength="16"
        @input="onNameInput"
      >
      <div class="team-caption">
        <span>{{ isPeak ? '巅峰对决' : '征召阵容' }}</span>
        <span>{{ picks.length }} / 5</span>
      </div>
    </header>

    <div v-if="hidden" class="privacy-notice">
      <EyeOff :size="14" />
      对方阵容保密中
    </div>

    <div class="pick-list">
      <div
        v-for="(hero, index) in pickSlots"
        :key="index"
        class="pick-slot"
        :class="{ filled: hero && !hidden, placeholder: !hero || hidden, next: !hero && index === picks.length }"
        :draggable="Boolean(hero) && !hidden"
        @dragstart="hero && !hidden && onDragStart($event, hero)"
      >
        <template v-if="hero && !hidden">
          <img :src="hero.avatar" :alt="hero.name" class="pick-avatar">
          <div class="pick-gradient" />
          <div class="pick-meta">
            <span class="pick-index">0{{ index + 1 }}</span>
            <strong>{{ hero.name }}</strong>
            <span>{{ CLASS_NAMES[hero.classId] }} · {{ hero.laneIds.map(id => LANE_NAMES[id]).join(' / ') }}</span>
          </div>
          <button
            v-if="isPeak && revealPending"
            class="remove-pick"
            title="移除该英雄"
            @click="emit('remove', hero.id)"
          >
            <X :size="14" />
          </button>
        </template>
        <template v-else>
          <span class="slot-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span v-if="hidden" class="slot-secret">?</span>
          <span v-else class="slot-empty">
            <i class="slot-plus">+</i>
            <em>待选英雄</em>
          </span>
        </template>
      </div>
    </div>

    <div v-if="!isPeak" class="lane-coverage">
      <span
        v-for="lane in laneCoverage"
        :key="lane.id"
        class="lane-chip"
        :class="{ covered: lane.covered }"
      >{{ lane.label }}</span>
    </div>

    <section v-if="!isPeak" class="ban-section">
      <div class="section-label">
        <span><ShieldBan :size="13" />禁用英雄<i class="ban-split-hint">{{ banSplit }} + {{ banCount - banSplit }}</i></span>
        <b>{{ bans.length }} / {{ banCount }}</b>
      </div>
      <div class="ban-grid">
        <template v-for="(hero, index) in banSlots" :key="index">
          <span v-if="index === banSplit" class="ban-divider" />
          <div class="ban-slot" :title="hero?.name">
            <template v-if="hero">
              <img :src="hero.avatar" :alt="hero.name">
              <span class="ban-slash" />
            </template>
            <span v-else>{{ index + 1 }}</span>
          </div>
        </template>
      </div>
    </section>

    <section v-else class="peak-note">
      <span>自由征召</span>
      <p>无 Ban · 无历史限制 · 允许双方同英雄</p>
    </section>

    <section v-if="globalUsed.length" class="used-section">
      <div class="section-label">
        <span><History :size="13" />本队全局已用</span>
        <b>{{ globalUsed.length }}</b>
      </div>
      <div class="used-avatars">
        <img
          v-for="hero in globalUsed"
          :key="hero.id"
          :src="hero.avatar"
          :alt="hero.name"
          :title="hero.name"
        >
      </div>
    </section>
  </aside>
</template>
