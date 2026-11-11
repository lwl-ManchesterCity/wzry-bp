<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Activity,
  AlertCircle,
  BrainCircuit,
  Clock3,
  Database,
  Layers,
  LoaderCircle,
  RefreshCw,
  Shield,
  Sparkles,
  Swords,
  X,
} from 'lucide-vue-next'
import type { DraftReview, SeriesSnapshot, StatsBasis, StructureFinding, SynergyBasis } from '../types'

const props = defineProps<{
  snapshot: SeriesSnapshot
  aiConfigured: boolean
}>()

const emit = defineEmits<{ close: [] }>()
const review = ref<DraftReview | null>(null)
const statsBasis = ref<StatsBasis | null>(null)
const synergyBasis = ref<SynergyBasis | null>(null)
const loading = ref(false)
const error = ref('')
const responseModel = ref('')

function rateClass(rate: number | null) {
  if (rate === null) return ''
  if (rate >= 55) return 'high'
  if (rate <= 45) return 'low'
  return ''
}

const favoredText = computed(() => {
  if (!review.value) return ''
  if (review.value.verdict.favoredSide === 'even') return '双方均势'
  return review.value.verdict.favoredSide === 'blue'
    ? `${props.snapshot.blueName}阵容占优`
    : `${props.snapshot.redName}阵容占优`
})

const teamSections = computed(() => {
  if (!review.value) return []
  return [
    { side: 'blue', name: props.snapshot.blueName, data: review.value.blue },
    { side: 'red', name: props.snapshot.redName, data: review.value.red },
  ]
})

const basisSections = computed(() => {
  if (!statsBasis.value) return []
  return [
    { side: 'blue', name: props.snapshot.blueName, data: statsBasis.value.blue },
    { side: 'red', name: props.snapshot.redName, data: statsBasis.value.red },
  ]
})

// 客观协同结论优先展示，模型的解释挂到对应组合下；两者都来自服务端校验过的数据
const synergySections = computed(() => {
  if (!synergyBasis.value) return []
  const notes = review.value?.synergyNotes ?? []
  const build = (side: 'blue' | 'red', name: string) => {
    const data = synergyBasis.value![side]
    const cards = data.combos.map((combo) => ({
      ...combo,
      note: notes.find((note) => note.side === side && combo.heroes.every((hero) => note.combo.includes(hero))),
    }))
    const priority = (finding: StructureFinding) => {
      if (finding.title.includes('保护')) return 0
      return finding.level === 'weak' ? 1 : 2
    }
    const topFindings = [...data.findings].sort((a, b) => priority(a) - priority(b)).slice(0, 4)
    return { side, name, cards, broken: data.broken, structure: data.structure, topFindings }
  }
  return [build('blue', props.snapshot.blueName), build('red', props.snapshot.redName)]
})

const crossNotes = computed(() => synergyBasis.value?.crossNotes ?? [])

const AXIS_LABEL: Record<string, string> = {
  lane: '线上优势',
  skirmish: '小规模团战',
  rotate: '支援能力',
  teamfight: '团战优势',
  siege: '推进能力',
}

const axisRows = computed(() => {
  const axes = synergyBasis.value?.axes
  if (!axes) return []
  return Object.entries(AXIS_LABEL).map(([key, label]) => ({ key, label, ...axes[key as keyof typeof axes] }))
})

const laneRows = computed(() => synergyBasis.value?.lanes ?? [])
const axisNotes = computed(() => synergyBasis.value?.axisNotes ?? [])

