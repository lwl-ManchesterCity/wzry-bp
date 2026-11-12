/**
 * 验证 AI 对手「每局不一样」：
 * 用同一个固定的人类阵容脚本跑多局 BP，看 AI 的禁用与阵容是否随种子变化。
 * 直接调规则引擎（不经过模型），所以是离线、可复现的。
 *
 *   node scripts/check-ai-variety.mjs
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSynergyEngine } from '../server/synergy.mjs'
import { createDraftAdvisor } from '../server/ai-draft.mjs'
import { styleForGame } from '../shared/styles.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = async (name) => JSON.parse(await readFile(path.join(root, 'src/data', name), 'utf8'))
const heroes = await load('heroes.json')
const heroMap = new Map(heroes.map((hero) => [hero.id, hero]))
const kplStats = await load('kpl-stats.json')
const synergy = await load('hero-synergy.json')
const macro = await load('hero-macro.json')
const synergyEngine = createSynergyEngine({ synergy, heroes, macro })
const advisor = createDraftAdvisor({ heroes, heroMap, kplStats, synergyEngine, synergy, macro })

const KPL_STEPS = [
  ...Array.from({ length: 6 }, (_, i) => ({ side: i % 2 ? 'red' : 'blue', type: 'ban' })),
  { side: 'blue', type: 'pick' }, { side: 'red', type: 'pick' }, { side: 'red', type: 'pick' },
  { side: 'blue', type: 'pick' }, { side: 'blue', type: 'pick' }, { side: 'red', type: 'pick' },
  { side: 'red', type: 'ban' }, { side: 'blue', type: 'ban' }, { side: 'red', type: 'ban' }, { side: 'blue', type: 'ban' },
  { side: 'red', type: 'pick' }, { side: 'blue', type: 'pick' }, { side: 'blue', type: 'pick' }, { side: 'red', type: 'pick' },
]

// 固定的人类脚本：不管 AI 怎么变，蓝方（人）永远先拿这几个人，逼出「同样的输入 AI 是否给同样答案」
const HUMAN_SCRIPT = ['吕布', '镜', '不知火舞', '鲁班七号', '张飞']
const byName = new Map(heroes.map((hero) => [hero.name, hero.id]))

function simulate(seed, seriesIndex = 0, humanSide = 'blue') {
  const aiSide = humanSide === 'blue' ? 'red' : 'blue'
  const used = new Set()
  const picks = { blue: [], red: [] }
  const bans = { blue: [], red: [] }
  const humanQueue = [...HUMAN_SCRIPT]
  const style = styleForGame(seed, 1, seriesIndex)

  for (const step of KPL_STEPS) {
    const side = step.side
    const available = heroes.filter((hero) => !used.has(hero.id)).map((hero) => hero.id)
    if (side !== aiSide) {
      let heroId = null
      if (step.type === 'pick') {
        const wanted = humanQueue.shift()
        heroId = byName.get(wanted)
      }
      if (!heroId) {
        // 人类禁用/补位按「表里第一个还能用的」，只为让流程跑完
        heroId = available[0]
      }
      used.add(heroId)
      ;(step.type === 'pick' ? picks : bans)[side].push(heroId)
      continue
    }
    const teamPicks = step.type === 'ban' ? picks[humanSide] : picks[aiSide]
    const ranked = advisor.rank({
      teamPicks,
      available,
      myPicks: picks[aiSide],
      oppPicks: picks[humanSide],
      limit: 8,
      mode: step.type,
      style,
      seed,
      step: used.size,
    })
    const chosen = advisor.choose(ranked)
    used.add(chosen.id)
    ;(step.type === 'pick' ? picks : bans)[aiSide].push(chosen.id)
  }
  const name = (id) => heroMap.get(id)?.name || String(id)
  const evaluated = advisor.scoreLineup(picks[aiSide], {
    style, oppPicks: picks[humanSide], final: true,
  })
  return {
    style: style.label,
    bans: bans[aiSide].map(name),
    picks: picks[aiSide].map(name),
    lanes: evaluated.metrics?.lanes || [],
    teamScore: evaluated.score,
  }
}

const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']
const results = seeds.map((seed, index) => ({ seed, ...simulate(seed, index) }))
for (const row of results) {
  const lanes = row.lanes.join('/')
  console.log(`${row.seed.padEnd(3)} ${row.style.padEnd(5)} 禁 ${row.bans.join('/')}`)
  console.log(`    选 ${row.picks.join('/')}｜整队 ${row.teamScore.toFixed(1)}｜${lanes}`)
  // 整队评分只有在「能真正上场」的前提下才有意义，五路缺一就是不可用的阵容
  if (row.picks.length !== 5) throw new Error(`${row.seed} 只选出 ${row.picks.length} 人，阵容不完整`)
  if (new Set(row.lanes).size !== 5) throw new Error(`${row.seed} 分路重复：${lanes}`)
}

const banKey = (row) => row.bans.join()
const pickKey = (row) => row.picks.join()
const distinctBans = new Set(results.map(banKey)).size
const distinctPicks = new Set(results.map(pickKey)).size
console.log(`\n${results.length} 个种子：禁用组合 ${distinctBans} 种，阵容 ${distinctPicks} 种`)

if (distinctBans < 3) throw new Error('AI 的禁用太单一，多个种子禁出了同一套')
if (distinctPicks < 3) throw new Error('AI 的阵容太单一，多个种子选出了同一套')
console.log('通过：同一套人类阵容下，AI 会给出不同的禁用与阵容')
