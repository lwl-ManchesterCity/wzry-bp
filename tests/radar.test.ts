import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createSynergyEngine, RADAR_KEYS } from '../server/synergy.mjs'
import type { Hero } from '../src/types'

const root = path.resolve(__dirname, '..')
const heroes: Hero[] = JSON.parse(readFileSync(path.join(root, 'src/data/heroes.json'), 'utf8'))
const synergy = JSON.parse(readFileSync(path.join(root, 'src/data/hero-synergy.json'), 'utf8'))

let engine: ReturnType<typeof createSynergyEngine>
beforeAll(() => {
  engine = createSynergyEngine({ synergy, heroes })
})

// 鲁班七号 盾山 司马震 镜 武则天
const LINEUP = [112, 509, 537, 531, 136]

describe('八维雷达底层量', () => {
  it('raw 与 structure 同口径：求和 / 阈值计数(>=3) / 机动均值', () => {
    const { structure } = engine.analyzeTeam(LINEUP, [])
    const { raw } = engine.radarProfile(LINEUP)
    expect(raw).toEqual([
      structure.front,
      structure.engageCount,
      structure.strongPeelCount,
      structure.pokeScore,
      structure.burstCount,
      structure.sustainScore,
      structure.mobilityAvg,
      structure.controlScore,
    ])
  })

  it('轴顺序与 RADAR_KEYS 一致，共 8 维', () => {
    expect(RADAR_KEYS).toHaveLength(8)
    const { raw, pct } = engine.radarProfile(LINEUP)
    expect(raw).toHaveLength(8)
    expect(pct).toHaveLength(8)
  })
})

describe('八维雷达百分位归一', () => {
  it('pct 全部落在 0-100', () => {
    for (const v of engine.radarProfile(LINEUP).pct) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('语料规模固定 4000，且同种子跨引擎可复现', () => {
    const a = engine.radarProfile(LINEUP)
    const b = createSynergyEngine({ synergy, heroes }).radarProfile(LINEUP)
    expect(a.corpusSize).toBe(4000)
    expect(a).toEqual(b)
  })

  it('归一走经验百分位，不是 raw/15 的理论上限', () => {
    const { raw, pct } = engine.radarProfile(LINEUP)
    const naive = raw.map((v) => Math.round((v / 15) * 100))
    expect(pct).not.toEqual(naive)
  })

  it('百分位对原始值单调：同一轴 raw 越大 pct 不减', () => {
    const samples = [
      LINEUP,
      [112, 509, 537, 531, 109],
      [157, 189, 531, 537, 136],
      [166, 167, 111, 312, 184],
    ].map((p) => engine.radarProfile(p))
    for (let i = 0; i < RADAR_KEYS.length; i += 1) {
      const sorted = [...samples].sort((a, b) => a.raw[i] - b.raw[i])
      for (let k = 1; k < sorted.length; k += 1) {
        expect(sorted[k].pct[i]).toBeGreaterThanOrEqual(sorted[k - 1].pct[i])
      }
    }
  })

  it('零能力归 0：原始值为 0 的轴百分位必须为 0（严格小于口径）', () => {
    const samples = [
      LINEUP,
      [112, 509, 537, 531, 109],
      [157, 189, 531, 537, 136],
      [166, 167, 111, 312, 184],
    ]
    let checked = 0
    for (const picks of samples) {
      const { raw, pct } = engine.radarProfile(picks)
      raw.forEach((value, i) => {
        if (value === 0) {
          expect(pct[i]).toBe(0)
          checked += 1
        }
      })
    }
    expect(checked).toBeGreaterThan(0)
  })
})