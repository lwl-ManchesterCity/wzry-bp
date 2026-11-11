<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  ChevronLeft,
  Download,
  Eye,
  FileClock,
  RotateCcw,
  Settings2,
  ShieldBan,
  Swords,
} from 'lucide-vue-next'
import HeroPool from './components/HeroPool.vue'
import LineupBoard from './components/LineupBoard.vue'
import ReviewModal from './components/ReviewModal.vue'
import SetupScreen from './components/SetupScreen.vue'
import TeamPanel from './components/TeamPanel.vue'
import { useDraft } from './composables/useDraft'
import heroesData from './data/heroes.json'
import { CLASS_NAMES, LANE_NAMES } from './data/meta'
import { getSteps } from './engine/draft'
import type { Game, Hero, SeriesSettings, SeriesSnapshot, Side } from './types'

const heroes = heroesData as Hero[]
const heroMap = new Map(heroes.map((hero) => [hero.id, hero]))
const {
  settings,
  previousGames,
  currentGame,
  blueName,
  redName,
  selectedHeroId,
  peakSide,
  peakRevealed,
  error,
  currentStep,
  activeSide,
  activeType,
  complete,
  aiSide,
  aiTurn,
  reasonFor,
  confirmHero,
  undo,
  resetCurrentGame,
  resetSeries,
  nextGame,
  removePeakHero,
  globalUsed,
  sidePicks,
  sideBans,
  laneMap,
  assignLane,
  autoLanes,
  lineupPayload,
  exportSeries,
} = useDraft(heroes)

const screen = ref<'lobby' | 'draft'>('lobby')
const aiThinking = ref(false)
const aiNote = ref('')
const reviewOpen = ref(false)
const aiConfigured = ref(false)
const aiModel = ref('deepseek-chat')
// 每次 AI 请求持有一个令牌，局面变化后旧响应自动作废
let aiToken = 0

const isAiGame = computed(() => settings.opponent === 'ai')
const aiName = computed(() => (settings.humanSide === 'blue' ? redName.value : blueName.value))
const humanName = computed(() => (settings.humanSide === 'blue' ? blueName.value : redName.value))
const modeLabel = computed(() => (settings.mode === 'global' ? 'KPL 全局 BP' : '普通单局'))
const rulesetLabel = computed(() => (settings.ruleset === 'kpl2026' ? 'KPL 2026 · 5 Ban' : '经典 · 4 Ban'))
const poolLocked = computed(() => isAiGame.value && (aiThinking.value || aiTurn.value))

const toHeroes = (ids: number[]) => ids.map((id) => heroMap.get(id)).filter((hero): hero is Hero => Boolean(hero))
const bluePicks = computed(() => toHeroes(sidePicks('blue')))
const redPicks = computed(() => toHeroes(sidePicks('red')))
const blueBans = computed(() => toHeroes(sideBans('blue')))
const redBans = computed(() => toHeroes(sideBans('red')))
const blueUsed = computed(() => toHeroes([...globalUsed('blue')]))
const redUsed = computed(() => toHeroes([...globalUsed('red')]))
const selectedHero = computed(() => selectedHeroId.value ? heroMap.get(selectedHeroId.value) ?? null : null)
const banCount = computed(() => settings.ruleset === 'kpl2026' ? 5 : 4)
const totalSteps = computed(() => getSteps(settings.ruleset).length)
const isSeriesEnd = computed(() => complete.value && currentGame.value.number >= settings.format)

const unavailableReasons = computed<Record<number, string>>(() => {
  const result: Record<number, string> = {}
  for (const hero of heroes) {
    const reason = reasonFor(hero)
    if (reason) result[hero.id] = reason
  }
  return result
})

const currentOrdinal = computed(() => {
  if (currentGame.value.isPeak) return sidePicks(activeSide.value).length + 1
  return currentGame.value.actions.filter(
    (action) => action.side === currentStep.value?.side && action.type === currentStep.value?.type,
  ).length + 1
})

const statusLabel = computed(() => {
  if (complete.value) {
    return currentGame.value.isPeak
      ? '双方阵容已锁定'
      : `第 ${currentGame.value.number} 局 · 征召结束`
  }
  const side = activeSide.value === 'blue' ? blueName.value : redName.value
  if (currentGame.value.isPeak) return `${side} · 自由选择第 ${Math.min(currentOrdinal.value, 5)} 个英雄`
  return `${side} · ${activeType.value === 'ban' ? '禁用' : '选择'}第 ${currentOrdinal.value} 个英雄`
})

