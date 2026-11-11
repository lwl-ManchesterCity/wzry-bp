# NBA 单赛季选秀模拟器 · 交接规格（v2）

> 这份文档是给执行方 agent 的完整规格。读完应当能独立开工，不需要再问原作者。
> 文中路径、端点、字段名、公式都是确定值；标注「可调」的地方才允许自行决定。
>
> **v2 修订说明**：v1 指定的 `stats.nba.com` 数据源已实测不可用（见 §4.1 实测记录），BPM/VORP 也拿不到。v2 改用 **ESPN 公开 API**，全部字段经实测确认；同时补齐了 z-score 计算口径、短板测试的断言方式、复盘校验边界、无密钥降级。

---

## 0. 一句话目标

从零建一个独立的 NBA 选秀模拟器：**单赛季球员池**，双方按 **1-2-2-2-2-1 蛇形顺位**各选 5 人（共 10 手），支持双人对战与挑战 AI，选完由 DeepSeek 做阵容复盘。

视觉与交互沿用已有的王者荣耀 KPL BP 模拟器，**但这是一个全新项目，不要修改原项目任何文件**。

---

## 1. 参考项目（只读，不要改）

路径：`/Users/lwl/WorkBuddy/2026-11-06-14-35-48`

这是已经做完并验证过的 KPL 版。你要做的是「换领域、换数据、换评价维度」，不是从零发明架构。

| 文件 | 作用 | 你怎么用 |
|---|---|---|
| `src/engine/draft.ts` | 顺位状态机，`getSteps()` 返回扁平 `DraftStep[]` | 骨架照抄，只换 step 数组，删掉 KPL 特有逻辑 |
| `src/composables/useDraft.ts` | 选人状态、撤销、AI 回合判定 | 骨架照抄，删全局池/巅峰对决/多局 |
| `server/ai-draft.mjs` | 打分引擎 `createDraftAdvisor()` + prompt 构造 `buildDecisionContext()` | 打分函数重写，外层流程照抄 |
| `server/synergy.mjs` | 结构诊断 `createSynergyEngine()`（`summarizeStructure` / `diagnose` / `analyzeTeam`） | 维度换成篮球的，骨架照抄 |
| `server/index.mjs` | Express：`/api/review`、`/api/ai-draft`、`/api/health`，含 `parseModelJson()` | 路由、降级、清洗逻辑照抄 |
| `src/components/SetupScreen.vue` | 开场页（对战方式 / 执方） | 直接照抄，去掉「征召规则」「全局 BP」「赛制」 |
| `src/style.css` | 深色电竞风 CSS 变量与面板样式 | 直接复用配色变量 |
| `scripts/smoke-ai.mjs` | 人机对局浏览器闭环 | 改成 10 手版本 |
| `tests/draft.test.ts` | 顺位断言写法 | 照着写 NBA 版 |

**硬性禁止**：
- 不要修改 `/Users/lwl/WorkBuddy/2026-11-06-14-35-48` 下的任何文件，不要在该目录内新建 NBA 相关文件
- 不要执行 `git commit` / `git push`（任何仓库都不许，等人工确认）

**新项目路径**：`/Users/lwl/WorkBuddy/nba-draft`（独立目录，可 `git init`，不许提交推送）

---

## 2. 技术栈（不要升级）

Vue 3 + TypeScript + Vite，图标 `lucide-vue-next`；后端 Express（`server/index.mjs`）；测试 Vitest + `playwright-core`（驱动本机 Chrome）；数据本地 JSON 快照。

**不要引入**：Pinia、Vuex、Tailwind、任何 UI 组件库、向量库、数据库、登录系统。

---

## 3. 选秀规则（先写引擎和测试，再写 UI）

### 3.1 顺位

10 手，蛇形对称：

| 手次 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| 归属 | A | B | B | A | A | B | B | A | A | B |

A 拿第 1/4/5/8/9 手（共 5），B 拿第 2/3/6/7/10 手（共 5）。

直接写常量，不要用公式生成（只有 10 项，公式边界容易算错）：

