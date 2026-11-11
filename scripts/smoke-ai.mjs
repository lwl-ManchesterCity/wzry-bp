// 人机对局闭环：开场选「挑战 AI」→ 玩家执蓝 → AI 自动接管红方每一手
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

const filled = () => page.evaluate(() => {
  const picks = document.querySelectorAll('.team-panel .pick-slot.filled').length
  const bans = document.querySelectorAll('.team-panel .ban-slot img').length
  return picks + bans
})

try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:3001/', { waitUntil: 'networkidle' })
  await page.locator('.setup-screen').waitFor()

  // 选「挑战 AI」，执蓝先手
  await page.locator('.opponent-card.ai').click()
  await page.locator('.side-picker').waitFor()
  await page.locator('.side-picker button').first().click()
  await page.locator('.start-draft').click()
  await page.locator('.hero-card').first().waitFor()

  // 玩家执蓝：20 步里蓝方占 10 手，红方由 AI 自动完成
  for (let step = 0; step < 10; step += 1) {
    // 等 AI 思考结束、轮到玩家
    await page.waitForFunction(() => !document.querySelector('.pool-lock'), null, { timeout: 90000 })
    const before = await filled()
    const hero = page.locator('.hero-card:not([disabled])').first()
    await hero.scrollIntoViewIfNeeded()
    await hero.click()
    await page.locator('.confirm-action').click()
    // 玩家落子 + AI 落子，一共应推进 2 手
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
  const bluePicks = await page.locator('.team-panel.blue .pick-slot.filled').count()
  const redPicks = await page.locator('.team-panel.red .pick-slot.filled').count()
  const blueBans = await page.locator('.team-panel.blue .ban-slot img').count()
  const redBans = await page.locator('.team-panel.red .ban-slot img').count()
  if (bluePicks !== 5 || redPicks !== 5 || blueBans !== 5 || redBans !== 5) {
    throw new Error(`人机对局数据异常：蓝 ${bluePicks}P/${blueBans}B，红 ${redPicks}P/${redBans}B`)
  }

  const blueName = await page.locator('.team-panel.blue .team-name').first().inputValue()
  if (!blueName?.includes('我方')) throw new Error(`执蓝时本方名称应为「我方」，实际 ${blueName}`)
  const noteCount = await page.locator('.ai-note-line').count()
  if (noteCount === 0) throw new Error('缺少 AI 决策理由展示')

  await page.screenshot({ path: '/tmp/ai-draft.png', fullPage: true })
  if (pageErrors.length) throw new Error(`浏览器运行错误：${pageErrors.join('；')}`)

  console.log(`人机对局通过：${bluePicks}/${redPicks} Pick、${blueBans}/${redBans} Ban 全部由 AI 自动补位。`)
} finally {
  await browser.close()
}