const phaseLabel = computed(() => {
  if (complete.value) return 'DRAFT COMPLETE'
  if (currentGame.value.isPeak) return 'ULTIMATE BATTLE'
  return activeType.value === 'ban' ? 'BAN PHASE' : 'PICK PHASE'
})

const phaseMeta = computed(() => {
  if (currentGame.value.isPeak) return 'FREE PICK'
  return settings.ruleset === 'kpl2026' ? '5 BAN · 3+2' : '4 BAN · 2+2'
})

const stages = computed(() => {
  if (currentGame.value.isPeak) return [{ label: '巅峰对决 · 自由征召', start: 0, end: totalSteps.value }]
  const steps = getSteps(settings.ruleset)
  const groups: { type: 'ban' | 'pick'; start: number; end: number }[] = []
  steps.forEach((step, index) => {
    const last = groups[groups.length - 1]
    if (last && last.type === step.type) last.end = index + 1
    else groups.push({ type: step.type, start: index, end: index + 1 })
  })
  let banPhase = 0
  let pickPhase = 0
  return groups.map((group) => {
    const ordinal = group.type === 'ban' ? ++banPhase : ++pickPhase
    return {
      label: `${ordinal === 1 ? '第一' : '第二'}阶段 ${group.type === 'ban' ? 'BAN' : 'PICK'}`,
      start: group.start,
      end: group.end,
    }
  })
})

const progress = computed(() => {
  if (currentGame.value.isPeak) return (bluePicks.value.length + redPicks.value.length) * 10
  return Math.round((currentGame.value.actions.length / totalSteps.value) * 100)
})

const snapshot = computed<SeriesSnapshot>(() => ({
  settings: { ...settings },
  blueName: blueName.value,
  redName: redName.value,
  previousGames: previousGames.value,
  currentGame: currentGame.value,
  lineups: lineupPayload(),
}))

const blueLanes = computed(() => laneMap('blue'))
const redLanes = computed(() => laneMap('red'))

const recordedGames = computed(() => [...previousGames.value, currentGame.value])

function lineupSlots(game: Game, side: Side) {
  const picks = game.actions.filter((action) => action.side === side && action.type === 'pick')
  return Array.from({ length: 5 }, (_, index) => {
    const action = picks[index]
    return action ? heroMap.get(action.heroId) ?? null : null
  })
}

function hasAnyProgress() {
  return previousGames.value.length > 0 || currentGame.value.actions.length > 0
}

// 开场页改任何设置都意味着换一局，已有进度需要确认
function handleSetupChange(patch: Partial<SeriesSettings>) {
  if (hasAnyProgress() && !window.confirm('修改对局设置会清空当前系列赛，是否继续？')) return
  Object.assign(settings, patch)
  resetSeries()
  aiNote.value = ''
}

function startDraft() {
  if (settings.opponent === 'ai') {
    const label = aiConfigured.value ? aiModel.value || 'DeepSeek' : 'AI 对手'
    if (settings.humanSide === 'blue') {
      blueName.value = '我方'
      redName.value = label
    } else {
      blueName.value = label
      redName.value = '我方'
    }
  } else {
    blueName.value = '蓝色方'
    redName.value = '红色方'
  }
  resetSeries()
  aiNote.value = ''
  screen.value = 'draft'
}

function backToSetup() {
  if (hasAnyProgress() && !window.confirm('返回设置会清空当前系列赛，是否继续？')) return
  aiToken += 1
  aiThinking.value = false
  resetSeries()
  aiNote.value = ''
  screen.value = 'lobby'
}

