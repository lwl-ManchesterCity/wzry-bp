/**
 * AI 教练思路（drafting identity）
 *
 * 之前 AI 每局都照同一张榜单选人：局面一样 → 分数一样 → 结果一样。
 * 这里给每局抽一个「本局思路」，它改变打分权重，而不是改变胜负判定:
 *   - 思路决定「什么样的英雄算好」，于是首抢、连招搭配、Ban 目标都会变；
 *   - 同一系列赛内按局号轮转，第 2 局不会继续用第 1 局的思路。
 *
 * 权重口径：traits 每点加多少分（0-3 分档），macro 同理。
 * strength 是赛季强度分的乘数，comboStrong / comboConditional 是组合协同分的乘数，
 * adapt 是「看对手调整」那一项的乘数。
 */

export const DRAFT_STYLES = [
  {
    key: 'meta',
    label: '版本答案',
    summary: '强度优先，抢版本强势、禁版本强势',
    pickHint: '按版本强度与通用适配度取舍，不刻意追体系',
    banHint: '禁对手最可能一抢的版本强势点',
    strength: 1.4,
    banStrength: 1.35,
    comboStrong: 1.0,
    comboConditional: 0.9,
    traits: { front: 1, control: 1 },
    banTraits: {},
    macro: {},
    banMacro: {},
    phaseBias: {},
    adapt: 0.7,
  },
  {
    key: 'engage',
    label: '强开团',
    summary: '先手开团 + 控制链，靠一波团战切死',
    pickHint: '优先能先手开团、控制链连续、前排敢冲的英雄',
    banHint: '优先拆对手的保护与续航，让开团切进去就出不来',
    strength: 0.95,
    banStrength: 0.85,
    comboStrong: 1.15,
    comboConditional: 1.1,
    traits: { engage: 8, control: 4, front: 2 },
    banTraits: { peel: 7, sustain: 3 },
    macro: { controlResist: 1 },
    banMacro: {},
    phaseBias: {},
    adapt: 1.0,
  },
  {
    key: 'protect',
    label: '保核心',
    summary: '四保一，资源全压在后期大核上',
    pickHint: '优先保护与续航，围绕一个后期大核搭保护链',
    banHint: '优先禁掉能越过前排威胁我方大核的英雄',
    strength: 0.9,
    banStrength: 0.85,
    comboStrong: 1.25,
    comboConditional: 1.0,
    traits: { peel: 7, sustain: 3 },
    banTraits: { burst: 4, mobility: 3 },
    macro: {},
    banMacro: { flank: 5 },
    phaseBias: { late: 8, early: -2 },
    adapt: 1.0,
  },
  {
    key: 'siege',
    label: '运营推进',
    summary: '清线快、推进强，靠兵线与塔差滚雪球',
    pickHint: '优先清线与推进，能持续压塔、逼对手接团',
    banHint: '优先禁掉对手清线快、能拖后期的英雄',
    strength: 0.95,
    banStrength: 0.85,
    comboStrong: 1.05,
    comboConditional: 1.05,
    traits: { poke: 2 },
    banTraits: {},
    macro: { siege: 6, waveclear: 5, lanePressure: 3, aoe: 2 },
    banMacro: { waveclear: 4, siege: 2 },
    phaseBias: {},
    adapt: 1.0,
  },
  {
    key: 'pickoff',
    label: '抓单切入',
    summary: '绕后抓单秒掉核心，靠人数差打团',
    pickHint: '优先绕后机动与爆发，能单点秒杀脆皮',
    banHint: '优先禁掉对手的高机动脉冲与保人英雄',
    strength: 0.95,
    banStrength: 0.85,
    comboStrong: 1.1,
    comboConditional: 1.05,
    traits: { burst: 5, mobility: 4 },
    banTraits: { peel: 5, sustain: 2 },
    macro: { flank: 7, dps: 2 },
    banMacro: {},
    phaseBias: {},
    adapt: 1.1,
  },
  {
    key: 'counter',
    label: '针对性',
    summary: '以拆对手为主，禁选都冲着对手的成型点去',
    pickHint: '优先能压制对手已选英雄的对位与反手',
    banHint: '禁掉对手成型所需的最后一块拼图，而不是泛泛的强英雄',
    strength: 0.85,
    banStrength: 0.8,
    comboStrong: 1.0,
    comboConditional: 1.15,
    traits: {},
    banTraits: { peel: 3 },
    macro: { controlResist: 1 },
    banMacro: {},
    phaseBias: {},
    adapt: 1.9,
  },
]

export const STYLE_BY_KEY = new Map(DRAFT_STYLES.map((style) => [style.key, style]))

/** 字符串 → 32 位无符号整数，用于把系列赛种子稳定映射成思路 */
function hashString(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * 同一系列赛里每局换一种思路：相邻两局一定不同。
 * seriesIndex 是前端记的「第几场系列赛」，给了它就按序号轮转，
 * 保证每开一场新的系列赛，AI 一定换一种打法，而不是靠运气不撞车。
 * 没给时退回用种子散列，同一个种子仍然稳定复现。
 */
export function styleForGame(seed, gameNumber = 1, seriesIndex = null) {
  const count = DRAFT_STYLES.length
  const base = Number.isFinite(Number(seriesIndex)) && seriesIndex !== null
    ? Number(seriesIndex)
    : hashString(String(seed ?? 'default'))
  const offset = Math.max(0, Number(gameNumber) - 1)
  return DRAFT_STYLES[(((base + offset) % count) + count) % count]
}

/** 局面里任何一处变化都会让噪声变，但同样的输入永远得到同样的结果，便于测试与复盘 */
export function seededUnit(seed, ...parts) {
  const text = [seed ?? 'default', ...parts].join('|')
  let value = hashString(text)
  value ^= value >>> 15
  value = Math.imul(value, 2246822507)
  value ^= value >>> 13
  return (value >>> 0) / 4294967296
}
