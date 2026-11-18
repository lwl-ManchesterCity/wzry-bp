import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine } from '../server/synergy.mjs'
import { createDraftAdvisor } from '../server/ai-draft.mjs'
import { solveLineup, LANE_LABEL } from '../shared/lanes.mjs'
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
  // 落位与排布面板同口径：按整队求解后的分路判齐全，而不是各认主路
  expect(new Set(plan.metrics.lanes).size).toBe(5)
  expect(plan.metrics.offLane).toBe(0)
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

  it('已选同主路两人时整队规划不熄火，仍按阵容结构补齐而非退回个体评分', () => {
    const idOf = (name: string) => heroes.find((hero) => hero.name === name)!.id
    const fixed = [idOf('盾山'), idOf('蔡文姬')]
    expect(new Set(fixed.map(advisor.laneOf)).size).toBe(1)
    const available = allIds.filter((id) => !fixed.includes(id))
    const plans = advisor.buildLineups!(fixed, available, { style: style('meta'), seed: 'lane-conflict' })
    expect(plans.length).toBeGreaterThan(0)
    for (const plan of plans) {
      expect(plan.picks).toHaveLength(5)
      expect(plan.picks).toContain(fixed[0])
      expect(plan.picks).toContain(fixed[1])
    }
    const ranked = advisor.rank({
      teamPicks: fixed, available, myPicks: fixed, oppPicks: [],
      limit: 3, mode: 'pick', style: style('meta'), seed: 'lane-conflict', step: 8,
    })
    expect(ranked[0].plan).toBeTruthy()
  })

  it('剪枝初筛纳入协同潜力后，放宽 perLane 不再显著更优（强协同拼图不被砍掉）', () => {
    const engage = style('engage')
    const narrow = advisor.buildLineups!([], allIds, { style: engage, seed: 's3', perLane: 8 })[0]
    const wide = advisor.buildLineups!([], allIds, { style: engage, seed: 's3', perLane: 24 })[0]
    // 灵活分路后副路桶会被主路是别处的英雄挤占、协同拼图易被单卡强度剪掉：
    // 未折扣时 narrow 比 wide 低 9.74（后羿/哪吒被剪）。副路锚点折扣 0.8＋协同权重 4 后，
    // 各思路×种子的窄/宽缺口都收敛到 ≤0（本例约 -0.19）。阈值 5 留作回归余量。
    expect(wide.score - narrow.score).toBeLessThan(5)
  })

  it('多路英雄不再被压成主路：对抗路有人时芈月按打野评估与落位', () => {
    const idOf = (name: string) => heroes.find((hero) => hero.name === name)!.id
    const bai = idOf('白起')
    const mi = idOf('芈月')
    // 白起占对抗路，芈月（对抗/打野）评估时走副路打野，而不是被压回主路撞车
    expect(advisor.evaluate!(mi, [bai], 'pick').lane).toBe('打野')
    // 把两人一起固定进整队规划：芈月仍落打野、五路齐全，落位与面板共用求解一致
    const plans = advisor.buildLineups!([bai, mi], allIds.filter((id) => id !== bai && id !== mi), {
      style: style('meta'), seed: 'flex-lane',
    })
    const plan = plans[0]
    expect(plan.picks).toContain(bai)
    expect(plan.picks).toContain(mi)
    expect(plan.metrics.lineup[2]).toBe(mi)
    expect(plan.metrics.offLane).toBe(0)
    expect(plan.metrics.lineup).toEqual(solveLineup(plan.picks.map((id) => heroMap.get(id))))
  })

  it('单路英雄撞路仍算补位：五路齐全奖励不再发给双射手阵容', () => {
    const idOf = (name: string) => heroes.find((hero) => hero.name === name)!.id
    const five = [idOf('鲁班七号'), idOf('孙尚香'), idOf('妲己'), idOf('白起'), idOf('庄周')]
    const evaluated = advisor.scoreLineup!(five, { style: style('meta') })
    expect(evaluated.metrics.offLane).toBe(1)
    expect(evaluated.notes).not.toContain('五路完整')
  })
})

