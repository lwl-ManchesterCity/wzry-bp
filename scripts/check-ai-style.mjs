/**
 * 人机对局「不是固定答卷」的端到端验证：
 * 在同一个页面里连开两场系列赛，玩家每手都选池子里第一个可用英雄（行为固定），
 * 比较 AI 两局的禁用与阵容是否一致，并检查界面是否展示本局思路。
 *
 * 必须是同一个页面：思路按「第几场系列赛」轮转，序号存在 localStorage，
 * 另开一个页面就相当于换了个浏览器，看不出轮转效果。
 *
 *   node scripts/check-ai-style.mjs
 */
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())

const url = process.env.APP_URL || 'http://127.0.0.1:3001/'
const filled = () => page.evaluate(() => {
  const picks = document.querySelectorAll('.team-panel .pick-slot.filled').length
  const bans = document.querySelectorAll('.team-panel .ban-slot img').length
  return picks + bans
})

async function playGame(tag) {
  await page.locator('.hero-card').first().waitFor()
  for (let step = 0; step < 10; step += 1) {
    await page.waitForFunction(() => !document.querySelector('.pool-lock'), null, { timeout: 90000 })
    const before = await filled()
    const hero = page.locator('.hero-card:not([disabled])').first()
    await hero.scrollIntoViewIfNeeded()
    await hero.click()
    await page.locator('.confirm-action').click()
    await page.waitForFunction(
      (expected) => {
        const picks = document.querySelectorAll('.team-panel .pick-slot.filled').length
        const bans = document.querySelectorAll('.team-panel .ban-slot img').length
        return picks + bans >= expected
      },
      before + 2,
      { timeout: 90000 },
    ).catch(() => {})
  }

  await page.locator('.complete-summary').waitFor({ timeout: 90000 })
  const style = (await page.locator('.ai-style-chip').first().textContent().catch(() => ''))?.trim() || ''
  if (!style.includes('思路')) throw new Error(`${tag}：界面上没有显示 AI 本局思路`)

  const read = (side, selector) => page.evaluate(
    ({ side, selector }) => [...document.querySelectorAll(`.team-panel.${side} ${selector}`)]
      .map((node) => node.getAttribute('alt') || node.textContent?.trim() || ''),
    { side, selector },
  )
  const picks = await read('red', '.pick-slot.filled img')
  const bans = await read('red', '.ban-slot img')
  await page.screenshot({ path: `/tmp/ai-style-${tag}.png`, fullPage: true })
  if (pageErrors.length) throw new Error(`${tag} 浏览器报错：${pageErrors.join('；')}`)
  return { style, picks, bans }
}

try {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.locator('.setup-screen').waitFor()

  const startSeries = async () => {
    await page.locator('.opponent-card.ai').click()
    await page.locator('.side-picker').waitFor()
    await page.locator('.side-picker button').first().click()
    await page.locator('.start-draft').click()
  }

  await startSeries()
  const first = await playGame('a')

  // 回到设置重开一场，序号 +1，AI 应当换思路
  await page.locator('.setup-back').click()
  await page.locator('.setup-screen').waitFor()
  await startSeries()
  const second = await playGame('b')

  const line = (game, label) => console.log(`${label} ${game.style}\n   禁 ${game.bans.join('/')}\n   选 ${game.picks.join('/')}`)
  line(first, '第一局')
  line(second, '第二局')

  if (first.style === second.style) throw new Error(`两局思路都是「${first.style}」，没有轮转`)
  const same = (a, b) => a.join('|') === b.join('|')
  if (same(first.picks, second.picks) && same(first.bans, second.bans)) {
    throw new Error('两局 AI 的禁用与阵容完全一样，仍然像固定答卷')
  }
  console.log('\n通过：同样的玩家操作下，AI 换了一种思路，禁选也随之变化')
} finally {
  await browser.close()
}
