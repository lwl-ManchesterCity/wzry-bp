import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('response', (res) => { if (res.status() >= 400) console.log('HTTP', res.status(), res.url()) })

try {
  await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' })
  await page.locator('.start-draft').click()
  await page.locator('.hero-card').first().waitFor()

  const blueQueue = ['敖隐', '元流之子(坦克)', '司空震', '钟馗', '小乔']
  const reserved = new Set(blueQueue)

  const clickAvailableNotReserved = async () => {
    const cards = page.locator('.hero-card:not([disabled])')
    const total = await cards.count()
    for (let index = 0; index < total; index += 1) {
      const name = (await cards.nth(index).locator('strong').textContent())?.trim() || ''
      if (reserved.has(name)) continue
      await cards.nth(index).scrollIntoViewIfNeeded()
      await cards.nth(index).click()
      return
    }
    throw new Error('没有可用的非保留英雄')
  }

  for (let step = 0; step < 20; step += 1) {
    const action = (await page.locator('.confirm-action').textContent()) || ''
    if (action.includes('蓝方确认选择')) {
      const wanted = blueQueue.shift()
      await page.locator('.search-box input').fill(wanted)
      await page.locator('.hero-card:not([disabled])').first().click()
      await page.locator('.search-box input').fill('')
    } else {
      await clickAvailableNotReserved()
    }
    await page.locator('.confirm-action').click()
    await page.waitForFunction(() => !document.querySelector('.selected-summary'))
  }

  await page.locator('.lineup-board').waitFor()
  const dump = async (label) => {
    const rows = await page.locator('.lineup-row').evaluateAll((nodes) => nodes.map((row) => {
      const cells = [...row.querySelectorAll('.lineup-cell')]
      return {
        lane: row.querySelector('.lineup-lane')?.textContent?.trim(),
        blue: cells[0]?.querySelector('.lineup-hero-meta strong')?.textContent?.trim() || null,
        blueTag: cells[0]?.querySelector('.lineup-tag')?.textContent?.trim() || null,
        red: cells[1]?.querySelector('.lineup-hero-meta strong')?.textContent?.trim() || null,
      }
    }))
    console.log(label, JSON.stringify(rows, null, 0))
    return rows
  }
  await dump('初始排布')

  // 点击兜底：选中司空震，再点打野格子
  const heroChip = (name) => page.locator('.lineup-hero', { hasText: name }).first()
  await heroChip('司空震').click()
  await page.locator('.lineup-row').nth(1).locator('.lineup-cell.blue').click()
  const afterClick = await dump('点击换位后')
  if (afterClick[1].blue !== '司空震') throw new Error('点击换位未生效')

  // 拖拽：把钟馗从游走拖到对抗路
  await heroChip('钟馗').dragTo(page.locator('.lineup-row').nth(0).locator('.lineup-cell.blue'))
  const afterDrag = await dump('拖拽后')
  if (afterDrag[0].blue !== '钟馗') throw new Error('拖拽换位未生效')
  if (afterDrag[4].blue !== '元流之子(坦克)') throw new Error('拖拽后原占位者应回到钟馗的旧位置')

  await page.locator('.lineup-auto').first().click()
  const afterAuto = await dump('自动排位后')
  if (afterAuto[0].blue !== '司空震') throw new Error('自动排位未恢复主路排布')
  await page.screenshot({ path: '/tmp/kpl-lineup.png', fullPage: true })

  // 复盘请求必须带上分路排布，否则服务端只能自己猜
  let posted = null
  await page.route('**/api/review', async (route) => {
    posted = route.request().postDataJSON()
    await route.abort()
  })
  await page.locator('.review-button').click()
  await page.locator('.generate-review').click()
  await page.waitForTimeout(600)
  if (!posted) throw new Error('没有发出复盘请求')
  const blueLanes = Object.keys(posted.lineups?.blue ?? {}).length
  const redLanes = Object.keys(posted.lineups?.red ?? {}).length
  if (blueLanes !== 5 || redLanes !== 5) throw new Error(`复盘请求分路数据缺失：蓝 ${blueLanes}，红 ${redLanes}`)
  console.log('复盘请求分路', JSON.stringify(posted.lineups))

  if (errors.length) throw new Error(`浏览器报错：${errors.join('；')}`)
  console.log('分路面板验证通过')
} finally {
  await browser.close()
}
