# Silicon Rider Bench - 配置指南

本文档提供详细的配置说明和示例。

## 环境变量配置

### 基本配置

复制 `.env.example` 到 `.env` 并填入你的配置：

```bash
cp .env.example .env
```

### 必需配置

#### API_KEY

支持多种 API 服务，根据你使用的服务获取对应的 API Key：

**OpenRouter（推荐）：**
1. 访问 https://openrouter.ai/
2. 注册或登录账号
3. 进入 Keys 页面
4. 创建新的 API Key
5. 复制 Key 并填入 `.env` 文件

```bash
API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**OpenAI：**
1. 访问 https://platform.openai.com/
2. 注册或登录账号
3. 进入 API Keys 页面
4. 创建新的 API Key
5. 复制 Key 并填入 `.env` 文件

```bash
API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**其他兼容服务：**
参考对应服务的文档获取 API Key，只要支持 OpenAI SDK 格式即可使用。

### 可选配置

#### MODEL_NAME

选择要使用的 AI 模型。不同模型有不同的性能和成本特点：

**推荐模型：**

```bash
# Claude 3.5 Sonnet - 推荐，性能优秀，成本适中
MODEL_NAME=anthropic/claude-3.5-sonnet

# Claude 3 Opus - 最强性能，适合追求最佳结果
MODEL_NAME=anthropic/claude-3-opus

# Claude 3 Haiku - 快速响应，成本低
MODEL_NAME=anthropic/claude-3-haiku

# GPT-4 Turbo - OpenAI 最新模型
MODEL_NAME=openai/gpt-4-turbo

# GPT-4 - 稳定可靠
MODEL_NAME=openai/gpt-4

# GPT-3.5 Turbo - 快速，成本低
MODEL_NAME=openai/gpt-3.5-turbo
```

**性能对比：**

| 模型 | 性能 | 速度 | 成本 | 推荐场景 |
|------|------|------|------|----------|
| Claude 3.5 Sonnet | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 日常测试，性能评估 |
| Claude 3 Opus | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | 追求最佳性能 |
| Claude 3 Haiku | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 快速测试，成本敏感 |
| GPT-4 Turbo | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | OpenAI 用户 |
| GPT-3.5 Turbo | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 快速原型 |

#### BASE_URL

API 基础 URL，默认使用 OpenRouter：

```bash
BASE_URL=https://openrouter.ai/api/v1
```

如果使用其他兼容 OpenAI SDK 的服务：

```bash
# 使用 OpenAI 官方 API
BASE_URL=https://api.openai.com/v1

# 使用自定义代理
BASE_URL=https://your-proxy.com/v1
```

#### MAX_ITERATIONS

最大迭代次数，控制 AI 模型的最大对话轮数：

```bash
# 默认值：300
MAX_ITERATIONS=300
```

**说明：**
- 每次迭代代表一轮 AI 模型的请求和响应
- Level 0.1 通常需要 5-10 次迭代即可完成
- Level 1 可能需要 100-300 次迭代（取决于模型策略）
- 如果达到最大迭代次数，模拟会自动终止并生成报告
- 设置过低可能导致任务未完成就终止
- 设置过高会增加 API 调用成本

**推荐值：**
- 快速测试：50-100
- 正常运行：200-300
- 长时间运行：500+

#### SITE_URL 和 APP_NAME

用于 OpenRouter 统计和排名（可选）：

```bash
SITE_URL=https://your-website.com
APP_NAME=My Silicon Rider Bench
```

## Level 配置

### 预定义 Level

系统提供两个预定义的 Level：

#### Level 0.1 - 教程场景

```typescript
{
  duration: 60,           // 60 分钟
  mapSize: 'small',       // 小地图（约 10 个节点）
  seed: 12345,            // 固定种子
  orderCount: 1,          // 只有一个订单
}
```

**用途：**
- 验证 Agent 基本功能
- 测试工具调用序列
- 快速调试

**运行：**
```bash
npm run level0.1
```

#### Level 1 - 完整基准测试

```typescript
{
  duration: 1440,         // 1440 分钟（24 小时）
  mapSize: 'large',       // 大地图（50+ 节点）
  seed: 67890,            // 固定种子
  baseOrderFrequency: 5,  // 每 5 分钟生成订单
}
```

