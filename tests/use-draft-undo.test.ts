import { describe, expect, it } from 'vitest'
import { useDraft } from '../src/composables/useDraft'
import { addAction, createGame, getCurrentStep } from '../src/engine/draft'
import type { Hero, Side } from '../src/types'

const heroes: Hero[] = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  name: `英雄${index + 1}`,
  title: '',
  avatar: '',
  classId: 1,
  laneIds: [1],
  pickGroup: `hero-${index + 1}`,
}))

function setup(opponent: 'ai' | 'human', humanSide: Side = 'blue', peak = false) {
  const draft = useDraft(heroes)
  draft.settings.opponent = opponent
  draft.settings.humanSide = humanSide
  draft.currentGame.value = createGame(peak ? 7 : 1, 7)
  return draft
}

type Draft = ReturnType<typeof setup>

function push(draft: Draft, side: Side, type: 'ban' | 'pick', heroId: number) {
  addAction(draft.currentGame.value, { side, type, heroId }, draft.previousGames.value, draft.settings, heroes)
}

function fourBans(draft: Draft) {
  push(draft, 'blue', 'ban', 1)
  push(draft, 'red', 'ban', 2)
  push(draft, 'blue', 'ban', 3)
  push(draft, 'red', 'ban', 4)
}

describe('人机模式撤销', () => {
  it('撤掉自己上一手连同 AI 的应手，回到轮到人类', () => {
    const draft = setup('ai')
    fourBans(draft)
    push(draft, 'blue', 'pick', 5)
    push(draft, 'red', 'pick', 6)
    draft.undo()
    expect(draft.currentGame.value.actions.map((action) => action.heroId)).toEqual([1, 2, 3, 4])
    expect(getCurrentStep(draft.currentGame.value, 'kpl2026')).toEqual({ side: 'blue', type: 'pick' })
  })

  it('AI 回合中撤销只撤掉人类那一手，不会留下 AI 回合', () => {
    const draft = setup('ai')
    fourBans(draft)
    push(draft, 'blue', 'pick', 5)
    draft.undo()
    expect(draft.currentGame.value.actions).toHaveLength(4)
    expect(getCurrentStep(draft.currentGame.value, 'kpl2026')).toEqual({ side: 'blue', type: 'pick' })
  })

  it('终局后撤销解除锁定并回到人类最后一手之前', () => {
    const draft = setup('ai')
    let heroId = 1
    while (getCurrentStep(draft.currentGame.value, 'kpl2026')) {
      const step = getCurrentStep(draft.currentGame.value, 'kpl2026')!
      push(draft, step.side, step.type, heroId)
      heroId += 1
    }
    expect(draft.currentGame.value.completedAt).toBeDefined()
    draft.undo()
    expect(draft.currentGame.value.actions).toHaveLength(18)
    expect(draft.currentGame.value.completedAt).toBeUndefined()
    expect(getCurrentStep(draft.currentGame.value, 'kpl2026')).toEqual({ side: 'blue', type: 'pick' })
  })

  it('巅峰对决撤掉自己最后一选及其后的 AI 选择，并回到人类输入侧', () => {
    const draft = setup('ai', 'blue', true)
    for (let id = 1; id <= 5; id += 1) push(draft, 'blue', 'pick', id)
    push(draft, 'red', 'pick', 6)
    push(draft, 'red', 'pick', 7)
    draft.undo()
    expect(draft.currentGame.value.actions.map((action) => action.heroId)).toEqual([1, 2, 3, 4])
    expect(draft.peakSide.value).toBe('blue')
  })

  it('还没有人类操作时撤销不动局面', () => {
    const draft = setup('ai', 'red')
    push(draft, 'blue', 'ban', 1)
    draft.undo()
    expect(draft.currentGame.value.actions).toHaveLength(1)
  })

  it('双人对战仍是一手一撤', () => {
    const draft = setup('human')
    fourBans(draft)
    push(draft, 'blue', 'pick', 5)
    push(draft, 'red', 'pick', 6)
    draft.undo()
    expect(draft.currentGame.value.actions).toHaveLength(5)
  })
})