```ts
const NBA_STEPS: DraftStep[] = [
  { side: 'blue', type: 'pick' }, // 1
  { side: 'red',  type: 'pick' }, // 2
  { side: 'red',  type: 'pick' }, // 3
  { side: 'blue', type: 'pick' }, // 4
  { side: 'blue', type: 'pick' }, // 5
  { side: 'red',  type: 'pick' }, // 6
  { side: 'red',  type: 'pick' }, // 7
  { side: 'blue', type: 'pick' }, // 8
  { side: 'blue', type: 'pick' }, // 9
  { side: 'red',  type: 'pick' }, // 10
]
```

`Side` 沿用 `'blue' | 'red'`（省大量类型改动），但 **UI 文案显示「主队 / 客队」**，不要出现蓝红字样。

### 3.2 选人合法性

只有三条：
1. 该球员未被任何一方选走（全局唯一）
2. 本方未满 5 人
3. 其余全部放开

**不要做位置硬约束**。位置只作为赛后诊断提示，不作为禁用理由。

**不要做 Ban**。KPL 版的 3+2 禁用、全局池、巅峰对决全部删除。

### 3.3 多局

v1 只做**单局**，不做 BO3/BO5，不做跨局去重。

---

## 4. 数据层

### 4.1 数据源：ESPN 公开 API（不要用 stats.nba.com / Basketball-Reference）

**实测记录（2026-11-10，本机网络环境）**：

| 数据源 | 实测结果 |
|---|---|
| `stats.nba.com/stats/leaguedashplayerstats` | HTTP 200 但返回 **nba.com 首页 HTML**，不是 JSON。加上 `Referer` / `x-nba-stats-*` 四个头后仍然如此 |
| `www.basketball-reference.com` | HTTP **403**（Cloudflare 挑战页），`playwright` 真实浏览器同样 403 |
| `www.nba.com/stats/players/advanced` | 页面标题 **Access Denied** |
| `site.api.espn.com` / `sports.core.api.espn.com` | **200，JSON 正常** |

结论：**只用 ESPN**。不要再尝试前三个，浪费时间且在这个环境下必然失败。

### 4.2 三个端点

**① 球队列表**（1 次）
`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams`
→ `sports[0].leagues[0].teams` 共 30 队，取 `team.id` / `team.abbreviation` / `team.displayName`

**② 每队名单**（30 次）
`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{teamId}/roster`
→ `athletes[]`，每人含：

| 字段 | 含义 | 实测样例 |
|---|---|---|
| `id` | 球员 ID（也用头像） | `3945274` |
| `fullName` | 姓名 | `Luka Doncic` |
| `position.abbreviation` | 位置，**只有 G / F / C 三档** | `G` |
| `displayHeight` | 身高字符串 | `6' 8"` |
| `age` | 年龄 | `27` |
| `experience.years` | 球龄 | `9` |

每队约 19 人，30 队合计约 **570 人**。

**身高解析**：`6' 8"` → `6*30.48 + 8*2.54 = 203.2` → 取整 `203`（cm）。正则 `/(\d+)'\s*(\d+)"/`。

**③ 单人赛季统计**（每人 1 次，约 570 次）
`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2025/types/2/athletes/{athleteId}/statistics`

- `season=2025` 对应 **2024-25 赛季**（ESPN 用赛季结束年份，这是口径，别写成 2024）
- `types/2` = 常规赛（`types/3` 是季后赛，本项目不用）
- 结构：`splits.categories[].stats[].{name, value}`，需要摊平成 `{ [name]: value }`

**请求规范**：
- 并发 5，单请求超时 15 秒，失败重试 2 次（间隔 2 秒）
- 全部 570 次预计 2-4 分钟，属于一次性快照，**服务启动只读 JSON，不要运行时抓**

### 4.3 字段清单（全部经实测确认存在）

从 ESPN 统计里取这些，字段名照抄：