async function requestReview() {
  loading.value = true
  error.value = ''
  review.value = null
  statsBasis.value = null
  synergyBasis.value = null
  try {
    const response = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(props.snapshot),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error || `请求失败（${response.status}）`)
    review.value = result.review as DraftReview
    statsBasis.value = (result.statsBasis as StatsBasis) ?? null
    synergyBasis.value = (result.synergyBasis as SynergyBasis) ?? null
    responseModel.value = result.model
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '网络异常，请检查本地服务'
  } finally {
    loading.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !loading.value) emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="modal-backdrop" @click.self="!loading && emit('close')">
    <section class="review-modal" role="dialog" aria-modal="true" aria-label="AI 阵容复盘">
      <header class="review-header">
        <div class="review-title">
          <span class="review-logo"><BrainCircuit :size="23" /></span>
          <div>
            <span>DEEPSEEK MATCH REVIEW</span>
            <h2>AI 阵容复盘</h2>
          </div>
        </div>
        <div class="review-header-meta">
          <span>第 {{ snapshot.currentGame.number }} 局 · BO{{ snapshot.settings.format }}</span>
          <button :disabled="loading" title="关闭" @click="emit('close')"><X :size="20" /></button>
        </div>
      </header>

      <div class="review-body">
        <div v-if="!review && !loading" class="review-intro">
          <div class="intro-orb"><Sparkles :size="34" /></div>
          <span class="eyebrow">CURRENT DRAFT ANALYSIS</span>
          <h3>从阵容组合到对局策略</h3>
          <p>DeepSeek 将基于本局完整 Ban/Pick 顺序、双方阵容及全局 BP 历史生成结构化复盘。</p>
          <div class="analysis-scope">
            <span>阵容强弱期</span>
            <span>分路与联动</span>
            <span>胜负倾向</span>
            <span>分阶段打法</span>
          </div>
          <div class="review-disclaimer">
            胜率百分比仅表示模型对阵容的主观判断，不代表真实统计胜率。
          </div>
          <div v-if="error" class="review-error"><AlertCircle :size="18" /><span>{{ error }}</span></div>
          <button class="generate-review" @click="requestReview">
            <Sparkles :size="18" />
            {{ error ? '重新生成复盘' : '生成 AI 复盘' }}
          </button>
          <span v-if="!aiConfigured" class="config-hint">当前服务端尚未配置密钥，点击后可查看配置提示</span>
        </div>

        <div v-else-if="loading" class="review-loading">
          <LoaderCircle :size="40" class="spin" />
          <h3>正在分析双方阵容</h3>
          <p>评估对线、阵容联动、强势期与获胜条件…</p>
        </div>

        <template v-else-if="review">
          <section class="verdict-card">
            <div class="verdict-topline">
              <span><Swords :size="15" />综合阵容判断</span>
              <span>置信度：{{ review.verdict.confidence }}<template v-if="responseModel"> · {{ responseModel }}</template></span>
            </div>
            <div class="verdict-main">
              <div class="win-team blue">
                <span>{{ snapshot.blueName }}</span>
                <strong>{{ review.verdict.blueWinRate }}<small>%</small></strong>
              </div>
              <div class="verdict-center">
                <span>阵容倾向</span>
                <b>{{ favoredText }}</b>
              </div>
              <div class="win-team red">
                <span>{{ snapshot.redName }}</span>
                <strong>{{ review.verdict.redWinRate }}<small>%</small></strong>
              </div>
            </div>
            <div class="win-rate-track">
              <i :style="{ width: `${review.verdict.blueWinRate}%` }" />
            </div>
            <p>{{ review.verdict.summary }}</p>
          </section>

          <section v-if="axisRows.length" class="axis-basis">
            <header class="synergy-head">
              <h3><Activity :size="16" />五轴对局模型</h3>
              <span>0-100 为相对五人上限 · 两侧独立计分</span>
            </header>

            <div class="axis-list">
              <div v-for="row in axisRows" :key="row.key" class="axis-row">
                <span class="axis-label">{{ row.label }}</span>
                <div class="axis-bars">
                  <span class="bar-track"><i class="blue" :style="{ width: `${row.blue}%` }" /></span>
                  <span class="bar-track"><i class="red" :style="{ width: `${row.red}%` }" /></span>
                </div>
                <span class="axis-num"><b class="blue">{{ row.blue }}</b><em>/</em><b class="red">{{ row.red }}</b></span>
                <span class="axis-lead" :class="Math.abs(row.diff) < 6 ? 'even' : row.diff > 0 ? 'blue' : 'red'">
                  {{ Math.abs(row.diff) < 6 ? '接近' : `${row.diff > 0 ? '蓝 +' : '红 +'}${Math.abs(row.diff)}` }}
                </span>
              </div>
            </div>

            <div class="lane-grid">
              <div v-for="(lane, index) in laneRows" :key="index" class="lane-row">
                <span class="lane-name">{{ lane.lane }}</span>
                <span class="lane-side blue" :class="{ vacant: !lane.blue }" :title="lane.blue?.reasons.join('、')">
                  {{ lane.blue ? `${lane.blue.name} ${lane.blue.score}` : '无人' }}<i v-if="lane.blue && !lane.blue.natural" class="lane-off">补位</i>
                </span>
                <span class="lane-vs">vs</span>
                <span class="lane-side red" :class="{ vacant: !lane.red }" :title="lane.red?.reasons.join('、')">
                  {{ lane.red ? `${lane.red.name} ${lane.red.score}` : '无人' }}<i v-if="lane.red && !lane.red.natural" class="lane-off">补位</i>
                </span>
                <span class="lane-edge" :class="lane.vacant ? 'vacant' : lane.leader">
                  {{ lane.vacant ? '无对位' : lane.leader === 'even' ? '持平' : `${lane.leader === 'blue' ? '蓝 +' : '红 +'}${Math.abs(lane.edge)}` }}
                </span>
              </div>
            </div>

            <ul v-if="axisNotes.length" class="axis-notes">
              <li v-for="note in axisNotes" :key="note">{{ note }}</li>
            </ul>
          </section>

          <section v-if="synergySections.length" class="synergy-basis">
            <header class="synergy-head">
              <h3><Layers :size="16" />组合协同与结构</h3>
              <span>按英雄功能标签计算 · 不依赖模型判断</span>
            </header>
            <div class="synergy-rows">
              <div v-for="team in synergySections" :key="team.side" class="synergy-row" :class="team.side">
                <span class="synergy-side">{{ team.name }}</span>
                <div class="synergy-main">
                  <div
                    v-for="combo in team.cards"
                    :key="`${combo.name}-${combo.heroes.join()}`"
                    class="combo-card"
                    :class="combo.tier"
                  >
                    <div class="combo-top">
                      <span class="combo-tier">{{ combo.tier === 'strong' ? '强协同' : '条件协同' }}</span>
                      <b>{{ combo.heroes.join(' + ') }}</b>
                      <span class="combo-name">{{ combo.name }}</span>
                      <span v-if="combo.source === 'derived'" class="combo-src">机制推导</span>
                    </div>
                    <p v-if="combo.note?.impact" class="combo-impact">{{ combo.note.impact }}</p>
                    <p v-else class="combo-impact">{{ combo.mechanism }}</p>
                    <p v-if="combo.note?.counter" class="combo-counter">对手应对：{{ combo.note.counter }}</p>
                  </div>

                  <div v-for="item in team.broken" :key="`${item.held}-${item.missing}`" class="combo-broken">
                    <span>被拆</span>
                    <p><b>{{ item.held }}</b> 的「{{ item.name }}」因 <b>{{ item.missing }}</b> 被禁用而无法成立</p>
                  </div>

                  <p v-if="!team.cards.length && !team.broken.length" class="combo-empty">未形成记录在案的成型搭配</p>

                  <div class="struct-metrics">
                    <span>前排 <b>{{ team.structure.front }}</b>/15</span>
                    <span>硬开团 <b>{{ team.structure.engageCount }}</b></span>
                    <span>保人 <b>{{ team.structure.peelCount }}</b></span>
                    <span>消耗 <b>{{ team.structure.pokeScore }}</b></span>
                    <span>控制 <b>{{ team.structure.controlScore }}</b></span>
                    <span>机动 <b>{{ team.structure.mobilityAvg }}</b></span>
                  </div>

                  <ul class="struct-findings">
                    <li v-for="finding in team.topFindings" :key="finding.title" :class="finding.level">
                      <b>{{ finding.title }}</b>
                      <em>{{ finding.detail }}</em>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <ul v-if="crossNotes.length" class="synergy-cross">
              <li v-for="note in crossNotes" :key="note">{{ note }}</li>
            </ul>
          </section>

          <section v-if="statsBasis" class="stats-basis">
            <header class="stats-head">
              <h3><Database :size="16" />分析依据</h3>
              <span>{{ statsBasis.seasonName }} · {{ statsBasis.seasonRange }} · 数据截至 {{ statsBasis.fetchedAt }}</span>
            </header>
            <div class="stats-rows">
              <div v-for="team in basisSections" :key="team.side" class="stats-row" :class="team.side">
                <span class="stats-side">{{ team.name }}</span>
                <div class="stats-chips">
                  <div
                    v-for="hero in team.data.picks"
                    :key="hero.heroId"
                    class="stat-chip"
                    :class="{ thin: hero.games > 0 && hero.games < 15 }"
                    :title="hero.lane ? `${hero.job} · ${hero.lane}` : hero.job"
                  >
                    <b>{{ hero.name }}</b>
                    <span v-if="hero.games" :class="rateClass(hero.winRate)">{{ hero.games }} 场 · {{ hero.winRate }}%</span>
                    <span v-else class="stat-none">未登场</span>
                  </div>
                </div>
              </div>
            </div>
            <p class="stats-note">
              数据来自 {{ statsBasis.source }}，为职业赛事样本；虚线框表示出场不足 15 场。胜率同时受队伍实力影响，不等同于英雄强度。
            </p>
          </section>

          <div class="team-review-grid">
            <section v-for="team in teamSections" :key="team.side" class="team-review" :class="team.side">
              <h3><Shield :size="18" />{{ team.name }}</h3>
              <div class="review-columns">
                <div>
                  <h4>阵容优势</h4>
                  <ul class="strengths"><li v-for="item in team.data.strengths" :key="item">{{ item }}</li></ul>
                </div>
                <div>
                  <h4>潜在短板</h4>
                  <ul class="weaknesses"><li v-for="item in team.data.weaknesses" :key="item">{{ item }}</li></ul>
                </div>
              </div>
              <div class="timing"><Clock3 :size="15" /><div><b>关键节奏</b><p>{{ team.data.keyTiming }}</p></div></div>
              <div class="gameplan">
                <h4>推荐打法</h4>
                <ol><li v-for="item in team.data.gameplan" :key="item">{{ item }}</li></ol>
              </div>
            </section>
          </div>

          <section v-if="review.matchups.length" class="matchup-section">
            <h3><Swords :size="18" />关键对位与联动</h3>
            <div class="matchup-grid">
              <article v-for="item in review.matchups" :key="item.title">
                <h4>{{ item.title }}<span v-if="item.unverified" class="matchup-flag">未引用事实</span></h4>
                <p>{{ item.analysis }}</p>
              </article>
            </div>
          </section>

          <section v-if="review.keyFactors.length" class="key-factors">
            <h3>本场获胜条件</h3>
            <ul><li v-for="(item, index) in review.keyFactors" :key="item"><span>0{{ index + 1 }}</span>{{ item }}</li></ul>
          </section>

          <div class="review-footer">
            <span>AI 结论仅供阵容讨论，实际对局还受选手状态、版本与执行影响。</span>
            <button :disabled="loading" @click="requestReview"><RefreshCw :size="15" />重新分析</button>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
