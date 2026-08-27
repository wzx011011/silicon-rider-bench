# Silicon Rider Bench（硅基骑手）

![](./assets/images/silicon-rider-bench-cover.jpg)

KCORES Agent 基准测试项目，旨在评估单模态/多模态模型作为智能体的能力。

## 项目简介

Silicon Rider Bench 模拟外卖骑手的工作流程，AI 智能体通过调用工具做出决策，最终评价基于固定时间内赚取的利润。该基准测试提供了一个虚拟沙箱环境，智能体在模拟城市中导航、接单、取餐、送餐，并管理电池电量等资源。

### 核心特性

- 🎯 **真实场景模拟**：模拟外卖配送的完整工作流程，包括接单、取餐、送餐、换电等
- 🗺️ **动态环境**：基于种子生成的确定性地图，支持动态拥堵和订单潮汐
- 🔋 **资源管理**：智能体需要管理电量、承载能力、时间等多种资源
- 📊 **多维度评估**：从利润、准时率、路径效率、API 违规率等多个角度评估性能
- 🧪 **可重现性**：使用种子确保每次运行的地图和订单生成完全一致
- 🛠️ **工具调用**：提供 10 个标准工具 API，支持 OpenAI SDK 兼容的模型

## 安装

### 环境要求

- Node.js ≥ 18.0.0
- TypeScript ≥ 5.0.0
- OpenRouter API Key（或兼容 OpenAI SDK 的 API，或本地 llama.cpp 服务）

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/kcores/silicon-rider-bench.git
cd silicon-rider-bench

# 安装依赖
npm install

# 配置 API
cp .env.example .env
# 编辑 .env 文件，填入你的 API_KEY
```

### 配置说明

编辑 `.env` 文件：

**使用 OpenRouter / OpenAI：**

```bash
# API Key（必需）- 支持 OpenRouter、OpenAI 等兼容服务
API_KEY=your_api_key_here

# 模型名称（可选，默认：anthropic/claude-3.5-sonnet）
MODEL_NAME=anthropic/claude-3.5-sonnet

# API Base URL（可选，默认：https://openrouter.ai/api/v1）
BASE_URL=https://openrouter.ai/api/v1

# 最大迭代次数（可选，默认：300）
# AI 模型的最大对话轮数，Level 1 可能需要 100-300 次迭代
MAX_ITERATIONS=300
```

**使用 llama.cpp 或其他无需 API Key 的服务：**

```bash
# API Key 是可选的，留空即可
API_KEY=

# API Base URL - 支持本地或远程服务
BASE_URL=http://localhost:8080/v1
# 或远程地址，例如：
# BASE_URL=http://10.0.6.26:9999/api/v1

# 模型名称（可以任意填写）
MODEL_NAME=llama-local

# 最大迭代次数
MAX_ITERATIONS=300
```

> **注意**：API_KEY 现在是可选的。如果留空，系统会使用占位符，由上游 API 决定是否需要认证。
> 详细配置说明请参考 [DOCUMENTS/llamacpp-configuration.md](DOCUMENTS/llamacpp-configuration.md)

# 站点 URL（可选，用于 OpenRouter 排名）
SITE_URL=

# 应用名称（可选）
APP_NAME=Silicon Rider Bench
```

## 使用指南

### 快速开始

```bash
# 运行 Level 0.1（教程场景，单订单完成）
npm run level0.1

# 运行 Level 1（完整基准测试，24 小时模拟）
npm run level1

# 运行测试套件
npm test

# 运行测试（带覆盖率报告）
npm run test:coverage
```

### 高级用法

```bash
# 使用自定义种子运行
npm run dev -- --level 1 --seed 12345

# 禁用实时可视化（提高性能）
npm run dev -- --level 1 --no-viz

# 指定输出报告文件
npm run dev -- --level 1 --output my-report.md

# 使用不同的 AI 模型
npm run dev -- --level 1 --model anthropic/claude-3-opus

# 组合多个选项
npm run dev -- --level 1 --seed 42 --model openai/gpt-4 --output gpt4-result.md

# 查看所有命令行选项
npm run dev -- --help
```

