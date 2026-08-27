---
description: 用 Silicon Rider Bench 测试 ZCode 接入的 AI 模型（外卖骑手 Agent 基准）
argument-hint: "[级别] [provider/model ...] 例: 0.1 | 1 | 0.1 builtin:bigmodel-coding-plan/GLM-5.3-Flash"
---

使用 `srb-bench` 技能完成本次基准测试请求：

$ARGUMENTS

执行要点：
1. 先读本插件目录下的 `config.json` 获取 bench 仓库路径；文件不存在时从 `config.example.json` 复制创建，并向用户确认其中的 `benchRepoPath`。
2. 在 bench 仓库运行 `npm run zcode-bench -- --list` 列出全部可测试模型。
3. 用户未明确指定模型时，先列出可测试模型让用户选择范围（全部 / 指定模型）。
4. 批量测试默认 Level 0.1 冒烟；Level 1 属于正式基准（每模型数小时），必须先向用户确认。
5. 运行结束后读取 `zcode-bench-comparison.md`，向用户汇报各模型的核心指标（利润/完成单数/准时率/路径效率/违规率）。
6. 安全红线：任何输出都不得包含 API Key（CLI 自行从 ZCode 配置读取并注入子进程环境变量，无需也不应展示密钥）。