| ESPN 字段 | 含义 | 实测值（LeBron 2024-25） |
|---|---|---|
| `gamesPlayed` | 出场 | 70 |
| `minutes` | 总分钟 | 2444 |
| `avgMinutes` | 场均分钟 | 34.91 |
| `points` / `avgPoints` | 总/场均得分 | 1710 / 24.43 |
| `rebounds` / `avgRebounds` | 篮板 | 546 / 7.8 |
| `assists` / `avgAssists` | 助攻 | 575 / 8.21 |
| `steals` / `blocks` / `turnovers` | 抢断/盖帽/失误（总量） | 70 / 39 / 260 |
| `fieldGoalsAttempted` | 出手 | 由 `fieldGoals` 与命中率推算或直接取 |
| `freeThrowsAttempted` | 罚球出手 | 331 |
| `threePointFieldGoalsAttempted` | 三分出手 | 396 |
| `threePointPct` | 三分命中率，**百分数** | 37.63 |
| `trueShootingPct` | 真实命中率，**百分数** | 60.40 |
| `assistRatio` | 助攻率，**百分数** | 25.55 |
| `turnoverRatio` | 失误率，**百分数** | 11.55 |
| `assistTurnoverRatio` | 助失比 | 2.21 |
| `PER` | 球员效率值（官方公式） | 22.81 |
| `NBARating` | ESPN 综合评分 | 46.30 |
| `plusMinus` | 整季总正负值 | -54 |

**⚠️ 实测为 0、不可使用的字段**（这是 v1 规格最大的错误来源）：

| 字段 | 实测值 | 结论 |
|---|---|---|
| `usageRate` | **0** | 拿不到，必须自算替代 |
| `reboundRate` | **0** | 同上 |
| `defReboundRate` | **0** | 同上 |
| `VORP` | **0** | 同上 |

**BPM / OBPM / DBPM 在 ESPN 里根本不存在**（那是 Basketball-Reference 的专有指标），v1 文档里用它们做价值与护框判定是错的。**v2 全部弃用**，改用 §5 的自算口径。

**量纲约定**：ESPN 的 `trueShootingPct`、`threePointPct`、`assistRatio`、`turnoverRatio` 都是 **0-100 百分数**，入库前统一 `/100` 转成 0-1 小数；页面展示时再乘回 100。派生指标一律 0-1。

### 4.4 输出文件 `src/data/players.json`

```json
{
  "season": "2024-25",
  "espnSeason": 2025,
  "seasonType": 2,
  "source": "ESPN core API",
  "fetchedAt": "2026-11-10T08:00:00.000Z",
  "players": [
    {
      "id": 3945274,
      "name": "Luka Doncic",
      "team": "LAL",
      "position": "G",
      "heightCm": 203,
      "age": 27,
      "gp": 70, "mpg": 34.9,
      "pts": 24.4, "reb": 7.8, "ast": 8.2, "stl": 1.0, "blk": 0.6, "tov": 3.7,
      "ts": 0.604, "tpPct": 0.376, "astRatio": 0.256, "astTo": 2.21,
      "per": 22.8, "nbaRating": 46.3,
      "per36": { "reb": 8.0, "blk": 0.57, "stl": 1.03, "tpa": 5.83, "load": 26.4 }
    }
  ]
}
```

`per36` 在抓取脚本里算好存盘，前端和 AI 都不用重复算，避免两处公式不一致。

### 4.5 过滤与去重

- 过滤：`gamesPlayed >= 20` 且 `avgMinutes >= 15`（预计 320-360 人）
- 去重：**以 roster 为名单基准，天然不会重复**（每人在当前所属球队只出现一次），因此不需要处理「赛季中被交易球员拆成多行」的问题——这是选 roster 而不是选联盟统计表的原因，别改
- 球队口径：**取抓取时点的所属球队**，赛季中换队的球员只保留现队，不追溯
- 年龄口径：**ESPN roster 返回的年龄**，即抓取时点年龄，不做赛季折算。年龄**不参与任何算法**，仅展示，因此口径不影响结果

### 4.6 头像

`https://cdn.nba.com/headshots/nba/latest/1040x760/{athleteId}.png`

**先实测这一个 URL 是否能下载**，能则下载到 `public/headshots/{id}.png` 本地缓存（并发 5，失败跳过，不要重试 3 次以上）；不能则**全部用队色块 + 姓名首字母**，不要在设计上留半成品。

头像版权归 NBA，README 写明「仅供本地个人使用，不要公开发布」。

---

## 5. 评价体系（核心，逐条实现，不要自由发挥）

### 5.1 原始量定义（全部在抓取脚本算好）

```
m36       = 36 / avgMinutes
reb36     = avgRebounds * m36
blk36     = (blocks / gamesPlayed) * m36
stl36     = (steals / gamesPlayed) * m36
tpa36     = (threePointFieldGoalsAttempted / gamesPlayed) * m36
load      = ((fieldGoalsAttempted + 0.44*freeThrowsAttempted + turnovers) / gamesPlayed) * m36
ts        = trueShootingPct / 100
tpPct     = threePointPct / 100
astRatio  = assistRatio / 100
astTo     = assistTurnoverRatio
per       = PER
nbaRating = NBARating
```