describe('完整阵容价值映射回当前一手', () => {
  it('对手只露出两手时，先补全其最佳应对再给我方整套阵容评分', () => {
    const oppTarget = advisor.buildLineups!([], allIds, { style: style('meta'), seed: 'opp-response' })[0]
    const oppPicks = oppTarget.picks.slice(0, 2)
    const ourTarget = advisor.buildLineups!(
      [], allIds.filter((id) => !oppPicks.includes(id)), { style: style('engage'), seed: 'opp-response-ours' },
    )[0]
    const teamPicks = ourTarget.picks.slice(0, 2)
    const available = allIds.filter((id) => ![...oppPicks, ...teamPicks].includes(id))
    const ranked = advisor.rank({
      teamPicks, available, myPicks: teamPicks, oppPicks,
      limit: 5, mode: 'pick', style: style('engage'), seed: 'opp-response', step: 6,
    })
    const response = ranked[0].plan?.oppResponse
    expect(response).toBeTruthy()
    expectCompleteLineup(response)
    for (const id of oppPicks) expect(response.picks).toContain(id)
    // 方案分必须等于「对着补全后的对手」评出的分，而不是对着残缺两手
    expect(ranked[0].plan.score).toBe(
      advisor.scoreLineup!(ranked[0].plan.picks, { style: style('engage'), oppPicks: response.picks }).score,
    )
  })

  it('对手五手已齐时不再推演，直接按其现有阵容评分', () => {
    const oppPicks = advisor.buildLineups!([], allIds, { style: style('meta'), seed: 'opp-full' })[0].picks
    const ourTarget = advisor.buildLineups!(
      [], allIds.filter((id) => !oppPicks.includes(id)), { style: style('meta'), seed: 'opp-full-ours' },
    )[0]
    const teamPicks = ourTarget.picks.slice(0, 4)
    const ranked = advisor.rank({
      teamPicks,
      available: allIds.filter((id) => ![...oppPicks, ...teamPicks].includes(id)),
      myPicks: teamPicks, oppPicks,
      limit: 5, mode: 'pick', style: style('meta'), seed: 'opp-full', step: 15,
    })
    expect(ranked[0].plan.oppResponse).toBeNull()
    expect(ranked[0].plan.score).toBe(
      advisor.scoreLineup!(ranked[0].plan.picks, { style: style('meta'), oppPicks }).score,
    )
  })

  it('第五手从完整方案中补齐最后一路，并保留前四个已选英雄', () => {
    const target = advisor.buildLineups!([], allIds, { style: style('meta'), seed: 'fifth-pick' })[0]
    const fixed = target.picks.slice(0, 4)
    // 灵活分路下「最后一路」＝前四手锁定落位后剩下的空路，而非第五手的主路
    const incumbent = solveLineup(fixed.map((id) => heroMap.get(id)))
    const takenLanes = new Set(Object.keys(incumbent).map(Number))
    const missingLane = LANE_LABEL[[1, 2, 3, 4, 5].find((lane) => !takenLanes.has(lane))!]
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

  it('对方某路已满员时，不去禁那一路的强英雄（禁了也拆不动阵容）', () => {
    const idOf = (name: string) => heroes.find((hero) => hero.name === name)!.id
    const oppPicks = [idOf('盾山'), idOf('艾琳'), idOf('沈梦溪')]
    const occupied = new Set(oppPicks.map(advisor.laneOf))
    const ranked = advisor.rank({
      teamPicks: oppPicks,
      available: allIds.filter((id) => !oppPicks.includes(id)),
      myPicks: [],
      oppPicks,
      limit: 8,
      mode: 'ban',
      style: style('meta'),
      seed: 'lane-blocked-ban',
      step: 13,
    })

    expect(occupied.has(ranked[0].lane)).toBe(false)
    expect(ranked.every((item) => !occupied.has(item.lane))).toBe(true)
    const cai = ranked.find((item) => item.id === idOf('蔡文姬'))
    if (cai) {
      expect(cai.banImpact).toBe(0)
      expect(ranked[0].id).not.toBe(cai.id)
    }
  })
})
