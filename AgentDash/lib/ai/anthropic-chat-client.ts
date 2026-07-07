import Anthropic from "@anthropic-ai/sdk";
type ChatCompletionChunk = {
  choices: Array<{
    index?: number;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: ChatCompletionUsage;
  id?: string;
  diagnostics?: AnthropicCacheDiagnostics | null;
};
import {
  ANTHROPIC_CACHE_DIAGNOSIS_BETA,
  ANTHROPIC_CHAT_MODEL,
  ANTHROPIC_MAX_TOKENS,
  getAnthropicApiKey,
  isAnthropicCacheDiagnosticsEnabled,
  isAnthropicPromptCacheEnabled,
} from "@/lib/ai/llm-chat-defaults";

export type CacheControl = { type: "ephemeral" };

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  cache_control?: CacheControl;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ChatCompletionBody = {
  model?: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  tool_choice?: "auto" | "none";
  temperature?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  /** When true, marks the last tool with cache_control (requires prompt cache enabled). */
  cache_tools?: boolean;
  /** Prior Anthropic response id for cache diagnostics chaining (null opts in on first call). */
  previous_message_id?: string | null;
};

export type ChatCompletionUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type AnthropicCacheMissReason = {
  type: string;
  cache_missed_input_tokens?: number;
};

export type AnthropicCacheDiagnostics = {
  cache_miss_reason: AnthropicCacheMissReason | null;
};

export type ChatCompletionResult = {
  id?: string;
  diagnostics?: AnthropicCacheDiagnostics | null;
  choices: Array<{
    message: OpenAICompatibleAssistantMessage;
    finish_reason: string | null;
  }>;
  usage?: ChatCompletionUsage;
};

export type OpenAICompatibleAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type AnthropicMessageParam = Anthropic.Messages.MessageParam;
type AnthropicTool = Anthropic.Messages.Tool;
type AnthropicSystem = string | Anthropic.Messages.TextBlockParam[];

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function promptCacheActive(body: ChatCompletionBody, messages: ChatMessage[]): boolean {
  if (!isAnthropicPromptCacheEnabled()) return false;
  if (body.cache_tools) return true;
  return messages.some((m) => m.role === "system" && m.cache_control);
}

export function toAnthropicTools(
  tools: ChatToolDefinition[] | undefined,
  cacheTools: boolean
): AnthropicTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool, index) => {
    const mapped: AnthropicTool = {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: (tool.function.parameters ?? {
        type: "object",
        properties: {},
      }) as Anthropic.Messages.Tool.InputSchema,
    };
    if (cacheTools && index === tools.length - 1) {
      mapped.cache_control = { type: "ephemeral" };
    }
    return mapped;
  });
}

export function toAnthropicMessages(messages: ChatMessage[], useStructuredSystem: boolean): {
  system: AnthropicSystem | undefined;
  messages: AnthropicMessageParam[];
} {
  const systemParts: string[] = [];
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [];
  const anthropicMessages: AnthropicMessageParam[] = [];

  let pendingToolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

  const flushToolResults = () => {
    if (!pendingToolResults.length) return;
    anthropicMessages.push({
      role: "user",
      content: pendingToolResults,
    });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (message.role === "system") {
      const text = String(message.content ?? "").trim();
      if (!text) continue;
      if (useStructuredSystem) {
        const block: Anthropic.Messages.TextBlockParam = { type: "text", text };
        if (message.cache_control) {
          block.cache_control = message.cache_control;
        }
        systemBlocks.push(block);
      } else {
        systemParts.push(text);
      }
      continue;
    }

    if (message.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: String(message.tool_call_id ?? ""),
        content: String(message.content ?? ""),
      });
      continue;
    }

    flushToolResults();

    if (message.role === "user") {
      const text = String(message.content ?? "");
      anthropicMessages.push({
        role: "user",
        content: text,
      });
      continue;
    }

    if (message.role === "assistant") {
      const blocks: Anthropic.Messages.ContentBlockParam[] = [];
      const text = String(message.content ?? "").trim();
      if (text) {
        blocks.push({ type: "text", text });
      }
      for (const toolCall of message.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        });
      }
      anthropicMessages.push({
        role: "assistant",
        content: blocks.length ? blocks : "",
      });
    }
  }

  flushToolResults();

  if (useStructuredSystem) {
    return {
      system: systemBlocks.length ? systemBlocks : undefined,
      messages: ensureAnthropicMessagesEndWithUser(anthropicMessages),
    };
  }

  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: ensureAnthropicMessagesEndWithUser(anthropicMessages),
  };
}

