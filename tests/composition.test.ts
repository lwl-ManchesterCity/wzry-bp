import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine } from '../server/synergy.mjs'
import { judgeComposition, compareComposition, judgeWinPaths, metaUsagePolicy } from '../server/composition.mjs'
import type { Hero } from '../src/types'

/**
 * 体系闭环度与胜利路径。
 *
 * 闭环度判的不是「谁更强」，而是「这套阵容的齿轮咬不咬得上」：
 * 有人扛、有人开、有人保、伤害打得进去、强势期撞在一起、有成型协同、有走得通的赢法。
 * 路径判的是「靠什么结束游戏」：团战、推进、单抓，各自能不能走、对方解不解得掉。
 */

const root = path.resolve(__dirname, '..')
const read = (name: string) => JSON.parse(readFileSync(path.join(root, 'src/data', name), 'utf8'))

const heroes: Hero[] = read('heroes.json')
const synergy = read('hero-synergy.json')
const macro = read('hero-macro.json')
const engine = createSynergyEngine({ synergy, heroes, macro })!

const BLUE = [525, 581, 545, 537, 138] // 鲁班大师/元流之子(坦克)/莱西奥/司空震/王维
const RED = [312, 114, 128, 174, 193] // 沈梦溪/刘禅/曹操/虞姬/铠

const blueTeam = engine.analyzeTeam(BLUE, [])
const redTeam = engine.analyzeTeam(RED, [])
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
  waveclear: 10,
  siege: 8,
  lanePressure: 10,
  controlResist: 6,
  splitters: ['测试绕后', '测试单带'],
  splitCount: 2,
  ...patch,
})

describe('单侧闭环度', () => {
  it('蓝方七环节全成立，判为完整体系', () => {
    const blue = judgeComposition(blueTeam, redTeam)!
    expect(blue.passed).toBe(7)
    expect(blue.total).toBe(7)
    expect(blue.tier).toBe('S')
    expect(blue.tierLabel).toBe('完整体系')
    expect(blue.missing).toEqual([])
  })

  it('红方缺保护链、伤害类型与成型协同，判为各自为战', () => {
    const red = judgeComposition(redTeam, blueTeam)!
    expect(red.passed).toBe(4)
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

describe('胜利路径', () => {
  it('蓝方靠团战赢，推进与单抓都够不上门槛', () => {
    const paths = judgeWinPaths(blueTeam.structure, redTeam.structure)!
    const byKey = Object.fromEntries(paths.paths.map((item) => [item.key, item]))
    expect(byKey.teamfight.status).toBe('open')
    expect(byKey.siege.status).toBe('blocked')
    expect(byKey.siege.detail).toContain('推进 6 低于 7')
    expect(byKey.pick.status).toBe('blocked')
    expect(byKey.pick.detail).toContain('仅 1 人可绕后')
    expect(paths.usable).toBe(1)
  })

  it('红方团战自身不成立，单抓被蓝方保护链封死', () => {
    const paths = judgeWinPaths(redTeam.structure, blueTeam.structure)!
    const byKey = Object.fromEntries(paths.paths.map((item) => [item.key, item]))
    // 前排 8/15 比蓝方厚，但伤害物理4/法术1，团战核心条件不成立
    expect(byKey.teamfight.status).toBe('blocked')
    expect(byKey.teamfight.detail).toContain('伤害类型单一')
    expect(byKey.pick.status).toBe('blocked')
    expect(byKey.pick.detail).toContain('鲁班大师')
    expect(byKey.siege.status).toBe('contested')
    expect(paths.blocked).toBe(2)
  })

  it('三条路全封死时，胜利路径环节判不通过', () => {
    const dead = { structure: structure({ front: 2, engageCount: 0, hardEngage: [], peelCount: 0, protectors: [], damageMix: { phys: 5, magic: 0, true: 0, mixed: 0 }, waveclear: 4, siege: 2, splitters: [], splitCount: 0 }), combos: [] }
    const judged = judgeComposition(dead)!
    const pathCheck = judged.checks.find((check) => check.key === 'path')!
    expect(pathCheck.ok).toBe(false)
    expect(pathCheck.detail).toContain('三条路全部走不通')
    expect(judged.missing).toContain('胜利路径')
  })

  it('推进路径按对方清线差判封死：对方清线高出 2 点以上就推不动', () => {
    const own = { structure: structure({ waveclear: 10, siege: 8 }), combos: [] }
    const opp = { structure: structure({ waveclear: 12 }) }
    const paths = judgeWinPaths(own.structure, opp.structure)!
    expect(paths.paths.find((item) => item.key === 'siege')!.status).toBe('blocked')
  })

  it('缺 macro 数据时不判推进路径，也不计为失败', () => {
    const paths = judgeWinPaths(structure({ waveclear: null, siege: null }), null)!
    const siege = paths.paths.find((item) => item.key === 'siege')!
    expect(siege.status).toBe('unknown')
    expect(siege.statusLabel).toBe('缺数据')
  })
})

describe('两侧对比', () => {
  it('这一局体系差 3 个环节，提示跟随蓝方', () => {
    const result = compareComposition(
      judgeComposition(blueTeam, redTeam),
      judgeComposition(redTeam, blueTeam),
    )!
    expect(result.gap).toBe(3)
    expect(result.hint.active).toBe(true)
    expect(result.hint.side).toBe('blue')
    expect(result.hint.text).toContain('体系优先')
  })

  it('路径质量单独给出结论，蓝方 2 分对红方 1 分', () => {
    const result = compareComposition(
      judgeComposition(blueTeam, redTeam),
      judgeComposition(redTeam, blueTeam),
    )!
    expect(result.paths).not.toBeNull()
    expect(result.paths).toMatchObject({ gap: 1, side: 'blue' })
    expect(result.paths!.text).toContain('蓝方路径更稳')
    expect(result.paths!.text).toContain('受制')
  })

  it('差距不到 2 个环节时不激活体系优先', () => {
    const close = compareComposition(
      { passed: 6, total: 7, missing: [], checks: [], tier: 'A', tierLabel: '基本成型' } as never,
      { passed: 5, total: 7, missing: [], checks: [], tier: 'B', tierLabel: '存在缺口' } as never,
    )!
    expect(close.gap).toBe(1)
    expect(close.hint.active).toBe(false)
    expect(close.hint.side).toBeNull()
    expect(close.hint.text).toContain('体系完整度接近')
  })

  it('一侧数据缺失时不给对比结论', () => {
    expect(compareComposition(judgeComposition(blueTeam, redTeam), null)).toBeNull()
  })
})

describe('版本强度的用法', () => {
  it('体系差 2 个环节以上时降为诊断项，不得改判', () => {
    const policy = metaUsagePolicy(3)
    expect(policy.diagnosticOnly).toBe(true)
    expect(policy.closureGap).toBe(3)
    expect(policy.text).toContain('只作诊断依据')
    expect(policy.text).toContain('不得据此改变胜负倾向')
  })

  it('体系差不足 2 个环节时可作平手裁决', () => {
    const policy = metaUsagePolicy(1)
    expect(policy.diagnosticOnly).toBe(false)
    expect(policy.text).toContain('平手裁决')
  })
})
