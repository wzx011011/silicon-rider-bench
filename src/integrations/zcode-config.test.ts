/**
 * ZCode 配置解析单元测试
 */

import { describe, it, expect } from 'vitest';
import { parseZcodeConfig, entrySlug } from './zcode-config';

function buildConfig(providers: Record<string, any>): any {
  return { provider: providers };
}

describe('parseZcodeConfig', () => {
  it('openai 协议直接透传 baseURL', () => {
    const config = buildConfig({
      'custom:openai': {
        name: 'OpenAI',
        kind: 'openai',
        enabled: true,
        options: { apiKey: 'sk-test', baseURL: 'https://api.openai.com/v1' },
        models: { 'gpt-4o': {} },
      },
    });

    const { entries, warnings } = parseZcodeConfig(config, id => config.provider[id].options.apiKey);

    expect(entries).toHaveLength(1);
    expect(entries[0].endpoint).toBe('https://api.openai.com/v1');
    expect(entries[0].apiModelName).toBe('gpt-4o'); // 非智谱主机不做小写规范化
    expect(entries[0].hasApiKey).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('bigmodel anthropic 端点映射为 coding/paas/v4 且模型名小写', () => {
    const config = buildConfig({
      'builtin:bigmodel-coding-plan': {
        name: 'BigModel - Coding Plan',
        kind: 'anthropic',
        enabled: true,
        options: { apiKey: 'k-123', baseURL: 'https://open.bigmodel.cn/api/anthropic' },
        models: {
          'GLM-5.3-Flash': { modalities: { input: ['text', 'image'] } },
          'GLM-5.3': { modalities: { input: ['text'] } },
        },
      },
    });

    const { entries } = parseZcodeConfig(config, id => config.provider[id].options.apiKey);

    expect(entries).toHaveLength(2);
    expect(entries[0].endpoint).toBe('https://open.bigmodel.cn/api/coding/paas/v4');
    expect(entries[0].apiModelName).toBe('glm-5.3-flash');
    expect(entries[0].modelId).toBe('GLM-5.3-Flash');
    expect(entries[0].multimodal).toBe(true);
    expect(entries[1].multimodal).toBe(false);
  });

  it('z.ai anthropic 端点映射为 paas/v4', () => {
    const config = buildConfig({
      'builtin:zai': {
        kind: 'anthropic',
        enabled: true,
        options: { apiKey: 'k', baseURL: 'https://api.z.ai/api/anthropic' },
        models: { 'GLM-4.6': {} },
      },
    });

    const { entries } = parseZcodeConfig(config, id => config.provider[id].options.apiKey);
    expect(entries[0].endpoint).toBe('https://api.z.ai/api/paas/v4');
  });

  it('未知 anthropic 端点标记不可测试并给出原因', () => {
    const config = buildConfig({
      'custom:other': {
        kind: 'anthropic',
        enabled: true,
        options: { apiKey: 'k', baseURL: 'https://example.com/anthropic' },
        models: { 'm1': {} },
      },
    });

    const { entries } = parseZcodeConfig(config, id => config.provider[id].options.apiKey);

    expect(entries).toHaveLength(1);
    expect(entries[0].endpoint).toBeNull();
    expect(entries[0].endpointNote).toContain('未知 anthropic 端点');
  });

  it('enabled=false 的 provider 被跳过', () => {
    const config = buildConfig({
      'builtin:off': {
        kind: 'openai',
        enabled: false,
        options: { apiKey: 'k', baseURL: 'https://x.example/v1' },
        models: { m1: {} },
      },
    });

    const { entries } = parseZcodeConfig(config, () => 'k');
    expect(entries).toHaveLength(0);
  });

  it('缺少 API Key 的 provider 产生警告且 hasApiKey=false', () => {
    const config = buildConfig({
      'builtin:nokey': {
        kind: 'openai',
        enabled: true,
        options: { baseURL: 'https://x.example/v1' },
        models: { m1: {} },
      },
    });

    const { entries, warnings } = parseZcodeConfig(config, () => undefined);

    expect(entries[0].hasApiKey).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('builtin:nokey');
  });

  it('不支持的协议类型给出说明', () => {
    const config = buildConfig({
      'custom:weird': {
        kind: 'google',
        enabled: true,
        options: { apiKey: 'k', baseURL: 'https://x.example' },
        models: { m1: {} },
      },
    });

    const { entries } = parseZcodeConfig(config, () => 'k');
    expect(entries[0].endpoint).toBeNull();
    expect(entries[0].endpointNote).toContain('google');
  });

  it('entrySlug 生成文件名安全的标识', () => {
    const entry = parseZcodeConfig(
      buildConfig({
        'builtin:bigmodel-coding-plan': {
          kind: 'openai',
          enabled: true,
          options: { apiKey: 'k', baseURL: 'https://open.bigmodel.cn/v1' },
          models: { 'GLM-5.3-Flash': {} },
        },
      }),
      () => 'k'
    ).entries[0];

    expect(entrySlug(entry)).toBe('builtin-bigmodel-coding-plan_GLM-5.3-Flash');
  });
});