**特性：**
- 24 小时完整周期
- 动态拥堵（早晚高峰）
- 订单潮汐效应
- 多种订单类型
- 完整评分系统

**运行：**
```bash
npm run level1
```

### 自定义 Level

通过命令行参数自定义 Level 配置：

```bash
# 使用自定义种子
npm run dev -- --level 1 --seed 12345

# 自定义种子和模型
npm run dev -- --level 1 --seed 42 --model anthropic/claude-3-opus

# 禁用可视化（提高性能）
npm run dev -- --level 1 --no-viz

# 指定输出文件
npm run dev -- --level 1 --output my-report.md
```

### 配置参数说明

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `duration` | number | 模拟时长（分钟） | Level 配置 |
| `mapSize` | 'small' \| 'large' | 地图大小 | Level 配置 |
| `seed` | number | 随机种子 | Level 配置 |
| `orderCount` | number | 订单数量（Level 0.1） | 1 |
| `baseOrderFrequency` | number | 基准订单频率（Level 1） | 5 |

## 命令行选项

### 完整选项列表

```bash
npm run dev -- [options]
```

| 选项 | 简写 | 类型 | 说明 | 默认值 |
|------|------|------|------|--------|
| `--level` | `-l` | string | Level 名称（0.1 或 1） | 1 |
| `--seed` | `-s` | number | 地图种子 | Level 配置 |
| `--model` | `-m` | string | AI 模型名称 | .env 配置 |
| `--no-viz` | - | boolean | 禁用可视化 | false |
| `--output` | `-o` | string | 输出文件路径 | report.md |
| `--help` | `-h` | - | 显示帮助 | - |

### 使用示例

#### 基本使用

```bash
# 运行 Level 1（默认配置）
npm run level1

# 运行 Level 0.1
npm run level0.1
```

#### 自定义种子

```bash
# 使用固定种子确保可重现性
npm run dev -- --level 1 --seed 12345

# 使用不同种子测试多次
npm run dev -- --level 1 --seed 1
npm run dev -- --level 1 --seed 2
npm run dev -- --level 1 --seed 3
```

#### 模型对比测试

```bash
# 测试 Claude 3.5 Sonnet
npm run dev -- --level 1 --model anthropic/claude-3.5-sonnet --output claude-sonnet.md

# 测试 GPT-4
npm run dev -- --level 1 --model openai/gpt-4 --output gpt4.md

# 测试 Claude 3 Haiku
npm run dev -- --level 1 --model anthropic/claude-3-haiku --output claude-haiku.md
```

#### 性能优化

```bash
# 禁用可视化以提高性能
npm run dev -- --level 1 --no-viz

# 组合多个选项
npm run dev -- --level 1 --seed 42 --no-viz --output fast-test.md
```

#### 批量测试

```bash
# 使用 shell 脚本批量测试
for seed in 1 2 3 4 5; do
  npm run dev -- --level 1 --seed $seed --output "result-$seed.md"
done
```

## 配置最佳实践

### 开发环境

```bash
# .env
API_KEY=your_dev_key
MODEL_NAME=anthropic/claude-3-haiku  # 快速，成本低
DEBUG=true
```

```bash
# 快速测试
npm run level0.1

# 完整测试（禁用可视化）
npm run dev -- --level 1 --no-viz
```

### 生产环境

```bash
# .env
API_KEY=your_prod_key
MODEL_NAME=anthropic/claude-3.5-sonnet  # 性能优秀
SITE_URL=https://your-site.com
APP_NAME=Silicon Rider Bench Production
```

```bash
# 正式评测
npm run dev -- --level 1 --seed 67890 --output production-report.md
```

### 基准测试

```bash
# 使用固定种子确保公平对比
SEED=12345

# 测试多个模型
npm run dev -- --level 1 --seed $SEED --model anthropic/claude-3.5-sonnet --output benchmark-sonnet.md
npm run dev -- --level 1 --seed $SEED --model openai/gpt-4 --output benchmark-gpt4.md
npm run dev -- --level 1 --seed $SEED --model anthropic/claude-3-opus --output benchmark-opus.md
```

## 故障排除

### API Key 无效

**错误：** `Invalid API key`

