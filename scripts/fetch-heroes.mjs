import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const listUrl = 'https://pvp.qq.com/web201605/js/herolist.json'
const avatarUrl = (id) => `https://game.gtimg.cn/images/yxzj/img201606/heroimg/${id}/${id}.jpg`

const response = await fetch(listUrl)
if (!response.ok) throw new Error(`英雄列表获取失败：HTTP ${response.status}`)
const list = await response.json()
if (!Array.isArray(list) || list.length < 100) throw new Error('英雄列表格式异常')

const heroes = list.map((item) => ({
  id: Number(item.ename),
  name: item.cname,
  title: item.title,
  avatar: `/heroes/${item.ename}.jpg`,
  classId: Number(item.hero_type),
  laneIds: String(item.roles || '').split('|').filter(Boolean).map(Number),
  pickGroup: item.cname.startsWith('元流之子') ? 'yuanliu' : `hero-${item.ename}`,
}))

await mkdir(path.join(root, 'public/heroes'), { recursive: true })
await mkdir(path.join(root, 'src/data'), { recursive: true })
await writeFile(path.join(root, 'src/data/heroes.json'), `${JSON.stringify(heroes, null, 2)}\n`)

let cursor = 0
const failures = []
async function worker() {
  while (cursor < heroes.length) {
    const hero = heroes[cursor++]
    try {
      const image = await fetch(avatarUrl(hero.id))
      if (!image.ok) throw new Error(`HTTP ${image.status}`)
      const contentType = image.headers.get('content-type') || ''
      if (!contentType.startsWith('image/')) throw new Error(`非图片响应 ${contentType}`)
      const bytes = Buffer.from(await image.arrayBuffer())
      await writeFile(path.join(root, `public/heroes/${hero.id}.jpg`), bytes)
    } catch (error) {
      failures.push(`${hero.name}(${hero.id}): ${error.message}`)
    }
  }
}

await Promise.all(Array.from({ length: 8 }, () => worker()))
if (failures.length) {
  throw new Error(`以下头像下载失败：\n${failures.join('\n')}`)
}
console.log(`已更新 ${heroes.length} 名英雄及 ${heroes.length} 张本地头像。`)
