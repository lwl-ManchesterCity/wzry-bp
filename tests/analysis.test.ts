import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine } from '../server/synergy.mjs'
import { createMatchupModel } from '../server/matchup.mjs'
import { createDraftAdvisor } from '../server/ai-draft.mjs'
import type { Hero } from '../src/types'

const root = path.resolve(__dirname, '..')
const heroes: Hero[] = JSON.parse(readFileSync(path.join(root, 'src/data/heroes.json'), 'utf8'))
const synergy = JSON.parse(readFileSync(path.join(root, 'src/data/hero-synergy.json'), 'utf8'))
const macro = JSON.parse(readFileSync(path.join(root, 'src/data/hero-macro.json'), 'utf8'))
const kplStats = JSON.parse(readFileSync(path.join(root, 'src/data/kpl-stats.json'), 'utf8'))
const heroMap = new Map(heroes.map((hero) => [hero.id, hero]))

const ID = {
  dunshan: 509,
  ailin: 155,
  guanyu: 140,
  shenmengxi: 312,
  xiahoudun: 126,
  caocao: 128,
  zhangfei: 171,
  houyi: 169,
  huowu: 157,
  donghuang: 187,
  gali: 508,
  luban: 112,
  huangzhong: 192,
  aoyin: 519,
  sikongzhen: 537,
  yuantan: 581,
  zhongkui: 175,
  xiaoqiao: 106,
  zhaoyun: 107,
} as const

// 用户实际打出的一局：盾山+艾琳+关羽+沈梦溪+夏侯惇 对 曹操+张飞+后羿+不知火舞+东皇太一
const BLUE = [ID.dunshan, ID.ailin, ID.guanyu, ID.shenmengxi, ID.xiahoudun]
const RED = [ID.caocao, ID.zhangfei, ID.houyi, ID.huowu, ID.donghuang]

let engine: ReturnType<typeof createSynergyEngine>
let matchup: ReturnType<typeof createMatchupModel>
let advisor: ReturnType<typeof createDraftAdvisor>

beforeAll(() => {
  engine = createSynergyEngine({ synergy, heroes, macro })
  matchup = createMatchupModel({ synergy, heroes, macro })
  advisor = createDraftAdvisor({ heroes, heroMap, kplStats, synergyEngine: engine })
})

describe('macro 七维标注', () => {
  it('133 名英雄全部标注且取值合法', () => {
    const ids = heroes.map((hero) => String(hero.id))
    expect(ids.every((id) => Array.isArray(macro.traits[id]))).toBe(true)
    for (const id of ids) {
      const row = macro.traits[id]
      expect(row).toHaveLength(7)
      expect(row.every((value: number) => Number.isInteger(value) && value >= 0 && value <= 3)).toBe(true)
    }
  })

  it('射手拿到持续输出分，坦克拿不到', () => {
    expect(macro.traits[String(ID.ailin)][0]).toBe(3)
    expect(macro.traits[String(ID.dunshan)][0]).toBe(0)
  })

  it('抗控维度覆盖「用身体吃控制」：夏侯惇与盾山都属高抗控', () => {
    expect(macro.traits[String(ID.xiahoudun)][6]).toBe(3)
    expect(macro.traits[String(ID.dunshan)][6]).toBe(3)
  })
})