### ZCode 模型批量测试

自动读取 ZCode 客户端配置（`~/.zcode/v2/config.json`）中已接入的全部 AI 模型，
逐个运行基准并生成横向对比报告。无需手动配置 `.env`——API Key 在运行时
从 ZCode 配置读取，仅通过环境变量注入子进程，不落盘、不打印。

```bash
# 列出 ZCode 接入的全部模型（密钥脱敏）
npm run zcode-bench -- --list

# 批量冒烟测试全部可测模型（Level 0.1，单模型约 2~5 分钟）
npm run zcode-bench -- --all --level 0.1 --seed 67890

# 单模型正式基准（Level 1，耗时约 1 小时/模型）
npm run zcode-bench -- --model builtin:bigmodel-coding-plan/GLM-5.3-Flash --level 1 --seed 67890

# 单模型 + Web 可视化（浏览器打开 http://localhost:3000）
npm run zcode-bench -- --model builtin:bigmodel-coding-plan/GLM-5.3-Flash --level 0.1 --mode web

# 排除部分 provider
npm run zcode-bench -- --all --exclude builtin:bigmodel
```

产物（均在仓库根目录）：

| 文件 | 说明 |
|------|------|
| `report-zcode-<provider>-<model>-l<level>.md` | 单模型评测报告 |
| `report-zcode-<provider>-<model>-l<level>.json` | 单模型结构化指标 |
| `bench-logs/*.log` | 单模型完整运行日志 |
| `zcode-bench-comparison.md` | 全部模型的横向对比表 |

支持情况说明：

- 智谱系 provider（`open.bigmodel.cn` / `api.z.ai`，anthropic 协议）自动映射到
  OpenAI 兼容端点（已实测 `open.bigmodel.cn/api/coding/paas/v4`）；
- `kind: openai` 的 provider 直接使用其 baseURL；
- 未知 anthropic 端点或缺少 API Key 的模型会在 `--list` 中标出并自动跳过；
- Level 2/3 需要`--list`中标记"多模态=是"的模型。

#### ZCode 插件（`/srb:bench` 命令）

仓库内置 ZCode 插件包（`plugin/` 目录），安装后可在 ZCode 中直接用
`/srb:bench [级别] [模型]` 发起测试：

1. ZCode 客户端 → 设置 → 插件管理 → 发现 → `+` 添加市场，
   选择本地目录：本仓库的 `plugin/`；
2. 安装 `silicon-rider-bench` 插件并启用；
3. 首次使用时按提示把 `plugin/config.example.json` 复制为 `plugin/config.json`，
   确认其中 `benchRepoPath` 指向本仓库绝对路径；
4. 在任意会话输入 `/srb:bench 0.1` 即可。

### Web 可视化模式

Silicon Rider Bench 支持基于浏览器的实时可视化界面，提供更直观的模拟过程展示。

#### 启动 Web 模式

```bash
# 使用默认配置启动 Web 模式（localhost:3000）
npm run dev -- --level 1 --mode web

# 指定自定义主机和端口
npm run dev -- --level 1 --mode web --host 0.0.0.0 --port 8080

# Web 模式下运行 Level 0.1
npm run dev -- --level 0.1 --mode web
```

启动后，终端会显示访问 URL：

```
🌐 Web server started at http://localhost:3000
📊 Open this URL in your browser to view the simulation
```

#### Web 界面功能

Web 界面分为三个主要区域：

**1. 地图区域（左侧/中央）**
- 🗺️ 显示完整的模拟世界地图
- 📍 使用 emoji 图标表示不同类型的位置：
  - 🍔 餐厅
  - 🏠 住宅
  - 🏢 办公室
  - 🛒 超市
  - 💊 药店
  - 🔋 换电站
- 🚴 实时显示骑手当前位置
- 📐 网格背景显示空间结构

