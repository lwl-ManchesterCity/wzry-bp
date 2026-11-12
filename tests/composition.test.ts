import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine } from '../server/synergy.mjs'
import { judgeComposition, compareComposition } from '../server/composition.mjs'
import type { Hero } from '../src/types'

/**
 * 体系闭环度。
 *
 * 这里判的不是「谁更强」，而是「这套阵容的五个齿轮咬不咬得上」：
 * 有人扛、有人开、有人保、伤害打得进去、强势期撞在一起，再加一条成型协同。
 * 缺口比分数更有信息量——红方那套的毛病不是数值低，是根本没有保人。
 */

const root = path.resolve(__dirname, '..')
const read = (name: string) => JSON.parse(readFileSync(path.join(root, 'src/data', name), 'utf8'))

const heroes: Hero[] = read('heroes.json')
const synergy = read('hero-synergy.json')
const macro = read('hero-macro.json')
const engine = createSynergyEngine({ synergy, heroes, macro })!

const BLUE = [525, 581, 545, 537, 138] // 鲁班大师/元流之子(坦克)/莱西奥/司空震/王维
const RED = [312, 114, 128, 174, 193] // 沈梦溪/刘禅/曹操/虞姬/铠

const judge = (ids: number[]) => judgeComposition(engine.analyzeTeam(ids, []))

/** 造一个最小 structure，只改被测环节 */
const structure = (patch: Record<string, unknown> = {}) => ({
  sample: 5,
  unknown: [],
  front: 8,
  engageScore: 8,
  engageCount: 1,
  hardEngage: ['测试开团'],
  fragileCarry: [],
  protectors: ['测试保人'],
  peelCount: 1,
  peelScore: 3,
  pokeScore: 5,
  pokeCount: 2,
  burstCount: 1,
  sustainScore: 4,
  mobilityAvg: 2,
  controlScore: 7,
  damageMix: { phys: 2, magic: 2, true: 0, mixed: 1 },
  phaseCount: { early: 0, mid: 4, late: 1 },
  ...patch,
})

describe('单侧闭环度', () => {
  it('蓝方六环节全成立，判为完整体系', () => {
    const blue = judge(BLUE)!
    expect(blue.passed).toBe(6)
    expect(blue.total).toBe(6)
    expect(blue.tier).toBe('S')
    expect(blue.tierLabel).toBe('完整体系')
    expect(blue.missing).toEqual([])
  })

  it('红方缺保护链、伤害类型与成型协同，判为各自为战', () => {
    const red = judge(RED)!
    expect(red.passed).toBe(3)
    expect(red.tier).toBe('C')
    expect(red.missing).toEqual(['保护链', '伤害类型', '成型协同'])
    // 无保人这件事必须能在 detail 里读出来，不能只是一个 ✗
    const peel = red.checks.find((check) => check.key === 'peel')!
    expect(peel.ok).toBe(false)
    expect(peel.detail).toContain('无保人型')
  })

  it('伤害单一类型超阈值判不通过，混合且分散判通过', () => {
    const mono = judgeComposition({ structure: structure({ damageMix: { phys: 4, magic: 1, true: 0, mixed: 0 } }), combos: [] })!
    expect(mono.checks.find((check) => check.key === 'damage')!.ok).toBe(false)

    const mixed = judgeComposition({ structure: structure({ damageMix: { phys: 2, magic: 2, true: 0, mixed: 1 } }), combos: [] })!
    expect(mixed.checks.find((check) => check.key === 'damage')!.ok).toBe(true)
  })

  it('强势期分散判不通过', () => {
    const scattered = judgeComposition({ structure: structure({ phaseCount: { early: 2, mid: 2, late: 1 } }), combos: [] })!
    expect(scattered.checks.find((check) => check.key === 'phase')!.ok).toBe(false)
  })

  it('没有结构数据时返回 null，不抛错', () => {
    expect(judgeComposition(null)).toBeNull()
    expect(judgeComposition({})).toBeNull()
  })
})

describe('两侧对比', () => {
  it('这一局体系差 3 个环节，提示跟随蓝方', () => {
    const result = compareComposition(judge(BLUE), judge(RED))!
    expect(result.gap).toBe(3)
    expect(result.hint.active).toBe(true)
    expect(result.hint.side).toBe('blue')
    expect(result.hint.text).toContain('体系优先')
  })

  it('差距不到 2 个环节时不激活体系优先', () => {
    const close = compareComposition(
      { passed: 5, total: 6, missing: [], checks: [], tier: 'A', tierLabel: '基本成型' } as never,
      { passed: 4, total: 6, missing: [], checks: [], tier: 'B', tierLabel: '存在缺口' } as never,
    )!
    expect(close.gap).toBe(1)
    expect(close.hint.active).toBe(false)
    expect(close.hint.side).toBeNull()
    expect(close.hint.text).toContain('体系完整度接近')
  })

  it('一侧数据缺失时不给对比结论', () => {
    expect(compareComposition(judge(BLUE), null)).toBeNull()
  })
})
