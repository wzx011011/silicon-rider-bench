/**
 * ZCode 模型批量基准测试入口
 *
 * 从 ZCode 客户端配置（~/.zcode/v2/config.json）枚举已接入的全部模型，
 * 逐个运行基准并聚合对比。API Key 只通过环境变量注入子进程，不落盘、不打日志。
 *
 * 用法：
 *   npx tsx src/cli/zcode-bench.ts --list
 *   npx tsx src/cli/zcode-bench.ts --model builtin:bigmodel-coding-plan/GLM-5.3-Flash [--level 0.1]
 *   npx tsx src/cli/zcode-bench.ts --all [--level 0.1] [--exclude id1,id2] [--seed 67890]
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  loadZcodeModels,
  resolveZcodeConfigPath,
  entrySlug,
  ZcodeModelEntry,
} from '../integrations/zcode-config';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');

interface BenchArgs {
  list: boolean;
  all: boolean;
  model?: string;
  level: string;
  exclude: string[];
  seed?: number;
  zcodeConfig?: string;
  mode: 'terminal' | 'web';
  maxIterations?: number;
  perModelTimeoutMin: number;
}

function printUsage(): void {
  console.log(`用法:
  --list                                 列出 ZCode 接入的全部模型（密钥脱敏）
  --model <providerId>/<modelId>         测试单个模型
  --all                                  测试全部可测试模型
  --level <name>                         基准级别（默认 0.1 冒烟；正式数据用 1）
  --exclude <id,id2>                     --all 时排除的 providerId 或 provider/model
  --seed <n>                             固定地图种子（对比公平性建议指定）
  --zcode-config <path>                  ZCode 配置文件路径（默认 ~/.zcode/v2/config.json）
  --mode <terminal|web>                  单模型运行模式（默认 terminal；web 打开可视化）
  --max-iterations <n>                   传递给基准的最大迭代次数
  --per-model-timeout <min>              单模型超时分钟数（默认 30，0 为不限制）`);
}

function parseBenchArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = {
    list: false,
    all: false,
    level: '0.1',
    exclude: [],
    mode: 'terminal',
    perModelTimeoutMin: 30,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--list': args.list = true; break;
      case '--all': args.all = true; break;
      case '--model': args.model = argv[++i]; break;
      case '--level': args.level = argv[++i]; break;
      case '--exclude': args.exclude = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean); break;
      case '--seed': args.seed = parseInt(argv[++i], 10); break;
      case '--zcode-config': args.zcodeConfig = argv[++i]; break;
      case '--mode':
        args.mode = argv[++i] === 'web' ? 'web' : 'terminal';
        break;
      case '--max-iterations': args.maxIterations = parseInt(argv[++i], 10); break;
      case '--per-model-timeout': args.perModelTimeoutMin = parseInt(argv[++i], 10) || 0; break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`未知参数: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
}

interface RunResult {
  entry: ZcodeModelEntry;
  ok: boolean;
  failureReason?: string;
  durationSec: number;
  metrics?: any;
}

/** 列出全部模型（脱敏） */
function listModels(entries: ZcodeModelEntry[], warnings: string[]): void {
  console.log(`ZCode 配置文件: ${resolveZcodeConfigPath()}\n`);
  console.log('已接入模型：\n');
  console.log('  providerId                             模型                  协议        端点                                              Key   多模态  可测试');
  console.log('  ' + '-'.repeat(150));

  for (const e of entries) {
    const testable = !!e.endpoint && e.hasApiKey;
    const reason = !e.endpoint ? (e.endpointNote ?? '端点无法映射')
      : !e.hasApiKey ? '缺少 API Key'
      : '✓';
    console.log(
      `  ${e.providerId.padEnd(39)} ${e.modelId.padEnd(21)} ${e.kind.padEnd(11)} ${(e.endpoint ?? '(无映射)').padEnd(49)} ${e.hasApiKey ? '有' : '无'}    ${e.multimodal ? '是' : '否'}     ${reason}`
    );
  }

  console.log(`\n共 ${entries.length} 个模型，可测试 ${entries.filter(e => e.endpoint && e.hasApiKey).length} 个。`);
  for (const w of warnings) {
    console.warn(`⚠ ${w}`);
  }
}

