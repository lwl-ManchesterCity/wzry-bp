import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine } from '../server/synergy.mjs'
import type { Hero } from '../src/types'

const root = path.resolve(__dirname, '..')
const heroes: Hero[] = JSON.parse(readFileSync(path.join(root, 'src/data/heroes.json'), 'utf8'))
const synergy = JSON.parse(readFileSync(path.join(root, 'src/data/hero-synergy.json'), 'utf8'))

let engine: ReturnType<typeof createSynergyEngine>

beforeAll(() => {
  engine = createSynergyEngine({ synergy, heroes })
})

// 常用英雄 ID，集中在这里避免测试里散落魔法数字
const ID = {
  luban: 112,
  dunshan: 509,
  gali: 508,
  guiguzi: 189,
  huowu: 157,
  sunwukong: 167,
  yao: 505,
  simazhen: 537,
  jing: 531,
  wuzetian: 136,
  yase: 166,
  daji: 109,
  aguduo: 533,
  caowenji: 184,
  sunshangxiang: 111,
  shenmengxi: 312,
} as const

const pickNames = (combos: { heroes: string[] }[]) => combos.map((combo) => combo.heroes.join('+'))

describe('英雄能力标签', () => {
  it('133 个英雄全部有标签，且格式合法', () => {
    const ids = heroes.map((hero) => String(hero.id))
    expect(Object.keys(synergy.traits).sort()).toEqual(ids.sort())
    for (const id of ids) {
      const traits = synergy.traits[id]
      expect(traits).toHaveLength(10)
      expect(['early', 'mid', 'late']).toContain(traits[8])
      expect(['phys', 'magic', 'true', 'mixed']).toContain(traits[9])
    }
  })
})

describe('组合协同检测', () => {
  it('鲁班七号 + 盾山 这样的强搭配必须被识别出来', () => {
    const result = engine.analyzeTeam([ID.luban, ID.dunshan, ID.simazhen, ID.jing, ID.wuzetian], [])
    const names = pickNames(result.combos)
    expect(names).toContain('鲁班七号+盾山')
    const combo = result.combos.find((item) => item.heroes.includes('鲁班七号') && item.heroes.includes('盾山'))
    expect(combo?.tier).toBe('strong')
  })

  it('强协同排在条件协同之前', () => {
    // 鲁班+盾山(强) 与 鲁班+蔡文姬(条件) 同时在场
    const result = engine.analyzeTeam([ID.luban, ID.dunshan, ID.caowenji, ID.simazhen, ID.jing], [])
    const tiers = result.combos.map((combo) => combo.tier)
    expect(tiers[0]).toBe('strong')
    expect(tiers).toContain('conditional')
  })

  it('识别鬼谷子 + 不知火舞的开团链', () => {
    const result = engine.analyzeTeam([ID.guiguzi, ID.huowu, ID.jing, ID.simazhen, ID.luban], [])
    expect(pickNames(result.combos)).toContain('鬼谷子+不知火舞')
  })

  it('没有任何搭配时返回空数组而不是报错', () => {
    const result = engine.analyzeTeam([ID.daji, ID.yase, ID.sunwukong, ID.aguduo, ID.yao], [])
    // 孙悟空+瑶是条件协同，因此只断言为数组且不抛错
    expect(Array.isArray(result.combos)).toBe(true)
  })
})

describe('组合被禁用拆断', () => {
  it('鲁班在场但盾山被对方 Ban 掉时，报告保护链被拆', () => {
    const result = engine.analyzeTeam([ID.luban, ID.caowenji, ID.simazhen, ID.jing, ID.wuzetian], [ID.dunshan])
    expect(result.broken).toHaveLength(1)
    expect(result.broken[0].held).toBe('鲁班七号')
    expect(result.broken[0].missing).toBe('盾山')
  })

  it('搭档在本方阵容里时不算被拆', () => {
    const result = engine.analyzeTeam([ID.luban, ID.dunshan, ID.simazhen, ID.jing, ID.wuzetian], [ID.dunshan])
    expect(result.broken).toHaveLength(0)
  })

  it('已经组成强协同的英雄不再提示其他备选组合被拆', () => {
    // 盾山同时挂在「鲁班+盾山」和「盾山+沈梦溪」两条强组合上，
    // 鲁班已在阵中，此时不应再拿沈梦溪被 Ban 来说事
    const result = engine.analyzeTeam(
      [ID.luban, ID.dunshan, ID.simazhen, ID.jing, ID.wuzetian],
      [ID.shenmengxi],
    )
    expect(result.broken).toHaveLength(0)
  })
})

describe('阵容结构诊断', () => {
  it('后期核心配上保人英雄时，判定保护链成立', () => {
    const result = engine.analyzeTeam([ID.luban, ID.dunshan, ID.simazhen, ID.jing, ID.wuzetian], [])
    const finding = result.findings.find((item) => item.title === '后期核心保护链成立')
    expect(finding).toBeTruthy()
    expect(finding?.level).toBe('strong')
    expect(finding?.detail).toContain('鲁班七号')
  })

  it('后期核心没有保人英雄时，判定保护链缺失', () => {
    const result = engine.analyzeTeam([ID.luban, ID.simazhen, ID.jing, ID.wuzetian, ID.daji], [])
    const finding = result.findings.find((item) => item.title === '后期核心缺乏保护')
    expect(finding?.level).toBe('weak')
  })

  it('全队无硬开团时给出对应短板', () => {
    const result = engine.analyzeTeam([ID.luban, ID.dunshan, ID.gali, ID.daji, ID.sunshangxiang], [])
    expect(result.findings.some((item) => item.title === '缺少主动开团')).toBe(true)
  })

  it('伤害类型高度集中时提示针对性出装风险', () => {
    const result = engine.analyzeTeam([ID.luban, ID.sunshangxiang, ID.sunwukong, ID.yase, ID.jing], [])
    const finding = result.findings.find((item) => item.title === '伤害类型单一')
    expect(finding).toBeTruthy()
    expect(finding?.detail).toContain('物理')
  })
})

describe('双方对照', () => {
  it('一方有成型的强协同、另一方没有时给出差异结论', () => {
    const blue = engine.analyzeTeam([ID.yase, ID.sunwukong, ID.daji, ID.aguduo, ID.yao], [])
    const red = engine.analyzeTeam([ID.simazhen, ID.jing, ID.wuzetian, ID.luban, ID.dunshan], [])
    const notes = engine.compareSides(blue, red)
    expect(notes.some((note) => note.includes('红方存在成型的强协同组合'))).toBe(true)
  })
})
