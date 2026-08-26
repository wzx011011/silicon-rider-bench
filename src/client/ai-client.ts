/**
 * AI 客户端模块
 * Silicon Rider Bench - Agent 基准测试系统
 * 
 * 需求：16.1-16.4
 * 
 * 职责：
 * - 加载 .env 配置
 * - 初始化 OpenAI SDK（配置 OpenRouter）
 * - 实现工具定义生成
 * - 实现对话循环
 * - 实现工具调用解析和执行
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';
import { Simulator } from '../core/simulator';
import { ToolCallRequest, ImageTransportMode } from '../types';
import { createToolRegistry, createToolRegistryV3 } from '../tools';
import { generateSystemPrompt } from './system-prompt';
import type { WebVisualization } from '../web/web-visualization.js';

// 加载环境变量
dotenv.config();

/**
 * Get image transport mode from environment
 */
function getImageTransportMode(): ImageTransportMode {
  const mode = process.env.IMAGE_TRANSPORT_MODE?.toLowerCase();
  if (mode === 'file_path') {
    return 'file_path';
  }
  return 'base64'; // default
}

// Note: We always use OpenAI standard format for multimodal messages
// because we use the OpenAI SDK which calls /chat/completions endpoint.
// Even Volcengine/Doubao's /chat/completions endpoint uses OpenAI format.
// The input_text/input_image format is only for Volcengine's /responses endpoint.

/**
 * 空内容占位符
 * 用于兼容 llama.cpp 等服务器的聊天模板，它们可能无法处理空字符串或 null content
 * 如果空格不起作用，可以尝试其他值如 " " 或 "[empty]" 等
 */
const EMPTY_CONTENT_PLACEHOLDER = ' ';

/**
 * AI 客户端配置
 */
export interface AIClientConfig {
  apiKey: string;
  modelName: string;
  baseURL: string;
  siteURL?: string;
  appName?: string;
  maxIterations?: number;
  temperature?: number;
  topP?: number;                // Top-P (nucleus sampling)
  repetitionPenalty?: number;   // Repetition penalty (frequency_penalty in OpenAI API)
  contextHistoryLimit?: number; // 限制传递给服务器的历史消息数量（不包含 system 消息），不设置或 0 表示不限制
  imageTransportMode?: ImageTransportMode; // 图片传输模式（V2 多模态使用）
}

/**
 * 多模态消息内容项 (OpenAI 标准格式)
 */
export interface MultimodalContentItem {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/**
 * 对话消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MultimodalContentItem[];
  tool_call_id?: string;
  name?: string;
}

/**
 * 对话日志条目
 */
export interface ConversationLogEntry {
  iteration: number;
  type: 'assistant' | 'tool';
  content: string;
  timestamp: number;
}

/**
 * AI 客户端类
 * 
 * 负责与 OpenAI SDK 交互，管理对话循环，处理工具调用
 */
export class AIClient {
  private client: OpenAI;
  private config: AIClientConfig;
  private simulator: Simulator;
  private conversationHistory: ChatMessage[];
  private toolDefinitions: any[];
  private conversationLogs: ConversationLogEntry[];
  private lastReadLogIndex: number;
  private webVisualization?: WebVisualization;
  private totalTokens = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private cumulativeTotalTokens = 0;
  private cumulativePromptTokens = 0;
  private cumulativeCompletionTokens = 0;

  /**
   * 创建 AI 客户端实例
   * 
   * @param simulator 模拟器实例
   * @param config 客户端配置（可选，默认从环境变量加载）
   * @param webVisualization Web 可视化适配器（可选，用于 Web 模式）
   */
  constructor(simulator: Simulator, config?: Partial<AIClientConfig>, webVisualization?: WebVisualization) {
    this.simulator = simulator;
    this.webVisualization = webVisualization;
    
    // 加载配置
    this.config = this.loadConfig(config);
    
    // 初始化 OpenAI SDK
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      defaultHeaders: {
        'HTTP-Referer': this.config.siteURL || '',
        'X-Title': this.config.appName || 'Silicon Rider Bench',
      },
    });
    
    // 初始化对话历史
    this.conversationHistory = [];
    
    // 初始化对话日志
    this.conversationLogs = [];
    this.lastReadLogIndex = 0;
    