**三分命中率要做贝叶斯收缩**，否则 2 投 1 中的球员会虚高：

```
tpShrunk = (threePointFieldGoalsMade + 0.33 * 20) / (threePointFieldGoalsAttempted + 20)
```

`load` 是持球负荷的代理（出手 + 罚球 + 失误折合每 36 分钟）。**它不等于官方 USG%，因为 ESPN 的 `usageRate` 返回 0**，这一点在 UI 上如果有 tooltip 要写清楚是「持球负荷」不是「使用率」。

### 5.2 七个维度：连续分数 + 布尔命中

每个维度先算 **raw 连续分**（各分量的 z-score 线性组合，z 用全池均值/标准差），raw 再作为该维度的 `z` 存下来。**布尔命中用于 UI 人数统计，不参与短板计算**。

| 维度 | raw 连续分公式 | 布尔命中条件 |
|---|---|---|
| `creation` 持球创造 | `0.6*z(load) + 0.4*z(astRatio)` | `z >= 0.8` |
| `spacing` 空间 | `0.75*z(tpa36) + 0.25*z(tpShrunk)` | `tpa36 >= 4.0 && tpShrunk >= 0.345` |
| `rim` 护框 | `0.5*z(blk36) + 0.3*z(reb36) + 0.2*z(heightCm)` | `blk36 >= 1.2 \|\| (heightCm >= 208 && reb36 >= 8)` |
| `perimeter` 外线换防 | `0.6*z(stl36) + 0.4*z(switchHeight)` | `switchHeight >= 0.7 && stl36 >= 1.0` |
| `playmaking` 组织 | `0.5*z(astRatio) + 0.5*z(astTo)` | `astRatio >= 0.20 && astTo >= 1.8` |
| `rebounding` 篮板 | `z(reb36)` | `reb36 >= 9.0` |
| `efficiency` 效率 | `0.7*z(ts) + 0.3*z(per)` | `ts >= 0.565 && per >= 15` |

其中：

```
switchHeight = clamp(1 - |heightCm - 201| / 18, 0, 1)
```

**为什么用平滑函数而不是 `196 <= height <= 208`**：硬窗口在边界会产生跳变（207cm 得分、209cm 归零），排序会突然翻转。平滑后 201cm 得 1.0，183cm 和 219cm 都得 0，中间线性，行为可预期。

**`rim` 是代理指标，不是真护框**：没有 `DFG%`（对手在篮下的命中率）可用，只有盖帽率 + 篮板率 + 身高。文档和 UI 都要如实说明这一点，不要写成「护框能力」。

**位置（G/F/C）不进入任何维度公式**，只在诊断文案里提「三名纯内线」这类描述。原因：位置标签只有三档且由名单来源决定，用它做算法会引入来源噪声。

### 5.3 布尔阈值必须校准（不要直接相信 §5.2 的数字）

上面括号里的绝对阈值是**起始值，不是结论**。抓完真实数据后必须跑一次校准：

1. 统计每个维度布尔命中人数占全池的比例
2. 目标：每个维度命中率落在 **50%-70%** 之间（这样一支 5 人阵容期望命中 2.5-3.5 人，既不全员满足也不全员空白）
3. 命中率偏离目标时，调整该维度的阈值，**记录调整前后的表格放进 README**
4. 校准只改阈值，不改公式

不做校准直接上线，会出现「全联盟 90% 的人都不满足空间条件」这种结论，诊断全部失真。

### 5.4 阵容结构诊断

对 5 人阵容统计每维布尔命中人数：

| 检查项 | 判定 | 结论 |
|---|---|---|
| 持球点 | 命中 0 人 | 弱：没有稳定进攻发起点 |
| | 命中 >= 3 且其中 2 人 `load >= 30` | 弱：球权过载，需要有人改打无球 |
| 空间 | 命中 <= 1 人 | 弱：空间拥堵，突破和挡拆会被压缩 |
| | 命中 >= 3 人 | 强：空间资源充足 |
| 护框 | 命中 0 人 | 弱：禁区缺少保护（代理指标口径） |
| 外线换防 | 命中 <= 1 人 | 弱：换防资源不足，容易被针对错位 |
| | 命中 >= 3 人 | 强：换防弹性好 |
| 组织 | 命中 0 人 | 弱：缺少二次组织，进攻容易停滞 |
| 篮板 | 命中 <= 1 人 | 弱：后场板保护差 |
| 效率 | 全队 `ts` 均值 < 0.55 | 弱：整体出手质量偏低 |