async function runAiTurn() {
  if (!aiTurn.value || aiThinking.value) return
  const token = (aiToken += 1)
  const expected = currentGame.value.actions.length
  const side = activeSide.value
  const type = activeType.value
  aiThinking.value = true
  selectedHeroId.value = null

  let advanced = false
  try {
    const available = heroes.filter((hero) => !unavailableReasons.value[hero.id]).map((hero) => hero.id)
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 30000)
    const response = await fetch('/api/ai-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        settings: { ...settings },
        blueName: blueName.value,
        redName: redName.value,
        currentGame: currentGame.value,
        available,
        side,
        type,
      }),
    }).finally(() => window.clearTimeout(timer))

    const result = await response.json().catch(() => null)
    if (token !== aiToken) return
    if (currentGame.value.actions.length !== expected) return
    if (!response.ok || !result?.heroId) throw new Error(result?.error || 'AI 未返回选择')

    aiNote.value = result.reason || ''
    confirmHero(Number(result.heroId))
    advanced = currentGame.value.actions.length > expected
    if (currentGame.value.isPeak && sidePicks(aiSide.value).length >= 5) {
      peakSide.value = settings.humanSide
    }
  } catch {
    if (token !== aiToken) return
    // 兜底：宁可随机落子也不让对局卡在 AI 回合
    if (currentGame.value.actions.length === expected) {
      aiNote.value = 'AI 决策超时，已按备用方案落子'
      const fallback = heroes.find((hero) => !unavailableReasons.value[hero.id])
      if (fallback) {
        confirmHero(fallback.id)
        advanced = currentGame.value.actions.length > expected
      }
    }
  } finally {
    if (token === aiToken) {
      aiThinking.value = false
      // 对手连续两手时，落子后仍然轮到它，需要接着走
      if (advanced && aiTurn.value) window.setTimeout(() => void runAiTurn(), 260)
    }
  }
}

watch(
  () => [screen.value, aiTurn.value, currentGame.value.actions.length, peakSide.value] as const,
  () => {
    if (screen.value !== 'draft') return
    if (aiTurn.value && !aiThinking.value) void runAiTurn()
  },
  { flush: 'post' },
)

function requestResetSeries() {
  const hasProgress = previousGames.value.length > 0 || currentGame.value.actions.length > 0
  if (!hasProgress || window.confirm('将清空全部小局记录并新建系列赛，是否继续？')) resetSeries()
}

function openReview() {
  peakRevealed.value = true
  reviewOpen.value = true
}

function sideName(side: Side) {
  return side === 'blue' ? blueName.value : redName.value
}

function handleLaneAssign(side: Side, laneId: number, heroId: number) {
  assignLane(side, laneId, heroId)
}

watch(peakSide, () => {
  selectedHeroId.value = null
})

onMounted(async () => {
  try {
    const response = await fetch('/api/health')
    const result = await response.json()
    aiConfigured.value = Boolean(result.configured)
    aiModel.value = result.model || 'deepseek-chat'
  } catch {
    aiConfigured.value = false
  }
})
</script>

