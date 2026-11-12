import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine } from '../server/synergy.mjs'
import { createDraftAdvisor } from '../server/ai-draft.mjs'
import { DRAFT_STYLES } from '../shared/styles.mjs'
import type { Hero } from '../src/types'

const root = path.resolve(__dirname, '..')
const heroes: Hero[] = JSON.parse(readFileSync(path.join(root, 'src/data/heroes.json'), 'utf8'))
const synergy = JSON.parse(readFileSync(path.join(root, 'src/data/hero-synergy.json'), 'utf8'))
const macro = JSON.parse(readFileSync(path.join(root, 'src/data/hero-macro.json'), 'utf8'))
const kplStats = JSON.parse(readFileSync(path.join(root, 'src/data/kpl-stats.json'), 'utf8'))
const heroMap = new Map(heroes.map((hero) => [hero.id, hero]))
const allIds = heroes.map((hero) => hero.id)
const style = (key: string) => DRAFT_STYLES.find((item) => item.key === key)!

let advisor: ReturnType<typeof createDraftAdvisor>

beforeAll(() => {
  const synergyEngine = createSynergyEngine({ synergy, heroes, macro })
  advisor = createDraftAdvisor({ heroes, heroMap, kplStats, synergyEngine, synergy, macro })
})

function expectCompleteLineup(plan: any) {
  expect(plan.picks).toHaveLength(5)
  expect(new Set(plan.picks).size).toBe(5)
  expect(new Set(plan.picks.map(advisor.laneOf)).size).toBe(5)
  expect(Number.isFinite(plan.score)).toBe(true)
}

describe('BO1 整队候选生成', () => {
  it('保留已选核心，生成多套五人且五路齐全的候选阵容', () => {
    const fixed = heroes.find((hero) => hero.name === '曹操')!.id
    const plans = advisor.buildLineups!([fixed], allIds.filter((id) => id !== fixed), {
      style: style('engage'), seed: 'complete-lineups',
    })
    expect(plans.length).toBeGreaterThan(3)
    for (const plan of plans) {
      expectCompleteLineup(plan)
      expect(plan.picks).toContain(fixed)
    }
    expect(new Set(plans.map((plan) => plan.picks.join('+'))).size).toBe(plans.length)
  })

  it('不同执教思路最终真的形成不同结构，不只是给同一阵容换名字', () => {
    const engage = advisor.buildLineups!([], allIds, { style: style('engage'), seed: 'identity' })[0]
    const protect = advisor.buildLineups!([], allIds, { style: style('protect'), seed: 'identity' })[0]
    const siege = advisor.buildLineups!([], allIds, { style: style('siege'), seed: 'identity' })[0]
    const pickoff = advisor.buildLineups!([], allIds, { style: style('pickoff'), seed: 'identity' })[0]

    expect(engage.metrics.structure.engageCount).toBeGreaterThanOrEqual(2)
    expect(protect.metrics.structure.peelCount).toBeGreaterThanOrEqual(2)
    expect(protect.metrics.structure.phaseCount.late).toBeGreaterThanOrEqual(1)
    expect(siege.metrics.macros.waveclear).toBeGreaterThanOrEqual(8)
    expect(pickoff.metrics.macros.flank).toBeGreaterThanOrEqual(6)
    expect(new Set([engage, protect, siege, pickoff].map((plan) => plan.picks.join('+'))).size).toBe(4)
  })
})

describe('完整阵容价值映射回当前一手', () => {
  it('第五手从完整方案中补齐最后一路，并保留前四个已选英雄', () => {
    const target = advisor.buildLineups!([], allIds, { style: style('meta'), seed: 'fifth-pick' })[0]
    const fixed = target.picks.slice(0, 4)
    const missingLane = advisor.laneOf(target.picks[4])
    const ranked = advisor.rank({
      teamPicks: fixed,
      available: allIds.filter((id) => !fixed.includes(id)),
      myPicks: fixed,
      oppPicks: [],
      limit: 8,
      mode: 'pick',
      style: style('meta'),
      seed: 'fifth-pick',
      step: 15,
    })

    expect(ranked[0].lane).toBe(missingLane)
    expectCompleteLineup(ranked[0].plan)
    for (const id of fixed) expect(ranked[0].plan.picks).toContain(id)
    expect(ranked[0].reasons.some((reason) => reason.startsWith('整队方案：'))).toBe(true)
  })
})

describe('Ban 按对手整队损失计算', () => {
  it('榜首有禁前与禁后两套完整阵容，禁用收益来自两者分差', () => {
    const target = advisor.buildLineups!([], allIds, { style: style('meta'), seed: 'ban-impact' })[0]
    const oppPicks = target.picks.slice(0, 4)
    const available = allIds.filter((id) => !oppPicks.includes(id))
    const ranked = advisor.rank({
      teamPicks: oppPicks,
      available,
      myPicks: [],
      oppPicks,
      limit: 8,
      mode: 'ban',
      style: style('meta'),
      seed: 'ban-impact',
      step: 12,
    })
    const best = ranked[0]

    expect(best.banImpact).toBeGreaterThan(0)
    expect(best.reasons.some((reason) => reason.includes('最佳整队评分下降'))).toBe(true)
    expectCompleteLineup(best.plan.before)
    expectCompleteLineup(best.plan.after)
    expect(best.plan.before.picks).toContain(best.id)
    expect(best.plan.after.picks).not.toContain(best.id)
    expect(best.plan.before.score - best.plan.after.score).toBeCloseTo(best.banImpact, 6)
  })

  it('同一种子的整队推演可复现，刷新或重试不会换一套理由', () => {
    const args = {
      teamPicks: [] as number[],
      available: allIds,
      myPicks: [] as number[],
      oppPicks: [] as number[],
      limit: 8,
      mode: 'ban' as const,
      style: style('meta'),
      seed: 'repeatable',
      step: 0,
    }
    const first = advisor.rank(args)
    const second = advisor.rank(args)
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id))
    expect(first.map((item) => item.banImpact)).toEqual(second.map((item) => item.banImpact))
  })
})