同时输出 `shortfall`：7 维 `avgZ` 最低且 **`avgZ < -0.4`** 的那一维；若最低维 `>= -0.4` 则 `shortfall = null`，文案输出「无明显短板」。这个阈值是为了避免把「相对最弱但实际正常」的维度误报成短板。

### 5.5 球员综合价值

```
value = 0.5*z(per) + 0.3*z(nbaRating) + 0.2*z(avgMinutes)
```

**不要用 BPM/VORP**（拿不到，见 §4.3）。`PER` 和 `NBARating` 都是 ESPN 直接给的字段，口径可查、可复现。

### 5.6 互补性（替代人工组合库）

不要写死「纳什 + 斯塔德迈尔」这类搭档知识。

```
1. 算当前阵容 7 维 avgZ
2. shortfall = 最低维（且 < -0.4），没有则按「提升最小的那维」处理
3. 候选球员在该维 z >= +1.0  → 补短板分 +12
   候选球员在该维 z >= +0.5  → 补短板分 +6
4. 若 shortfall 为 null，改用「维度命中人数从 0 变 1」的补强计分，每维 +8
5. creation 维度：候选 z >= 1.5 且阵容中已有 2 人 z >= 1.5  → 功能重叠 -10
```

---

## 6. AI 对手

流程照抄 `server/ai-draft.mjs`，只换打分函数。

1. 前端在轮到 AI 时 POST `/api/ai-draft`，带双方已选阵容、可选球员 id、AI 执掌方、当前手次
2. 服务端对每个候选打分：
   ```
   score = value
         + 补短板分（§5.6）
         + 维度补强分
         - 功能重叠分
   ```
3. 取 Top 8 交给 DeepSeek，要求从候选中挑一个 + 不超过 40 字理由
4. **校验**：返回的 id 必须在 Top 8 内，否则回落规则首选
5. 模型超时（20 秒）/报错/无密钥 → 回落规则首选，不许卡住对局

### 6.1 两个必须照抄的坑（KPL 版实际踩过）

1. **候选必须带 id**：prompt 写成 `playerId 3945274 = Luka Doncic（G，补持球创造）`。只给名字，模型会自己编 id，导致永远回落规则引擎。
2. **输出必须清洗**：上游会夹带 `<|endoftext|>` 这类特殊 token，直接 `JSON.parse` 必失败。照抄 `server/index.mjs` 的 `parseModelJson()`：剥 `/<\|[^|]*\|>/g`、代码块围栏，再截首尾花括号重试。

解析同时接受 `playerId` 和 `playerName`（名字唯一），双重匹配。

---

## 7. AI 复盘

### 7.1 注入事实块（程序化生成，不让模型算）

- 双方 5 人的赛季数据：`pts/reb/ast` 场均值、`ts`、`load`、`per`、`gp`
- 双方结构诊断：7 维命中人数、强项、短板（含 `shortfall` 为 null 的情况）
- 互补性结论：谁补上了哪一维

### 7.2 system prompt

```
你是 NBA 球队分析师。基于给定的真实赛季数据与结构诊断复盘这两套阵容。
优先级：阵容结构互补 > 球权与空间兼容 > 位置与对位 > 单项数据。
禁止用「谁场均得分高谁更强」这类单指标推导胜负。
所有数字必须来自给定数据，不得编造；数据里没有的（伤病史、合同、季后赛表现、年龄潜力）不要提。
「护框」是盖帽率+篮板率+身高的代理指标，不要描述成对手命中率。
胜率倾向是主观判断不是统计结论，双方总和 100。
只输出 JSON：{verdict, home:{strengths,weaknesses,gameplan,keyTiming}, away:{...}, matchups:[{title,analysis}], keyFactors:[...]}
```

### 7.3 事实校验（按条目回退，不整篇丢弃）

自由文本里「识别所有数字并逐一比对」不可靠，所以**明确划定校验范围**，不要试图全覆盖。

