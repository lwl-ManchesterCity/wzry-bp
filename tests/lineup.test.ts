import { describe, expect, it } from 'vitest'
import { applyLaneDrop, invertLineup, laneOfHero, resolveLanes } from '../src/engine/lineup'
import type { Hero } from '../src/types'

const hero = (id: number, name: string, laneIds: number[], classId = 1): Hero => ({
  id,
  name,
  laneIds,
  classId,
  title: '',
  avatar: '',
  pickGroup: '',
})

// 用户实战阵容：敖隐射手、元流之子(坦克)、司空震、钟馗、小乔
const PICKS = [
  hero(519, '敖隐', [4], 5),
  hero(581, '元流之子(坦克)', [1, 2], 3),
  hero(537, '司空震', [1, 2], 1),
  hero(175, '钟馗', [5], 6),
  hero(106, '小乔', [3], 2),
]

describe('客户端分路落位', () => {
  it('自动排布把两名对抗/打野分到两条不同的路', () => {
    const lanes = resolveLanes(PICKS)
    expect(lanes[1]).toBe(537)
    expect(lanes[2]).toBe(581)
    expect(Object.keys(lanes)).toHaveLength(5)
  })

  it('拖拽换位后两人互换，其余位置不动', () => {
    const manual = applyLaneDrop(PICKS, {}, 537, 2)
    const lanes = resolveLanes(PICKS, manual)
    expect(lanes[2]).toBe(537)
    expect(lanes[1]).toBe(581)
    expect(lanes[3]).toBe(106)
    expect(lanes[4]).toBe(519)
    expect(lanes[5]).toBe(175)
  })

  it('拖到空位时其他人保持原位，heroId 映射可回传给服务端', () => {
    const partial = [PICKS[0], PICKS[3]] // 敖隐、钟馗
    const manual = applyLaneDrop(partial, {}, 175, 1)
    const lanes = resolveLanes(partial, manual)
    expect(lanes[1]).toBe(175)
    expect(lanes[4]).toBe(519)
    expect(laneOfHero(lanes, 175)).toBe(1)
    expect(invertLineup(lanes)[175]).toBe(1)
  })

  it('拖到已占位置时，原占位者回到被拖英雄的旧位置', () => {
    const manual = applyLaneDrop(PICKS, {}, 175, 1)
    const lanes = resolveLanes(PICKS, manual)
    expect(lanes[1]).toBe(175)
    expect(lanes[5]).toBe(537)
    expect(new Set(Object.values(lanes)).size).toBe(5)
  })
})
