/**
 * Silicon Rider Bench - 主程序入口
 * 
 * 任务 18.1: 实现 CLI 入口
 * - 创建 src/index.ts
 * - 实现命令行参数解析
 * - 实现 Level 选择逻辑
 * - 整合所有模块
 * - 启动模拟和可视化
 * - 生成最终报告
 */

import { Simulator } from './core/simulator';
import { getLevelConfig, printLevelConfig } from './levels/level-config';
import { LevelConfig } from './types';
import { createAIClient, generateSystemPrompt, AIClient } from './client/ai-client';
import { TerminalDisplay } from './visualization/terminal-display';
import { ReportGenerator, ConversationEntry, ReportStatus } from './scoring/report-generator';
import { formatStatusDisplay, formatHeader, formatSeparator } from './utils/cli-formatter';
import { parseArgs, CLIArgs } from './cli/args-parser';
import { WebServer } from './web/web-server';
import { WebVisualization } from './web/web-visualization';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 全局变量，用于优雅退出时生成报告
let globalSimulator: Simulator | null = null;
let globalAIClient: AIClient | null = null;
let globalConfig: LevelConfig | null = null;
let globalArgs: CLIArgs | null = null;
let globalStartTime: Date | null = null;
let globalWebVisualization: WebVisualization | null = null;
let globalWebServer: WebServer | null = null;
let isShuttingDown = false;

/**
 * 生成并保存报告
 * 
 * @param status 报告状态
 * @param statusMessage 状态说明信息
 */
async function generateAndSaveReport(
  status: ReportStatus,
  statusMessage?: string
): Promise<void> {
  if (!globalSimulator || !globalAIClient || !globalConfig || !globalArgs || !globalStartTime) {
    console.log('\n⚠️ 无法生成报告：模拟器或 AI 客户端未初始化');
    return;
  }

  const endTime = new Date();
  
  console.log('\n正在计算评分...');
  const scoreCalculator = globalSimulator.getScoreCalculator();
  const metrics = scoreCalculator.calculateMetrics();

  // 获取 token 使用量
  const tokenUsage = globalAIClient.getTokenUsage();
  
  // 获取对话历史并转换为 ConversationEntry 格式
  const conversationLogs = globalAIClient.getAllConversationLogs();
  const conversationHistory: ConversationEntry[] = conversationLogs.map(log => {
    const entry: ConversationEntry = {
      iteration: log.iteration,
      role: log.type as 'assistant' | 'tool',
    };
    
    if (log.type === 'assistant') {
      const contentMatch = log.content.match(/【Content】\n([\s\S]*?)(?=\n【Tool Calls】|\n={80})/);
      if (contentMatch) {
        entry.content = contentMatch[1].trim();
      }
      
      const toolCallMatch = log.content.match(/\[\d+\]\s+(\w+)\n\s*Arguments:\n([\s\S]*?)(?=\n\s*\[\d+\]|\n={80})/);
      if (toolCallMatch) {
        entry.toolName = toolCallMatch[1];
        try {
          entry.toolArgs = JSON.parse(toolCallMatch[2].trim());
        } catch {
          // 如果解析失败，保留原始字符串
        }
      }
    } else if (log.type === 'tool') {
      const toolNameMatch = log.content.match(/TOOL:\s*(\w+)/);
      if (toolNameMatch) {
        entry.toolName = toolNameMatch[1];
      }
      
      const resultMatch = log.content.match(/【Result】\n([\s\S]*?)(?=\n-{80})/);
      if (resultMatch) {
        try {
          entry.toolResult = JSON.parse(resultMatch[1].trim());
        } catch {
          entry.toolResult = resultMatch[1].trim();
        }
      }
    }
    
    return entry;
  });

  // 生成报告配置
  const aiConfig = globalAIClient.getConfig();
  const reportConfig = {
    level: globalArgs.level === 'level0.1' ? '0.1' : '1',
    seed: globalConfig.seed,
    duration: globalConfig.duration,
    modelName: aiConfig.modelName,
    startTime: globalStartTime.toLocaleString(),
    endTime: endTime.toLocaleString(),
    tokenUsage: tokenUsage.cumulative,
    status,
    statusMessage,
    // 配置参数
    maxIterations: aiConfig.maxIterations,
    contextHistoryLimit: aiConfig.contextHistoryLimit,
    temperature: aiConfig.temperature,
    topP: aiConfig.topP,
    repetitionPenalty: aiConfig.repetitionPenalty,
    toolCallFormat: process.env.TOOL_CALL_FORMAT || 'openai',
  };

  // 生成报告
  console.log('正在生成报告...\n');
  const report = ReportGenerator.generateReport(
    reportConfig,
    metrics
  );

  // 输出报告
  console.log('\n' + formatSeparator('═'));
  console.log(report);
  console.log(formatSeparator('═'));

  // 发送模拟结束消息到 Web 客户端
  if (globalWebVisualization) {
    globalWebVisualization.sendSimulationEnd(report);
  }

  // 保存报告到文件
  const statusSuffix = status === 'interrupted' ? '-interrupted' : '';
  const outputFile = globalArgs.outputFile || `report-${globalArgs.level}-${Date.now()}${statusSuffix}.md`;
  const outputPath = path.resolve(outputFile);
  fs.writeFileSync(outputPath, report, 'utf-8');
  console.log(`\n✓ 报告已保存到: ${outputPath}`);

  // 保存结构化指标 JSON（供批量测试工具聚合对比）
  const metricsJson = {
    config: reportConfig,
    metrics,
    tokenUsage: tokenUsage.cumulative,
  };
  const metricsJsonPath = outputPath.replace(/\.md$/, '.json');
  fs.writeFileSync(metricsJsonPath, JSON.stringify(metricsJson, null, 2), 'utf-8');
  console.log(`✓ 指标 JSON 已保存到: ${metricsJsonPath}`);

  // 生成并保存详细报告
  console.log('正在生成详细报告...');
  const detailReport = ReportGenerator.generateDetailReport(
    { ...reportConfig, conversationHistory },
    metrics,
    conversationHistory
  );
  const detailOutputFile = outputFile.replace('.md', '-detail.md');
  const detailOutputPath = path.resolve(detailOutputFile);
  fs.writeFileSync(detailOutputPath, detailReport, 'utf-8');
  console.log(`✓ 详细报告已保存到: ${detailOutputPath}\n`);

  // 关闭 Web 服务器（如果启用）
  if (globalWebServer) {
    console.log('正在关闭 Web 服务器...');
    await globalWebServer.stop();
    console.log('✓ Web 服务器已关闭\n');
  }
}

