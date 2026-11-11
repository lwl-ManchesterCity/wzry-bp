<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, LoaderCircle, Search, ShieldBan, SlidersHorizontal, Swords, X } from 'lucide-vue-next'
import { CLASS_NAMES, HERO_CLASSES, LANES } from '../data/meta'
import type { ActionType, Hero } from '../types'

const props = defineProps<{
  heroes: Hero[]
  unavailableReasons: Record<number, string>
  selectedId: number | null
  actionType: ActionType
  sideName: string
  complete: boolean
  blueBans: Hero[]
  redBans: Hero[]
  hasNextGame: boolean
  /** AI 回合时锁定英雄池，避免玩家替对手操作 */
  locked?: boolean
  lockedLabel?: string
}>()

const emit = defineEmits<{
  select: [heroId: number]
}>()

const query = ref('')
const classId = ref(0)
const laneId = ref(0)

const filteredHeroes = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return props.heroes.filter((hero) => {
    const matchesKeyword = !keyword
      || hero.name.toLowerCase().includes(keyword)
      || hero.title.toLowerCase().includes(keyword)
      || String(hero.id).includes(keyword)
    const matchesClass = classId.value === 0 || hero.classId === classId.value
    const matchesLane = laneId.value === 0 || hero.laneIds.includes(laneId.value)
    return matchesKeyword && matchesClass && matchesLane
  })
})

const availableCount = computed(() => (
  filteredHeroes.value.filter((hero) => !props.unavailableReasons[hero.id]).length
))

function clearFilters() {
  query.value = ''
  classId.value = 0
  laneId.value = 0
}

function pickHero(hero: Hero) {
  if (props.locked) return
  emit('select', hero.id)
}
</script>

<template>
  <section class="hero-pool" :class="[`mode-${actionType}`, { 'is-complete': complete, 'is-locked': locked }]">
    <div v-if="locked" class="pool-lock">
      <LoaderCircle :size="20" class="spin" />
      <strong>{{ lockedLabel || 'AI 正在决策' }}</strong>
      <span>对手正在评估阵容协同与禁用价值，稍候自动落子</span>
    </div>
    <div class="pool-mode-banner">
      <span class="pool-mode-icon">
        <ShieldBan v-if="actionType === 'ban'" :size="14" />
        <Swords v-else :size="14" />
      </span>
      <b v-if="complete">征召结束</b>
      <b v-else>{{ sideName }}{{ actionType === 'ban' ? '禁用阶段' : '选择阶段' }}</b>
      <span v-if="!complete" class="pool-mode-count">可选 <b>{{ availableCount }}</b> / {{ filteredHeroes.length }}</span>
      <span v-else class="pool-mode-count">英雄池已锁定</span>
    </div>
    <template v-if="!complete">
    <div class="pool-toolbar">
      <label class="search-box">
        <Search :size="17" />
        <input v-model="query" placeholder="搜索英雄 / 称号 / 编号" aria-label="搜索英雄">
        <button v-if="query" title="清空搜索" @click="query = ''"><X :size="14" /></button>
      </label>
    </div>

    <div class="filter-row class-filter" aria-label="职业筛选">
      <button
        v-for="item in HERO_CLASSES"
        :key="item.id"
        :class="{ selected: classId === item.id }"
        @click="classId = item.id"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="filter-row lane-filter">
      <span><SlidersHorizontal :size="13" />分路</span>
      <button
        v-for="item in LANES"
        :key="item.id"
        :class="{ selected: laneId === item.id }"
        @click="laneId = item.id"
      >
        {{ item.label.replace('全部', '全部') }}
      </button>
      <button class="clear-filter" title="重置全部筛选" @click="clearFilters">重置</button>
    </div>

    <div v-if="filteredHeroes.length" class="hero-grid">
      <button
        v-for="hero in filteredHeroes"
        :key="hero.id"
        class="hero-card"
        :class="{ selected: selectedId === hero.id, unavailable: unavailableReasons[hero.id] }"
        :disabled="Boolean(unavailableReasons[hero.id])"
        :title="unavailableReasons[hero.id] || `${hero.name} · ${hero.title}`"
        @click="pickHero(hero)"
      >
        <span class="avatar-wrap">
          <img :src="hero.avatar" :alt="hero.name" loading="lazy">
          <span v-if="unavailableReasons[hero.id]" class="unavailable-mask">
            <i>{{ unavailableReasons[hero.id] }}</i>
          </span>
          <span v-else-if="selectedId === hero.id" class="selection-ribbon" :class="actionType">
            <ShieldBan v-if="actionType === 'ban'" :size="9" />
            <Check v-else :size="9" />
            {{ actionType === 'ban' ? 'BAN' : 'PICK' }}
          </span>
        </span>
        <strong>{{ hero.name }}</strong>
        <span class="hero-class" :class="`class-${hero.classId}`">{{ CLASS_NAMES[hero.classId] }}</span>
      </button>
    </div>
    <div v-else class="empty-pool">
      <Search :size="28" />
      <strong>没有符合条件的英雄</strong>
      <button @click="clearFilters">清除筛选</button>
    </div>
    </template>

    <div v-else class="pool-finished">
      <span class="finished-icon"><Check :size="24" /></span>
      <strong>本局 BP 已完成</strong>
      <p>双方阵容已锁定，英雄池不再接受操作。</p>

      <div v-if="blueBans.length || redBans.length" class="finished-bans">
        <div class="finished-ban-row">
          <span class="finished-ban-side blue">蓝方禁用</span>
          <div class="finished-ban-list blue">
            <img v-for="hero in blueBans" :key="`fb-${hero.id}`" :src="hero.avatar" :alt="hero.name" :title="hero.name">
          </div>
        </div>
        <div class="finished-ban-row">
          <span class="finished-ban-side red">红方禁用</span>
          <div class="finished-ban-list red">
            <img v-for="hero in redBans" :key="`fr-${hero.id}`" :src="hero.avatar" :alt="hero.name" :title="hero.name">
          </div>
        </div>
      </div>

      <div class="finished-steps">
        <span v-if="hasNextGame"><i>01</i>进入下一局继续系列赛</span>
        <span v-else class="series-end"><i>✓</i>系列赛已完成</span>
        <span><i>{{ hasNextGame ? '02' : '01' }}</i>生成 AI 阵容复盘</span>
      </div>
      <small v-if="hasNextGame">全局 BP 模式下，双方本局选用过的英雄会在下一局自动排除</small>
      <small v-else>可导出完整系列赛记录，或重新开始新的系列赛</small>
    </div>
  </section>
</template>
