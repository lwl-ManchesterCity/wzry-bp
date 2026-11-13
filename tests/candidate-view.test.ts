import { describe, expect, it } from 'vitest'
import { toCandidateView } from '../server/candidate-view.mjs'

describe('toCandidateView', () => {
  it('按整队评分从高到低排序', () => {
    const view = toCandidateView([
      { id: 1, name: 'A', score: 40 },
      { id: 2, name: 'B', score: 130 },
      { id: 3, name: 'C', score: 88 },
    ])
    expect(view.map((item) => item.name)).toEqual(['B', 'C', 'A'])
  })

  it('选人模式取整队五人名单，禁人字段留空', () => {
    const view = toCandidateView([
      { id: 189, name: '鲁班大师', lane: '游走', score: 150, plan: { names: ['鲁班大师', '女娲', '黄忠', '铠', '赵云'] } },
    ])
    expect(view[0].lineup).toEqual(['鲁班大师', '女娲', '黄忠', '铠', '赵云'])
    expect(view[0].banImpact).toBeNull()
    expect(view[0].banTarget).toBeNull()
  })

  it('禁人模式取禁用收益与对手原方案', () => {
    const view = toCandidateView([
      {
        id: 189,
        name: '鲁班大师',
        score: 280,
        banImpact: 34.08,
        plan: { before: { names: ['鲁班大师', '女娲'] }, after: { names: ['女娲'] } },
      },
    ])
    expect(view[0].banImpact).toBe(34.1)
    expect(view[0].banTarget).toEqual(['鲁班大师', '女娲'])
    expect(view[0].lineup).toBeNull()
  })

  it('过滤掉已经结构化表达的三类理由原句', () => {
    const view = toCandidateView([
      {
        id: 1,
        name: 'A',
        score: 10,
        reasons: ['整队方案：A、B、C', '阻止对手补成：D、E', '禁后对手最佳整队评分下降 12.3', '补充前排承伤'],
      },
    ])
    expect(view[0].reasons).toEqual(['补充前排承伤'])
  })

  it('理由最多保留三条', () => {
    const view = toCandidateView([{ id: 1, name: 'A', score: 10, reasons: ['一', '二', '三', '四', '五'] }])
    expect(view[0].reasons).toHaveLength(3)
  })

  it('缺少整队方案时不抛错，字段留空', () => {
    const view = toCandidateView([{ id: 7, name: 'A', score: '63.6', reasons: undefined, plan: null }])
    expect(view[0]).toMatchObject({ heroId: 7, score: 64, reasons: [], lineup: null, banImpact: null })
  })

  it('输入不是数组时返回空列表', () => {
    expect(toCandidateView(null)).toEqual([])
    expect(toCandidateView(undefined)).toEqual([])
  })

  it('plan 存在但没有 names 时视为无方案', () => {
    const withNames = toCandidateView([{ id: 3, name: 'A', score: 5, plan: { names: ['A', 'B'], score: 120 } }])
    expect(withNames[0].lineup).toEqual(['A', 'B'])
    const withoutNames = toCandidateView([{ id: 4, name: 'B', score: 5, plan: { score: 99 } }])
    expect(withoutNames[0].lineup).toBeNull()
  })
})
