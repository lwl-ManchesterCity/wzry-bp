import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Hero } from '../src/types'

/**
 * 数据一致性。
 *
 * 复盘结论全部由这些 JSON 算出，标错一个分路或一对组合，
 * 模型会一本正经地把错的结论讲得很像那么回事（王维被标成打野、
 * 艾琳被当成零位移核心都属于这类）。这里把能机械校验的部分固定下来。
 */

const root = path.resolve(__dirname, '..')
const read = (name: string) => JSON.parse(readFileSync(path.join(root, 'src/data', name), 'utf8'))

const heroes: Hero[] = read('heroes.json')
const synergy = read('hero-synergy.json')
const macro = read('hero-macro.json')
const kplStats = read('kpl-stats.json')

const LANE_NAME: Record<number, string> = { 1: '对抗路', 2: '打野', 3: '中路', 4: '发育路', 5: '游走' }
const LANE_ID: Record<string, number> = { 对抗路: 1, 打野: 2, 中路: 3, 发育路: 4, 游走: 5 }
const CLASS_NAME: Record<number, string> = { 1: '战士', 2: '法师', 3: '坦克', 4: '刺客', 5: '射手', 6: '辅助' }

describe('英雄表', () => {
  it('分路编号合法且不重复', () => {
    for (const hero of heroes) {
      expect(hero.laneIds.length, `${hero.name} 没有分路`).toBeGreaterThan(0)
      expect(new Set(hero.laneIds).size, `${hero.name} 分路重复`).toBe(hero.laneIds.length)
      for (const lane of hero.laneIds) expect(LANE_NAME[lane], `${hero.name} 分路编号 ${lane} 非法`).toBeTruthy()
    }
  })

  it('分路与 KPL 赛季数据里的位置一致', () => {
    const mismatched: string[] = []
    for (const hero of heroes) {
      const stat = kplStats.heroes[String(hero.id)]
      if (!stat?.lane) continue
      const expected = LANE_ID[stat.lane]
      if (!expected) continue
      if (!hero.laneIds.includes(expected)) {
        mismatched.push(`${hero.name}：库里 ${hero.laneIds.map((id) => LANE_NAME[id]).join('/')}，KPL 数据是 ${stat.lane}`)
      }
    }
    expect(mismatched).toEqual([])
  })

  it('射手至少能站发育路，除非数据明确写成别的定位', () => {
    // 卢雅那被标成纯游走就是这类错误：职业是射手，实战分路是发育路
    const shooters = heroes.filter((hero) => hero.classId === 5)
    const noBot = shooters.filter((hero) => !hero.laneIds.includes(4)).map((hero) => hero.name)
    expect(noBot).toEqual([])
  })
})

describe('能力标签', () => {
  it('每个英雄都有 10 维与 7 维标签，取值在合法区间', () => {
    for (const hero of heroes) {
      const traits = synergy.traits[String(hero.id)]
      const macroTraits = macro.traits[String(hero.id)]
      expect(traits, `${hero.name} 缺少能力标签`).toBeTruthy()
      expect(macroTraits, `${hero.name} 缺少宏观标签`).toBeTruthy()
      expect(traits).toHaveLength(10)
      expect(macroTraits).toHaveLength(7)
      for (const value of traits.slice(0, 8)) {
        expect(Number.isInteger(value) && value >= 0 && value <= 3, `${hero.name} 标签越界`).toBe(true)
      }
      for (const value of macroTraits) {
        expect(Number.isInteger(value) && value >= 0 && value <= 3, `${hero.name} 宏观标签越界`).toBe(true)
      }
      expect(['early', 'mid', 'late']).toContain(traits[8])
      expect(['phys', 'magic', 'mixed', 'true']).toContain(traits[9])
    }
  })
})

describe('组合库', () => {
  const heroIds = new Set(heroes.map((hero) => hero.id))

  it('引用的英雄都存在', () => {
    for (const combo of synergy.combos) {
      for (const id of combo.ids) {
        expect(heroIds.has(id), `组合「${combo.name}」引用了不存在的英雄 ${id}`).toBe(true)
      }
    }
  })

  it('同一对英雄不会重复登记', () => {
    const seen = new Set<string>()
    for (const combo of synergy.combos) {
      const key = [...combo.ids].sort((a, b) => a - b).join('+')
      expect(seen.has(key), `组合重复登记：${key}`).toBe(false)
      seen.add(key)
    }
  })

  it('强度等级与机制描述齐全', () => {
    for (const combo of synergy.combos) {
      expect(['strong', 'conditional']).toContain(combo.tier)
      expect(combo.name.length, '组合缺少名称').toBeGreaterThan(0)
      expect(combo.mechanism.length, `组合「${combo.name}」缺少机制说明`).toBeGreaterThan(10)
    }
  })
})