**2. 统计面板（右侧）**
- ⏰ 当前游戏时间
- 🔋 骑手电量百分比
- 💰 当前利润金额
- 📦 携带订单数量和重量
- ✅ 已完成订单数量
- 📋 背包中的订单详细列表（ID、类型、重量、截止时间）

**3. 对话面板（底部）**
- 💭 AI 的思考过程和推理文本
- 🔧 工具调用信息（工具名称和参数）
- 📥 工具调用返回结果
- 🔄 自动滚动到最新消息

#### Web 模式特性

- **实时更新**：通过 WebSocket 实现毫秒级的状态同步
- **连接状态指示**：界面右上角显示连接状态（🟢 已连接 / 🔴 已断开）
- **自动重连**：WebSocket 断开时自动尝试重新连接
- **响应式布局**：适配不同屏幕尺寸
- **终端日志保留**：Web 模式下终端仍然输出关键事件和最终报告

#### Web 模式 vs 终端模式

| 特性 | 终端模式 | Web 模式 |
|------|---------|---------|
| 可视化方式 | 终端字符界面 | 浏览器图形界面 |
| 实时更新 | 逐行刷新 | WebSocket 推送 |
| 地图显示 | ASCII 字符 | Emoji 图标 + 网格 |
| 对话展示 | 滚动文本 | 结构化气泡 |
| 多设备查看 | ❌ | ✅（同一网络） |
| 性能影响 | 低 | 低（异步推送） |
| 模拟结果 | 完全一致 | 完全一致 |

#### 技术细节

- **服务器**：基于 Node.js 内置 `http` 模块和 `ws` 库
- **客户端**：原生 HTML5 + CSS3 + JavaScript（无框架依赖）
- **通信协议**：WebSocket（双向实时通信）
- **静态资源**：位于 `src/web/public/` 目录
- **浏览器兼容性**：支持所有现代浏览器（Chrome 16+, Firefox 11+, Safari 7+, Edge）

#### 故障排除

**端口已被占用**
```bash
# 使用其他端口
npm run dev -- --level 1 --mode web --port 3001
```

**无法访问 Web 界面**
- 检查防火墙设置
- 确认浏览器支持 WebSocket
- 查看终端输出的访问 URL 是否正确

**连接断开**
- Web 界面会自动尝试重连
- 检查网络连接
- 刷新浏览器页面

### 命令行选项

| 选项 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--level` | `-l` | 指定关卡（0.1 或 1） | 1 |
| `--seed` | `-s` | 指定地图种子 | Level 配置默认值 |
| `--model` | `-m` | 指定 AI 模型名称 | .env 中的 MODEL_NAME |
| `--mode` | - | 可视化模式（terminal 或 web） | terminal |
| `--host` | - | Web 服务器主机地址（仅 Web 模式） | localhost |
| `--port` | - | Web 服务器端口号（仅 Web 模式） | 3000 |
| `--no-viz` | - | 禁用实时可视化 | false |
| `--output` | `-o` | 指定报告输出文件 | report.md |
| `--help` | `-h` | 显示帮助信息 | - |

### Level 说明

#### Level 0.1 - 教程场景

- **目标**：完成单个订单配送
- **时长**：60 分钟
- **地图**：小型地图（约 10 个节点）
- **订单**：1 个预设订单
- **用途**：验证 Agent 基本功能，测试工具调用序列

#### Level 1 - 完整基准测试

- **目标**：在 24 小时内最大化利润
- **时长**：1440 分钟（24 小时）
- **地图**：大型地图（50+ 节点）
- **订单**：动态生成，支持订单潮汐
- **特性**：
  - 动态拥堵（早晚高峰）
  - 订单潮汐（不同时段不同类型订单频率变化）
  - 多种订单类型（餐饮、超市、药店）
  - 资源管理（电量、承载能力）
  - 超时惩罚机制



## 评分指标

模拟结束后，系统会生成包含以下指标的评测报告：

### 核心指标

1. **总利润**：订单支付总和 - 换电成本
2. **准时率**：准时配送订单数 / 总配送订单数
3. **路径效率**：实际行驶距离 / 理论最优距离
4. **API 违规率**：无效工具调用数 / 总工具调用数

### 详细统计

- 完成订单数
- 总行驶距离
- 换电次数
- 平均每单利润
- 超时订单数
- 平均超时时长
- 订单类型分布

### 报告示例

```markdown
# Silicon Rider Bench - 评测报告

