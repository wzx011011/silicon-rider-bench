---
name: srb-bench
description: Use when the user wants to benchmark AI models connected to ZCode using Silicon Rider Bench (骑手外卖 Agent 模拟基准). Covers listing ZCode-configured models, running single-model or batch benchmarks, and reporting the comparison results.
---

# Silicon Rider Bench — ZCode 模型基准测试

把 ZCode 客户端配置的 AI 模型（`~/.zcode/v2/config.json` 的 provider）作为被测对象，
运行 Silicon Rider Bench（AI 外卖骑手 Agent 模拟）并对比各模型成绩。

## 前置条件

1. **定位 bench 仓库**：读本插件目录下 `config.json` 的 `benchRepoPath` 字段。
   - 文件不存在：从 `config.example.json` 复制创建，向用户确认路径后填入。
   - Windows 路径用正斜杠或双反斜杠。
2. **依赖检查**：确认 `<benchRepoPath>/node_modules` 存在，否则先在仓库目录执行 `npm install`。

## 工作流

### 1. 列出可测试模型

```bash
cd <benchRepoPath>
npm run zcode-bench -- --list
```

输出包含每个模型的 provider、协议、映射后的 OpenAI 兼容端点、密钥配置状态、是否多模态、
能否测试。无法映射端点或缺少密钥的模型会被自动跳过。

### 2. 与用户确认测试范围与级别

- **范围**：全部可测试模型，或其中某几个（格式 `providerId/modelId`）。
- **级别**（重要，涉及耗时与费用）：
  - `0.1` 冒烟（默认）：单模型约 2~5 分钟，验证接入与基础能力；
  - `1` 正式：单模型 1 小时以上、百万级 token，必须先获得用户明确同意；
  - `2`/`3`：多模态/多骑手场景，仅对支持图像输入的模型有意义（`--list` 的"多模态"列）。

### 3. 运行基准

```bash
# 批量冒烟（推荐加固定种子保证可比性）
npm run zcode-bench -- --all --level 0.1 --seed 67890

# 单模型正式
npm run zcode-bench -- --model builtin:bigmodel-coding-plan/GLM-5.3-Flash --level 1 --seed 67890

# 排除某些 provider
npm run zcode-bench -- --all --exclude builtin:bigmodel
```

批量运行为顺序执行，每模型产物：
- `report-zcode-<provider>-<model>-l<level>.md` 评测报告
- `report-zcode-<provider>-<model>-l<level>.json` 结构化指标
- `bench-logs/<provider>-<model>-l<level>.log` 完整运行日志

全部结束后生成 **`zcode-bench-comparison.md`** 对比表。

### 4. 汇报结果

读取 `zcode-bench-comparison.md`，向用户汇报：每个模型的状态、利润、完成单数、准时率、
路径效率、违规率、token 消耗、耗时；指出表现最好/最差的模型和失败原因。

## Web 可视化（可选，仅单模型）

```bash
npm run zcode-bench -- --model builtin:bigmodel-coding-plan/GLM-5.3-Flash --level 0.1 --mode web
```

服务地址 `http://localhost:3000`，可打开浏览器实时查看地图与对话。

## 安全红线

- API Key 由 CLI 从 ZCode 配置读取，仅通过环境变量注入子进程；**agent 与任何输出都不得读取、显示或记录密钥**。
- `--list` 输出已脱敏（只显示"有/无"密钥）。

## 故障排查

| 症状 | 处理 |
|------|------|
| `未找到模型` | 用 `--list` 核对 providerId/modelId（区分大小写，modelId 用 ZCode 配置里的原始名称） |
| 1211 模型不存在 | CLI 会自动小写重试一次；仍失败说明该端点无此模型 |
| 1214 messages 参数非法 | 仓库已内置 BigModel 兼容修复；复现说明仓库版本过旧，检查 src/client/ai-client.ts 的历史裁剪逻辑 |
| 单模型卡死 | 默认 30 分钟超时自动终止；可用 `--per-model-timeout` 调整 |
| 端点无法映射 | anthropic 协议仅支持智谱系已知端点；自定义 provider 需在 src/integrations/zcode-config.ts 的映射表中添加 |
