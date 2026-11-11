export declare const LANE_IDS: readonly number[]
export declare const LANE_LABEL: Record<number, string>

export interface LaneHeroLike {
  id: number
  laneIds: number[]
  classId?: number
}

export declare function laneFit(hero: LaneHeroLike | null | undefined, lane: number): number

export declare function solveLineup(
  heroes: LaneHeroLike[],
  fixed?: Record<string | number, number>,
): Record<number, number>
