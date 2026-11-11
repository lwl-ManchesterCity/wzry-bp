import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine } from '../server/synergy.mjs'
import { createDraftAdvisor } from '../server/ai-draft.mjs'
import { DRAFT_STYLES, styleForGame } from '../shared/styles.mjs'
import type { Hero } from '../src/types'

const root = path.resolve(__dirname, '..')
const heroes: Hero[] = JSON.parse(readFileSync(path.join(root, 'src/data/heroes.json'), 'utf8'))
const synergy = JSON.parse(readFileSync(path.join(root, 'src/data/hero-synergy.json'), 'utf8'))
const macro = JSON.parse(readFileSync(path.join(root, 'src/data/hero-macro.json'), 'utf8'))
const kplStats = JSON.parse(readFileSync(path.join(root, 'src/data/kpl-stats.json'), 'utf8'))
const heroMap = new Map(heroes.map((hero) => [hero.id, hero]))
const allIds = heroes.map((hero) => hero.id)

let advisor: ReturnType<typeof createDraftAdvisor>

beforeAll(() => {
  const synergyEngine = createSynergyEngine({ synergy, heroes, macro })
  advisor = createDraftAdvisor({ heroes, heroMap, kplStats, synergyEngine, synergy, macro })
})

const traits = (id: number) => synergy.traits[String(id)] as number[]
const macroTraits = (id: number) => macro.traits[String(id)] as number[]

describe('AI 每局思路轮转', () => {
  it('同一系列赛相邻两局一定换思路，且六局覆盖全部思路', () => {
    const labels = [1, 2, 3, 4, 5, 6].map((game) => styleForGame('seed-a', game).key)
    for (let i = 1; i < labels.length; i += 1) expect(labels[i]).not.toBe(labels[i - 1])
    expect(new Set(labels).size).toBe(DRAFT_STYLES.length)
  })

  it('给了系列赛序号就按序号轮转，每场新系列赛一定换打法', () => {
    const keys = [0, 1, 2, 3, 4, 5].map((index) => styleForGame('any-seed', 1, index).key)
    for (let i = 1; i < keys.length; i += 1) expect(keys[i]).not.toBe(keys[i - 1])
  })

  it('不同系列赛的起始思路不一定相同', () => {
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const keys = seeds.map((seed) => styleForGame(seed, 1).key)
    expect(new Set(keys).size).toBeGreaterThan(1)
  })
})

describe('AI 不再是固定答卷', () => {
  it('同一局面同一种子必得同一结果，换种子则首禁发生变化', () => {
    const firstBan = (seed: string) => advisor.rank({
      teamPicks: [],
      available: allIds,
      myPicks: [],
      oppPicks: [],
      limit: 1,
      mode: 'ban',
      style: styleForGame(seed, 1),
      seed,
      step: 0,
    })[0].id

    expect(firstBan('seed-a')).toBe(firstBan('seed-a'))
    const picks = new Set(['seed-a', 'seed-b', 'seed-c', 'seed-d', 'seed-e'].map(firstBan))
    expect(picks.size).toBeGreaterThan(1)
  })

  it('同一套阵容在不同思路下，榜首会不同', () => {
    const tops = DRAFT_STYLES.map((style) => advisor.rank({
      teamPicks: [],
      available: allIds,
      myPicks: [],
      oppPicks: [],
      limit: 1,
      mode: 'pick',
      style,
      seed: 'fixed',
      step: 0,
    })[0].id)
    expect(new Set(tops).size).toBeGreaterThan(2)
  })
})

describe('AI 会看对手调整', () => {
  it('对方有两个硬开团时，抗控英雄的评分被抬高', () => {
    // 找一个抗控满档的英雄，比较「对方双开团 / 对方无开团」两种局面
    const resistHero = heroes.find((hero) => macroTraits(hero.id)?.[6] === 3 && traits(hero.id)?.[1] <= 1)
    const engageHeroes = heroes.filter((hero) => traits(hero.id)?.[1] >= 3).slice(0, 2)
    expect(resistHero).toBeTruthy()
    expect(engageHeroes).toHaveLength(2)

    const style = styleForGame('counter-seed', 1)
    const args = { available: [resistHero!.id], myPicks: [], limit: 1, mode: 'pick' as const, style, seed: 'counter-seed', step: 6 }
    const vsEngage = advisor.rank({ ...args, teamPicks: [], oppPicks: engageHeroes.map((hero) => hero.id) })[0]
    const vsNothing = advisor.rank({ ...args, teamPicks: [], oppPicks: [] })[0]
    expect(vsEngage.adjusted).toBeGreaterThan(vsNothing.adjusted)
  })

  it('我方有脆皮核心时，切入型英雄在禁人榜单上升', () => {
    const carry = heroes.find((hero) => {
      const t = traits(hero.id)
      return t && t[8] === 'late' && t[6] <= 1 && t[0] === 0
    })
    const diver = heroes.find((hero) => macroTraits(hero.id)?.[4] === 3 && traits(hero.id)?.[4] >= 2)
    expect(carry).toBeTruthy()
    expect(diver).toBeTruthy()

    const style = styleForGame('threat-seed', 1)
    const base = { teamPicks: [], available: [diver!.id], limit: 1, mode: 'ban' as const, style, seed: 'threat-seed', step: 4 }
    const withCarry = advisor.rank({ ...base, myPicks: [carry!.id], teamPicks: [carry!.id] })[0]
    const noCarry = advisor.rank({ ...base, myPicks: [], teamPicks: [] })[0]
    expect(withCarry.adjusted).toBeGreaterThan(noCarry.adjusted)
  })
})

describe('系列赛记忆', () => {
  it('上局用过的英雄在禁人榜单上被压一档', () => {
    const target = allIds[0]
    const style = styleForGame('memory-seed', 2)
    const args = { teamPicks: [], available: [target], myPicks: [], limit: 1, mode: 'ban' as const, style, seed: 'memory-seed', step: 3 }
    const fresh = advisor.rank(args)[0]
    const reused = advisor.rank({ ...args, avoid: [target] })[0]
    expect(reused.adjusted).toBeLessThan(fresh.adjusted)
  })
})
