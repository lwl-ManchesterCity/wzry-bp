import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5175/', { waitUntil: 'networkidle' })
  // 先过开场页：对局方式、模式、赛制都在这里定
  await page.locator('.setup-screen').waitFor()
  const opponentCards = await page.locator('.opponent-card').count()
  if (opponentCards !== 2) throw new Error(`开场页应有两种对战方式，实际 ${opponentCards}`)
  await page.locator('.start-draft').click()
  await page.locator('.hero-card').first().waitFor()
  const heroCount = await page.locator('.hero-card').count()
  if (heroCount !== 133) throw new Error(`英雄池应为 133，实际为 ${heroCount}`)

  for (let step = 0; step < 20; step += 1) {
    const hero = page.locator('.hero-card:not([disabled])').first()
    await hero.scrollIntoViewIfNeeded()
    await hero.click()
    await page.locator('.confirm-action').click()
    await page.waitForFunction(() => !document.querySelector('.selected-summary'))
  }

  await page.locator('.complete-summary').waitFor()
  const bluePicks = await page.locator('.team-panel.blue .pick-slot.filled').count()
  const redPicks = await page.locator('.team-panel.red .pick-slot.filled').count()
  const blueBans = await page.locator('.team-panel.blue .ban-slot img').count()
  const redBans = await page.locator('.team-panel.red .ban-slot img').count()
  if (bluePicks !== 5 || redPicks !== 5 || blueBans !== 5 || redBans !== 5) {
    throw new Error(`完整 BP 数据异常：蓝 ${bluePicks}P/${blueBans}B，红 ${redPicks}P/${redBans}B`)
  }
  // 分路排布：五路都必须有落位，不能再出现「打野 无人」
  await page.locator('.lineup-board').waitFor()
  const laneRows = await page.locator('.lineup-row').count()
  const filledBlue = await page.locator('.lineup-cell.blue.filled').count()
  const filledRed = await page.locator('.lineup-cell.red.filled').count()
  if (laneRows !== 5 || filledBlue !== 5 || filledRed !== 5) {
    throw new Error(`分路排布异常：${laneRows} 行，蓝 ${filledBlue} 人，红 ${filledRed} 人`)
  }
  await page.screenshot({ path: '/tmp/kpl-complete.png', fullPage: true })

  await page.locator('.review-button').click()
  await page.locator('.review-modal').waitFor()
  const health = await page.request.get('http://127.0.0.1:3001/api/health').then((response) => response.json())
  if (!health.configured) {
    await page.locator('.generate-review').click()
    await page.locator('.review-error').waitFor()
    const message = await page.locator('.review-error').textContent()
    if (!message?.includes('DEEPSEEK_API_KEY')) throw new Error('未配置密钥时缺少明确提示')
  } else {
    // 主流程：复盘必须带出组合协同与结构区块，缺了说明协同数据没接上
    await page.locator('.generate-review').click()
    await page.locator('.verdict-card').waitFor({ timeout: 120000 })
    await page.locator('.synergy-basis').waitFor({ timeout: 15000 })
    const structureRows = await page.locator('.struct-metrics').count()
    if (structureRows !== 2) throw new Error(`组合协同区块结构指标应有 2 组，实际 ${structureRows}`)
    const findingRows = await page.locator('.struct-findings li').count()
    if (findingRows === 0) throw new Error('组合协同区块缺少结构结论')
  }

  await page.locator('.review-header-meta button').click()
  await page.locator('.next-game').click()
  await page.waitForFunction(() => document.querySelector('.match-ribbon strong')?.textContent?.includes('第 2 局'))
  const usedBlue = await page.locator('.team-panel.blue .used-avatars img').count()
  const usedRed = await page.locator('.team-panel.red .used-avatars img').count()
  if (usedBlue !== 5 || usedRed !== 5) throw new Error('进入第二局后全局已用英雄记录异常')
  if (pageErrors.length) throw new Error(`浏览器运行错误：${pageErrors.join('；')}`)

  console.log(`浏览器闭环通过：${heroCount} 英雄，首局 5/5 Pick、5/5 Ban，复盘弹窗正常，第二局全局记录正常。`)
} finally {
  await browser.close()
}
