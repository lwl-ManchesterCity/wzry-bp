// 拉取 KPL 官方赛季英雄数据，生成 src/data/kpl-stats.json
// 数据来源：KPL 官网（kpl.qq.com）赛季排行所用的公开接口
// 用法：npm run stats:fetch

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = 'https://kplshop-op.timi-esports.qq.com/kplow'

// 官方编码：job 1坦克 2法师 3战士 4刺客 5射手 6辅助
const JOB_NAMES = { 1: '坦克', 2: '法师', 3: '战士', 4: '刺客', 5: '射手', 6: '辅助' }
// 官方编码：position 1对抗路 2中路 3发育路 4打野 5游走
const LANE_NAMES = { 1: '对抗路', 2: '中路', 3: '发育路', 4: '打野', 5: '游走' }

async function post(endpoint, body = {}) {
  const response = await fetch(`${ENDPOINT}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://kpl.qq.com',
      Referer: 'https://kpl.qq.com/',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}`)
  const payload = await response.json()
  if (payload?.result !== 0 || !payload.data) throw new Error(`${endpoint} 返回异常：${payload?.msg || '未知'}`)
  return payload.data
}

function seasonRange(start, end) {
  const fmt = (seconds) => {
    const d = new Date(Number(seconds) * 1000)
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }
  if (!start || !end) return ''
  return `${fmt(start)}至${fmt(end)}`
}

async function main() {
  console.log('正在读取本地英雄池…')
  const localHeroes = JSON.parse(await readFile(path.join(root, 'src/data/heroes.json'), 'utf8'))
  const localNames = new Map(localHeroes.map((hero) => [String(hero.id), hero.name]))

  console.log('正在请求赛季信息…')
  const seasonData = await post('getSeasonAndStageAndTeamList')
  const current = (seasonData.seasons || []).find((item) => Number(item.is_cur_season) === 1)
  if (!current) throw new Error('未找到当前赛季')

  console.log('正在请求英雄排行…')
  const rankData = await post('getHeroRankList')
  const list = rankData.list || []
  if (!list.length) throw new Error('英雄排行返回为空')

  const heroes = {}
  let picked = 0
  let unmatched = 0
  for (const row of list) {
    const id = String(row.hero_id)
    const games = Number(row.match_count) || 0
    const rawRate = Number(row.win_cr) || 0
    if (games > 0) picked += 1
    if (!localNames.has(id)) unmatched += 1
    heroes[id] = {
      // 以本地英雄池名称为准，避免「元流之子」这类写法不一致
      name: localNames.get(id) || String(row.hero_name || id),
      job: JOB_NAMES[row.job] || '',
      lane: LANE_NAMES[row.position] || '',
      games,
      winRate: games > 0 ? Math.round(rawRate * 1000) / 10 : null,
    }
  }

  const output = {
    season: current.seasonid,
    seasonName: current.season_name,
    seasonRange: current.season_time_desc || seasonRange(current.start_time, current.end_time),
    scope: 'KPL 职业赛事',
    source: 'KPL 官网 · 赛季排行',
    sourceUrl: 'https://kpl.qq.com/',
    fetchedAt: new Date().toISOString().slice(0, 10),
    totalHeroes: Object.keys(heroes).length,
    pickedHeroes: picked,
    heroes,
  }

  const target = path.join(root, 'src/data/kpl-stats.json')
  await writeFile(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

  console.log(`完成：${output.seasonName}（${output.season}）`)
  console.log(`  统计区间：${output.seasonRange}`)
  console.log(`  英雄 ${output.totalHeroes} 名，其中有出场记录 ${picked} 名`)
  if (unmatched) console.log(`  注意：${unmatched} 个英雄未匹配到本地名称，已回退官方名称`)
  console.log(`  已写入 ${path.relative(root, target)}`)

  const top = Object.entries(heroes)
    .filter(([, hero]) => hero.games > 0)
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, 5)
  console.log('  出场最多：')
  for (const [, hero] of top) {
    console.log(`    ${hero.name} ${hero.games} 场 ${hero.winRate}%`)
  }
}

main().catch((error) => {
  console.error(`抓取失败：${error.message}`)
  process.exit(1)
})
