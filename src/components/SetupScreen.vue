<script setup lang="ts">
import { computed } from 'vue'
import { Bot, ChevronRight, Swords, Users } from 'lucide-vue-next'
import AppSelect from './AppSelect.vue'
import type { MatchFormat, Opponent, RuleSet, SeriesSettings, Side } from '../types'

const props = defineProps<{
  settings: SeriesSettings
  aiConfigured: boolean
  model: string
}>()

const emit = defineEmits<{
  change: [patch: Partial<SeriesSettings>]
  start: []
}>()

const formatOptions = [
  { value: 1, label: 'BO1', hint: '单局决胜' },
  { value: 3, label: 'BO3', hint: '三局两胜' },
  { value: 5, label: 'BO5', hint: '五局三胜' },
  { value: 7, label: 'BO7', hint: '七局四胜 · 含巅峰对决' },
]
const rulesetOptions = [
  { value: 'kpl2026', label: 'KPL 2026', hint: '每方 5 Ban · 2 + 3' },
  { value: 'classic', label: '经典征召', hint: '每方 4 Ban · 2 + 2' },
]

const isAi = computed(() => props.settings.opponent === 'ai')

function setOpponent(opponent: Opponent) {
  if (opponent === props.settings.opponent) return
  emit('change', { opponent })
}

function setHumanSide(humanSide: Side) {
  if (humanSide === props.settings.humanSide) return
  emit('change', { humanSide })
}

function setMode(mode: SeriesSettings['mode']) {
  if (mode === props.settings.mode) return
  emit('change', { mode })
}

function setFormat(value: string | number) {
  emit('change', { format: Number(value) as MatchFormat })
}

function setRuleset(value: string | number) {
  emit('change', { ruleset: String(value) as RuleSet })
}

const summary = computed(() => {
  const mode = props.settings.mode === 'global' ? 'KPL 全局 BP' : '普通单局'
  const bans = props.settings.ruleset === 'kpl2026' ? '每方 5 Ban' : '每方 4 Ban'
  if (!isAi.value) return `${mode} · BO${props.settings.format} · ${bans} · 双人对战`
  const side = props.settings.humanSide === 'blue' ? '你执蓝先手' : '你执红后手'
  return `${mode} · BO${props.settings.format} · ${bans} · ${side} 对阵 ${props.model || 'AI'}`
})
</script>

<template>
  <div class="setup-screen">
    <div class="setup-glow" aria-hidden="true" />

    <header class="setup-top">
      <div class="brand">
        <span class="brand-mark"><Swords :size="20" /></span>
        <div class="brand-text">
          <strong><span class="brand-lower">lwl</span> BP</strong>
          <span>Draft Lab</span>
        </div>
      </div>
      <span class="ai-status" :class="{ configured: aiConfigured }" :title="model">
        <i />{{ model || 'DeepSeek' }} {{ aiConfigured ? '已配置' : '待配置' }}
      </span>
    </header>

    <main class="setup-main">
      <div class="setup-heading">
        <span class="setup-eyebrow">DRAFT SETUP</span>
        <h1>选择你的对局</h1>
        <p>先定对局形式与规则，再进入 BP 界面。</p>
      </div>

      <section class="opponent-grid">
        <button
          class="opponent-card"
          :class="{ active: settings.opponent === 'human' }"
          @click="setOpponent('human')"
        >
          <span class="opponent-icon"><Users :size="24" /></span>
          <div class="opponent-copy">
            <strong>双人对战</strong>
            <span>两个人共用这台设备轮流操作，一人执蓝一人执红。</span>
          </div>
          <em class="opponent-tag">本地对战</em>
        </button>

        <button
          class="opponent-card ai"
          :class="{ active: settings.opponent === 'ai' }"
          @click="setOpponent('ai')"
        >
          <span class="opponent-icon"><Bot :size="24" /></span>
          <div class="opponent-copy">
            <strong>挑战 AI</strong>
            <span>模型完整接管对面一方的禁选，你只需要操作自己这一半。</span>
          </div>
          <em class="opponent-tag">{{ aiConfigured ? 'DeepSeek 对战' : '规则引擎代打' }}</em>
        </button>
      </section>

      <transition name="setup-reveal">
        <section v-if="isAi" class="side-picker">
          <span class="field-label">我的位置</span>
          <div class="side-toggle">
            <button :class="{ active: settings.humanSide === 'blue' }" @click="setHumanSide('blue')">
              <span class="side-dot blue" />执蓝 · 先手
            </button>
            <button :class="{ active: settings.humanSide === 'red' }" @click="setHumanSide('red')">
              <span class="side-dot red" />执红 · 后手
            </button>
          </div>
          <span class="side-note">先手拥有首抢权，后手拥有后置位的针对性调整</span>
        </section>
      </transition>

      <section class="rule-grid">
        <div class="rule-field">
          <span class="field-label">对局模式</span>
          <div class="mode-switch">
            <button :class="{ active: settings.mode === 'single' }" @click="setMode('single')">普通单局</button>
            <button :class="{ active: settings.mode === 'global' }" @click="setMode('global')">KPL 全局 BP</button>
          </div>
        </div>
        <AppSelect label="赛制" :value="settings.format" :options="formatOptions" width="compact" @change="setFormat" />
        <AppSelect label="征召规则" :value="settings.ruleset" :options="rulesetOptions" width="wide" @change="setRuleset" />
      </section>
    </main>

    <footer class="setup-footer">
      <span class="setup-summary">{{ summary }}</span>
      <button class="start-draft" @click="emit('start')">
        进入 BP 界面<ChevronRight :size="18" />
      </button>
    </footer>
  </div>
</template>