/**
 * 优雅退出处理器
 */
async function handleGracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log('\n⚠️ 正在关闭中，请稍候...');
    return;
  }
  
  isShuttingDown = true;
  console.log(`\n\n📋 收到 ${signal} 信号，正在优雅退出...`);
  
  // 设置模拟器状态为中断
  if (globalSimulator) {
    globalSimulator.setStatus('completed');
  }
  
  try {
    await generateAndSaveReport('interrupted', `用户通过 ${signal} 信号中断了模拟`);
  } catch (error) {
    console.error('生成报告时出错:', error);
  }
  
  console.log('👋 程序已退出');
  process.exit(0);
}

// 注册信号处理器
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
Silicon Rider Bench - AI 外卖骑手基准测试

用法:
  npm run level0.1              运行 Level 0.1（教程场景）
  npm run level1                运行 Level 1（完整基准测试）
  npm run level2                运行 Level 2（V2 多模态测试）
  npm run level3                运行 Level 3（V3 多骑手测试）
  npm run dev -- [options]      使用自定义选项运行

选项:
  --level, -l <level>           指定 Level（0.1, 1, 2, 或 3）
  --seed, -s <seed>             指定地图种子（覆盖默认值）
  --model, -m <model>           指定 AI 模型名称
  --base-url <url>              指定 API 基础 URL（用于本地 llama.cpp 等）
  --mode <mode>                 可视化模式（terminal 或 web，默认: terminal）
  --host <host>                 Web 服务器主机地址（默认: localhost）
  --port <port>                 Web 服务器端口号（默认: 3000）
  --no-viz                      禁用实时可视化
  --output, -o <file>           指定报告输出文件
  --help, -h                    显示此帮助信息

Level 说明:
  Level 0.1                     教程场景：简单地图，单个订单
  Level 1                       完整基准测试：24小时，持续订单生成
  Level 2 (V2)                  多模态测试：使用真实小票图片，需识别手机号取餐
  Level 3 (V3)                  多骑手测试：一个AI同时操作多个骑手，共享订单池

