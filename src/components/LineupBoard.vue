<script setup lang="ts">
import { computed, ref } from 'vue'
import { GripVertical, LayoutGrid, Wand2 } from 'lucide-vue-next'
import { CLASS_NAMES, LANE_NAMES, LANES } from '../data/meta'
import type { Hero, Side } from '../types'

const props = defineProps<{
  blueName: string
  redName: string
  bluePicks: Hero[]
  redPicks: Hero[]
  /** laneId -> heroId */
  blueLanes: Record<number, number>
  redLanes: Record<number, number>
  /** 巅峰对决未揭晓时，对手阵容不能出现在排布面板上 */
  blueHidden?: boolean
  redHidden?: boolean
}>()

const emit = defineEmits<{
  assign: [side: Side, laneId: number, heroId: number]
  auto: [side: Side]
}>()

const hoverKey = ref('')
/** 点击选中再点目标分路的兜底操作，拖拽不顺手时也能换位 */
const picked = ref<{ side: Side; heroId: number } | null>(null)

function sidePicks(side: Side) {
  return side === 'blue' ? props.bluePicks : props.redPicks
}

function sideLanes(side: Side) {
  return side === 'blue' ? props.blueLanes : props.redLanes
}

function heroOf(side: Side, laneId: number) {
  if (side === 'blue' ? props.blueHidden : props.redHidden) return null
  const heroId = Number(sideLanes(side)[laneId])
  if (!heroId) return null
  return sidePicks(side).find((hero) => hero.id === heroId) ?? null
}

function isHidden(side: Side) {
  return side === 'blue' ? Boolean(props.blueHidden) : Boolean(props.redHidden)
}

const boardRows = computed(() => LANES
  .filter((lane) => lane.id !== 0)
  .map((lane) => ({
    id: lane.id,
    label: lane.label,
    blue: heroOf('blue', lane.id),
    red: heroOf('red', lane.id),
  })))

/** 站的是不是自己的主路：主路 / 副路 / 补位 */
function laneTag(hero: Hero, laneId: number) {
  const index = hero.laneIds.indexOf(laneId)
  if (index === 0) return { text: '主路', tone: 'primary' }
  if (index > 0) return { text: '副路', tone: 'secondary' }
  return { text: '补位', tone: 'off' }
}

function onDragStart(event: DragEvent, side: Side, heroId: number) {
  const payload = `${side}:${heroId}`
  event.dataTransfer?.setData('application/x-bp-hero', payload)
  event.dataTransfer?.setData('text/plain', payload)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  picked.value = { side, heroId }
}

function onDrop(event: DragEvent, side: Side, laneId: number) {
  hoverKey.value = ''
  if (isHidden(side)) return
  const raw = event.dataTransfer?.getData('application/x-bp-hero')
    || event.dataTransfer?.getData('text/plain')
    || ''
  const [fromSide, heroId] = raw.split(':')
  if (fromSide !== side || !heroId) return
  emit('assign', side, laneId, Number(heroId))
  picked.value = null
}

function onCellClick(side: Side, laneId: number) {
  if (isHidden(side)) return
  if (!picked.value || picked.value.side !== side) return
  emit('assign', side, laneId, picked.value.heroId)
  picked.value = null
}

/** 点已占位的一格：手里有别的英雄就换位，否则选它自己 */
function onHeroClick(side: Side, laneId: number, heroId: number) {
  if (picked.value && picked.value.side === side && picked.value.heroId !== heroId) {
    emit('assign', side, laneId, picked.value.heroId)
    picked.value = null
    return
  }
  picked.value = { side, heroId }
}

function isPicked(side: Side, heroId: number) {
  return picked.value?.side === side && picked.value.heroId === heroId
}
</script>

<template>
  <section class="lineup-board">
    <header class="lineup-board-head">
      <h3><LayoutGrid :size="16" />分路排布</h3>
      <p>拖动英雄换位，复盘与逐路对位按这里的排布计算</p>
      <span class="lineup-legend">
        <i class="dot primary" />主路
        <i class="dot secondary" />副路
        <i class="dot off" />补位
      </span>
    </header>

    <div class="lineup-column-head">
      <span class="column-side blue">{{ blueName }}<button v-if="!isHidden('blue')" class="lineup-auto" title="按主路重新自动排布" @click="emit('auto', 'blue')"><Wand2 :size="12" />自动</button></span>
      <span class="column-lane">分路</span>
      <span class="column-side red"><button v-if="!isHidden('red')" class="lineup-auto" title="按主路重新自动排布" @click="emit('auto', 'red')"><Wand2 :size="12" />自动</button>{{ redName }}</span>
    </div>

    <div class="lineup-rows">
      <div v-for="row in boardRows" :key="row.id" class="lineup-row">
        <div
          class="lineup-cell blue"
          :class="{ filled: row.blue, over: hoverKey === `blue-${row.id}` }"
          @dragover.prevent="hoverKey = `blue-${row.id}`"
          @dragleave="hoverKey = ''"
          @drop.prevent="onDrop($event, 'blue', row.id)"
          @click="onCellClick('blue', row.id)"
        >
          <div
            v-if="row.blue"
            class="lineup-hero"
            :class="{ picked: isPicked('blue', row.blue.id) }"
            draggable="true"
            @dragstart="onDragStart($event, 'blue', row.blue.id)"
            @click.stop="onHeroClick('blue', row.id, row.blue.id)"
          >
            <img :src="row.blue.avatar" :alt="row.blue.name">
            <div class="lineup-hero-meta">
              <strong>{{ row.blue.name }}</strong>
              <span>{{ CLASS_NAMES[row.blue.classId] }} · {{ row.blue.laneIds.map(id => LANE_NAMES[id]).join(' / ') }}</span>
            </div>
            <em class="lineup-tag" :class="laneTag(row.blue, row.id).tone">{{ laneTag(row.blue, row.id).text }}</em>
            <GripVertical :size="13" class="lineup-grip" />
          </div>
          <span v-else class="lineup-empty">{{ isHidden('blue') ? '阵容待揭晓' : '拖入英雄' }}</span>
        </div>

        <div class="lineup-lane">{{ row.label }}</div>

        <div
          class="lineup-cell red"
          :class="{ filled: row.red, over: hoverKey === `red-${row.id}` }"
          @dragover.prevent="hoverKey = `red-${row.id}`"
          @dragleave="hoverKey = ''"
          @drop.prevent="onDrop($event, 'red', row.id)"
          @click="onCellClick('red', row.id)"
        >
          <div
            v-if="row.red"
            class="lineup-hero"
            :class="{ picked: isPicked('red', row.red.id) }"
            draggable="true"
            @dragstart="onDragStart($event, 'red', row.red.id)"
            @click.stop="onHeroClick('red', row.id, row.red.id)"
          >
            <GripVertical :size="13" class="lineup-grip" />
            <em class="lineup-tag" :class="laneTag(row.red, row.id).tone">{{ laneTag(row.red, row.id).text }}</em>
            <div class="lineup-hero-meta">
              <strong>{{ row.red.name }}</strong>
              <span>{{ CLASS_NAMES[row.red.classId] }} · {{ row.red.laneIds.map(id => LANE_NAMES[id]).join(' / ') }}</span>
            </div>
            <img :src="row.red.avatar" :alt="row.red.name">
          </div>
          <span v-else class="lineup-empty">{{ isHidden('red') ? '阵容待揭晓' : '拖入英雄' }}</span>
        </div>
      </div>
    </div>

    <p class="lineup-hint">拖拽任意英雄到目标分路即可换位；两人互换，其余位置保持不变。点「自动」恢复按主路排布。</p>
  </section>
</template>