**解决：**
1. 检查 `.env` 文件中的 `API_KEY` 是否正确
2. 确认 API Key 在对应服务网站上是否有效
3. 检查 API Key 是否有足够的额度
4. 确认 `BASE_URL` 与 API Key 的服务匹配

### 模型不可用

**错误：** `Model not found`

**解决：**
1. 检查模型名称是否正确（区分大小写）
2. 访问 [OpenRouter Models](https://openrouter.ai/models) 查看可用模型
3. 确认你的账号是否有权限使用该模型

### 连接超时

**错误：** `Connection timeout`

**解决：**
1. 检查网络连接
2. 尝试使用代理
3. 增加超时时间（在 `.env` 中添加 `API_TIMEOUT=120000`）

### 种子不生效

**问题：** 使用相同种子但结果不同

**解决：**
1. 确认使用了 `--seed` 参数
2. 检查是否修改了代码中的随机数生成逻辑
3. 确保使用相同的 Level 配置

## 高级配置

### 自定义 Level 配置（代码）

如果需要更复杂的自定义配置，可以修改 `src/levels/level-config.ts`：

```typescript
import { createCustomLevelConfig } from './src/levels/level-config';

const myConfig = createCustomLevelConfig({
  duration: 720,              // 12 小时
  mapSize: 'large',
  seed: 99999,
  baseOrderFrequency: 3,      // 每 3 分钟生成订单
});
```

### 环境变量优先级

配置的优先级（从高到低）：

1. 命令行参数（`--model`, `--seed` 等）
2. 环境变量（`.env` 文件）
3. 代码中的默认值

### 调试模式

启用详细日志以查看完整的 AI 请求和响应：

```bash
# .env
DEBUG=true
```

或使用环境变量：

```bash
DEBUG=true npm run level1
```

**调试输出包括：**
- 完整的请求 JSON（包括 messages 和 tools）
- 完整的响应 JSON（包括 choices 和 usage）
- 工具调用的详细信息

**注意：** 调试模式会产生大量输出，建议只在需要排查问题时启用。

## 配置模板

### 快速测试模板

```bash
# .env.quick-test
API_KEY=your_key
MODEL_NAME=anthropic/claude-3-haiku
DEBUG=true
```

```bash
# 使用模板
cp .env.quick-test .env
npm run level0.1
```

### 性能评测模板

```bash
# .env.benchmark
API_KEY=your_key
MODEL_NAME=anthropic/claude-3.5-sonnet
SITE_URL=https://your-site.com
APP_NAME=Silicon Rider Benchmark
```

```bash
# 使用模板
cp .env.benchmark .env
npm run dev -- --level 1 --seed 67890 --output benchmark.md
```

### 成本优化模板

```bash
# .env.cost-optimized
API_KEY=your_key
MODEL_NAME=anthropic/claude-3-haiku
```

```bash
# 使用模板
cp .env.cost-optimized .env
npm run dev -- --level 1 --no-viz
```

## ZCode 模型批量测试

除手动配置 `.env` 外，还可以直接测试 ZCode 客户端接入的全部模型
（详见 README 的"ZCode 模型批量测试"章节）：

```bash
npm run zcode-bench -- --list          # 列出模型
npm run zcode-bench -- --all           # 批量冒烟（默认 Level 0.1）
```

相关配置：

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `ZCODE_CONFIG` | ZCode 配置文件路径 | `~/.zcode/v2/config.json` |

说明：

- 该模式下 `API_KEY` / `BASE_URL` / `MODEL_NAME` 从 ZCode 配置自动注入，
  `.env` 中的同名变量会被注入值覆盖（环境变量优先于 dotenv）；
- API Key 不写入任何仓库文件，`--list` 输出只显示"是否已配置"；
- 智谱系 anthropic 端点会自动映射为 OpenAI 兼容端点
  （`open.bigmodel.cn/api/anthropic` → `open.bigmodel.cn/api/coding/paas/v4`）。

## 参考资源

- [OpenRouter 文档](https://openrouter.ai/docs)
- [OpenRouter 模型列表](https://openrouter.ai/models)
- [OpenAI SDK 文档](https://github.com/openai/openai-node)
- [项目 GitHub](https://github.com/your-org/silicon-rider-bench)
