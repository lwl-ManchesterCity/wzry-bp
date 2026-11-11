import express from 'express'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSynergyEngine } from './synergy.mjs'
import { AXIS_LABEL, createMatchupModel } from './matchup.mjs'
import { buildDecisionContext, createDraftAdvisor } from './ai-draft.mjs'
import { DRAFT_STYLES, seededUnit, styleForGame } from '../shared/styles.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const heroes = JSON.parse(await readFile(path.join(root, 'src/data/heroes.json'), 'utf8'))
const heroMap = new Map(heroes.map((hero) => [hero.id, hero]))

// 赛季数据缺失时降级为纯阵容分析，不阻塞服务启动
let kplStats = null
try {
  kplStats = JSON.parse(await readFile(path.join(root, 'src/data/kpl-stats.json'), 'utf8'))
} catch {
  console.warn('未找到 src/data/kpl-stats.json，复盘将不含赛季数据参考')
}

// 协同知识库：英雄能力标签 + 经典组合，缺文件时组合分析整体降级
let synergyEngine = null
let matchupModel = null
// AI 决策要直接读原始标签（思路加权、临场针对都靠它），所以留一份引用
let synergyRaw = null
let macroRaw = null
try {
  const synergy = JSON.parse(await readFile(path.join(root, 'src/data/hero-synergy.json'), 'utf8'))
  synergyRaw = synergy
  // macro 七维（持续输出/范围/清线/推进/绕后/对线/抗控）缺失时，机制推导与五轴分析降级
  let macro = null
  try {
    macro = JSON.parse(await readFile(path.join(root, 'src/data/hero-macro.json'), 'utf8'))
  } catch {
    console.warn('未找到 src/data/hero-macro.json，组合推导与五轴分析将不可用')
  }
  macroRaw = macro
  synergyEngine = createSynergyEngine({ synergy, heroes, macro })
  if (macro) matchupModel = createMatchupModel({ synergy, heroes, macro })
} catch (error) {
  console.warn('未找到 src/data/hero-synergy.json，复盘将不含组合协同分析', error)
}

const app = express()
app.use(express.json({ limit: '256kb' }))

