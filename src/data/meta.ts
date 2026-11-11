export const HERO_CLASSES = [
  { id: 0, label: '全部职业' },
  { id: 3, label: '坦克' },
  { id: 1, label: '战士' },
  { id: 4, label: '刺客' },
  { id: 2, label: '法师' },
  { id: 5, label: '射手' },
  { id: 6, label: '辅助' },
] as const

export const LANES = [
  { id: 0, label: '全部分路' },
  { id: 1, label: '对抗路' },
  { id: 2, label: '打野' },
  { id: 3, label: '中路' },
  { id: 4, label: '发育路' },
  { id: 5, label: '游走' },
] as const

export const CLASS_NAMES: Record<number, string> = {
  1: '战士',
  2: '法师',
  3: '坦克',
  4: '刺客',
  5: '射手',
  6: '辅助',
}

export const LANE_NAMES: Record<number, string> = {
  1: '对抗路',
  2: '打野',
  3: '中路',
  4: '发育路',
  5: '游走',
}
