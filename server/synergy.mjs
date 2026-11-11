/**
 * 阵容协同分析引擎
 *
 * 数据层只说"每个英雄自己多强"，这里补的是"几个人放在一起会变成什么"。
 * 全部结论由程序算出，不依赖模型自觉：模型只负责解释，不负责发现。
 */

// traits 数组的维度顺序，与 hero-synergy.json 的 _schema 一致
export const DIMENSIONS = ['front', 'engage', 'peel', 'poke', 'burst', 'sustain', 'mobility', 'control']

const PHASE_LABEL = { early: '前中期', mid: '中期', late: '后期' }

function traitsOf(synergy, heroId) {
  const raw = synergy.traits[String(heroId)]
  if (!Array.isArray(raw) || raw.length !== 10) return null
  return {
    front: raw[0],
    engage: raw[1],
    peel: raw[2],
    poke: raw[3],
    burst: raw[4],
    sustain: raw[5],
    mobility: raw[6],
    control: raw[7],
    phase: raw[8],
    damage: raw[9],
  }
}

// macro 数组的维度顺序，与 hero-macro.json 的 _schema 一致
export const MACRO_DIMENSIONS = [
  'dps',
  'aoe',
  'waveclear',
  'siege',
  'flank',
  'lanePressure',
  'controlResist',
]

function macroOf(macro, heroId) {
  const raw = macro?.traits?.[String(heroId)]
  if (!Array.isArray(raw) || raw.length !== 7) return null
  return {
    dps: raw[0],
    aoe: raw[1],
    waveclear: raw[2],
    siege: raw[3],
    flank: raw[4],
    lanePressure: raw[5],
    controlResist: raw[6],
  }
}