/** Anthropic rejects requests whose message list ends with an assistant turn. */
function ensureAnthropicMessagesEndWithUser(
  messages: AnthropicMessageParam[]
): AnthropicMessageParam[] {
  if (messages.length === 0) return messages;
  if (messages[messages.length - 1]?.role !== "assistant") return messages;
  return [
    ...messages,
    {
      role: "user",
      content: "Continue with the required next step.",
    },
  ];
}

function mapStopReason(stopReason: string | null): string | null {
  if (!stopReason) return null;
  if (stopReason === "tool_use") return "tool_calls";
  if (stopReason === "end_turn") return "stop";
  return stopReason;
}

type AnthropicUsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

function fromAnthropicUsage(usage: AnthropicUsageLike): ChatCompletionUsage {
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
  };
}

function mapDiagnostics(
  diagnostics: Anthropic.Beta.Messages.BetaDiagnostics | null | undefined
): AnthropicCacheDiagnostics | null {
  if (diagnostics == null) return null;
  const reason = diagnostics.cache_miss_reason;
  if (reason == null) {
    return { cache_miss_reason: null };
  }
  return {
    cache_miss_reason: {
      type: reason.type,
      ...("cache_missed_input_tokens" in reason
        ? { cache_missed_input_tokens: reason.cache_missed_input_tokens }
        : {}),
    },
  };
}

export function logAnthropicCacheDiagnostics(
  context: string,
  diagnostics: AnthropicCacheDiagnostics | null | undefined,
  usage?: ChatCompletionUsage
): void {
  if (!diagnostics?.cache_miss_reason) return;
  const reason = diagnostics.cache_miss_reason;
  console.log(
    `[Anthropic] Cache diagnostics (${context})`,
    JSON.stringify({
      cache_miss_reason: reason.type,
      cache_missed_input_tokens: reason.cache_missed_input_tokens ?? null,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
    })
  );
}

function buildBetaExtras(body: ChatCompletionBody): {
  betas: [typeof ANTHROPIC_CACHE_DIAGNOSIS_BETA];
  diagnostics: { previous_message_id: string | null };
} {
  return {
    betas: [ANTHROPIC_CACHE_DIAGNOSIS_BETA],
    diagnostics: { previous_message_id: body.previous_message_id ?? null },
  };
}

