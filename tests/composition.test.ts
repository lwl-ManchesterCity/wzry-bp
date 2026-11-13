import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine } from '../server/synergy.mjs'
import { judgeComposition, compareComposition, judgeWinPaths, metaUsagePolicy, checkVerdictConsistency } from '../server/composition.mjs'
import { createMetaModel } from '../server/meta-strength.mjs'
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
const metaModel = createMetaModel({ stats: read('kpl-stats.json'), heroes })!

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
  strongPeelCount: 0,
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

  it('front=6 归闭环判成立，结构诊断不得在同一数值判偏薄', () => {
    // 133 英雄随机抽 5 人（2 万组）：front p25=3 / p50=5 / p75=7，恰好 6 占 15.9%。
    // 诊断旧边界是 front<=6，这 15.9% 会同时收到「承伤点成立 ✓」与「前排承伤偏薄」两条相反结论
    expect(blueTeam.structure.front).toBe(6)
    const judged = judgeComposition(blueTeam, redTeam)!
    expect(judged.checks.find((check) => check.key === 'front')!.ok).toBe(true)
    expect(blueTeam.findings.some((item) => item.title === '前排承伤偏薄')).toBe(false)

    // 边界只错开一格：5 仍然判偏薄，不是把整段诊断关掉
    const thin = engine.analyzeTeam([115, 130, 141, 163, 170], [])
    expect(thin.structure.front).toBe(5)
    expect(thin.findings.some((item) => item.title === '前排承伤偏薄')).toBe(true)
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

  it('红方团战自身不成立，单抓被蓝方单人保护拖成受制', () => {
    const paths = judgeWinPaths(redTeam.structure, blueTeam.structure)!
    const byKey = Object.fromEntries(paths.paths.map((item) => [item.key, item]))
    // 前排 8/15 比蓝方厚，但伤害物理4/法术1，团战核心条件不成立
    expect(byKey.teamfight.status).toBe('blocked')
    expect(byKey.teamfight.detail).toContain('伤害类型单一')
    // 蓝方只有鲁班大师一个保人型（peel=2，无 peel>=3），单人保护只判受制，不再整条封死
    expect(blueTeam.structure.peelCount).toBe(1)
    expect(blueTeam.structure.strongPeelCount).toBe(0)
    expect(byKey.pick.status).toBe('contested')
    expect(byKey.pick.detail).toContain('鲁班大师')
    expect(byKey.siege.status).toBe('contested')
    expect(paths.blocked).toBe(1)
  })

  it('单抓路径：单人保护判受制，强保护或双人保护才封死', () => {
    // 2 万组随机 5v5：自身够格单抓的占 49.0%；旧条款 peel>=1 即封死会封掉其中 42.6%，
    // 改成「peel>=3 或保人型>=2」后降到 26.3%，其余转受制。
    // 对方 controlResist 一律置 0，把保护条款单独隔离出来测
    const own = structure()
    const pickOf = (opp: Record<string, unknown>) =>
      judgeWinPaths(own, structure(opp))!.paths.find((item) => item.key === 'pick')!

    expect(pickOf({ peelCount: 1, strongPeelCount: 0, protectors: ['单个保人'], controlResist: 0 }).status).toBe('contested')
    expect(pickOf({ peelCount: 1, strongPeelCount: 1, protectors: ['强保人'], controlResist: 0 }).status).toBe('blocked')
    expect(pickOf({ peelCount: 2, strongPeelCount: 0, protectors: ['保人甲', '保人乙'], controlResist: 0 }).status).toBe('blocked')
    // 单人保护但抗控极高时，仍按更硬的那条封死，不能因为降级就漏掉反打
    expect(pickOf({ peelCount: 1, strongPeelCount: 0, controlResist: 8 }).status).toBe('blocked')
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

  it('路径质量单独给出结论：蓝方 2 分对红方 2 分，判相当', () => {
    const result = compareComposition(
      judgeComposition(blueTeam, redTeam),
      judgeComposition(redTeam, blueTeam),
    )!
    expect(result.paths).not.toBeNull()
    // 蓝方团战可执行 2 分；红方推进与单抓各受制 1 分。单抓从封死改判受制后两侧持平
    expect(result.paths).toMatchObject({ gap: 0, side: null })
    expect(result.paths!.text).toContain('双方路径质量相当')
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
    expect(policy.sampleReady).toBe(true)
    expect(policy.text).toContain('平手裁决')
  })

  it('有效样本不足时，体系再接近也只作诊断', () => {
    const policy = metaUsagePolicy(0, false)
    expect(policy.diagnosticOnly).toBe(true)
    expect(policy.sampleReady).toBe(false)
    expect(policy.text).toContain('有效样本不足')
    expect(policy.text).toContain('不得据此改变胜负倾向')
  })
})

describe('verdict 一致性校验', () => {
  const closure = compareComposition(
    judgeComposition(blueTeam, redTeam),
    judgeComposition(redTeam, blueTeam),
  )!
  // 与 index.mjs 一致：policy 由体系差与样本量共同决定
  const metaOf = (blue: number[], red: number[], gap: number) => {
    const meta = metaModel.compare(blue, red)
    return { ...meta, policy: metaUsagePolicy(gap, meta.sampleReady) }
  }
  const meta = metaOf(BLUE, RED, Math.abs(closure.gap))

  const review = (patch: Record<string, unknown> = {}) => ({
    verdict: { favoredSide: 'blue', blueWinRate: 62, redWinRate: 38, confidence: '中', summary: '蓝方体系更完整' },
    blue: { strengths: [], weaknesses: [], gameplan: [], keyTiming: '' },
    red: { strengths: [], weaknesses: [], gameplan: [], keyTiming: '' },
    keyFactors: ['蓝方保护链成型'],
    ...patch,
  })
  const verdict = (patch: Record<string, unknown>) => review({ verdict: { ...review().verdict, ...patch } })

  it('倾向跟随体系差时判一致，不加任何标记', () => {
    expect(checkVerdictConsistency(review(), closure, meta)).toEqual({ ok: true, issues: [] })
  })

  it('体系差 3 个环节却判红方，标出违背体系优先', () => {
    const result = checkVerdictConsistency(verdict({ favoredSide: 'red', blueWinRate: 38, redWinRate: 62 }), closure, meta)
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(['体系差 3 个环节应跟随蓝方，模型判的是红方'])
  })

  it('用 50/50 抹平体系差同样要标出来', () => {
    const result = checkVerdictConsistency(verdict({ favoredSide: 'even', blueWinRate: 50, redWinRate: 50 }), closure, meta)
    expect(result.issues.some((text) => text.includes('模型判的是双方接近'))).toBe(true)
  })

  it('倾向与百分比自相矛盾时标出来，但不改数字', () => {
    const lean = verdict({ blueWinRate: 42, redWinRate: 58 })
    expect(checkVerdictConsistency(lean, closure, meta).issues).toContain('倾向蓝方，百分比却是蓝方 42%')
    expect(lean.verdict.blueWinRate).toBe(42)
    expect(checkVerdictConsistency(verdict({ favoredSide: 'even', blueWinRate: 55, redWinRate: 45 }), closure, meta).issues)
      .toContain('判双方接近，百分比却是 55:45')
  })

  it('路径对比反向时标出来（只取 paths.side 这一格）', () => {
    const redPaths = { gap: -1, hint: { active: false, side: null }, paths: { side: 'red' } }
    const result = checkVerdictConsistency(review(), redPaths as never, meta)
    expect(result.issues).toEqual(['路径质量红方更稳，模型倾向却给了蓝方'])
  })

  it('判双方接近不算与路径对比相反', () => {
    const redPaths = { gap: -1, hint: { active: false, side: null }, paths: { side: 'red' } }
    const even = verdict({ favoredSide: 'even', blueWinRate: 50, redWinRate: 50 })
    expect(checkVerdictConsistency(even, redPaths as never, meta).ok).toBe(true)
  })

  it('版本强度写进 keyFactors 就要标出来', () => {
    const result = checkVerdictConsistency(review({ keyFactors: ['蓝方版本层占优 16 分'] }), closure, meta)
    expect(result.issues.some((text) => text.includes('版本强度写进了决定胜负的因素'))).toBe(true)
  })

  it('样本不足时写「版本层占优」要标，样本充足时同一句不算违规', () => {
    const thin = metaOf([525, 114, 109], RED, 0)
    expect(thin.policy.sampleReady).toBe(false)
    const withMeta = review({ blue: { strengths: ['版本层占优 16 分'], weaknesses: [], gameplan: [], keyTiming: '' } })
    expect(checkVerdictConsistency(withMeta, closure, thin).issues).toContain('有效样本不足，仍写出「版本层占优」')
    expect(checkVerdictConsistency(withMeta, closure, meta).ok).toBe(true)
  })

  it('缺 verdict 或缺程序结论时不抛错', () => {
    expect(checkVerdictConsistency(null)).toEqual({ ok: true, issues: [] })
    expect(checkVerdictConsistency(review(), null, null).ok).toBe(true)
  })
})
