import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createMetaModel, describeMembers } from '../server/meta-strength.mjs'
import type { Hero } from '../src/types'

/**
 * 版本强度。
 *
 * 这套分只做一件事：把「谁在版本里」变成模型能引用的事实。
 * 判据的关键不是分高几分，而是**未登场不能被当成弱**——
 * 刘禅 0 场是职业队不要，元流之子(坦克) 有 24 场说明新英雄已经进池，
 * 两种「看起来没数据」的情况必须分开处理。
 */

const root = path.resolve(__dirname, '..')
const read = (name: string) => JSON.parse(readFileSync(path.join(root, 'src/data', name), 'utf8'))

const heroes: Hero[] = read('heroes.json')
const kplStats = read('kpl-stats.json')

const model = createMetaModel({ stats: kplStats, heroes })!

describe('版本强度合成', () => {
  it('出场越多、胜率越高，分越高', () => {
    const hot = model.scoreOf(128) // 曹操 75 场 61.3%
    const cold = model.scoreOf(174) // 虞姬 9 场 66.7%
    expect(hot.score).toBeGreaterThan(cold.score!)
    expect(hot.tier).toBe('T0')
    // 高胜率但样本少只能到 T2，不能因为胜率好看就顶到 T0
    expect(cold.tier).toBe('T2')
    expect(cold.note).toBe('样本有限')
  })

  it('0 场英雄记「无样本」，不给低分', () => {
    const liuShan = model.scoreOf(114) // 刘禅
    expect(liuShan.games).toBe(0)
    expect(liuShan.score).toBeNull()
    expect(liuShan.tier).toBe('NA')
    expect(liuShan.note).toBe('本赛季未登场')
  })

  it('赛季数据查不到时用英雄表补名字，同样记「无样本」而不是报错', () => {
    const unknown = model.scoreOf(999999)
    expect(unknown.score).toBeNull()
    expect(unknown.tier).toBe('NA')

    // 元流之子(坦克) 是英雄表里的新形态，赛季数据里也有 24 场，不能被当成未登场
    const yuanliu = model.scoreOf(581)
    expect(yuanliu.name).toBe('元流之子(坦克)')
    expect(yuanliu.games).toBe(24)
    expect(yuanliu.score).not.toBeNull()
  })

  it('分数落在 25-100 之间且分档与分数一致', () => {
    for (const id of [525, 581, 537, 545, 138, 312, 128, 174, 193]) {
      const item = model.scoreOf(id)
      expect(item.score).toBeGreaterThanOrEqual(25)
      expect(item.score).toBeLessThanOrEqual(100)
      const expected = item.score! >= 80 ? 'T0' : item.score! >= 65 ? 'T1' : item.score! >= 50 ? 'T2' : 'T3'
      expect(item.tier).toBe(expected)
    }
  })
})

describe('两队对比', () => {
  it('均分只算有效样本，未登场单独列出', () => {
    // 蓝方：鲁班大师/元流之子(坦克)/莱西奥/司空震/王维，五人都有赛季样本
    const blue = model.team([525, 581, 545, 537, 138])
    expect(blue.knownCount).toBe(5)
    expect(blue.noSample).toEqual([])
    expect(blue.avg).toBe(58)

    // 红方含刘禅 0 场：均分按 4 人算，刘禅进 noSample
    const red = model.team([312, 114, 128, 174, 193])
    expect(red.knownCount).toBe(4)
    expect(red.noSample).toEqual(['刘禅'])
    expect(red.avg).toBe(74)
  })

  it('一方全无样本时不给差距，避免制造假差距', () => {
    const both = model.compare([581], [312, 128])
    expect(both.diff).not.toBeNull()

    const oneSideEmpty = model.compare([114], [312, 128]) // 蓝方只有刘禅，0 场
    expect(oneSideEmpty.blue.avg).toBeNull()
    expect(oneSideEmpty.diff).toBeNull()
    expect(oneSideEmpty.leader).toBe('even')
  })

  it('双方未登场人数相同要标出来，避免把「缺样本」当成版本差距', () => {
    const result = model.compare([525, 114], [312, 109]) // 双方各一个 0 场英雄
    expect(result.blue.noSample).toEqual(['刘禅'])
    expect(result.red.noSample).toEqual(['妲己'])
    expect(result.evenNoSample).toBe(true)
  })

  it('复盘那一局：红方版本强度明显更高', () => {
    // 事实记录，不是判断：蓝方五人都只是 T1/T2，
    // 红方靠曹操（75 场 61.3%）与沈梦溪（79 场）两个 T0 把均分拉到 74；
    // 唯一缺样本的刘禅反而在红方，说明版本层优势不是靠「对手缺人」得来的。
    const result = model.compare([525, 581, 545, 537, 138], [312, 114, 128, 174, 193])
    expect(result.blue.avg).toBe(58)
    expect(result.red.avg).toBe(74)
    expect(result.diff).toBe(-16)
    expect(result.leader).toBe('red')
    expect(result.blue.noSample).toEqual([])
    expect(result.red.noSample).toEqual(['刘禅'])
    expect(result.evenNoSample).toBe(false)
  })

  it('描述行把分档、场次、胜率写全，未登场英雄单独标注', () => {
    const red = model.team([128, 114])
    const text = describeMembers(red)
    expect(text).toContain('曹操 T0 93')
    expect(text).toContain('75场/61.3%')
    expect(text).toContain('刘禅 未登场')
  })
})
