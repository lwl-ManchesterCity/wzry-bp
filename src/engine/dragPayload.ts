import type { Side } from '../types'

/** 侧栏与排布面板共用的拖拽 wire 格式：`${side}:${heroId}` */
export const HERO_DRAG_MIME = 'application/x-bp-hero'

export function setHeroDrag(data: DataTransfer, side: Side, heroId: number): void {
  const payload = `${side}:${heroId}`
  data.setData(HERO_DRAG_MIME, payload)
  data.setData('text/plain', payload)
  data.effectAllowed = 'move'
}

export function readHeroDrag(data: DataTransfer | null): { side: Side; heroId: number } | null {
  const raw = data?.getData(HERO_DRAG_MIME) || data?.getData('text/plain') || ''
  const [side, id] = raw.split(':')
  if (side !== 'blue' && side !== 'red') return null
  const heroId = Number(id)
  if (!id || !Number.isFinite(heroId)) return null
  return { side, heroId }
}