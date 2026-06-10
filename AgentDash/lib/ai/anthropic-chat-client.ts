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
};
import {
  ANTHROPIC_CHAT_MODEL,
  ANTHROPIC_MAX_TOKENS,
  getAnthropicApiKey,
} from "@/lib/ai/llm-chat-defaults";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
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

function toAnthropicTools(tools: ChatToolDefinition[] | undefined): AnthropicTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: (tool.function.parameters ?? {
      type: "object",
      properties: {},
    }) as Anthropic.Messages.Tool.InputSchema,
  }));
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: AnthropicMessageParam[];
} {
  const systemParts: string[] = [];
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
      if (text) systemParts.push(text);
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

  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: anthropicMessages,
  };
}

function mapStopReason(stopReason: string | null): string | null {
  if (!stopReason) return null;
  if (stopReason === "tool_use") return "tool_calls";
  if (stopReason === "end_turn") return "stop";
  return stopReason;
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

function buildRequestParams(body: ChatCompletionBody): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const { system, messages } = toAnthropicMessages(body.messages);
  const tools = toAnthropicTools(body.tools);
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

export async function createChatCompletion(body: ChatCompletionBody) {
  const anthropic = getClient();
  const response = await anthropic.messages.create(buildRequestParams(body));
  const mapped = fromAnthropicMessage(response);
  return {
    choices: [
      {
        message: mapped.message,
        finish_reason: mapped.finish_reason,
      },
    ],
  };
}

async function* anthropicStreamToOpenAIChunks(
  stream: AsyncIterable<Anthropic.Messages.MessageStreamEvent>
): AsyncIterable<ChatCompletionChunk> {
  const toolCallsByIndex: Record<
    number,
    { id: string; name: string; arguments: string; started: boolean }
  > = {};
  let finishReason: string | null = null;

  for await (const event of stream) {
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
    } as ChatCompletionChunk;
  }
}

export async function createChatCompletionStream(
  body: ChatCompletionBody
): Promise<AsyncIterable<ChatCompletionChunk>> {
  const anthropic = getClient();
  const stream = await anthropic.messages.create({
    ...buildRequestParams(body),
    stream: true,
  });
  return anthropicStreamToOpenAIChunks(stream);
}

/** Drop-in replacements for the former OpenAI reasoning-compat helpers. */
export async function createChatCompletionWithReasoningCompat(body: ChatCompletionBody) {
  return createChatCompletion(body);
}

export async function createChatCompletionStreamWithReasoningCompat(
  body: ChatCompletionBody
): Promise<AsyncIterable<ChatCompletionChunk>> {
  return createChatCompletionStream(body);
}
