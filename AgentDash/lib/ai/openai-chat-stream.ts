type ChatCompletionChunk = {
  choices: Array<{
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
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  id?: string;
  diagnostics?: {
    cache_miss_reason: { type: string; cache_missed_input_tokens?: number } | null;
  } | null;
};

export type StreamedAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export async function streamChatCompletionToMessage(
  createStream: () => Promise<AsyncIterable<ChatCompletionChunk>>,
  options?: {
    onToken?: (text: string) => void;
    onToolCallsDetected?: (names: string[]) => void;
  }
): Promise<{
  message: StreamedAssistantMessage;
  finishReason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  id?: string;
  diagnostics?: {
    cache_miss_reason: { type: string; cache_missed_input_tokens?: number } | null;
  } | null;
}> {
  const stream = await createStream();
  let content = "";
  const toolCallsByIndex: Record<
    number,
    { id: string; type: "function"; function: { name: string; arguments: string } }
  > = {};
  let finishReason: string | null = null;
  let sawToolCallDelta = false;
  let usage:
    | {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens: number;
        cache_read_input_tokens: number;
      }
    | undefined;
  let id: string | undefined;
  let diagnostics:
    | {
        cache_miss_reason: { type: string; cache_missed_input_tokens?: number } | null;
      }
    | null
    | undefined;

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = chunk.usage;
    }
    if (chunk.id) {
      id = chunk.id;
    }
    if ("diagnostics" in chunk) {
      diagnostics = chunk.diagnostics;
    }
    const choice = chunk.choices[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) continue;

    if (delta.tool_calls?.length) {
      sawToolCallDelta = true;
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsByIndex[idx]) {
          toolCallsByIndex[idx] = {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          };
        }
        if (tc.id) toolCallsByIndex[idx].id = tc.id;
        if (tc.function?.name) toolCallsByIndex[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCallsByIndex[idx].function.arguments += tc.function.arguments;
      }
    }

    if (delta.content) {
      content += delta.content;
      if (!sawToolCallDelta && options?.onToken) {
        options.onToken(delta.content);
      }
    }
  }

  const toolCalls = Object.keys(toolCallsByIndex)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => toolCallsByIndex[Number(k)])
    .filter((tc) => tc.id && tc.function.name);

  if (toolCalls.length && options?.onToolCallsDetected) {
    options.onToolCallsDetected(toolCalls.map((tc) => tc.function.name));
  }

  return {
    message: {
      role: "assistant",
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    finishReason,
    usage,
    id,
    diagnostics,
  };
}