/** 读取密钥（不打印） */
function readApiKey(providerId: string, configPath?: string): string | undefined {
  const config = JSON.parse(fs.readFileSync(resolveZcodeConfigPath(configPath), 'utf-8'));
  const key = config?.provider?.[providerId]?.options?.apiKey;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

/** 运行单个模型的基准子进程 */
async function runSingle(
  entry: ZcodeModelEntry,
  apiKey: string,
  args: BenchArgs,
  modelOverride?: string
): Promise<RunResult> {
  const slug = entrySlug(entry);
  const levelTag = args.level.replace('.', '-');
  const outputFile = `report-zcode-${slug}-l${levelTag}.md`;
  const logDir = path.join(REPO_ROOT, 'bench-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${slug}-l${levelTag}.log`);

  const cliArgs = [
    'tsx', 'src/index.ts',
    '--level', args.level,
    '--model', modelOverride ?? entry.apiModelName,
    '--output', outputFile,
  ];
  if (args.seed !== undefined) cliArgs.push('--seed', String(args.seed));
  if (args.mode === 'terminal') cliArgs.push('--no-viz');

  const childEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    API_KEY: apiKey,
    BASE_URL: entry.endpoint!,
    MODEL_NAME: modelOverride ?? entry.apiModelName,
  };
  if (args.maxIterations !== undefined) {
    childEnv.MAX_ITERATIONS = String(args.maxIterations);
  }

  const start = Date.now();
  console.log(`  ▶ 输出: ${outputFile}`);
  console.log(`  ▶ 日志: ${logFile}`);

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn('npx', cliArgs, {
      cwd: REPO_ROOT,
      env: childEnv,
      shell: true,
      // web 模式直接透传输出，让服务地址可见；批量模式写日志文件
      stdio: args.mode === 'web' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    const logStream = fs.createWriteStream(logFile, { flags: 'w' });
    if (child.stdout) child.stdout.pipe(logStream);
    if (child.stderr) child.stderr.pipe(logStream);

    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    if (args.perModelTimeoutMin > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        console.warn(`  ⚠ 超过 ${args.perModelTimeoutMin} 分钟，终止该模型`);
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, args.perModelTimeoutMin * 60 * 1000);
    }

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      logStream.end();
      resolve(timedOut ? -2 : (code ?? -1));
    });
  });

  const durationSec = Math.round((Date.now() - start) / 1000);

  if (exitCode !== 0) {
    let reason = `退出码 ${exitCode}`;
    try {
      const log = fs.readFileSync(logFile, 'utf-8');
      // 提取最后的错误行作为失败原因
      const errMatches = log.match(/[❌]|Error in conversation|BadRequestError[^\n]*/g);
      if (errMatches && errMatches.length > 0) {
        reason = errMatches[errMatches.length - 1].slice(0, 120);
      }
      // 模型名大小写不匹配（1211）：小写重试一次
      if (log.includes('1211') || log.includes('模型不存在')) {
        const lower = (modelOverride ?? entry.apiModelName).toLowerCase();
        if (lower !== (modelOverride ?? entry.apiModelName)) {
          console.log('  ↻ 模型名不存在，使用小写名称重试');
          return await runSingle(entry, apiKey, args, lower);
        }
      }
    } catch { /* 日志读取失败不影响结果 */ }
    return { entry, ok: false, failureReason: reason, durationSec };
  }

  // 读取指标 JSON
  const metricsPath = path.join(REPO_ROOT, outputFile.replace(/\.md$/, '.json'));
  let metrics: any;
  try {
    metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
  } catch {
    return { entry, ok: false, failureReason: '未找到指标 JSON（基准可能未正常完成）', durationSec };
  }

  return { entry, ok: true, durationSec, metrics };
}