describe('机制推导', () => {
  it('盾山+艾琳必须命中保护链（强），即使组合库里没有这一对', () => {
    const result = engine.analyzeTeam(BLUE, [])
    const hit = result.combos.find((combo) => combo.name === '保护链' && combo.heroes.includes('艾琳'))
    expect(hit).toBeTruthy()
    expect(hit?.tier).toBe('strong')
    expect(hit?.source).toBe('derived')
  })

  it('保护链的排序高于封挡接消耗：核心能否输出比消耗手段更重要', () => {
    const result = engine.analyzeTeam(BLUE, [])
    const protect = result.combos.findIndex((combo) => combo.name === '保护链')
    const poke = result.combos.findIndex((combo) => combo.name === '封挡接消耗')
    expect(protect).toBeGreaterThanOrEqual(0)
    expect(poke).toBeGreaterThanOrEqual(0)
    expect(protect).toBeLessThan(poke)
  })

  it('同一对英雄不会同时产出显式组合和机制推导', () => {
    const result = engine.analyzeTeam(BLUE, [])
    const keys = result.combos.map((combo) => [...combo.heroes].sort().join('+'))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('不提供 macro 时退回纯显式组合，不报错', () => {
    const plain = createSynergyEngine({ synergy, heroes })
    const result = plain.analyzeTeam(BLUE, [])
    expect(result.combos.every((combo) => combo.source === 'explicit')).toBe(true)
  })
})

describe('五轴与分路对位', () => {
  it('五轴齐全且每轴都在 0-100', () => {
    const axes = matchup.compareAxes(BLUE, RED)
    for (const key of ['lane', 'skirmish', 'rotate', 'teamfight', 'siege'] as const) {
      expect(axes[key].blue).toBeGreaterThanOrEqual(0)
      expect(axes[key].blue).toBeLessThanOrEqual(100)
      expect(axes[key].red).toBeGreaterThanOrEqual(0)
      expect(axes[key].red).toBeLessThanOrEqual(100)
    }
  })

  it('线上对位：中路沈梦溪压不知火舞、发育路艾琳压后羿', () => {
    const rows = matchup.laneMatchups(BLUE, RED)
    const mid = rows.find((row) => row.lane === '中路')
    const bot = rows.find((row) => row.lane === '发育路')
    expect(mid?.blue?.name).toBe('沈梦溪')
    expect(mid!.blue!.score).toBeGreaterThan(mid!.red!.score)
    expect(bot?.blue?.name).toBe('艾琳')
    expect(bot!.blue!.score).toBeGreaterThan(bot!.red!.score)
  })

  it('对抗路曹操的线权高于关羽', () => {
    const rows = matchup.laneMatchups(BLUE, RED)
    const top = rows.find((row) => row.lane === '对抗路')
    expect(top?.red?.name).toBe('曹操')
    expect(top!.red!.score).toBeGreaterThan(top!.blue!.score)
  })

  it('没有对应英雄时标为无人，不虚构对位', () => {
    // 红方只落了对抗路与发育路，中路与游走应判为无人
    const rows = matchup.laneMatchups(BLUE, [ID.caocao, ID.houyi])
    const vacant = rows.find((row) => row.vacant)
    expect(vacant).toBeTruthy()
    expect(vacant?.leader).toBe('blue')
    expect(vacant?.blue?.name).toBeTruthy()
  })
})

// 用户实战阵容：敖隐+元流之子(坦克)+司空震+钟馗+小乔
const FLEX_BLUE = [ID.aoyin, ID.yuantan, ID.sikongzhen, ID.zhongkui, ID.xiaoqiao]
const FLEX_RED = [ID.caocao, ID.zhaoyun, ID.zhangfei, ID.huowu, ID.houyi]

describe('分路落位：五个位置一次分配，不因先选先占', () => {
  it('元流之子与司空震都是对抗/打野，自动排布后两条路都有人', () => {
    const rows = matchup.laneMatchups(FLEX_BLUE, FLEX_RED)
    const top = rows.find((row) => row.lane === '对抗路')
    const jungle = rows.find((row) => row.lane === '打野')
    expect(rows.filter((row) => row.vacant)).toHaveLength(0)
    expect(top?.blue?.name).toBe('司空震')
    expect(jungle?.blue?.name).toBe('元流之子(坦克)')
  })

  it('五名英雄各自只占一路', () => {
    const rows = matchup.laneMatchups(FLEX_BLUE, FLEX_RED)
    const names = rows.map((row) => row.blue?.name)
    expect(names).toHaveLength(5)
    expect(new Set(names).size).toBe(5)
  })

  it('手动排布优先于自动分配', () => {
    const rows = matchup.laneMatchups(
      FLEX_BLUE,
      FLEX_RED,
      { [ID.sikongzhen]: 2, [ID.yuantan]: 1 },
      null,
    )
    expect(rows.find((row) => row.lane === '打野')?.blue?.name).toBe('司空震')
    expect(rows.find((row) => row.lane === '对抗路')?.blue?.name).toBe('元流之子(坦克)')
    expect(rows.find((row) => row.lane === '游走')?.blue?.name).toBe('钟馗')
  })

  it('把人硬塞到非本路时标成补位', () => {
    const rows = matchup.laneMatchups([ID.zhangfei], [], { [ID.zhangfei]: 1 }, null)
    const top = rows.find((row) => row.lane === '对抗路')
    expect(top?.blue?.name).toBe('张飞')
    expect(top?.blue?.natural).toBe(false)
  })
})

describe('AI 禁人不重复禁同一分路', () => {
  it('对方已有艾琳时，禁伽罗/鲁班/黄忠的收益必须低于禁一个真实缺口位', () => {
    const myPicks = [ID.dunshan, ID.ailin, ID.guanyu, ID.shenmengxi]
    const oppPicks = [ID.caocao, ID.zhangfei, ID.houyi, ID.huowu]
    const available = heroes
      .map((hero) => hero.id)
      .filter((id) => !myPicks.includes(id) && !oppPicks.includes(id))
    const ranked = advisor.rank({ teamPicks: oppPicks, available, myPicks, limit: 200, mode: 'ban' })
    const rankOf = (id: number) => ranked.findIndex((item) => item.id === id) + 1
    const best = ranked[0]

    for (const shooter of [ID.gali, ID.luban, ID.huangzhong]) {
      expect(rankOf(shooter)).toBeGreaterThan(20)
    }
    // 榜首必须是能真正补上对方缺口的英雄，而不是第二个射手
    expect([ID.gali, ID.luban, ID.huangzhong]).not.toContain(best.id)
  })

  it('对方没有射手时，禁鲁班仍被视为拆保护链的高价值操作', () => {
    const myPicks = [ID.dunshan]
    const oppPicks = [ID.caocao, ID.zhangfei, ID.huowu]
    const available = heroes
      .map((hero) => hero.id)
      .filter((id) => !myPicks.includes(id) && !oppPicks.includes(id))
    const ranked = advisor.rank({ teamPicks: oppPicks, available, myPicks, limit: 200, mode: 'ban' })
    const luban = ranked.find((item) => item.id === ID.luban)
    expect(luban).toBeTruthy()
    expect(luban!.adjusted).toBeGreaterThan(0)
  })
})