示例:
  npm run dev -- --level 1 --seed 12345
  npm run dev -- --level 0.1 --no-viz --output report.md
  npm run dev -- --level 2 --mode web --port 8080
  npm run dev -- --level 3 --mode web --port 8080
  npm run dev -- --base-url http://localhost:8080/v1 --level 0.1

环境变量:
  API_KEY                       API 密钥（本地 API 不需要，支持 OpenRouter、OpenAI 等）
  MODEL_NAME                    AI 模型名称（可选）
  BASE_URL                      API 基础 URL（可选，本地 llama.cpp 使用如 http://localhost:8080/v1）
  MAX_ITERATIONS                最大迭代次数（0 表示无限，默认 300）
  BENCHMARK_TIME_LIMIT          基准测试时间限制，单位：小时（默认 24）
  IMAGE_TRANSPORT_MODE          图片传输模式（base64 或 file_path，V2/V3 多模态使用）
  SIMULATION_RIDER_NUM          骑手数量（Level 3 使用，默认 3，最大 10）
  `.trim());
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 解析命令行参数
  const args = parseArgs();

  // 显示帮助
  if (args.help) {
    showHelp();
    return;
  }

  console.log(formatHeader('Silicon Rider Bench - AI 外卖骑手基准测试'));

  // 显示 Level 配置信息
  console.log(printLevelConfig(args.level));
  console.log('');

  try {
    // 获取 Level 配置
    let config = getLevelConfig(args.level);

    // 如果指定了自定义种子，覆盖配置
    if (args.seed !== undefined) {
      config = { ...config, seed: args.seed };
      console.log(`使用自定义种子: ${args.seed}\n`);
    }

    // 初始化模拟器
    console.log('正在初始化模拟器...');
    const simulator = new Simulator(config);
    console.log('✓ 模拟器初始化完成\n');

    // 初始化 Web 服务器（如果是 Web 模式）
    let webServer: WebServer | null = null;
    let webVisualization: WebVisualization | null = null;
    if (args.mode === 'web') {
      const staticDir = path.join(__dirname, 'web', 'public');
      webServer = new WebServer({
        host: args.host,
        port: args.port,
        staticDir,
      });

      try {
        await webServer.start();
        const url = `http://${args.host}:${args.port}`;
        console.log('✓ Web 服务器已启动');
        console.log(`  访问 URL: ${url}\n`);
        
        // Set tool registry for /api/tools endpoint
        webServer.setToolRegistry(simulator.getToolRegistry());

        // 初始化 AI 客户端（需要先初始化以获取模型名称）
        console.log('正在初始化 AI 客户端...');
        const clientConfig: any = {};
        if (args.modelName) clientConfig.modelName = args.modelName;
        if (args.baseURL) clientConfig.baseURL = args.baseURL;
        const aiClient = createAIClient(simulator, Object.keys(clientConfig).length > 0 ? clientConfig : undefined);
        const modelName = aiClient.getConfig().modelName;
        console.log('✓ AI 客户端初始化完成');
        console.log(`  模型: ${modelName}\n`);

        // 创建 Web 可视化适配器（传递模型名称）
        webVisualization = new WebVisualization(simulator, webServer, modelName);
        
        // 当新客户端连接时，发送初始化数据
        webServer.onConnection(() => {
          console.log('✓ 新客户端连接，发送初始化数据');
          webVisualization!.sendInitialData();
        });
        
        console.log('✓ Web 可视化模块已启用\n');
      } catch (error) {
        if (error instanceof Error) {
          if ('code' in error) {
            const nodeError = error as NodeJS.ErrnoException;
            switch (nodeError.code) {
              case 'EADDRINUSE':
                console.error(`❌ 错误: 端口 ${args.port} 已被占用`);
                console.error(`   请尝试使用其他端口: --port <端口号>`);
                console.error(`   例如: --port ${args.port + 1}\n`);
                break;
              case 'EACCES':
                console.error(`❌ 错误: 没有权限绑定到端口 ${args.port}`);
                console.error(`   端口 1-1023 需要管理员/root 权限`);
                console.error(`   请尝试使用更高的端口号 (>1024)\n`);
                break;
              case 'EADDRNOTAVAIL':
                console.error(`❌ 错误: 无法绑定到地址 ${args.host}`);
                console.error(`   请检查主机地址是否正确\n`);
                break;
              default:
                console.error('❌ Web 服务器启动失败:', error.message);
                console.error(`   错误代码: ${nodeError.code}\n`);
            }
          } else {
            console.error('❌ Web 服务器启动失败:', error.message);
          }
        } else {
          console.error('❌ Web 服务器启动失败:', error);
        }
        process.exit(1);
      }
    }

    // 初始化终端可视化（如果是终端模式且启用）
    let display: TerminalDisplay | null = null;
    if (args.mode === 'terminal' && !args.noVisualization) {
      display = new TerminalDisplay(simulator, {
        updateInterval: 500, // 每 500ms 更新一次
      });
      console.log('✓ 终端可视化模块已启用\n');
    }

    // 如果不是 Web 模式，初始化 AI 客户端
    let aiClient;
    if (args.mode !== 'web') {
      console.log('正在初始化 AI 客户端...');
      const clientConfig = args.modelName ? { modelName: args.modelName } : undefined;
      aiClient = createAIClient(simulator, clientConfig, webVisualization || undefined);
      console.log('✓ AI 客户端初始化完成');
      console.log(`  模型: ${aiClient.getConfig().modelName}\n`);
    } else {
      // Web 模式下，AI 客户端已经在上面初始化了
      // 现在需要传递 webVisualization
      const clientConfig = args.modelName ? { modelName: args.modelName } : undefined;
      aiClient = createAIClient(simulator, clientConfig, webVisualization || undefined);
    }

    // 生成系统提示词并初始化对话
    const systemPrompt = generateSystemPrompt(simulator);
    aiClient.initializeConversation(systemPrompt);

    // 设置 Web 可视化的最大迭代次数
    // 使用 ?? 确保 0 值被正确处理（0 表示无限循环）
    if (webVisualization) {
      webVisualization.setMaxIterations(aiClient.getConfig().maxIterations ?? 300);
    }

    // 记录开始时间
    const startTime = new Date();
    console.log(`开始时间: ${startTime.toLocaleString()}\n`);
    console.log('开始模拟...\n');

    // 设置全局变量，用于优雅退出时生成报告
    globalSimulator = simulator;
    globalAIClient = aiClient;
    globalConfig = config;
    globalArgs = args;
    globalStartTime = startTime;
    globalWebVisualization = webVisualization;
    globalWebServer = webServer;

    // 设置模拟器状态
    simulator.setStatus('running');

    // 运行对话循环
    let lastDisplayUpdate = Date.now();
    const displayInterval = 1000; // 每秒更新一次显示

    await aiClient.runConversationLoop((iteration, message) => {
      // 更新 Web 可视化的当前迭代次数
      if (webVisualization) {
        webVisualization.updateIteration(iteration);
      }

      // 更新可视化
      const now = Date.now();
      
      // 终端模式：更新终端显示
      if (display && now - lastDisplayUpdate >= displayInterval) {
        display.display();
        
        // 在地图渲染后，打印新的对话日志
        aiClient.printNewConversationLogs();
        
        lastDisplayUpdate = now;
      }

      // Web 模式：发送状态更新到客户端
      if (webVisualization && now - lastDisplayUpdate >= displayInterval) {
        webVisualization.sendStateUpdate();
        lastDisplayUpdate = now;
      }

      // Web 模式：在终端输出关键事件
      if (args.mode === 'web') {
        // 打印对话日志（包含工具调用和结果）
        aiClient.printNewConversationLogs();
      }

      // 打印格式化的状态信息（如果禁用了可视化）
      if (!display && args.mode === 'terminal') {
        console.log(formatStatusDisplay(simulator, iteration, message));
        
        // 也打印对话日志
        aiClient.printNewConversationLogs();
      }
    });

    // 模拟完成
    simulator.setStatus('completed');
    const endTime = new Date();

    // 最后一次更新显示
    if (display) {
      display.display();
    }

    console.log('\n模拟完成！\n');
    console.log(`结束时间: ${endTime.toLocaleString()}`);
    console.log(`实际耗时: ${((endTime.getTime() - startTime.getTime()) / 1000).toFixed(1)} 秒\n`);

    // 使用统一的报告生成函数
    await generateAndSaveReport('completed');

  } catch (error) {
    console.error('\n❌ 错误:', error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// 运行主函数
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