**参与校验的内容**：`home/away` 的 `strengths`、`weaknesses`、`gameplan`，`matchups` 的每一条，`keyFactors` 的每一项。

**校验对象只有两类**：
1. **球员姓名**：出现的每个姓名必须属于本局双方 10 人之一（用全名匹配，允许只写姓且在池中唯一）。命中不上的条目判为失败。
2. **数值**：条目里出现的数字，必须能在事实块数字集合里找到，容差：
   - 百分比（含 `%` 或 0-1 小数）：±0.6 个百分点
   - 场均值（一位小数）：±0.2
   - 整数（场次、身高、年龄）：±1

**明确排除、不校验**：
- `verdict.blueWinRate` / `redWinRate`（主观判断，本来就不来自事实块）
- 赛季年份（2024、2025）、手次（第 1 手、第 10 手）、人数（5 人、10 人）、比分、胜场数
- 任何带「约」「左右」的数字按上面容差放宽一倍

**失败处理**：该条目替换为本地规则生成的兜底句（见 §7.4 的生成逻辑），其余条目保留。响应里返回 `droppedItems: n`，写进服务端日志。**不要因为个别条目失败就整篇报 502。**

### 7.4 无密钥 / 模型不可用时的降级（必须有，不是可选）

`/api/review` 在以下任一情况返回 `mode: "local"`：
- 没有 `DEEPSEEK_API_KEY`
- 模型请求失败、超时、返回无法解析

`mode: "local"` 的响应必须**字段齐全、内容非空**，结构和 AI 版完全一致：

| 字段 | 本地生成方式 |
|---|---|
| `verdict.blueWinRate` | 用双方 `value` 总分差映射：`50 + clamp((homeTotal - awayTotal) * 2.5, -18, 18)`，取整 |
| `verdict.summary` | 模板句：`主队 X 维占优、客队 Y 维占优，短板分别在 A 与 B` |
| `home/away.strengths` | 直接取该方诊断里 `level === 'strong'` 的结论（没有则取 avgZ 最高的两维，写「XX 维度相对最好」） |
| `home/away.weaknesses` | 取 `level === 'weak'` 的结论（没有则 `shortfall` 那一维，都没有则写「无显著短板」） |
| `home/away.gameplan` | 按短板生成固定建议句（缺空间 → 建议增加手递手与无球掩护；缺护框 → 建议收缩协防） |
| `home/away.keyTiming` | 固定文案，按双方 `avgMinutes` 与 `per` 分布给一句 |
| `matchups` | 取双方 `creation` z 最高的两人做一组对位，`rebounding` 最高的两人做一组 |
| `keyFactors` | 取双方 `avgZ` 差值最大的 3 个维度 |

前端在 `mode === 'local'` 时显示「本地规则复盘」标签，不要伪装成 AI 结果。**用户即使不配密钥，也必须能获得一份完整可读的复盘。**

---

## 8. UI 要求

**第一屏 开场页**：对战方式（双人对战 / 挑战 AI）、执方（主队 / 客队）、进入。去掉模式切换、征召规则、赛制。

**第二屏 选人页**：
- 左右两面板各 5 槽位，空位显示虚线 + 「第 N 顺位」
- 球员池网格：头像 + 姓名 + 球队 + 位置 + 场均得分/篮板/助攻
- 筛选：搜索、位置（G/F/C）、球队；排序：综合价值 / 单项数据
- 顶部顺位条：10 格，标出当前手次与归属方
- 当前行动方面板高亮，另一方降饱和
- **1440×900 单屏无纵向滚动**，球员池内部滚动
- AI 回合：球员池上锁 + 「AI 正在思考」，落子后底部显示上一手理由
- 「持球负荷」「护框（代理）」这类非官方指标要有 tooltip 说明口径

**第三屏 复盘弹窗**：结论卡、双方优劣势、结构诊断区（7 维胶囊，强项青色、弱项红色）、关键对位、获胜关键；`mode === 'local'` 时标题旁加「本地规则」标签。

配色复用 `src/style.css` 变量（`--bg-0`、`--gold-2`、`--line-2`）。

---

## 9. 验收标准

### 9.1 单元测试（Vitest）