// 排除 .env.example 里的占位符，避免误判为"已配置"后请求返回 401
const apiKey = () => {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) return ''
  if (/^sk-x{6,}$/i.test(key) || key.includes('xxxxxxxx')) return ''
  return key
}
const baseUrl = () => (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const model = () => process.env.DEEPSEEK_MODEL || 'deepseek-chat'

app.get('/api/health', (_request, response) => {
  response.json({ configured: Boolean(apiKey()), model: model() })
})

function heroLine(id) {
  const hero = heroMap.get(id)
  if (!hero) throw new Error(`未知英雄 ID：${id}`)
  return `${hero.name}（${hero.title}，英雄ID ${hero.id}）`
}

function serializeGame(game) {
  if (!game || !Array.isArray(game.actions)) throw new Error('小局数据格式错误')
  return {
    number: Number(game.number),
    isPeak: Boolean(game.isPeak),
    blueBans: game.actions.filter((a) => a.side === 'blue' && a.type === 'ban').map((a) => heroLine(a.heroId)),
    redBans: game.actions.filter((a) => a.side === 'red' && a.type === 'ban').map((a) => heroLine(a.heroId)),
    bluePicks: game.actions.filter((a) => a.side === 'blue' && a.type === 'pick').map((a) => heroLine(a.heroId)),
    redPicks: game.actions.filter((a) => a.side === 'red' && a.type === 'pick').map((a) => heroLine(a.heroId)),
    actionOrder: game.actions.map((a) => `${a.side === 'blue' ? '蓝方' : '红方'}${a.type === 'ban' ? '禁用' : '选择'}${heroLine(a.heroId)}`),
  }
}

// 模型偶尔会夹带 <|endoftext|> 之类的特殊 token 或代码块包裹，解析前先清洗
function parseModelJson(content) {
  const text = String(content || '')
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/^```(?:json)?\s*|\s*```$/g, '')
    .trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

// 模型对组合的解释必须落在程序检测出的组合上，避免它编造不存在的搭配
function matchDetectedCombo(text, detected) {
  const value = String(text || '')
  return detected.find((item) => item.heroes.every((name) => value.includes(name)))
}

function normalizeReview(value, detectedCombos = [], allowedKeys = new Set()) {
  if (!value || typeof value !== 'object') throw new Error('模型未返回 JSON 对象')
  const blueWinRate = Math.max(0, Math.min(100, Number(value.verdict?.blueWinRate)))
  if (!Number.isFinite(blueWinRate)) throw new Error('模型缺少有效的胜率倾向')
  return {
    verdict: {
      favoredSide: ['blue', 'red', 'even'].includes(value.verdict?.favoredSide) ? value.verdict.favoredSide : 'even',
      blueWinRate: Math.round(blueWinRate),
      redWinRate: 100 - Math.round(blueWinRate),
      confidence: String(value.verdict?.confidence || '中'),
      summary: String(value.verdict?.summary || ''),
    },
    blue: normalizeTeam(value.blue),
    red: normalizeTeam(value.red),
    synergyNotes: Array.isArray(value.synergyNotes)
      ? value.synergyNotes
          .map((item) => {
            const matched = matchDetectedCombo(item?.combo, detectedCombos)
            if (!matched) return null
            return {
              side: matched.side,
              combo: matched.heroes.join(' + '),
              name: matched.name,
              tier: matched.tier,
              impact: String(item?.impact || ''),
              counter: String(item?.counter || ''),
            }
          })
          .filter(Boolean)
          .slice(0, 8)
      : [],
    // 只接受事实块里真实存在的编号；模型自己编的 key 会被剔掉并标记，供前端提示
    matchups: Array.isArray(value.matchups) ? value.matchups.slice(0, 6).map((item) => {
      const raw = Array.isArray(item?.factKeys) ? item.factKeys.map(String) : []
      const valid = raw.filter((key) => allowedKeys.has(key))
      return {
        title: String(item?.title || '关键对位'),
        analysis: String(item?.analysis || ''),
        factKeys: valid.slice(0, 4),
        unverified: valid.length === 0,
        droppedKeys: raw.length - valid.length,
      }
    }) : [],
    keyFactors: Array.isArray(value.keyFactors) ? value.keyFactors.slice(0, 8).map(String) : [],
  }
}

function normalizeTeam(team) {
  return {
    strengths: Array.isArray(team?.strengths) ? team.strengths.slice(0, 6).map(String) : [],
    weaknesses: Array.isArray(team?.weaknesses) ? team.weaknesses.slice(0, 6).map(String) : [],
    gameplan: Array.isArray(team?.gameplan) ? team.gameplan.slice(0, 8).map(String) : [],
    keyTiming: String(team?.keyTiming || ''),
  }
}

function statOf(heroId) {
  if (!kplStats) return null
  return kplStats.heroes[String(heroId)] || null
}

function statsLine(heroId) {
  const hero = heroMap.get(heroId)
  const stat = statOf(heroId)
  const name = hero?.name || stat?.name || `英雄${heroId}`
  if (!stat) return `${name}：无本赛季数据`
  const tag = [stat.job, stat.lane].filter(Boolean).join('/')
  const prefix = tag ? `${name}（${tag}）` : name
  if (!stat.games) return `${prefix}：本赛季未登场，无胜率样本`
  return `${prefix}：出场 ${stat.games} 场，胜率 ${stat.winRate}%`
}

// 把本局相关的赛季数据整理成给模型阅读的事实块
function buildStatsBlock(game) {
  if (!kplStats) return ''
  const of = (side, type) => game.actions.filter((a) => a.side === side && a.type === type).map((a) => a.heroId)
  const lines = [
    `【赛季数据】${kplStats.seasonName}（${kplStats.season}），统计区间 ${kplStats.seasonRange}，` +
      `来源 ${kplStats.source}，数据截至 ${kplStats.fetchedAt}，样本为 KPL 职业赛事对局。`,
    '',
    '蓝方选用：',
    ...of('blue', 'pick').map((id) => `- ${statsLine(id)}`),
    '红方选用：',
    ...of('red', 'pick').map((id) => `- ${statsLine(id)}`),
  ]
  const blueBans = of('blue', 'ban')
  const redBans = of('red', 'ban')
  if (blueBans.length || redBans.length) {
    lines.push('', '本局禁用：')
    if (blueBans.length) lines.push(`- 蓝方禁用：${blueBans.map((id) => statsLine(id)).join('；')}`)
    if (redBans.length) lines.push(`- 红方禁用：${redBans.map((id) => statsLine(id)).join('；')}`)
  }
  lines.push(
    '',
    '数据使用要求：',
    '- 引用上述数字时须同时说明出场场次；出场少于 15 场的英雄须注明样本有限。',
    '- 胜率同时受队伍实力与对阵环境影响，不能直接等同于英雄强度。',
    '- 标注「本赛季未登场」的英雄没有任何样本，不得为其编造胜率、热度或优先级。',
    '- 本数据不含禁用率，禁止推测或编造 Ban 率。',
    '- 赛季数据只作为参考依据，最终判断仍需结合阵容结构与英雄克制关系。',
  )
  return lines.join('\n')
}

// 返回给前端用于核对模型引用的原始数字
function buildStatsBasis(game) {
  if (!kplStats) return null
  const collect = (side, type) =>
    game.actions
      .filter((a) => a.side === side && a.type === type)
      .map((a) => {
        const stat = statOf(a.heroId)
        return {
          heroId: a.heroId,
          name: heroMap.get(a.heroId)?.name || stat?.name || String(a.heroId),
          job: stat?.job || '',
          lane: stat?.lane || '',
          games: stat?.games ?? 0,
          winRate: stat?.winRate ?? null,
        }
      })
  return {
    season: kplStats.season,
    seasonName: kplStats.seasonName,
    seasonRange: kplStats.seasonRange,
    source: kplStats.source,
    sourceUrl: kplStats.sourceUrl,
    fetchedAt: kplStats.fetchedAt,
    blue: { picks: collect('blue', 'pick'), bans: collect('blue', 'ban') },
    red: { picks: collect('red', 'pick'), bans: collect('red', 'ban') },
  }
}

// 组合与结构的程序化分析：结论由代码算出，模型只负责解释
function analyzeSynergy(game, lineups = null) {
  if (!synergyEngine) return null
  const pickIds = (side) => game.actions.filter((a) => a.side === side && a.type === 'pick').map((a) => a.heroId)
  const banIds = (side) => game.actions.filter((a) => a.side === side && a.type === 'ban').map((a) => a.heroId)
  // 本方被拆的组合，来自对方对自己的禁用
  const blue = synergyEngine.analyzeTeam(pickIds('blue'), banIds('red'))
  const red = synergyEngine.analyzeTeam(pickIds('red'), banIds('blue'))
  const analysis = { blue, red, crossNotes: synergyEngine.compareSides(blue, red), axes: null, lanes: null, axisNotes: [] }

  // 五轴与分路对位：把属性还原成对局优势，否则模型只能复述前排/控制这类静态指标
  if (matchupModel) {
    const manualOf = (side) => (lineups && typeof lineups[side] === 'object' ? lineups[side] : null)
    analysis.axes = matchupModel.compareAxes(pickIds('blue'), pickIds('red'))
    analysis.lanes = matchupModel.laneMatchups(
      pickIds('blue'),
      pickIds('red'),
      manualOf('blue'),
      manualOf('red'),
    )
    analysis.axisNotes = matchupModel.axisNotes(analysis.axes)
  }
  return analysis
}

function structureLine(structure) {
  const names = (list) => (list?.length ? `（${list.join('、')}）` : '')
  const damage = Object.entries(structure.damageMix)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${{ phys: '物理', magic: '法术', true: '真实', mixed: '混合' }[type]}${count}`)
    .join('/')
  return [
    `前排承伤 ${structure.front}/15`,
    `硬开团 ${structure.engageCount} 人${names(structure.hardEngage)}`,
    `保人型 ${structure.peelCount} 人${names(structure.protectors)}`,
    `远程消耗 ${structure.pokeScore}`,
    `爆发型 ${structure.burstCount} 人`,
    `控制 ${structure.controlScore}`,
    `机动均值 ${structure.mobilityAvg}`,
    `伤害分布 ${damage}`,
    `强势期 前中期${structure.phaseCount.early}/中期${structure.phaseCount.mid}/后期${structure.phaseCount.late}`,
  ].join('，')
}

function teamSynergyLines(label, analysis, side) {
  const lines = [`${label}：`]
  const strong = analysis.combos.filter((combo) => combo.tier === 'strong')
  const conditional = analysis.combos.filter((combo) => combo.tier === 'conditional')
  const keyOf = (combo) => `combo.${side}.${analysis.combos.indexOf(combo)}`

  if (strong.length) {
    lines.push('  · 成型的强协同：')
    for (const combo of strong) {
      lines.push(`    - [${keyOf(combo)}] ${combo.heroes.join(' + ')}（${combo.name}）：${combo.mechanism}`)
    }
  }
  if (conditional.length) {
    lines.push('  · 条件协同（需满足前提才成立）：')
    for (const combo of conditional) {
      lines.push(`    - [${keyOf(combo)}] ${combo.heroes.join(' + ')}（${combo.name}），条件：${combo.need || '阵容完整度'}；${combo.mechanism}`)
    }
  }
  if (!analysis.combos.length) lines.push('  · 未形成记录在案的成型搭配')

  if (analysis.broken.length) {
    lines.push('  · 被对方禁用拆掉的搭配：')
    for (const item of analysis.broken) {
      lines.push(`    - ${item.held} 的 ${item.name} 缺少 ${item.missing}，该组合无法成立`)
    }
  }

  lines.push(`  · [structure.${side}] 结构指标：${structureLine(analysis.structure)}`)
  if (analysis.findings.length) {
    lines.push('  · 结构结论（程序判定，可直接引用）：')
    for (const finding of analysis.findings) {
      lines.push(`    - [${finding.level === 'strong' ? '优势' : '短板'}] ${finding.title}：${finding.detail}`)
    }
  }
  return lines
}

function buildSynergyBlock(analysis) {
  if (!analysis) return ''
  const lines = [
    '【阵容协同与结构】以下内容由程序依据英雄定位标签计算得出，属于确定事实，不需要你重新推导，但必须解释它的实战含义。行首方括号内的编号是该条事实的 factKey，引用时必须原样写出。',
    '',
    ...teamSynergyLines('蓝方', analysis.blue, 'blue'),
    '',
    ...teamSynergyLines('红方', analysis.red, 'red'),
  ]
  if (analysis.crossNotes.length) {
    lines.push('', '双方对照：', ...analysis.crossNotes.map((note) => `- ${note}`))
  }
  lines.push(
    '',
    '使用要求：',
    '- 标签是结构化定位摘要，代表"这个英雄能提供什么功能"，不是技能数值；若与你对英雄的理解冲突，以实际技能为准，但不得因此忽略组合结论。',
    '- 组合库只收录机制明确的常见搭配，另外一部分由英雄功能标签在运行时推导；两类都代表该协同客观存在，必须体现。',
  )
  return lines.join('\n')
}

/** 五轴与逐路对位，把「属性」翻译成「这局谁在哪方面占优」 */
function buildMatchupBlock(analysis) {
  if (!analysis?.axes) return { text: '（本次未提供五轴对局模型）', keys: [] }
  const keys = []
  const lines = [
    '【五轴对局模型】程序按英雄功能标签计算，0-100 是相对单人满分的五人上限，两侧独立计分，不相加为 100。分值接近时应当明确说「接近」，不要硬造差距。',
  ]
  for (const key of ['lane', 'skirmish', 'rotate', 'teamfight', 'siege']) {
    const item = analysis.axes[key]
    if (!item) continue
    const factKey = `axes.${key}`
    keys.push(factKey)
    const lead = Math.abs(item.diff) < 6 ? '两队接近' : item.diff > 0 ? `蓝方领先 ${item.diff}` : `红方领先 ${-item.diff}`
    lines.push(
      `- [${factKey}] ${AXIS_LABEL[key]}：蓝 ${item.blue} / 红 ${item.red}，${lead}；蓝方主要贡献 ${item.blueDrivers.join('、') || '—'}，红方主要贡献 ${item.redDrivers.join('、') || '—'}`,
    )
  }

  if (analysis.lanes?.length) {
    lines.push('', '【逐路对位】分路以教练排布为准（未手动排布时按主路自动落位），标「补位」表示该英雄本局不站自己最擅长的分路，评价这条线时要考虑这一点；标「无人」表示该路没有对位英雄，不能编造对位关系。')
    analysis.lanes.forEach((row, index) => {
      const factKey = `lanes.${index}`
      keys.push(factKey)
      const label = (item) => `${item.name}（${item.score}${item.natural ? '' : '，补位'}）`
      const b = row.blue ? `蓝方 ${label(row.blue)}` : '蓝方无人'
      const r = row.red ? `红方 ${label(row.red)}` : '红方无人'
      if (row.vacant) {
        lines.push(`- [${factKey}] ${row.lane}：${b} vs ${r}，不存在对位压制关系`)
        return
      }
      const lead = row.leader === 'even' ? '双方持平' : `${row.leader === 'blue' ? '蓝方' : '红方'}领先 ${Math.abs(row.edge)}`
      const why = row.driver.length ? `；依据：${row.driver.join('、')}` : ''
      lines.push(`- [${factKey}] ${row.lane}：${b} vs ${r}，${lead}${why}`)
    })
  }

  if (analysis.axisNotes?.length) {
    lines.push('', '五轴结论：', ...analysis.axisNotes.map((note) => `- ${note}`))
  }
  return { text: lines.join('\n'), keys }
}

// 返回给前端用于核对的结构化分析
function buildSynergyBasis(analysis) {
  if (!analysis) return null
  const pick = (side) => ({
    combos: side.combos,
    broken: side.broken,
    structure: side.structure,
    findings: side.findings,
  })
  return {
    blue: pick(analysis.blue),
    red: pick(analysis.red),
    crossNotes: analysis.crossNotes,
    axes: analysis.axes,
    lanes: analysis.lanes,
    axisNotes: analysis.axisNotes,
  }
}

/** 收集本轮事实块里真实存在的 factKey，供服务端校验模型引用 */
function collectFactKeys(analysis) {
  if (!analysis) return new Set()
  const keys = new Set(['structure.blue', 'structure.red'])
  for (const side of ['blue', 'red']) {
    analysis[side].combos.forEach((_, index) => keys.add(`combo.${side}.${index}`))
  }
  if (analysis.axes) for (const key of Object.keys(analysis.axes)) keys.add(`axes.${key}`)
  if (analysis.lanes) analysis.lanes.forEach((_, index) => keys.add(`lanes.${index}`))
  return keys
}

// 人机对战的决策引擎；协同数据缺失时整个功能降级为不可用
const advisor = synergyEngine
  ? createDraftAdvisor({ heroes, heroMap, kplStats, synergyEngine, synergy: synergyRaw, macro: macroRaw })
  : null

const slimCandidates = (candidates) =>
  candidates.map((item) => ({
    heroId: item.id,
    name: item.name,
    lane: item.lane,
    score: Math.round(item.score),
    reasons: item.reasons,
  }))

app.post('/api/ai-draft', async (request, response) => {
  try {
    const { settings, blueName, redName, currentGame, available, side, type, seed, previousGames, seriesIndex } = request.body || {}
    if (!Array.isArray(available) || !available.length) {
      return response.status(400).json({ error: '缺少可用英雄列表' })
    }
    if (!['blue', 'red'].includes(side) || !['ban', 'pick'].includes(type)) {
      return response.status(400).json({ error: '缺少行动方或行动类型' })
    }
    if (!advisor) {
      return response.status(503).json({ error: '组合协同数据缺失，无法启用 AI 对手' })
    }

    const actions = Array.isArray(currentGame?.actions) ? currentGame.actions : []
    const picksOf = (target) =>
      actions.filter((action) => action.side === target && action.type === 'pick').map((action) => Number(action.heroId))
    const myPicks = picksOf(side)
    const oppSide = side === 'blue' ? 'red' : 'blue'
    const oppPicks = picksOf(oppSide)

    const gameNumber = Number(currentGame?.number) || 1
    const step = actions.length
    // 本局思路：同一系列赛按局号轮转，第 2 局不会继续用第 1 局的打法
    const style = styleForGame(seed, gameNumber, seriesIndex)
    // 系列赛记忆：前几局用过的英雄，非全局 BP 时避免整套照抄
    const history = Array.isArray(previousGames) ? previousGames : []
    const memory = history
      .flatMap((game) => (Array.isArray(game?.actions) ? game.actions : []))
      .filter((action) => action.side === side && action.type === 'pick')
      .map((action) => heroMap.get(Number(action.heroId))?.name)
      .filter(Boolean)

    // 选人看这套阵容对我方还缺什么；禁人看对手拿到它会强多少
    const teamPicks = type === 'ban' ? oppPicks : myPicks
    const candidates = advisor.rank({
      teamPicks,
      available: available.map(Number),
      myPicks,
      oppPicks,
      avoid: memory.map((name) => heroes.find((hero) => hero.name === name)?.id).filter(Boolean),
      limit: 8,
      mode: type,
      style,
      seed: String(seed ?? 'default'),
      step,
    })
    if (!candidates.length) return response.status(400).json({ error: '没有可用的候选英雄' })

    const ordinal = actions.filter((action) => action.side === side && action.type === type).length + 1
    const sideName = side === 'blue' ? String(blueName || '蓝色方') : String(redName || '红色方')
    const nameOf = (id) => heroMap.get(Number(id))?.name || String(id)
    const styleInfo = { key: style.key, label: style.label, summary: style.summary }

    // 规则引擎兜底落子
    const ruleChoice = {
      heroId: candidates[0].id,
      heroName: candidates[0].name,
      reason: candidates[0].reasons.slice(0, 2).join('，') || `按「${style.label}」思路选择`,
      engine: 'rules',
      style: styleInfo,
      shortlist: slimCandidates(candidates),
    }

    // 未配置密钥时仍可对战，只是由规则引擎直接落子
    if (!apiKey()) return response.json(ruleChoice)

    // 候选顺序按种子打散：模型有「优先选第一条」的倾向，固定顺序等于固定答案
    const ordered = candidates
      .map((item) => ({ item, key: seededUnit(String(seed ?? 'default'), 'order', step, item.id) }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.item)

    const decision = buildDecisionContext({
      type,
      side,
      sideName,
      gameNumber,
      picks: myPicks.map(nameOf),
      oppPicks: oppPicks.map(nameOf),
      candidates: ordered,
      banCount: ordinal,
      style,
      memory: [...new Set(memory)],
    })

    const styleGuide = type === 'ban' ? style.banHint : style.pickHint
    const systemPrompt = `你是一名 KPL 职业教练，正在替${sideName}完成禁选。
${decision}

本局你的思路是「${style.label}」——${styleGuide}。
从候选中挑一个最合适的，按优先级考虑：
1. 是否符合本局思路（同样强的两个英雄，选更贴思路的那个）；
2. 组合协同——能与已选英雄组成成型体系的最优先；
3. 阵容补强——补前排、开团、保护、控制或伤害类型；
4. 分路覆盖——别让队伍缺位；
5. 禁人时要禁掉对手最想要、最能成型的英雄，但不要禁掉我方自己急需的。
候选顺序是打散的，不代表推荐度，别默认选第 1 条。
heroId 必须原样复制候选列表里给出的编号，绝不能自己编造；heroName 与之一致。
理由必须具体，点出协同关系或补强点，不超过 40 字，不要空话。
只输出一个 JSON 对象：{"heroId": 数字, "heroName": "候选里的英雄名", "reason": "简短理由"}`

    const llmResponse = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请给出第 ${ordinal} 手${type === 'ban' ? '禁用' : '选择'}。` },
        ],
        temperature: 0.95,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(20000),
    })

    const payload = await llmResponse.json().catch(() => null)
    const content = payload?.choices?.[0]?.message?.content
    if (!llmResponse.ok || !content) return response.json(ruleChoice)

    const parsed = parseModelJson(content)
    if (!parsed) return response.json(ruleChoice)

    // 模型只能从候选里挑，越界一律回落到规则首选，避免选出零前排的离谱阵容
    const chosenId = Number(parsed?.heroId)
    const chosenName = String(parsed?.heroName || '').trim()
    const matched = candidates.find((item) => item.id === chosenId)
      || (chosenName ? candidates.find((item) => item.name === chosenName) : null)
    if (!matched) return response.json(ruleChoice)

    return response.json({
      heroId: matched.id,
      heroName: matched.name,
      reason: String(parsed?.reason || '').slice(0, 80) || matched.reasons[0] || '按阵容需要选择',
      engine: 'deepseek',
      style: styleInfo,
      shortlist: slimCandidates(candidates),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return response.status(500).json({ error: `AI 决策失败：${message}` })
  }
})

