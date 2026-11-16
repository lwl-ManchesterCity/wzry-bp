<script setup lang="ts">
import { computed } from 'vue'
import type { RadarAxis } from '../types'

const props = defineProps<{
  axes: RadarAxis[]
  blueName: string
  redName: string
}>()

const CX = 190
const CY = 160
const R = 104
const LABEL_R = 132

const RADAR_LABEL: Record<string, string> = {
  front: '前排承伤',
  engage: '硬开团',
  peel: '强保人',
  poke: '远程消耗',
  burst: '爆发',
  sustain: '续航',
  mobility: '机动',
  control: '控制',
}

// 第 i 轴：正上方起，顺时针每 45°一轴，与 RADAR_KEYS 顺序一致
function vertex(i: number, radius: number) {
  const angle = (-90 + i * 45) * (Math.PI / 180)
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle), cos: Math.cos(angle) }
}

function polygon(values: number[]) {
  return values
    .map((v, i) => {
      const p = vertex(i, (Math.max(0, Math.min(100, v)) / 100) * R)
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    .join(' ')
}

const geo = computed(() => {
  const axes = props.axes
  const rings = [25, 50, 75, 100].map((level) =>
    axes.map((_, i) => {
      const p = vertex(i, (level / 100) * R)
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    }).join(' '),
  )
  const spokes = axes.map((_, i) => vertex(i, R))
  const labels = axes.map((axis, i) => {
    const p = vertex(i, LABEL_R)
    const anchor = p.cos > 0.3 ? 'start' : p.cos < -0.3 ? 'end' : 'middle'
    return { ...axis, name: RADAR_LABEL[axis.key] ?? axis.key, x: p.x, y: p.y, anchor }
  })
  return {
    rings,
    spokes,
    labels,
    bluePoly: polygon(axes.map((a) => a.bluePct)),
    redPoly: polygon(axes.map((a) => a.redPct)),
    blueDots: axes.map((a, i) => vertex(i, (Math.max(0, Math.min(100, a.bluePct)) / 100) * R)),
    redDots: axes.map((a, i) => vertex(i, (Math.max(0, Math.min(100, a.redPct)) / 100) * R)),
  }
})
</script>

<template>
  <div class="radar-chart">
    <svg viewBox="0 0 380 340" role="img" :aria-label="`${blueName}与${redName}的八维阵容画像`">
      <polygon v-for="(ring, index) in geo.rings" :key="`ring-${index}`" :points="ring" class="radar-ring" />
      <line
        v-for="(spoke, index) in geo.spokes"
        :key="`spoke-${index}`"
        :x1="CX"
        :y1="CY"
        :x2="spoke.x"
        :y2="spoke.y"
        class="radar-spoke"
      />

      <polygon :points="geo.redPoly" class="radar-area red" />
      <polygon :points="geo.bluePoly" class="radar-area blue" />
      <circle v-for="(dot, index) in geo.redDots" :key="`rd-${index}`" :cx="dot.x" :cy="dot.y" r="2.4" class="radar-dot red" />
      <circle v-for="(dot, index) in geo.blueDots" :key="`bd-${index}`" :cx="dot.x" :cy="dot.y" r="2.4" class="radar-dot blue" />

      <text
        v-for="label in geo.labels"
        :key="label.key"
        :x="label.x"
        :y="label.y"
        :text-anchor="label.anchor"
        class="radar-label"
      >
        <title>{{ label.name }} 原始值：{{ blueName }} {{ label.blueRaw }} / {{ redName }} {{ label.redRaw }}</title>
        <tspan :x="label.x" dy="-1">{{ label.name }}</tspan>
        <tspan :x="label.x" dy="13" class="radar-score">
          <tspan class="blue">{{ label.bluePct }}</tspan><tspan class="sep"> / </tspan><tspan class="red">{{ label.redPct }}</tspan>
        </tspan>
      </text>
    </svg>

    <div class="radar-legend">
      <span class="radar-key blue"><i />{{ blueName }}</span>
      <span class="radar-key red"><i />{{ redName }}</span>
      <span class="radar-note">0-100＝该维强于随机合法五人组的占比（参照非职业样本）· 悬停轴标签看原始值</span>
    </div>
  </div>
</template>