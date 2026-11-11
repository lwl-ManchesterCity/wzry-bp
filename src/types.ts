export type Side = 'blue' | 'red'
export type DraftMode = 'single' | 'global'
export type MatchFormat = 1 | 3 | 5 | 7
export type RuleSet = 'kpl2026' | 'classic'
export type ActionType = 'ban' | 'pick'
export type Opponent = 'human' | 'ai'

export interface Hero {
  id: number
  name: string
  title: string
  avatar: string
  classId: number
  laneIds: number[]
  pickGroup: string
}

export interface DraftStep {
  side: Side
  type: ActionType
}

export interface DraftAction extends DraftStep {
  heroId: number
}

export interface Game {
  number: number
  isPeak: boolean
  actions: DraftAction[]
  completedAt?: string
}

export interface SeriesSettings {
  mode: DraftMode
  format: MatchFormat
  ruleset: RuleSet
  /** human: 双方都由人操作；ai: 由模型接管 humanSide 的对面一方 */
  opponent: Opponent
  /** 人机对战时玩家执掌的一方 */
  humanSide: Side
}

export interface SeriesSnapshot {
  settings: SeriesSettings
  blueName: string
  redName: string
  previousGames: Game[]
  currentGame: Game
  /** heroId -> laneId，复盘按这份排布计算逐路对位 */
  lineups?: { blue: Record<number, number>; red: Record<number, number> }
}

export interface ReviewVerdict {
  favoredSide: Side | 'even'
  blueWinRate: number
  redWinRate: number
  confidence: string
  summary: string
}

export interface TeamReview {
  strengths: string[]
  weaknesses: string[]
  gameplan: string[]
  keyTiming: string
}

export interface MatchupReview {
  title: string
  analysis: string
  /** 该条结论引用的实时事实编号，服务端已校验存在 */
  factKeys?: string[]
  /** 没有任何有效事实引用时置 true，前端应标注为推断 */
  unverified?: boolean
  droppedKeys?: number
}

export interface SynergyNote {
  side: Side
  combo: string
  name: string
  tier: 'strong' | 'conditional'
  impact: string
  counter: string
}

export interface DraftReview {
  verdict: ReviewVerdict
  blue: TeamReview
  red: TeamReview
  synergyNotes: SynergyNote[]
  matchups: MatchupReview[]
  keyFactors: string[]
}

export interface ComboHit {
  name: string
  tier: 'strong' | 'conditional'
  heroes: string[]
  mechanism: string
  need: string
  /** explicit: 人工收录的经典搭配；derived: 按英雄功能标签运行时推导 */
  source?: 'explicit' | 'derived'
  kind?: string
  strength?: number
}

export interface BrokenCombo {
  name: string
  tier: string
  held: string
  missing: string
  mechanism: string
}

export interface TeamStructure {
  sample: number
  unknown: string[]
  front: number
  engageScore: number
  engageCount: number
  hardEngage: string[]
  fragileCarry: string[]
  protectors: string[]
  peelCount: number
  peelScore: number
  pokeScore: number
  pokeCount: number
  burstCount: number
  sustainScore: number
  mobilityAvg: number
  controlScore: number
  damageMix: { phys: number; magic: number; true: number; mixed: number }
  phaseCount: { early: number; mid: number; late: number }
}

export interface StructureFinding {
  level: 'strong' | 'weak'
  title: string
  detail: string
}

export interface TeamSynergy {
  combos: ComboHit[]
  broken: BrokenCombo[]
  structure: TeamStructure
  findings: StructureFinding[]
}

export interface AxisScore {
  blue: number
  red: number
  diff: number
  blueRaw: number
  redRaw: number
  blueDrivers: string[]
  redDrivers: string[]
}

export interface LaneMatchup {
  lane: string
  blue: { name: string; score: number; reasons: string[]; natural?: boolean } | null
  red: { name: string; score: number; reasons: string[]; natural?: boolean } | null
  edge: number
  leader: Side | 'even'
  vacant: boolean
  driver: string[]
}

export interface SynergyBasis {
  blue: TeamSynergy
  red: TeamSynergy
  crossNotes: string[]
  axes?: Record<'lane' | 'skirmish' | 'rotate' | 'teamfight' | 'siege', AxisScore> | null
  lanes?: LaneMatchup[] | null
  axisNotes?: string[]
}

export interface HeroStatLine {
  heroId: number
  name: string
  job: string
  lane: string
  games: number
  winRate: number | null
}

export interface StatsBasis {
  season: string
  seasonName: string
  seasonRange: string
  source: string
  sourceUrl: string
  fetchedAt: string
  blue: { picks: HeroStatLine[]; bans: HeroStatLine[] }
  red: { picks: HeroStatLine[]; bans: HeroStatLine[] }
}