    // 生成工具定义
    this.toolDefinitions = this.generateToolDefinitions();
  }

  /**
   * 加载配置
   * 需求：16.1
   * 
   * @param config 部分配置
   * @returns 完整配置
   */
  private loadConfig(config?: Partial<AIClientConfig>): AIClientConfig {
    // 获取 baseURL
    const baseURL = config?.baseURL || process.env.BASE_URL || 'https://openrouter.ai/api/v1';
    
    // 获取 API Key（现在是可选的）
    let apiKey = config?.apiKey || process.env.API_KEY;
    
    // 去除空白字符，将空字符串视为未设置
    if (apiKey) {
      apiKey = apiKey.trim();
    }
    
    // 如果没有提供 API Key，使用占位符
    // 让上游 API 自己决定是否需要验证
    if (!apiKey || apiKey === '') {
      apiKey = 'sk-no-key-required';
      console.log('⚠ API_KEY not set. If the upstream API requires authentication, it will return an error.');
    }

    // 解析最大迭代次数，支持从环境变量读取
    // 0 表示无限循环
    const maxIterationsFromEnv = process.env.MAX_ITERATIONS !== undefined && process.env.MAX_ITERATIONS !== ''
      ? parseInt(process.env.MAX_ITERATIONS, 10) 
      : undefined;

    // 解析上下文历史限制，支持从环境变量读取
    // 0 或不设置表示不限制
    const contextHistoryLimitFromEnv = process.env.CONTEXT_HISTORY_LIMIT 
      ? parseInt(process.env.CONTEXT_HISTORY_LIMIT, 10) 
      : undefined;

    // 解析采样参数，支持从环境变量读取
    const temperatureFromEnv = process.env.TEMPERATURE 
      ? parseFloat(process.env.TEMPERATURE) 
      : undefined;
    
    const topPFromEnv = process.env.TOP_P 
      ? parseFloat(process.env.TOP_P) 
      : undefined;
    
    const repetitionPenaltyFromEnv = process.env.REPETITION_PENALTY 
      ? parseFloat(process.env.REPETITION_PENALTY) 
      : undefined;

    return {
      apiKey,
      modelName: config?.modelName || process.env.MODEL_NAME || 'anthropic/claude-3.5-sonnet',
      baseURL,
      siteURL: config?.siteURL || process.env.SITE_URL,
      appName: config?.appName || process.env.APP_NAME || 'Silicon Rider Bench',
      maxIterations: config?.maxIterations ?? maxIterationsFromEnv ?? 300,
      temperature: config?.temperature ?? temperatureFromEnv ?? 1.0,
      topP: config?.topP ?? topPFromEnv ?? 0.95,
      repetitionPenalty: config?.repetitionPenalty ?? repetitionPenaltyFromEnv ?? 1.05,
      contextHistoryLimit: config?.contextHistoryLimit || contextHistoryLimitFromEnv,
      imageTransportMode: config?.imageTransportMode || getImageTransportMode(),
    };
  }

  /**
   * Get image transport mode
   */
  getImageTransportMode(): ImageTransportMode {
    return this.config.imageTransportMode || 'base64';
  }

  /**
   * 生成工具定义
   * 需求：16.1
   * 
   * @returns OpenAI 格式的工具定义数组
   */
  private generateToolDefinitions(): any[] {
    // Check if V3 mode (multi-rider mode with agent_id parameter)
    if (this.simulator.isLevel3Mode()) {
      const registry = createToolRegistryV3();
      return registry.toOpenAIFormat();
    }
    
    // Check if V2 mode (use multimodal tools)
    const v2Mode = this.simulator.isLevel2Mode();
    const registry = createToolRegistry(v2Mode);
    return registry.toOpenAIFormat();
  }

  /**
   * 初始化对话
   * 
   * @param systemPrompt 系统提示词
   */
  initializeConversation(systemPrompt: string): void {
    this.conversationHistory = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];
  }

  /**
   * 添加用户消息
   * 
   * @param message 用户消息内容
   */
  addUserMessage(message: string): void {
    this.conversationHistory.push({
      role: 'user',
      content: message,
    });
  }

  /**
   * 添加多模态消息（包含小票图片）- V2 模式使用
   * 
   * 使用 OpenAI 标准格式（text, image_url）。
   * 这是因为我们使用 OpenAI SDK 调用 /chat/completions 端点，
   * 即使是 Volcengine/Doubao 的兼容端点也使用这种格式。
   * 
   * @param receipts 小票数据数组
   */
  private addMultimodalReceiptMessage(receipts: Array<{ orderId: string; imagePath: string; imageData?: string }>): void {
    if (receipts.length === 0) return;

    const contentItems: MultimodalContentItem[] = [];

    // 添加说明文字
    const instructionText = `以下是${receipts.length}张外卖小票图片，请仔细查看每张小票，识别上面的手机号（格式如 172****3882），然后使用 pickup_food_by_phone_number 工具输入正确的手机号来取餐。`;
    
    // OpenAI standard format: type: text
    contentItems.push({
      type: 'text',
      text: instructionText,
    });

    // 添加每张图片
    for (const receipt of receipts) {
      if (receipt.imageData) {
        // OpenAI standard format: type: image_url, image_url: { url: string }
        contentItems.push({
          type: 'image_url',
          image_url: { url: receipt.imageData },
        });
        contentItems.push({
          type: 'text',
          text: `订单 ${receipt.orderId} 的小票`,
        });
      }
    }

    // 添加多模态消息到对话历史
    this.conversationHistory.push({
      role: 'user',
      content: contentItems,
    });

    console.log(`[AI Client] Added multimodal message with ${receipts.length} receipt image(s)`);
  }

  /**
   * 从对话历史中移除指定订单的小票图片 - 优化 V2/V3 模式的上下文大小
   * 
   * 当 pickup_food_by_phone_number 成功后调用，移除已经不需要的图片数据以节省 token
   * 这对于 Level 2 和 Level 3 测试特别重要，因为图片数据会占用大量上下文空间
   * 
   * @param orderId 已成功取餐的订单 ID
   */
  private removeReceiptImageFromHistory(orderId: string): void {
    // 遍历对话历史，查找并处理多模态消息
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      const msg = this.conversationHistory[i];
      
      // 只处理 user 角色的多模态消息（图片消息是以 user 身份添加的）
      if (msg.role !== 'user' || !Array.isArray(msg.content)) {
        continue;
      }

      const contentItems = msg.content as MultimodalContentItem[];
      
      // 查找是否包含目标订单的图片
      let foundOrderIndex = -1;
      for (let j = 0; j < contentItems.length; j++) {
        const item = contentItems[j];
        if (item.type === 'text' && item.text?.includes(`订单 ${orderId} 的小票`)) {
          foundOrderIndex = j;
          break;
        }
      }

      if (foundOrderIndex === -1) {
        continue;
      }

      // 找到了目标订单，移除对应的图片和文本
      // 图片在文本之前，所以需要移除 foundOrderIndex 和 foundOrderIndex - 1
      const itemsToRemove: number[] = [];
      
      // 添加文本标签
      itemsToRemove.push(foundOrderIndex);
      
      // 添加图片（在文本之前）
      if (foundOrderIndex > 0 && contentItems[foundOrderIndex - 1].type === 'image_url') {
        itemsToRemove.push(foundOrderIndex - 1);
      }

      // 从后往前删除，避免索引偏移问题
      itemsToRemove.sort((a, b) => b - a);
      for (const idx of itemsToRemove) {
        contentItems.splice(idx, 1);
      }

      console.log(`[AI Client] Removed receipt image for order ${orderId} from history (optimization)`);

      // 检查是否还有图片内容，如果只剩下说明文字，可以考虑移除整个消息
      const hasImages = contentItems.some(item => item.type === 'image_url');
      if (!hasImages) {
        // 没有图片了，移除整个多模态消息
        this.conversationHistory.splice(i, 1);
        console.log(`[AI Client] Removed empty multimodal message from history`);
      }

      // 找到并处理了目标订单，可以退出
      break;
    }
  }

  /**
   * 运行对话循环
   * 需求：16.2, 16.3, 16.4
   * 
   * 持续与 AI 模型交互，直到模拟终止或达到最大迭代次数
   * 
   * @param onIteration 每次迭代的回调函数
   * @returns 最终统计信息
   */
  async runConversationLoop(
    onIteration?: (iteration: number, message: string) => void
  ): Promise<void> {
    let iteration = 0;
    const maxIterations = this.config.maxIterations ?? 300;
    const isUnlimited = maxIterations === 0;
    const isDebugMode = process.env.DEBUG === 'true';

    // 部分服务（如智谱 BigModel）拒绝仅含 system 消息的请求，
    // 确保首轮至少有一条用户消息
    if (!this.conversationHistory.some(msg => msg.role !== 'system')) {
      this.addUserMessage(
        'Start the simulation. Call tools as needed to complete the delivery tasks.'
      );
    }

    while (!this.simulator.shouldTerminate() && (isUnlimited || iteration < maxIterations)) {
      iteration++;

      try {
        // 更新 system prompt 中的当前轮次信息
        if (this.conversationHistory.length > 0 && this.conversationHistory[0].role === 'system') {
          this.conversationHistory[0].content = generateSystemPrompt(this.simulator, iteration);
        }

        // 根据配置限制历史消息数量
        // 保留 system 消息（通常是第一条），只限制非 system 消息
        const historyLimit = this.config.contextHistoryLimit;
        
        if (historyLimit && historyLimit > 0) {
          // 分离 system 消息和非 system 消息
          const systemMessages = this.conversationHistory.filter(msg => msg.role === 'system');
          const nonSystemMessages = this.conversationHistory.filter(msg => msg.role !== 'system');
          
          // 只有当非 system 消息数量 > historyLimit 时才进行截取
          if (nonSystemMessages.length > historyLimit) {
            // 保留最近的 historyLimit 条非 system 消息
            const recentMessages = nonSystemMessages.slice(-historyLimit);
            // 合并 system 消息和最近的非 system 消息，并更新实际的历史记录
            this.conversationHistory = [...systemMessages, ...recentMessages];
            console.log(`[AI Client] History limit reached. Trimmed to ${historyLimit} non-system messages (removed ${nonSystemMessages.length - historyLimit} oldest messages)`);
          }
        }
        
        const messagesToSend = this.conversationHistory;

        // 清理消息，确保所有 content 都是字符串或有效的多模态数组
        // 这是为了兼容 llama.cpp 等服务器的聊天模板，它们可能无法处理 null 或空 content
        // 注意：使用 EMPTY_CONTENT_PLACEHOLDER 替换空内容
        // 重要：保留多模态数组（MultimodalContentItem[]），不要将其转换为字符串
        const sanitizedMessages = messagesToSend.map(msg => {
          // 处理 content：
          // - 如果是数组（多模态内容），直接保留
          // - 如果是 null/undefined/空字符串，替换为占位符
          // - 其他情况转换为字符串
          let content: string | MultimodalContentItem[] = msg.content;
          if (Array.isArray(content)) {
            // 保留多模态内容数组，不做转换
            // 多模态数组格式如：[{type: 'text', text: '...'}, {type: 'image_url', image_url: {...}}]
          } else if (content === null || content === undefined || content === '') {
            content = EMPTY_CONTENT_PLACEHOLDER;
          } else {
            content = String(content);
          }
          
          const sanitized: Record<string, any> = {
            role: msg.role,
            content,
          };
          // 复制其他可能存在的字段（如 tool_call_id, name, tool_calls, reasoning_content）
          if (msg.tool_call_id) sanitized.tool_call_id = msg.tool_call_id;
          if (msg.name) sanitized.name = msg.name;
          if ((msg as any).tool_calls) sanitized.tool_calls = (msg as any).tool_calls;
          if ((msg as any).reasoning_content) sanitized.reasoning_content = (msg as any).reasoning_content;
          return sanitized;
        });

        // 构建请求
        const requestBody: any = {
          model: this.config.modelName,
          messages: sanitizedMessages as any,
          tools: this.toolDefinitions,
          tool_choice: 'auto' as const,
          temperature: this.config.temperature,
          top_p: this.config.topP,
          frequency_penalty: this.config.repetitionPenalty ? this.config.repetitionPenalty - 1 : undefined,
          // Note: frequency_penalty in OpenAI API is different from repetition_penalty
          // OpenAI frequency_penalty range: -2.0 to 2.0 (0 means no penalty)
          // repetition_penalty range: typically 1.0+ (1.0 means no penalty)
          // We convert by: frequency_penalty = repetition_penalty - 1
        };

        // Debug: 输出请求详情
        if (isDebugMode) {
          console.log('\n=== AI Request ===');
          console.log('Model:', requestBody.model);
          console.log('Messages:', JSON.stringify(requestBody.messages, null, 2));
          console.log('Tools:', JSON.stringify(requestBody.tools, null, 2));
          console.log('==================\n');
        }

        // 调用 AI 模型（带重试机制）
        let response = null;
        let retryCount = 0;
        const maxRetries = 3;
        const retryDelay = 2000; // 2 seconds
        
        while (retryCount <= maxRetries) {
          try {
            response = await this.client.chat.completions.create(requestBody);
            break; // Success, exit retry loop
          } catch (apiError: any) {
            retryCount++;
            
            // Check if it's a network/JSON error that we should retry
            const isRetryableError = 
              apiError.type === 'invalid-json' ||
              apiError.message?.includes('Unexpected end of JSON') ||
              apiError.message?.includes('ECONNRESET') ||
              apiError.message?.includes('ETIMEDOUT') ||
              apiError.code === 'ECONNRESET' ||
              apiError.code === 'ETIMEDOUT';
            
            if (isRetryableError && retryCount <= maxRetries) {
              console.warn(`⚠️  API request failed (attempt ${retryCount}/${maxRetries}): ${apiError.message}`);
              console.log(`   Retrying in ${retryDelay / 1000} seconds...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
              // Non-retryable error or max retries reached
              throw apiError;
            }
          }
        }
        
        // If response is still null after retries, throw error
        if (!response) {
          throw new Error('Failed to get response from AI after multiple retries');
        }

        // 更新 token 使用量统计
        if (response.usage) {
          // 单次调用的 token 使用量
          this.totalTokens = response.usage.total_tokens || 0;
          this.promptTokens = response.usage.prompt_tokens || 0;
          this.completionTokens = response.usage.completion_tokens || 0;
          
          // 累计 token 使用量
          this.cumulativeTotalTokens += this.totalTokens;
          this.cumulativePromptTokens += this.promptTokens;
          this.cumulativeCompletionTokens += this.completionTokens;
          
          // 更新 Web 可视化的 token 信息
          if (this.webVisualization) {
            this.webVisualization.updateTokenUsage(
              this.totalTokens,
              this.promptTokens,
              this.completionTokens,
              this.cumulativeTotalTokens,
              this.cumulativePromptTokens,
              this.cumulativeCompletionTokens
            );
          }
        }

        // Debug: 输出响应详情
        if (isDebugMode) {
          console.log('\n=== AI Response ===');
          console.log('Response:', JSON.stringify(response, null, 2));
          console.log('===================\n');
        }

        const choice = response.choices[0];
        if (!choice) {
          throw new Error('No response from AI model');
        }

        const message = choice.message;

        // 检查是否有思考内容（reasoning models like o1）
        // OpenAI API 可能在不同字段返回思考内容
        const reasoningContent = (message as any).reasoning_content || 
                                (message as any).reasoning || 
                                (choice as any).reasoning_content;
        
        // 如果有思考内容，发送到 Web 客户端
        if (this.webVisualization && reasoningContent) {
          console.log('[AI Client] Reasoning content detected:', reasoningContent);
          this.webVisualization.sendReasoning(reasoningContent);
        }

        // 添加助手消息到历史（包含 tool_calls 和 reasoning_content 如果有的话）
        const assistantMessage: any = {
          role: 'assistant',
          content: message.content || '',
        };
        
        // 如果有思考内容，也要添加到历史中（Qwen3 等模型需要）
        if (reasoningContent) {
          assistantMessage.reasoning_content = reasoningContent;
        }
        
        // 如果有工具调用，也要添加到历史中
        if (message.tool_calls && message.tool_calls.length > 0) {
          assistantMessage.tool_calls = message.tool_calls;
        }
        
        this.conversationHistory.push(assistantMessage);

        // 发送对话消息到 Web 客户端（如果启用了 Web 可视化）
        if (this.webVisualization && message.content) {
          this.webVisualization.sendConversation('assistant', message.content);
        }

        // 检查是否有工具调用（支持 OpenAI 标准格式、SGLang XML 格式和 MCP XML 格式）
        let effectiveToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined = message.tool_calls;
        let sglangReasoning: string | undefined;
        
        // 如果没有标准格式的 tool_calls，尝试从 content 解析 XML 格式
        if ((!effectiveToolCalls || effectiveToolCalls.length === 0) && message.content) {
          // 首先尝试 MCP 格式 (<use_mcp_tool>)
          const mcpParsed = this.parseMCPToolCalls(message.content);
          
          if (mcpParsed.toolCalls.length > 0) {
            effectiveToolCalls = mcpParsed.toolCalls as any;
            
            // 更新历史记录中的 assistant message，添加 tool_calls
            const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              (lastMessage as any).tool_calls = effectiveToolCalls;
            }
            
            if (isDebugMode) {
              console.log('[AI Client] Parsed MCP tool calls:', JSON.stringify(effectiveToolCalls, null, 2));
            }
          } else {
            // 如果 MCP 格式没有解析出内容，尝试 SGLang 格式 (<tool_call>)
            const sglangParsed = this.parseSGLangToolCalls(message.content);
            
            // 如果解析出了 SGLang 格式的 tool calls
            if (sglangParsed.toolCalls.length > 0) {
              effectiveToolCalls = sglangParsed.toolCalls as any;
              sglangReasoning = sglangParsed.reasoning;
              
              // 如果有 SGLang reasoning content，发送到 Web 客户端
              if (this.webVisualization && sglangReasoning) {
                console.log('[AI Client] SGLang reasoning content detected:', sglangReasoning);
                this.webVisualization.sendReasoning(sglangReasoning);
              }
              
              // 更新历史记录中的 assistant message，添加 tool_calls
              const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
              if (lastMessage && lastMessage.role === 'assistant') {
                (lastMessage as any).tool_calls = effectiveToolCalls;
                // 如果有 SGLang reasoning，也添加到历史中
                if (sglangReasoning) {
                  (lastMessage as any).reasoning_content = sglangReasoning;
                }
              }
              
              if (isDebugMode) {
                console.log('[AI Client] Parsed SGLang tool calls:', JSON.stringify(effectiveToolCalls, null, 2));
              }
            }
          }
        }

        // 记录格式化的对话信息（在解析 MCP/SGLang 格式之后）
        // 创建包含解析后 tool_calls 的消息对象用于日志记录
        // 注意：无论是否 DEBUG 模式都要记录，以便生成详细报告
        {
          const messageForLog = {
            ...message,
            tool_calls: effectiveToolCalls || message.tool_calls,
          } as OpenAI.Chat.Completions.ChatCompletionMessage;
          const logContent = this.formatConversation(iteration, messageForLog);
          this.conversationLogs.push({
            iteration,
            type: 'assistant',
            content: logContent,
            timestamp: Date.now(),
          });
        }
        
        if (effectiveToolCalls && effectiveToolCalls.length > 0) {
          // 发送工具调用信息到 Web 客户端
          if (this.webVisualization) {
            for (const toolCall of effectiveToolCalls) {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                // Level 3: 从参数中获取 agent_id，设置到 webVisualization
                if (args.agent_id) {
                  this.webVisualization.setAgentId(args.agent_id);
                }
                this.webVisualization.sendToolCall(toolCall.function.name, args);
              } catch (error) {
                // 如果参数解析失败，发送原始字符串
                this.webVisualization.sendToolCall(toolCall.function.name, { raw: toolCall.function.arguments });
              }
            }
          }

          // 处理工具调用
          const toolResults = await this.handleToolCalls(effectiveToolCalls);

          // 将工具结果添加到对话历史
          for (const result of toolResults) {
            this.conversationHistory.push({
              role: 'tool',
              tool_call_id: result.toolCallId,
              name: result.toolName,
              content: JSON.stringify(result.result),
            });

            // V2 模式：如果是 get_receipts 工具，添加多模态消息让 AI 看到图片
            if (result.toolName === 'get_receipts' && result.result.success && result.result.data?.receipts) {
              this.addMultimodalReceiptMessage(result.result.data.receipts);
            }

            // V2/V3 模式：如果是 pickup_food_by_phone_number 成功，移除对应的图片以节省上下文
            // 这对于 Level 2 和 Level 3 测试特别重要，因为图片数据会占用大量上下文空间
            if (result.toolName === 'pickup_food_by_phone_number' && result.result.success && result.result.data?.orderId) {
              this.removeReceiptImageFromHistory(result.result.data.orderId);
            }

            // 发送工具结果到 Web 客户端
            if (this.webVisualization) {
              // Level 3: 从对应的工具调用中获取 agent_id
              const matchingToolCall = effectiveToolCalls.find(tc => tc.id === result.toolCallId);
              if (matchingToolCall) {
                try {
                  const args = JSON.parse(matchingToolCall.function.arguments);
                  if (args.agent_id) {
                    this.webVisualization.setAgentId(args.agent_id);
                  }
                } catch (e) {
                  // 忽略解析错误
                }
              }
              
              const success = result.result.success !== false;
              this.webVisualization.sendToolResult(result.toolName, success, result.result);
            }

            // 记录工具调用结果（无论是否 DEBUG 模式都要记录，以便生成详细报告）
            {
              const logContent = this.formatToolResult(iteration, result);
              this.conversationLogs.push({
                iteration,
                type: 'tool',
                content: logContent,
                timestamp: Date.now(),
              });
            }
          }

          // 回调
          if (onIteration) {
            onIteration(
              iteration,
              `Executed ${effectiveToolCalls.length} tool call(s)`
            );
          }
        } else {
          // 没有工具调用，可能是模型在思考或结束
          if (onIteration) {
            onIteration(
              iteration,
              message.content || 'No response'
            );
          }

          // 如果模型没有工具调用且没有内容，可能需要提示
          if (!message.content || message.content.trim() === '') {
            this.addUserMessage(
              'Please continue by calling appropriate tools to complete the delivery tasks. If you are unsure what to do, you can call the "help" tool to see all available tools and game rules.'
            );
          }
        }

        // 在 Level 1 中，定期生成新订单
        if (!this.simulator.isLevel01Mode() && iteration % 5 === 0) {
          this.simulator.advanceSimulation();
        }

      } catch (error) {
        console.error('Error in conversation loop:', error);
        throw error;
      }
    }

    // 检查终止原因
    if (!isUnlimited && iteration >= maxIterations) {
      console.warn(`Reached maximum iterations (${maxIterations})`);
    }
  }

  /**
   * 格式化对话信息（正常模式）
   * 
   * @param iteration 对话轮次
   * @param message AI 响应消息
   * @returns 格式化的字符串
   */
  private formatConversation(
    iteration: number,
    message: OpenAI.Chat.Completions.ChatCompletionMessage
  ): string {
    let output = '';
    output += '\n' + '='.repeat(80) + '\n';
    output += `[对话轮次 #${iteration}] ASSISTANT\n`;
    output += '='.repeat(80) + '\n';

    // 打印 content
    if (message.content) {
      output += '\n【Content】\n';
      output += message.content + '\n';
    }

    // 打印 tool_calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      output += '\n【Tool Calls】\n';
      message.tool_calls.forEach((toolCall, index) => {
        output += `\n  [${index + 1}] ${toolCall.function.name}\n`;
        output += '  Arguments:\n';
        try {
          const args = JSON.parse(toolCall.function.arguments);
          output += JSON.stringify(args, null, 4).split('\n').map(line => '    ' + line).join('\n') + '\n';
        } catch {
          output += '    ' + toolCall.function.arguments + '\n';
        }
      });
    }

    output += '\n' + '='.repeat(80) + '\n';
    return output;
  }

  /**
   * 格式化工具调用结果（正常模式）
   * 
   * @param iteration 对话轮次
   * @param result 工具调用结果
   * @returns 格式化的字符串
   */
  private formatToolResult(
    iteration: number,
    result: { toolCallId: string; toolName: string; result: any }
  ): string {
    let output = '';
    output += '\n' + '-'.repeat(80) + '\n';
    output += `[对话轮次 #${iteration}] TOOL: ${result.toolName}\n`;
    output += '-'.repeat(80) + '\n';
    output += '\n【Result】\n';
    output += JSON.stringify(result.result, null, 2) + '\n';
    output += '\n' + '-'.repeat(80) + '\n';
    return output;
  }

  /**
   * 获取新的对话日志（自上次读取以来的新日志）
   * 
   * @returns 新的对话日志数组
   */
  getNewConversationLogs(): ConversationLogEntry[] {
    const newLogs = this.conversationLogs.slice(this.lastReadLogIndex);
    this.lastReadLogIndex = this.conversationLogs.length;
    return newLogs;
  }

  /**
   * 获取所有对话日志
   * 
   * @returns 所有对话日志数组
   */
  getAllConversationLogs(): ConversationLogEntry[] {
    return [...this.conversationLogs];
  }

  /**
   * 打印新的对话日志
   */
  printNewConversationLogs(): void {
    const newLogs = this.getNewConversationLogs();
    for (const log of newLogs) {
      console.log(log.content);
    }
  }

  /**
   * 解析 MCP 格式的 tool call
   * MCP 返回格式: <use_mcp_tool><server_name>...</server_name><tool_name>...</tool_name><arguments>{...}</arguments></use_mcp_tool>
   * 
   * @param content 响应内容
   * @returns 解析结果，包含 tool calls
   */
  private parseMCPToolCalls(content: string): {
    toolCalls: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    cleanContent: string;
  } {
    const result: {
      toolCalls: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
      cleanContent: string;
    } = {
      toolCalls: [],
      cleanContent: content,
    };

    // 解析所有 <use_mcp_tool> 标签
    const mcpToolCallRegex = /<use_mcp_tool>([\s\S]*?)<\/use_mcp_tool>/g;
    let match;
    let callIndex = 0;

    while ((match = mcpToolCallRegex.exec(content)) !== null) {
      try {
        const innerContent = match[1];
        
        // 解析 <tool_name>
        const toolNameMatch = innerContent.match(/<tool_name>([\s\S]*?)<\/tool_name>/);
        const toolName = toolNameMatch ? toolNameMatch[1].trim() : null;
        
        // 解析 <arguments>
        const argsMatch = innerContent.match(/<arguments>([\s\S]*?)<\/arguments>/);
        let args = '{}';
        
        if (argsMatch) {
          const argsContent = argsMatch[1].trim();
          try {
            // 尝试解析 JSON，验证格式正确
            JSON.parse(argsContent);
            args = argsContent;
          } catch (jsonError) {
            // 如果 JSON 解析失败，尝试使用 json_repair 风格的修复
            // 这里简单处理常见问题：移除尾部逗号等
            const cleanedArgs = argsContent
              .replace(/,\s*}/g, '}')
              .replace(/,\s*]/g, ']');
            try {
              JSON.parse(cleanedArgs);
              args = cleanedArgs;
            } catch {
              console.warn('Failed to parse MCP arguments:', argsContent);
              args = '{}';
            }
          }
        }
        
        if (toolName) {
          result.toolCalls.push({
            id: `mcp_call_${Date.now()}_${callIndex++}`,
            type: 'function',
            function: {
              name: toolName,
              arguments: args,
            },
          });
        }
      } catch (e) {
        console.warn('Failed to parse MCP tool call:', match[1], e);
      }
    }

    // 从内容中移除 <use_mcp_tool> 部分
    result.cleanContent = result.cleanContent.replace(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/g, '').trim();

    return result;
  }

  /**
   * 解析 SGLang 格式的 tool call
   * SGLang 返回格式: <think>...</think><tool_call>{"name": "xxx", "arguments": {...}}</tool_call>
   * 
   * @param content 响应内容
   * @returns 解析结果，包含 reasoning 和 tool calls
   */
  private parseSGLangToolCalls(content: string): {
    reasoning?: string;
    toolCalls: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    cleanContent: string;
  } {
    const result: {
      reasoning?: string;
      toolCalls: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
      cleanContent: string;
    } = {
      toolCalls: [],
      cleanContent: content,
    };

    // 解析 <think> 标签
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      result.reasoning = thinkMatch[1].trim();
      // 从内容中移除 <think> 部分
      result.cleanContent = result.cleanContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }

    // 解析所有 <tool_call> 标签
    const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match;
    let callIndex = 0;
    
    while ((match = toolCallRegex.exec(content)) !== null) {
      try {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);
        
        // SGLang 格式: {"name": "xxx", "arguments": {...}}
        if (parsed.name) {
          result.toolCalls.push({
            id: `sglang_call_${Date.now()}_${callIndex++}`,
            type: 'function',
            function: {
              name: parsed.name,
              // arguments 需要是字符串格式
              arguments: typeof parsed.arguments === 'string' 
                ? parsed.arguments 
                : JSON.stringify(parsed.arguments || {}),
            },
          });
        }
      } catch (e) {
        console.warn('Failed to parse SGLang tool call:', match[1], e);
      }
    }

    // 从内容中移除 <tool_call> 部分
    result.cleanContent = result.cleanContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();

    return result;
  }

  /**
   * 获取工具的用法说明
   * 
   * @param toolName 工具名称
   * @returns 工具用法说明
   */
  private getToolUsage(toolName: string): string {
    const usageMap: Record<string, string> = {
      'get_my_status': 'Usage: get_my_status() - no parameters required',
      'search_nearby_orders': 'Usage: search_nearby_orders({"radius": <number>}) - Parameters: radius (required, number, search radius in km)',
      'search_nearby_battery_stations': 'Usage: search_nearby_battery_stations({"radius": <number>}) - Parameters: radius (required, number, search radius in km)',
      'get_location_info': 'Usage: get_location_info({"locationId": "<string>"}) - Parameters: locationId (required, string, location ID)',
      'calculate_distance': 'Usage: calculate_distance({"fromId": "<string>", "toId": "<string>"}) - Parameters: fromId (required, string, start location ID), toId (required, string, end location ID)',
      'estimate_time': 'Usage: estimate_time({"locationIds": ["<string>", "<string>", ...]}) - Parameters: locationIds (required, string array, list of location IDs)',
      'help': 'Usage: help() - no parameters required',
      'accept_order': 'Usage: accept_order({"orderId": "<string>"}) - Parameters: orderId (required, string, order ID)',
      'move_to': 'Usage: move_to({"targetLocationId": "<string>"}) - Parameters: targetLocationId (required, string, target location ID)',
      'pickup_food': 'Usage: pickup_food({"orderId": "<string>"}) - Parameters: orderId (required, string, order ID)',
      'deliver_food': 'Usage: deliver_food({"orderId": "<string>"}) - Parameters: orderId (required, string, order ID)',
      'swap_battery': 'Usage: swap_battery() - no parameters required',
    };

    return usageMap[toolName] || `Usage: ${toolName}(<parameters>) - please check tool definition`;
  }

  /**
   * 处理工具调用
   * 需求：16.3, 16.4
   * 
   * @param toolCalls OpenAI 工具调用数组
   * @returns 工具调用结果数组
   */
  private async handleToolCalls(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
  ): Promise<Array<{ toolCallId: string; toolName: string; result: any }>> {
    const results: Array<{ toolCallId: string; toolName: string; result: any }> = [];

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolCallId = toolCall.id;

      try {
        // 解析参数
        // 处理 AI 可能传输的 "undefined" 字符串
        let parameters: Record<string, any>;
        const args = toolCall.function.arguments?.trim() || '';
        
        if (args === '' || args === 'undefined' || args === 'null') {
          // 如果参数为空、"undefined" 或 "null"，使用空对象
          parameters = {};
        } else {
          parameters = JSON.parse(args);
        }

        // 构建工具调用请求
        const request: ToolCallRequest = {
          toolName,
          parameters,
        };

        // 执行工具调用
        const response = await this.simulator.executeToolCall(request);

        // 记录结果
        results.push({
          toolCallId,
          toolName,
          result: response,
        });
      } catch (error) {
        // 处理解析或执行错误
        let errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // 如果是 JSON 解析错误，添加工具用法说明
        if (error instanceof SyntaxError || errorMessage.includes('JSON')) {
          const usage = this.getToolUsage(toolName);
          errorMessage = `${errorMessage}. ${usage}`;
        }
        
        results.push({
          toolCallId,
          toolName,
          result: {
            success: false,
            error: {
              code: 'INVALID_PARAMETER',
              message: errorMessage,
              details: { 
                error: String(error),
                rawArguments: toolCall.function.arguments,
              },
            },
          },
        });
      }
    }

    return results;
  }

  /**
   * 获取对话历史
   * 
   * @returns 对话历史数组
   */
  getConversationHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * 获取配置
   * 
   * @returns 客户端配置
   */
  getConfig(): AIClientConfig {
    return { ...this.config };
  }

  /**
   * 获取模拟器实例
   * 
   * @returns 模拟器实例
   */
  getSimulator(): Simulator {
    return this.simulator;
  }

  /**
   * 获取 token 使用量统计
   * 
   * @returns token 使用量信息（包含单次和累计）
   */
  getTokenUsage(): { 
    last: { total: number; prompt: number; completion: number };
    cumulative: { total: number; prompt: number; completion: number };
  } {
    return {
      last: {
        total: this.totalTokens,
        prompt: this.promptTokens,
        completion: this.completionTokens,
      },
      cumulative: {
        total: this.cumulativeTotalTokens,
        prompt: this.cumulativePromptTokens,
        completion: this.cumulativeCompletionTokens,
      },
    };
  }
}

/**
 * 创建 AI 客户端实例
 * 
 * @param simulator 模拟器实例
 * @param config 客户端配置（可选）
 * @param webVisualization Web 可视化适配器（可选）
 * @returns AI 客户端实例
 */
export function createAIClient(
  simulator: Simulator,
  config?: Partial<AIClientConfig>,
  webVisualization?: WebVisualization
): AIClient {
  return new AIClient(simulator, config, webVisualization);
}

// 导出 generateSystemPrompt 以保持向后兼容
export { generateSystemPrompt } from './system-prompt';