<template>
  <SetupScreen
    v-if="screen === 'lobby'"
    :settings="settings"
    :ai-configured="aiConfigured"
    :model="aiModel"
    @change="handleSetupChange"
    @start="startDraft"
  />

  <div v-else class="app-shell" :class="[`action-${activeType}`, `side-${activeSide}`, { 'is-complete': complete, 'is-peak': currentGame.isPeak, 'is-ai': isAiGame }]">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"><Swords :size="20" /></span>
        <div class="brand-text">
          <strong><span class="brand-lower">lwl</span> BP</strong>
          <span>Draft Lab</span>
        </div>
      </div>

      <div class="topbar-controls">
        <div class="draft-config">
          <b>{{ modeLabel }}</b>
          <span>BO{{ settings.format }}</span>
          <span>{{ rulesetLabel }}</span>
          <em v-if="isAiGame" class="config-matchup">
            <span class="config-side">{{ humanName }}</span>
            <i>VS</i>
            <span class="config-ai">{{ aiName }}</span>
          </em>
        </div>
      </div>

      <div class="topbar-actions">
        <span class="ai-status" :class="{ configured: aiConfigured }" :title="aiModel"><i />DeepSeek {{ aiConfigured ? '已配置' : '待配置' }}</span>
        <button class="icon-button" title="导出 BP 记录" @click="exportSeries"><Download :size="18" /></button>
        <button class="setup-back" title="返回对局设置" @click="backToSetup"><Settings2 :size="15" />设置</button>
        <button class="new-series" @click="requestResetSeries"><RotateCcw :size="15" />新建系列赛</button>
      </div>
    </header>

    <div class="match-ribbon">
      <span>{{ settings.mode === 'global' ? 'GLOBAL BAN / PICK' : 'SINGLE DRAFT' }}</span>
      <strong>第 {{ currentGame.number }} 局 <i>/</i> BO{{ settings.format }}</strong>
      <span v-if="currentGame.isPeak" class="peak-ribbon">巅峰对决</span>
      <span v-else>{{ settings.ruleset === 'kpl2026' ? '2026 征召顺序' : '经典征召顺序' }}</span>
    </div>

    <main class="draft-layout">
      <TeamPanel
        side="blue"
        :name="blueName"
        :picks="bluePicks"
        :bans="blueBans"
        :global-used="blueUsed"
        :ban-count="banCount"
        :active="!complete && activeSide === 'blue'"
        :action-type="activeType"
        :is-peak="currentGame.isPeak"
        :hidden="currentGame.isPeak && !peakRevealed && peakSide !== 'blue'"
        :reveal-pending="currentGame.isPeak && !peakRevealed"
        @update-name="blueName = $event"
        @remove="removePeakHero('blue', $event)"
      />

      <section class="draft-center">
        <header class="phase-header">
          <div class="phase-mode-icon">
            <ShieldBan v-if="activeType === 'ban' && !complete" :size="21" />
            <Swords v-else :size="21" />
          </div>
          <div class="phase-copy">
            <span class="phase-kicker">{{ phaseLabel }}<i v-if="!complete && !currentGame.isPeak"> · STEP {{ Math.min(currentGame.actions.length + 1, totalSteps) }} / {{ totalSteps }}</i></span>
            <h1>{{ statusLabel }}</h1>
          </div>
          <span v-if="!complete" class="phase-type-pill">{{ phaseMeta }}</span>
          <div class="phase-actions">
            <button :disabled="!currentGame.actions.length" title="撤销上一步" @click="undo"><ChevronLeft :size="16" />撤销</button>
            <button :disabled="!currentGame.actions.length" title="重置当前小局" @click="resetCurrentGame"><RotateCcw :size="15" />重开本局</button>
          </div>
        </header>

        <div class="stage-track">
          <div
            v-for="stage in stages"
            :key="stage.label"
            class="stage-item"
            :style="{ flexGrow: stage.end - stage.start, flexBasis: 0 }"
            :class="{
              done: currentGame.isPeak ? complete : currentGame.actions.length >= stage.end,
              active: currentGame.isPeak ? !complete : currentGame.actions.length >= stage.start && currentGame.actions.length < stage.end,
            }"
          >
            <span>{{ stage.label }}</span><i />
          </div>
          <b>{{ progress }}%</b>
        </div>

        <div v-if="currentGame.isPeak" class="peak-selector">
          <div class="peak-tabs">
            <button :class="{ active: peakSide === 'blue' }" @click="peakSide = 'blue'">
              <span class="blue-dot" />{{ blueName }}<b>{{ bluePicks.length }}/5</b>
            </button>
            <button :class="{ active: peakSide === 'red' }" @click="peakSide = 'red'">
              <span class="red-dot" />{{ redName }}<b>{{ redPicks.length }}/5</b>
            </button>
          </div>
          <span v-if="!peakRevealed"><Eye :size="14" />仅显示当前操作方阵容</span>
          <span v-else><Eye :size="14" />双方阵容已揭晓</span>
        </div>

        <div v-if="isAiGame && aiNote" class="ai-note-line" :class="aiSide">
          <Bot :size="13" />
          <span><b>{{ aiName }}</b> 上一手：{{ aiNote }}</span>
        </div>

        <HeroPool
          v-if="!complete"
          :heroes="heroes"
          :unavailable-reasons="unavailableReasons"
          :selected-id="selectedHeroId"
          :action-type="activeType"
          :side-name="sideName(activeSide)"
          :complete="complete"
          :blue-bans="blueBans"
          :red-bans="redBans"
          :has-next-game="!isSeriesEnd"
          :locked="poolLocked"
          :locked-label="`${aiName} 正在思考`"
          @select="selectedHeroId = $event"
        />

        <LineupBoard
          v-else
          :blue-name="blueName"
          :red-name="redName"
          :blue-picks="bluePicks"
          :red-picks="redPicks"
          :blue-lanes="blueLanes"
          :red-lanes="redLanes"
          :blue-hidden="currentGame.isPeak && !peakRevealed && peakSide !== 'blue'"
          :red-hidden="currentGame.isPeak && !peakRevealed && peakSide !== 'red'"
          @assign="handleLaneAssign"
          @auto="autoLanes"
        />

        <div v-if="error" class="draft-error">{{ error }}</div>

        <footer class="action-dock" :class="[activeSide, { complete }]">
          <template v-if="!complete">
            <div v-if="selectedHero" class="selected-summary">
              <img :src="selectedHero.avatar" :alt="selectedHero.name">
              <div>
                <span>当前{{ activeType === 'ban' ? '禁用' : '选择' }} · {{ sideName(activeSide) }}</span>
                <strong>{{ selectedHero.name }}</strong>
              </div>
              <em class="selected-tag">{{ CLASS_NAMES[selectedHero.classId] }} · {{ selectedHero.laneIds.map(id => LANE_NAMES[id]).join(' / ') }}</em>
            </div>
            <div v-else class="selection-placeholder">
              <span class="mouse-icon" />
              <div v-if="poolLocked">
                <strong>{{ aiName }} 正在禁选</strong><span>对手决策完成后会自动落子，无需操作</span>
              </div>
              <div v-else>
                <strong>从上方选择一名英雄</strong><span>点击英雄卡片预览，再确认操作</span>
              </div>
            </div>
            <button class="confirm-action" :disabled="!selectedHero || poolLocked" @click="selectedHero && confirmHero(selectedHero.id)">
              <ShieldBan v-if="activeType === 'ban'" :size="18" />
              <Swords v-else :size="18" />
              {{ activeSide === 'blue' ? '蓝方' : '红方' }}确认{{ activeType === 'ban' ? '禁用' : '选择' }}
            </button>
          </template>
          <template v-else>
            <div class="complete-summary">
              <span class="complete-icon"><Swords :size="20" /></span>
              <div><strong>双方阵容已确定</strong><span>可进入下一局，或生成 DeepSeek 结构化复盘</span></div>
            </div>
            <div class="complete-actions">
              <button v-if="currentGame.isPeak && !peakRevealed" class="reveal-button" @click="peakRevealed = true"><Eye :size="17" />揭晓阵容</button>
              <button v-if="!isSeriesEnd" class="next-game" @click="nextGame">进入第 {{ currentGame.number + 1 }} 局<ArrowRight :size="17" /></button>
              <button class="review-button" @click="openReview"><BrainCircuit :size="18" />AI 阵容复盘</button>
            </div>
          </template>
        </footer>
      </section>

      <TeamPanel
        side="red"
        :name="redName"
        :picks="redPicks"
        :bans="redBans"
        :global-used="redUsed"
        :ban-count="banCount"
        :active="!complete && activeSide === 'red'"
        :action-type="activeType"
        :is-peak="currentGame.isPeak"
        :hidden="currentGame.isPeak && !peakRevealed && peakSide !== 'red'"
        :reveal-pending="currentGame.isPeak && !peakRevealed"
        @update-name="redName = $event"
        @remove="removePeakHero('red', $event)"
      />
    </main>

    <section class="series-history">
      <header><span><FileClock :size="15" />系列赛记录</span><b>{{ previousGames.length }} 局已归档 · 当前第 {{ currentGame.number }} 局</b></header>
      <div class="history-games">
        <article v-for="game in recordedGames" :key="game.number" :class="{ current: game.number === currentGame.number }">
          <div class="history-game-number"><span>GAME</span><strong>0{{ game.number }}</strong></div>
          <div class="history-lineup blue">
            <template v-for="(hero, index) in lineupSlots(game, 'blue')" :key="`${game.number}-b-${index}`">
              <img v-if="hero" :src="hero.avatar" :alt="hero.name" :title="hero.name">
              <span v-else class="lineup-empty" />
            </template>
          </div>
          <span class="history-vs">VS</span>
          <div class="history-lineup red">
            <template v-for="(hero, index) in lineupSlots(game, 'red')" :key="`${game.number}-r-${index}`">
              <img v-if="hero" :src="hero.avatar" :alt="hero.name" :title="hero.name">
              <span v-else class="lineup-empty" />
            </template>
          </div>
          <span class="history-state">{{ game.completedAt ? '已完成' : '进行中' }}</span>
        </article>
      </div>
    </section>

    <footer class="app-footer">
      <span>英雄数据与头像来源：王者荣耀官方网站 · 133 名英雄本地缓存</span>
      <span>BP 记录仅在当前页面会话中保留，可通过右上角导出 JSON</span>
    </footer>

    <ReviewModal v-if="reviewOpen" :snapshot="snapshot" :ai-configured="aiConfigured" @close="reviewOpen = false" />
  </div>
</template>