app.post('/api/review', async (request, response) => {
  if (!apiKey()) {
    return response.status(503).json({
      error: '尚未配置 DeepSeek。请复制 .env.example 为 .env，填写 DEEPSEEK_API_KEY 后重启服务。',
    })
  }

  try {
    const { settings, blueName, redName, previousGames = [], currentGame, lineups = null } = request.body || {}
    if (!settings || !currentGame) return response.status(400).json({ error: '缺少 BP 数据' })
    const current = serializeGame(currentGame)
    if (current.bluePicks.length !== 5 || current.redPicks.length !== 5) {
      return response.status(400).json({ error: '双方均需完成 5 个英雄选择后才能复盘' })
    }

    const analysis = analyzeSynergy(currentGame, lineups)
    const matchupBlock = buildMatchupBlock(analysis)
    const allowedKeys = collectFactKeys(analysis)

    const context = {
      mode: settings.mode === 'global' ? '各队独立限制的全局BP' : '普通单局BP',
      format: `BO${settings.format}`,
      ruleset: settings.ruleset === 'kpl2026' ? 'KPL 2026 每方5 Ban' : '经典每方4 Ban',
      teams: { blue: String(blueName || '蓝色方'), red: String(redName || '红色方') },
      previousGames: previousGames.map(serializeGame),
      currentGame: current,
      synergy: buildSynergyBlock(analysis) || '（本次未提供组合协同数据）',
      matchup: matchupBlock.text,
      factKeys: [...allowedKeys],
      seasonStats: buildStatsBlock(request.body?.currentGame) || '（本次未提供赛季数据）',
    }

    const systemPrompt = `你是一名王者荣耀职业赛事教练与数据分析师，正在复盘一局真实BP。用户消息中，synergy 是程序依据英雄功能标签算出的组合协同与阵容结构，matchup 是五轴对局模型与逐路对位，两者都是确定事实；factKeys 是本轮允许引用的事实编号白名单；seasonStats 是单英雄赛季数据。

复盘必须按对局推进的顺序展开，而不是按属性罗列：
1. 【线上】用 matchup 的逐路对位逐路说清谁压谁、凭什么（线权、消耗、续航、抗压）。分值差小于 6 就写「接近」，不要硬造差距。
2. 【小规模团战】2-3 人的控制链与爆发衔接，谁先手、谁跟进，哪一路的 2v2/3v3 更强。
3. 【支援能力】转线速度与野区联动，谁能在关键节点先到，支援差如何转成资源差。
4. 【团战优势】开团主动权、前排承伤、保护链、抗控换位、伤害类型与范围，核心在团战里如何被保护或被抓。
5. 【推进能力】清线与点塔的组合，谁掌握兵线节奏、谁能分带牵制、谁必须抱团。
组合协同与阵容结构是贯穿这五段的解释工具，不是独立的第五节。

硬性要求：
- 每一条 matchups 必须给出 factKeys，取值只能来自 factKeys 白名单，且必须真实支撑该条结论；找不到对应事实的判断不要写进 matchups。
- 正文里不要出现 lanes.2、axes.lane 这类编号字符串，编号只放在 factKeys 字段；正文用人类可读的写法，例如「中路 19:13」。事实编号由前端负责展示。
- matchups 最多 6 条：逐路对位最多占 2 条（多路可合并写），必须为团战与推进各保留至少一条，不能只写线上。
- 引用组合时必须原样使用 synergy 给出的组合名（如「保护链」「封挡接消耗」），不得改名，也不得把两条不同组合合并成一句。
- 五段分析里至少三段要引用具体数值（例如「中路 19:13」「支援 60:50」），不能只写「占优」「压制」而不给依据。
- 严禁用「5个英雄胜率谁高」推导胜负结论；seasonStats 只用于校验，引用时必须带场次，少于 15 场须注明样本有限，未登场英雄不得编造数据，该数据不含 Ban 率。
- synergy 中列出的每一条成型搭配、条件协同与被拆搭配，都必须在 synergyNotes 中各占一条，写清谁因此获得输出或生存环境（impact）、对手应当如何应对（counter）。combo 字段只写英雄名。
- 不得编造 synergy 与 matchup 里不存在的组合、对位或数值；标「无人」的一路不得虚构对位关系。
- verdict 的百分比只表达主观倾向，不是统计胜率，双方总和必须为100，阵容接近时给50/50。

只输出一个合法JSON对象，不要使用Markdown或代码块，结构如下：
{"verdict":{"favoredSide":"blue|red|even","blueWinRate":50,"redWinRate":50,"confidence":"低|中|高","summary":"总体判断"},"blue":{"strengths":["优势"],"weaknesses":["短板"],"gameplan":["分阶段打法"],"keyTiming":"关键节奏"},"red":{"strengths":["优势"],"weaknesses":["短板"],"gameplan":["分阶段打法"],"keyTiming":"关键节奏"},"synergyNotes":[{"combo":"英雄A + 英雄B","impact":"这个协同带来了什么","counter":"对手如何应对"}],"matchups":[{"title":"线上/小规模团战/支援/团战/推进 中的一条","analysis":"具体分析","factKeys":["lanes.2","axes.lane"]}],"keyFactors":["决定胜负的因素"]}`

    const deepseekResponse = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(context) },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(90000),
    })

    const result = await deepseekResponse.json().catch(() => null)
    if (!deepseekResponse.ok) {
      const message = result?.error?.message || `DeepSeek HTTP ${deepseekResponse.status}`
      return response.status(502).json({ error: `DeepSeek 请求失败：${message}` })
    }
    const content = result?.choices?.[0]?.message?.content
    if (!content) return response.status(502).json({ error: 'DeepSeek 未返回复盘内容' })

    const parsed = parseModelJson(content)
    if (!parsed) {
      return response.status(502).json({ error: '模型返回格式无法解析，请重新生成复盘' })
    }
    const detectedCombos = analysis
      ? [
          ...analysis.blue.combos.map((combo) => ({ ...combo, side: 'blue' })),
          ...analysis.red.combos.map((combo) => ({ ...combo, side: 'red' })),
        ]
      : []
    return response.json({
      review: normalizeReview(parsed, detectedCombos, allowedKeys),
      model: model(),
      statsBasis: buildStatsBasis(currentGame),
      synergyBasis: buildSynergyBasis(analysis),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    const status = message.includes('未知英雄') || message.includes('格式') ? 400 : 500
    return response.status(status).json({ error: `复盘生成失败：${message}` })
  }
})

const dist = path.join(root, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.use((_request, response) => response.sendFile(path.join(dist, 'index.html')))
}

const port = Number(process.env.PORT || 3001)
app.listen(port, '127.0.0.1', () => {
  console.log(`BP 服务端已启动：http://127.0.0.1:${port}；DeepSeek ${apiKey() ? '已配置' : '待配置'}`)
})
