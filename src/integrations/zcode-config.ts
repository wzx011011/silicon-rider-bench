/**
 * ZCode 配置集成模块
 *
 * 读取 ZCode 客户端的 provider/model 配置（~/.zcode/v2/config.json），
 * 将其映射为本基准可用的 OpenAI 兼容接入点（baseURL + 模型名 + API Key）。
 *
 * 密钥安全约定：
 * - API Key 只在运行时读入内存，通过环境变量传给子进程；
 * - 任何列表/日志输出只显示"是否已配置"，绝不输出密钥本体。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * ZCode 中一个可测试的模型条目
 */
export interface ZcodeModelEntry {
  /** provider 标识，如 builtin:bigmodel-coding-plan */
  providerId: string;
  /** provider 显示名，如 BigModel - Coding Plan */
  providerName: string;
  /** ZCode 配置里的模型名（如 GLM-5.3-Flash） */
  modelId: string;
  /** 实际请求 API 时使用的模型名（按端点规范化，如 glm-5.3-flash） */
  apiModelName: string;
  /** provider 协议类型（openai / anthropic / ...） */
  kind: string;
  /** OpenAI 兼容 baseURL；null 表示无法映射，不能测试 */
  endpoint: string | null;
  /** 无法映射时的原因说明 */
  endpointNote?: string;
  /** 是否配置了 API Key */
  hasApiKey: boolean;
  /** 模型输入是否包含图像（Level 2/3 多模态需要） */
  multimodal: boolean;
}

/**
 * anthropic 端点 → OpenAI 兼容端点映射表
 *
 * 智谱系 provider 在 ZCode 中以 anthropic 协议接入（/api/anthropic），
 * 但同一 API Key 可用于其 OpenAI 兼容端点。映射规则：
 * - open.bigmodel.cn（国内，含 coding/start 套餐）：/api/coding/paas/v4（已实测可用）
 * - api.z.ai（国际）：/api/paas/v4
 */
const ANTHROPIC_ENDPOINT_MAP: Array<{ match: RegExp; endpoint: string }> = [
  { match: /^https?:\/\/open\.bigmodel\.cn\/api\/anthropic\/?$/, endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4' },
  { match: /^https?:\/\/api\.z\.ai\/api\/anthropic\/?$/, endpoint: 'https://api.z.ai/api/paas/v4' },
];

/** 模型名需要小写规范化的主机（GLM 系列 API 模型名均为小写） */
const LOWERCASE_MODEL_HOSTS = ['open.bigmodel.cn', 'api.z.ai'];

/**
 * 解析 ZCode 配置的原始结构（纯函数，便于单元测试）
 *
 * @param config ZCode config.json 解析后的对象
 * @param getApiKey 读取密钥的回调（测试时可注入桩，避免接触真实密钥）
 */
export function parseZcodeConfig(
  config: any,
  getApiKey: (providerId: string) => string | undefined
): { entries: ZcodeModelEntry[]; warnings: string[] } {
  const entries: ZcodeModelEntry[] = [];
  const warnings: string[] = [];
  const providers = config?.provider ?? {};

  for (const [providerId, provider] of Object.entries<any>(providers)) {
    if (provider?.enabled === false) {
      continue;
    }

    const kind = provider?.kind ?? 'openai';
    const baseURL: string | undefined = provider?.options?.baseURL;
    const apiKey = getApiKey(providerId);

    let endpoint: string | null = null;
    let endpointNote: string | undefined;

    if (kind === 'openai') {
      if (baseURL) {
        endpoint = baseURL;
      } else {
        endpointNote = 'openai 协议 provider 缺少 baseURL';
      }
    } else if (kind === 'anthropic') {
      const mapped = ANTHROPIC_ENDPOINT_MAP.find(m => baseURL && m.match.test(baseURL));
      if (mapped) {
        endpoint = mapped.endpoint;
      } else {
        endpointNote = `未知 anthropic 端点，无 OpenAI 兼容映射：${baseURL ?? '(未配置)'}`;
      }
    } else {
      endpointNote = `不支持的 provider 协议类型：${kind}`;
    }

    const host = endpoint ? new URL(endpoint).host : '';
    const lowercaseModel = LOWERCASE_MODEL_HOSTS.includes(host);

    const models = provider?.models ?? {};
    for (const [modelId, modelConfig] of Object.entries<any>(models)) {
      entries.push({
        providerId,
        providerName: provider?.name ?? providerId,
        modelId,
        apiModelName: lowercaseModel ? modelId.toLowerCase() : modelId,
        kind,
        endpoint,
        endpointNote,
        hasApiKey: typeof apiKey === 'string' && apiKey.length > 0,
        multimodal: (modelConfig?.modalities?.input ?? []).includes('image'),
      });
    }

    if (endpoint && Object.keys(models).length > 0 && !apiKey) {
      warnings.push(`${providerId}：未配置 API Key，将被跳过`);
    }
  }

  return { entries, warnings };
}

/**
 * 定位 ZCode 配置文件路径
 *
 * 优先级：显式参数 > ZCODE_CONFIG 环境变量 > 默认 ~/.zcode/v2/config.json
 */
export function resolveZcodeConfigPath(explicit?: string): string {
  if (explicit) {
    return path.resolve(explicit);
  }
  if (process.env.ZCODE_CONFIG) {
    return path.resolve(process.env.ZCODE_CONFIG);
  }
  return path.join(os.homedir(), '.zcode', 'v2', 'config.json');
}

/**
 * 读取 ZCode 配置并返回全部可测试的模型条目
 *
 * @param configPath 可选的配置文件路径
 */
export function loadZcodeModels(configPath?: string): { entries: ZcodeModelEntry[]; warnings: string[] } {
  const resolved = resolveZcodeConfigPath(configPath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const config = JSON.parse(raw);
  return parseZcodeConfig(config, providerId => config?.provider?.[providerId]?.options?.apiKey);
}

/**
 * 生成条目的稳定标识（用于报告文件名等），如
 * builtin:bigmodel-coding-plan/GLM-5.3-Flash → builtin-bigmodel-coding-plan_GLM-5.3-Flash
 */
export function entrySlug(entry: ZcodeModelEntry): string {
  return `${entry.providerId}_${entry.modelId}`.replace(/[:\\/]+/g, '-');
}