/** 生成对比报告 */
function writeComparison(results: RunResult[], args: BenchArgs, skipped: ZcodeModelEntry[]): string {
  const lines: string[] = [];
  lines.push('# ZCode 模型基准对比');
  lines.push('');
  lines.push(`- 生成时间: ${new Date().toLocaleString()}`);
  lines.push(`- Level: ${args.level}${args.seed !== undefined ? `（种子 ${args.seed}）` : ''}`);
  lines.push(`- ZCode 配置: ${resolveZcodeConfigPath(args.zcodeConfig)}`);
  lines.push('');

  lines.push('| 模型 | 状态 | 利润 | 完成单 | 准时率 | 路径效率 | 违规率 | 工具调用 | 总 Tokens | 耗时 |');
  lines.push('|------|------|------|--------|--------|----------|--------|----------|-----------|------|');

  for (const r of results) {
    const name = `${r.entry.providerId}/${r.entry.modelId}`;
    if (!r.ok) {
      lines.push(`| ${name} | ❌ ${r.failureReason ?? '失败'} | - | - | - | - | - | - | - | ${r.durationSec}s |`);
      continue;
    }
    const m = r.metrics?.metrics ?? {};
    const t = r.metrics?.tokenUsage ?? {};
    const fmt = (v: any) => (typeof v === 'number' ? `${Math.round(v * 100) / 100}` : '-');
    // 比率型指标（0~1）转为百分数显示
    const fmtRate = (v: any) => (typeof v === 'number' ? `${Math.round(v * 1000) / 10}%` : '-');
    lines.push(
      `| ${name} | ✅ | ¥${fmt(m.totalProfit)} | ${m.completedOrders ?? '-'} | ${fmtRate(m.onTimeRate)} | ${fmt(m.pathEfficiency)} | ${fmtRate(m.apiViolationRate)} | ${m.totalToolCalls ?? '-'} | ${t.total?.toLocaleString() ?? '-'} | ${r.durationSec}s |`
    );
  }

  if (skipped.length > 0) {
    lines.push('');
    lines.push('## 已跳过（不可测试）');
    lines.push('');
    for (const e of skipped) {
      lines.push(`- \`${e.providerId}/${e.modelId}\`：${!e.endpoint ? e.endpointNote : !e.hasApiKey ? '缺少 API Key' : ''}`);
    }
  }

  const outPath = path.join(REPO_ROOT, 'zcode-bench-comparison.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  return outPath;
}

async function main(): Promise<void> {
  const args = parseBenchArgs(process.argv.slice(2));

  if (!args.list && !args.all && !args.model) {
    printUsage();
    process.exit(1);
  }

  const { entries, warnings } = loadZcodeModels(args.zcodeConfig);

  if (args.list) {
    listModels(entries, warnings);
    return;
  }

  // 选择目标模型
  let targets: ZcodeModelEntry[];
  let skipped: ZcodeModelEntry[] = [];

  if (args.model) {
    const [providerId, modelId] = args.model.split('/');
    if (!providerId || !modelId) {
      console.error(`--model 格式应为 <providerId>/<modelId>，收到: ${args.model}`);
      process.exit(2);
    }
    const entry = entries.find(e => e.providerId === providerId && e.modelId === modelId);
    if (!entry) {
      console.error(`未找到模型: ${args.model}。运行 --list 查看全部模型。`);
      process.exit(2);
    }
    targets = [entry];
  } else {
    targets = entries.filter(e => args.exclude.indexOf(e.providerId) === -1 && args.exclude.indexOf(`${e.providerId}/${e.modelId}`) === -1);
    skipped = targets.filter(e => !e.endpoint || !e.hasApiKey);
    targets = targets.filter(e => e.endpoint && e.hasApiKey);
  }

  if (targets.length === 0) {
    console.error('没有可测试的模型。');
    process.exit(2);
  }

  if (args.mode === 'web' && targets.length > 1) {
    console.warn('⚠ web 模式仅支持单模型，批量运行使用 terminal 模式。');
    args.mode = 'terminal';
  }

  console.log(`\n将测试 ${targets.length} 个模型（Level ${args.level}${args.mode === 'web' ? '，web 可视化' : ''}）\n`);

  const results: RunResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    const entry = targets[i];
    console.log(`\n[${i + 1}/${targets.length}] ${entry.providerId}/${entry.modelId}`);
    console.log(`  ▶ 端点: ${entry.endpoint}`);

    const apiKey = readApiKey(entry.providerId, args.zcodeConfig);
    if (!apiKey) {
      console.error('  ✗ 缺少 API Key，跳过');
      results.push({ entry, ok: false, failureReason: '缺少 API Key', durationSec: 0 });
      continue;
    }

    const result = await runSingle(entry, apiKey, args);
    results.push(result);
    console.log(result.ok ? `  ✓ 完成（${result.durationSec}s）` : `  ✗ 失败: ${result.failureReason}`);
  }

  const outPath = writeComparison(results, args, skipped);
  const okCount = results.filter(r => r.ok).length;
  console.log(`\n完成：${okCount}/${results.length} 个模型成功。`);
  console.log(`对比报告: ${outPath}`);

  process.exit(okCount === results.length ? 0 : 1);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(2);
});