## 基本信息
- Level: 1
- Seed: 67890
- Duration: 24:00:00
- Model: anthropic/claude-3.5-sonnet

## 核心指标
- **总利润**: ¥1,234.50
- **完成订单数**: 87
- **准时率**: 82.8% (72/87)
- **路径效率**: 1.15
- **API 违规率**: 2.3% (12/520)

## 详细统计
- 总行驶距离: 145.6 km
- 换电次数: 4
- 平均每单利润: ¥14.19
- 超时订单数: 15
- 平均超时时长: 8.3 分钟
```

## 项目结构

```
silicon-rider-bench/
├── src/
│   ├── core/                    # 核心模块
│   │   ├── agent-state.ts       # 智能体状态管理
│   │   ├── game-clock.ts        # 游戏时钟
│   │   ├── simulator.ts         # 模拟器核心
│   │   ├── order-generator.ts   # 订单生成器
│   │   ├── fee-calculator.ts    # 配送费计算
│   │   ├── penalty-calculator.ts # 惩罚计算
│   │   └── movement-calculator.ts # 移动计算
│   ├── world/                   # 地图和世界管理
│   │   ├── map-generator.ts     # 地图生成器
│   │   ├── congestion-manager.ts # 拥堵管理
│   │   └── pathfinder.ts        # 路径查找
│   ├── tools/                   # 工具调用模块
│   │   ├── tool-registry.ts     # 工具注册
│   │   ├── tool-executor.ts     # 工具执行器
│   │   ├── query-tools.ts       # 查询工具
│   │   └── action-tools.ts      # 行动工具
│   ├── client/                  # AI 客户端
│   │   └── ai-client.ts         # OpenAI SDK 集成
│   ├── cli/                     # 命令行参数解析
│   │   └── args-parser.ts       # 参数解析器
│   ├── visualization/           # 终端可视化模块
│   │   └── terminal-display.ts  # 终端显示
│   ├── web/                     # Web 可视化模块
│   │   ├── web-server.ts        # Web 服务器
│   │   ├── web-visualization.ts # Web 可视化适配器
│   │   ├── types.ts             # WebSocket 消息类型
│   │   └── public/              # 静态资源
│   │       ├── index.html       # 主页面
│   │       ├── css/
│   │       │   └── style.css    # 样式表
│   │       └── js/
│   │           ├── main.js      # 主逻辑
│   │           ├── map-renderer.js    # 地图渲染
│   │           ├── stats-panel.js     # 统计面板
│   │           └── chat-panel.js      # 对话面板
│   ├── scoring/                 # 评分模块
│   │   ├── score-calculator.ts  # 评分计算
│   │   └── report-generator.ts  # 报告生成
│   ├── levels/                  # 关卡配置
│   │   └── level-config.ts      # Level 配置
│   ├── types/                   # TypeScript 类型定义
│   │   └── index.ts             # 类型定义
│   ├── utils/                   # 工具函数
│   │   └── seeded-rng.ts        # 种子随机数生成器
│   └── index.ts                 # 主程序入口
├── tests/                       # 测试文件
│   └── integration/             # 集成测试
│       ├── level0.1.test.ts
│       └── level1.test.ts
├── .env.example                 # 环境变量示例
├── package.json                 # 项目配置
├── tsconfig.json                # TypeScript 配置
└── vitest.config.ts             # 测试配置
```

## 开发

### 运行测试

```bash
# 运行所有测试
npm test

# 监听模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

### 构建项目

```bash
# 编译 TypeScript
npm run build

# 运行编译后的代码
node dist/index.js --level 1
```



## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT

## 致谢

感谢所有为这个项目做出贡献的开发者。