function fromAnthropicMessage(message: Anthropic.Messages.Message): {
  message: OpenAICompatibleAssistantMessage;
  finish_reason: string | null;
} {
  const textParts: string[] = [];
  const toolCalls: OpenAICompatibleAssistantMessage["tool_calls"] = [];

  for (const block of message.content) {
    if (block.type === "text") {
      textParts.push(block.text);
      continue;
    }
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }

  return {
    message: {
      role: "assistant",
      content: textParts.join("") || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    finish_reason: mapStopReason(message.stop_reason),
  };
}

export function buildRequestParams(
  body: ChatCompletionBody
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const useStructuredSystem = promptCacheActive(body, body.messages);
  const cacheTools = useStructuredSystem && Boolean(body.cache_tools);
  const { system, messages } = toAnthropicMessages(body.messages, useStructuredSystem);
  const tools = toAnthropicTools(body.tools, cacheTools);
  const toolChoice =
    body.tool_choice === "none"
      ? ({ type: "none" } as const)
      : tools?.length
        ? ({ type: "auto" } as const)
        : undefined;

  return {
    model: body.model?.trim() || ANTHROPIC_CHAT_MODEL,
    max_tokens: body.max_completion_tokens ?? ANTHROPIC_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages,
    ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
  };
}

export async function createChatCompletion(body: ChatCompletionBody): Promise<ChatCompletionResult> {
  const anthropic = getClient();
  const params = buildRequestParams(body);
  const useDiagnostics = isAnthropicCacheDiagnosticsEnabled();

  if (useDiagnostics) {
    const response = await anthropic.beta.messages.create({
      ...params,
      ...buildBetaExtras(body),
    });
    const mapped = fromAnthropicMessage(response as Anthropic.Messages.Message);
    const usage = fromAnthropicUsage(response.usage);
    const diagnostics = mapDiagnostics(response.diagnostics);
    if (usage.cache_creation_input_tokens > 0 || usage.cache_read_input_tokens > 0) {
      console.log("[Anthropic] Prompt cache usage", JSON.stringify(usage));
    }
    logAnthropicCacheDiagnostics("completion", diagnostics, usage);
    return {
      id: response.id,
      diagnostics,
      choices: [
        {
          message: mapped.message,
          finish_reason: mapped.finish_reason,
        },
      ],
      usage,
    };
  }

  const response = await anthropic.messages.create(params);
  const mapped = fromAnthropicMessage(response);
  const usage = fromAnthropicUsage(response.usage);
  if (usage.cache_creation_input_tokens > 0 || usage.cache_read_input_tokens > 0) {
    console.log("[Anthropic] Prompt cache usage", JSON.stringify(usage));
  }
  return {
    id: response.id,
    choices: [
      {
        message: mapped.message,
        finish_reason: mapped.finish_reason,
      },
    ],
    usage,
  };
}

async function* anthropicStreamToOpenAIChunks(
  stream: AsyncIterable<Anthropic.Messages.MessageStreamEvent | Anthropic.Beta.Messages.BetaRawMessageStreamEvent>,
  options?: { diagnostics?: boolean }
): AsyncIterable<ChatCompletionChunk> {
  const toolCallsByIndex: Record<
    number,
    { id: string; name: string; arguments: string; started: boolean }
  > = {};
  let finishReason: string | null = null;
  let usage: ChatCompletionUsage | undefined;
  let messageId: string | undefined;
  let diagnostics: AnthropicCacheDiagnostics | null | undefined;

  for await (const event of stream) {
    if (event.type === "message_start") {
      if (event.message.usage) {
        usage = fromAnthropicUsage(event.message.usage);
      }
      messageId = event.message.id;
      if (options?.diagnostics && "diagnostics" in event.message) {
        diagnostics = mapDiagnostics(
          (event.message as Anthropic.Beta.Messages.BetaMessage).diagnostics
        );
      }
    }

    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      const block = event.content_block;
      toolCallsByIndex[event.index] = {
        id: block.id,
        name: block.name,
        arguments: "",
        started: false,
      };
      yield {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: event.index,
                  id: block.id,
                  type: "function",
                  function: { name: block.name, arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      } as ChatCompletionChunk;
      continue;
    }

    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta" && event.delta.text) {
        yield {
          choices: [
            {
              index: 0,
              delta: { content: event.delta.text },
              finish_reason: null,
            },
          ],
        } as ChatCompletionChunk;
        continue;
      }

      if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
        const tracked = toolCallsByIndex[event.index];
        if (tracked) {
          tracked.arguments += event.delta.partial_json;
        }
        yield {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: event.index,
                    function: { arguments: event.delta.partial_json },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        } as ChatCompletionChunk;
      }
      continue;
    }

    if (event.type === "message_delta") {
      finishReason = mapStopReason(event.delta.stop_reason);
      if (event.usage) {
        usage = fromAnthropicUsage(event.usage);
      }
    }
  }

  if (finishReason) {
    yield {
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
      ...(usage ? { usage } : {}),
      ...(messageId ? { id: messageId } : {}),
      ...(options?.diagnostics ? { diagnostics: diagnostics ?? null } : {}),
    } as ChatCompletionChunk;
  }
}

export async function createChatCompletionStream(
  body: ChatCompletionBody
): Promise<AsyncIterable<ChatCompletionChunk>> {
  const anthropic = getClient();
  const params = buildRequestParams(body);
  const useDiagnostics = isAnthropicCacheDiagnosticsEnabled();

  if (useDiagnostics) {
    const stream = await anthropic.beta.messages.create({
      ...params,
      ...buildBetaExtras(body),
      stream: true,
    });
    return anthropicStreamToOpenAIChunks(stream, { diagnostics: true });
  }

  const stream = await anthropic.messages.create({
    ...params,
    stream: true,
  });
  return anthropicStreamToOpenAIChunks(stream);
}
