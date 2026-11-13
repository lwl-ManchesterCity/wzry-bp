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
  /** 以下七项来自 macro 标注，缺失时为 null（不能拿 0 当真实值） */
  waveclear?: number | null
  siege?: number | null
  lanePressure?: number | null
  controlResist?: number | null
  splitters?: string[]
  splitCount?: number
}

export type PathStatus = 'open' | 'contested' | 'blocked' | 'unknown'

export interface WinPath {
  key: 'teamfight' | 'siege' | 'pick'
  label: string
  status: PathStatus
  statusLabel: string
  detail: string
}

export interface WinPathSummary {
  /** 三条路：可执行 2 分、受制 1 分、被封死 0 分 */
  score: number
  paths: WinPath[]
  open: number
  contested: number
  blocked: number
  usable: number
}

export interface CompositionCheck {
  key: string
  label: string
  ok: boolean
  detail: string
}

export interface CompositionJudge {
  passed: number
  total: number
  tier: 'S' | 'A' | 'B' | 'C'
  tierLabel: string
  checks: CompositionCheck[]
  missing: string[]
  paths?: WinPathSummary | null
}

export interface CompositionCompare {
  blue: CompositionJudge
  red: CompositionJudge
  gap: number
  paths?: { blue: WinPathSummary; red: WinPathSummary; gap: number; side: Side | null; text: string } | null
  hint: { active: boolean; side: Side | null; text: string }
}

export interface MetaHeroScore {
  id: number
  name: string
  score: number | null
  tier: string
  games: number
  winRate: number | null
  note: string
}

export interface MetaTeam {
  avg: number | null
  knownCount: number
  noSample: string[]
  members: MetaHeroScore[]
}
export interface MetaCompare {
  blue: MetaTeam
  red: MetaTeam
  diff: number | null
  leader: Side | 'even' | null
  evenNoSample: boolean
  policy?: { diagnosticOnly: boolean; closureGap: number; text: string }
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
  meta?: MetaCompare | null
  closure?: CompositionCompare | null
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

/** AI 一手的候选之一，服务端已按整队评分从高到低排序 */
export interface AiDraftCandidate {
  heroId: number
  name: string
  lane: string
  score: number
  reasons: string[]
  /** 选人时：这一手能凑成的五人阵容 */
  lineup: string[] | null
  /** 禁人时：禁掉之后对手最佳整队评分的下降值 */
  banImpact: number | null
  /** 禁人时：对手本来能凑成的五人阵容 */
  banTarget: string[] | null
}

export interface AiDraftResult {
  heroId: number
  heroName: string
  reason: string
  engine: 'deepseek' | 'rules'
  style: { key: string; label: string; summary: string } | null
  shortlist?: AiDraftCandidate[]
  error?: string
}