**顺位**
1. `NBA_STEPS.length === 10`，归属序列严格等于 `A B B A A B B A A B`
2. 第 1 手只接受 blue，第 2 手只接受 red
3. 同一球员不能被选两次
4. 一方满 5 人后不能再选
5. 第 10 手后 `isComplete === true`

**诊断（必须用构造数据，不要用真实球员）**

6. 构造 5 个「`tpa36 = 0.5`、`tpShrunk = 0.28`」的假球员 → 断言 `空间` 命中 0 人，且诊断里有「空间拥堵」的 weak 条目
7. 构造 5 个「`blk36 = 0.1`、`heightCm = 190`、`reb36 = 4`」的假球员 → 断言 `护框` 命中 0 人，且诊断里有「禁区缺少保护」
8. 构造 5 个「`load = 33`、`astRatio = 0.30`」的假球员 → 断言触发「球权过载」

> 这三条是**构造样例**，只验证规则分支能走到。**不要**写成「五个中锋一定空间拥堵」「五个后卫一定没护框」——位置不参与算法，这种断言在真实数据上不成立，且与 §5.2 的设计矛盾。

**互补性（按单调性断言，不要断言短板维度改变）**

9. 构造一支 `rim` 全为 `-2.0` 的阵容，断言 `shortfall === 'rim'`
10. 加入一个 `rim` z = `+2.5` 的候选后，断言：
    - 阵容 `rim` 的 `avgZ` **严格大于**加入前（单调性）
    - 该候选的「补短板分」`> 0`
    - **不断言** `shortfall` 变成别的维度

> 原因：短板是「七维里相对最低的那一维」，补充一个维度后它可能仍是最低项（例如原本 -2.0，补完变 -0.6，其他维度是 +0.5）。断言「短板必变」在数学上不成立。

**阈值校准**

11. 断言 `players.json` 里每个维度的布尔命中率落在 `0.4-0.8` 区间（宽于校准目标，只做兜底，防止阈值写崩）

### 9.2 浏览器闭环（`playwright-core`）

1. 开场页有两个对战方式卡片
2. 双人模式走完 10 手，双方各 5 人
3. 人机模式：玩家只操作 5 手，AI 自动补完 5 手，存在 AI 理由行
4. 复盘弹窗可打开，结构诊断区有 7 个维度胶囊
5. **无密钥场景**：把 `DEEPSEEK_API_KEY` 置空启动，断言复盘仍能打开、`mode === 'local'`、优劣势非空
6. 1440×900 下 `document.documentElement.scrollHeight <= clientHeight`

### 9.3 构建

`npm run build` 通过，无 TypeScript 错误。

每条都要实际跑过，在交付说明里贴真实输出。**没跑过的不要写「通过」。**

---

## 10. 开工顺序

1. 建项目 → `types.ts`（`Side` / `DraftStep` / `DraftAction` / `Player`）
2. `src/engine/draft.ts` + 顺位测试 → **先测试后 UI**
3. `scripts/fetch-players.mjs`：先抓 1 队 roster + 1 人统计**验证字段路径**，再全量；得到 `players.json` 后立刻跑阈值校准
4. `server/synergy.mjs`：7 维 + 诊断 + 互补，配构造数据测试
5. `server/ai-draft.mjs`：打分 + 命令行抽查（打印 Top 5 看是否合理）
6. 前端三屏
7. 接 `/api/ai-draft`、`/api/review`（含 local 降级）
8. 浏览器闭环

---

## 11. 常见走偏（别做这些）

- 不要重试 `stats.nba.com` / BR / nba.com，已实测不通
- 不要试图找 BPM/OBPM/DBPM/VORP 的替代品再算一遍，直接不用
- 不要用 `usageRate` / `reboundRate` / `VORP`（ESPN 对这几个返回 0）
- 不要人工维护「球员组合」知识库
- 不要给位置加硬约束，位置不参与公式
- 不要跳过阈值校准直接上线
- 不要做球员详情页、对比页、交易、薪资帽、历史跨时代池
- 不要改 KPL 项目，不要 commit / push
- 不要上向量库或 embedding（数据量小、要精确匹配）

---

## 12. 交付物

- 可运行项目（`npm run dev` / `npm run start`）
- `README.md`：如何跑、如何刷新数据、阈值校准前后对比表、头像版权声明
- 测试真实输出
- 1440×900 选人页截图、复盘弹窗截图、无密钥时 local 复盘截图