export function createSynergyEngine({ synergy, heroes, macro = null }) {
  const heroMap = new Map(heroes.map((hero) => [Number(hero.id), hero]))
  const nameOf = (id) => heroMap.get(Number(id))?.name || `英雄${id}`
  const hasMacro = Boolean(macro?.traits)
  const primaryLane = (id) => heroMap.get(Number(id))?.laneIds?.[0] ?? null

  // 组合索引：把 ids 排序后拼 key，支持任意顺序的两人组
  const comboIndex = new Map()
  for (const combo of synergy.combos || []) {
    const key = [...combo.ids].map(Number).sort((a, b) => a - b).join('+')
    if (!comboIndex.has(key)) comboIndex.set(key, [])
    comboIndex.get(key).push(combo)
  }

  // 建立 英雄 -> 其所属强组合 的反向索引，用于检测"组合被 Ban 拆断"
  const combosByHero = new Map()
  for (const combo of synergy.combos || []) {
    for (const id of combo.ids) {
      const key = Number(id)
      if (!combosByHero.has(key)) combosByHero.set(key, [])
      combosByHero.get(key).push(combo)
    }
  }

  // 显式配对只覆盖人工枚举过的组合；没枚举到的真实搭配（例如盾山+艾琳）
  // 靠机制模板在运行时推导，避免「库里没有 = 不存在」
  function deriveCombos(picks) {
    if (!hasMacro) return []
    const list = picks
      .map((id) => ({ id: Number(id), name: nameOf(id), t: traitsOf(synergy, id), m: macroOf(macro, id) }))
      .filter((item) => item.t && item.m)
    const derived = []
    const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join('+')

    const push = (name, tier, a, b, mechanism, extra = {}) => {
      derived.push({
        name,
        tier,
        heroes: [a.name, b.name],
        mechanism,
        need: '',
        source: 'derived',
        kind: KIND[name] ?? 'other',
        ...extra,
      })
    }

    const KIND = {
      保护链: 'protection',
      消耗封锁: 'poke',
      开团接火: 'engage',
      切入收割: 'pickoff',
      对线换血: 'lane',
      推进压制: 'push',
    }

    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const A = list[i]
        const B = list[j]
        // 显式组合优先级更高，同一对不再重复推导，否则前端会出现两条近义结论
        if (comboIndex.has(pairKey(A.id, B.id))) continue

        // 保护链：保人型英雄 + 低机动持续输出核心
        let protectedHit = false
        for (const [P, C] of [[A, B], [B, A]]) {
          if (protectedHit) break
          if (P.t.peel >= 2 && C.m.dps >= 3 && C.t.mobility <= 2) {
            const strong = P.t.peel >= 3
            push(
              '保护链',
              strong ? 'strong' : 'conditional',
              P,
              C,
              `${P.name}提供正面封挡与护盾，${C.name}是缺位移的持续输出核心，只有贴住保护才能稳定进入输出位`,
              { carry: C.name, protector: P.name, recipient: C.name },
            )
            protectedHit = true
          }
        }

        // 消耗封锁：保人型 + 远程消耗
        for (const [P, Q] of [[A, B], [B, A]]) {
          if (P.id === Q.id) continue
          if (P.t.peel >= 2 && Q.t.poke >= 3) {
            push(
              '消耗封锁',
              'conditional',
              P,
              Q,
              `${P.name}挡住对方突进，${Q.name}在安全距离持续消耗，形成以血换塔的压制节奏`,
              { recipient: Q.name },
            )
            break
          }
        }

        // 开团接火：硬开团 + 范围伤害
        for (const [E, F] of [[A, B], [B, A]]) {
          if (E.t.engage >= 3 && F.m.aoe >= 3) {
            push(
              '开团接火',
              F.m.dps >= 2 ? 'strong' : 'conditional',
              E,
              F,
              `${E.name}先手把团战打起来，${F.name}的范围伤害在人群中一次结算，开团与伤害转化连成一体`,
              { recipient: F.name },
            )
            break
          }
        }

        // 切入收割：绕后 + 爆发
        for (const [D, K] of [[A, B], [B, A]]) {
          if (D.m.flank >= 3 && K.t.burst >= 3) {
            push(
              '切入收割',
              'conditional',
              D,
              K,
              `${D.name}从侧翼切入逼出对方走位，${K.name}跟进爆发完成击杀，对未受保护的脆皮威胁极大`,
              { recipient: K.name },
            )
            break
          }
        }

        // 对线换血：同路两个线霸
        if (
          primaryLane(A.id)
          && primaryLane(A.id) === primaryLane(B.id)
          && A.m.lanePressure >= 3
          && B.m.lanePressure >= 3
        ) {
          push(
            '对线换血',
            'conditional',
            A,
            B,
            `${A.name}与${B.name}同处一线且对线压制都强，正面对拼能持续换血，逼对手提前交技能或换线`,
          )
        }

        // 推进压制：远程点塔 + 快速清线
        for (const [S, W] of [[A, B], [B, A]]) {
          if (S.m.siege >= 3 && W.m.waveclear >= 3) {
            push(
              '推进压制',
              'conditional',
              S,
              W,
              `${W.name}快速清线推波，${S.name}在塔外安全点塔，兵线一到就能持续磨损防御塔`,
              { recipient: S.name },
            )
            break
          }
        }
      }
    }
    // 同一套「跟进位」被多个先手触发时只保留一条，避免列出三条近义结论
    const seenRecipient = new Set()
    return derived.filter((combo) => {
      if (!combo.recipient) return true
      const key = `${combo.name}|${combo.recipient}`
      if (seenRecipient.has(key)) return false
      seenRecipient.add(key)
      return true
    })
  }

  function detectCombos(picks) {
    const ids = picks.map(Number)
    const hits = []
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = [ids[i], ids[j]].sort((a, b) => a - b).join('+')
        for (const combo of comboIndex.get(key) || []) {
          hits.push({
            name: combo.name,
            tier: combo.tier,
            heroes: combo.ids.map(nameOf),
            mechanism: combo.mechanism,
            need: combo.need || '',
            source: 'explicit',
          })
        }
      }
    }
    hits.push(...deriveCombos(ids))

    // 排序不按「来源」，按这条组合在阵容里承担的作用：
    // 保护链决定核心能否输出，权重最高；消耗/推进属于次级手段。
    const KIND_BONUS = {
      protection: 35,
      engage: 28,
      pickoff: 20,
      push: 12,
      lane: 10,
      poke: 8,
      other: 0,
    }
    const inferKind = (combo) => {
      if (combo.kind) return combo.kind
      const name = combo.name
      if (name.includes('保护链') || name.includes('架炮') || name.includes('掩护')) return 'protection'
      if (name.includes('开团')) return 'engage'
      if (name.includes('爆发') || name.includes('逼抢')) return 'pickoff'
      if (name.includes('推进') || name.includes('点塔')) return 'push'
      if (name.includes('换血') || name.includes('对线')) return 'lane'
      if (name.includes('消耗') || name.includes('封锁')) return 'poke'
      return 'other'
    }
    return hits
      .map((combo) => {
        const kind = inferKind(combo)
        return { ...combo, kind, strength: (combo.tier === 'strong' ? 60 : 30) + (KIND_BONUS[kind] ?? 0) }
      })
      .sort((a, b) => b.strength - a.strength)
  }

  // 本方选到的英雄，其强组合的搭档被对方 Ban 掉 —— 保护链/开团链被提前拆解
  function detectBrokenCombos(picks, oppBans) {
    const pickSet = new Set(picks.map(Number))
    const banSet = new Set(oppBans.map(Number))

    // 已经和其他英雄组成强协同的人，不再提示「另一个备选组合被拆」，
    // 否则一个英雄挂 2-3 个组合时会产生大量噪音
    const satisfied = new Set()
    for (const id of pickSet) {
      for (const combo of combosByHero.get(id) || []) {
        if (combo.tier !== 'strong') continue
        const other = combo.ids.find((candidate) => Number(candidate) !== id)
        if (other !== undefined && pickSet.has(Number(other))) satisfied.add(id)
      }
    }

    const broken = []
    const seen = new Set()
    for (const id of pickSet) {
      if (satisfied.has(id)) continue
      for (const combo of combosByHero.get(id) || []) {
        if (combo.tier !== 'strong') continue
        const partner = combo.ids.find((other) => Number(other) !== id)
        if (partner === undefined) continue
        if (pickSet.has(Number(partner)) || !banSet.has(Number(partner))) continue
        const key = `${id}-${partner}`
        if (seen.has(key)) continue
        seen.add(key)
        broken.push({
          name: combo.name,
          tier: combo.tier,
          held: nameOf(id),
          missing: nameOf(partner),
          mechanism: combo.mechanism,
        })
      }
    }
    return broken
  }

  function summarizeStructure(picks) {
    const list = picks
      .map((id) => ({ id: Number(id), name: nameOf(id), traits: traitsOf(synergy, id) }))
      .filter((item) => item.traits)
    const unknown = picks.filter((id) => !traitsOf(synergy, id)).map(nameOf)

    const sum = (key) => list.reduce((total, item) => total + item.traits[key], 0)
    const countAtLeast = (key, threshold) => list.filter((item) => item.traits[key] >= threshold).length

    const damageMix = { phys: 0, magic: 0, true: 0, mixed: 0 }
    for (const item of list) damageMix[item.traits.damage] += 1

    const phaseCount = { early: 0, mid: 0, late: 0 }
    for (const item of list) phaseCount[item.traits.phase] += 1

    // 硬开团要求 engage>=3；engage==2 只能算次级进场/半开团
    const hardEngage = list.filter((item) => item.traits.engage >= 3).map((item) => item.name)
    // 脆皮后期核心：自己站不住、又需要打到后期才有输出
    const fragileCarry = list
      .filter((item) => item.traits.phase === 'late' && item.traits.mobility <= 1 && item.traits.front === 0)
      .map((item) => item.name)
    const protectors = list.filter((item) => item.traits.peel >= 2).map((item) => item.name)

    return {
      sample: list.length,
      unknown,
      front: sum('front'),
      engageScore: sum('engage'),
      engageCount: hardEngage.length,
      hardEngage,
      fragileCarry,
      protectors,
      peelCount: countAtLeast('peel', 2),
      peelScore: sum('peel'),
      pokeScore: sum('poke'),
      pokeCount: countAtLeast('poke', 2),
      burstCount: countAtLeast('burst', 3),
      sustainScore: sum('sustain'),
      mobilityAvg: list.length ? Number((sum('mobility') / list.length).toFixed(2)) : 0,
      controlScore: sum('control'),
      damageMix,
      phaseCount,
    }
  }

  /**
   * 结构短板/长板诊断。每条都给出可核对的原始指标，
   * 便于模型引用时不会说空话，也便于前端展示依据。
   */
  function diagnose(structure) {
    const findings = []
    const push = (level, title, detail) => findings.push({ level, title, detail })

    if (structure.sample < 5) return findings

    if (structure.front <= 6) {
      push('weak', '前排承伤偏薄', `全队前排承伤合计 ${structure.front}/15（5人满额），团战缺少能站住的正面支点`)
    } else if (structure.front >= 11) {
      push('strong', '前排厚度充足', `前排承伤合计 ${structure.front}/15，能撑起长时间阵地战`)
    }

    if (structure.engageCount === 0) {
      push('weak', '缺少主动开团', '全队没有开团评分≥3的英雄，先手只能依赖抓单、地形或对手失误')
    } else if (structure.engageCount >= 2) {
      push(
        'strong',
        '开团手段充足',
        `${structure.engageCount} 名英雄具备硬开团能力（${structure.hardEngage.join('、')}），先手选择多样`,
      )
    }

    // 后期核心与保护手段的配对关系，是判断阵容能否成立的核心问题
    if (structure.fragileCarry.length) {
      const carries = structure.fragileCarry.join('、')
      if (structure.protectors.length) {
        push(
          'strong',
          '后期核心保护链成立',
          `${carries}属于零位移或低机动的后期核心，队内有${structure.protectors.join('、')}提供保护，核心可以进入输出位`,
        )
      } else {
        push(
          'weak',
          '后期核心缺乏保护',
          `${carries}属于零位移或低机动的后期核心，但全队没有保人型英雄，一旦被切入几乎没有生还手段`,
        )
      }
    }

    if (structure.peelCount === 0 && structure.fragileCarry.length === 0) {
      push('weak', '缺乏保人手段', '全队没有保人型英雄，后排完全依赖自身走位')
    }

    const damageEntries = Object.entries(structure.damageMix).filter(([, count]) => count > 0)
    const topDamage = damageEntries.sort((a, b) => b[1] - a[1])[0]
    if (topDamage && topDamage[1] >= 4) {
      const label = { phys: '物理', magic: '法术', true: '真实', mixed: '混合' }[topDamage[0]]
      push('weak', '伤害类型单一', `5 人中有 ${topDamage[1]} 人主打${label}伤害，对手针对性出防装的收益极高`)
    } else if (damageEntries.length >= 3) {
      push('strong', '伤害类型分散', '物理、法术等伤害混合，对手难以用单一防装应对')
    }

    if (structure.phaseCount.late >= 3) {
      push('weak', '强势期整体偏后', `${structure.phaseCount.late} 名英雄的强势期在后期，前中期容易被滚雪球`)
    } else if (structure.phaseCount.early >= 3 && structure.phaseCount.late === 0) {
      push('weak', '后期乏力', `${structure.phaseCount.early} 名英雄强势期在前中期，必须尽早建立优势`)
    }

    if (structure.burstCount >= 3 && structure.engageCount === 0) {
      push('weak', '爆发充足但无先手', `${structure.burstCount} 名爆发型英雄却没有开团手段，伤害难以稳定落地`)
    }

    if (structure.controlScore <= 3) {
      push('weak', '控制链薄弱', `全队控制评分合计仅 ${structure.controlScore}，缺乏留人与打断能力`)
    } else if (structure.controlScore >= 11) {
      push('strong', '控制链厚实', `全队控制评分合计 ${structure.controlScore}，可形成连续控制`)
    }

    if (structure.pokeScore >= 7) {
      push('strong', '远程消耗能力突出', `消耗评分合计 ${structure.pokeScore}，适合拉扯与压制型打法`)
    }

    if (structure.mobilityAvg <= 1.2) {
      push('weak', '机动性偏低', `全队机动均值 ${structure.mobilityAvg}/3，容易被单抓或被拉扯`)
    }

    return findings
  }

  function analyzeTeam(picks, oppBans = []) {
    const structure = summarizeStructure(picks)
    return {
      combos: detectCombos(picks),
      broken: detectBrokenCombos(picks, oppBans),
      structure,
      findings: diagnose(structure),
    }
  }

  // 双方放在一起看才有意义的结论
  function compareSides(blue, red) {
    const notes = []
    const gap = (a, b) => a - b

    const frontGap = gap(blue.structure.front, red.structure.front)
    if (Math.abs(frontGap) >= 4) {
      notes.push(
        frontGap > 0
          ? `蓝方前排承伤比红方多 ${frontGap} 点，正面阵地战更抗压，红方需要靠机动或拉扯规避正面`
          : `红方前排承伤比蓝方多 ${-frontGap} 点，蓝方更依赖先手命中与机动性来弥补正面劣势`,
      )
    }

    if (blue.structure.engageCount > 0 && red.structure.engageCount === 0) {
      notes.push('蓝方握有主动开团，红方只能反打；红方需靠消耗或抓单把节奏拖到对方先手落空')
    } else if (red.structure.engageCount > 0 && blue.structure.engageCount === 0) {
      notes.push('红方握有主动开团，蓝方只能反打；蓝方需靠消耗或抓单把节奏拖到对方先手落空')
    }

    const phaseLead = (side) => side.structure.phaseCount
    if (phaseLead(blue).late >= 3 && phaseLead(red).early >= 2) {
      notes.push('蓝方偏后期、红方偏前中期，红方的取胜窗口更早，时间压力在红方一侧')
    } else if (phaseLead(red).late >= 3 && phaseLead(blue).early >= 2) {
      notes.push('红方偏后期、蓝方偏前中期，蓝方的取胜窗口更早，时间压力在蓝方一侧')
    }

    if (blue.combos.some((c) => c.tier === 'strong') && !red.combos.some((c) => c.tier === 'strong')) {
      notes.push('蓝方存在成型的强协同组合，红方没有对应级别的组合，红方需要靠单点强度或对位优势打散对方配合')
    } else if (red.combos.some((c) => c.tier === 'strong') && !blue.combos.some((c) => c.tier === 'strong')) {
      notes.push('红方存在成型的强协同组合，蓝方没有对应级别的组合，蓝方需要靠单点强度或对位优势打散对方配合')
    }

    return notes
  }

  return { analyzeTeam, compareSides, nameOf }
}
