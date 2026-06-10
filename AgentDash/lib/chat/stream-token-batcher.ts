export type StreamTokenBatcher = {
  onToken: (token: string) => void;
  /** Apply any buffered tokens immediately (call before stream ends). */
  flush: () => void;
  dispose: () => void;
};

const scheduleFrame =
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;

const cancelFrame =
  typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame
    : (id: number) => clearTimeout(id);

/** Coalesce rapid SSE tokens into one update per animation frame for smoother UI. */
export function createStreamTokenBatcher(options: {
  onUpdate: (text: string, isFirst: boolean) => void;
}): StreamTokenBatcher {
  let buffer = "";
  let rafId: number | null = null;
  let isFirst = true;

  const flush = () => {
    if (rafId !== null) {
      cancelFrame(rafId);
      rafId = null;
    }
    if (!buffer) return;
    const text = buffer;
    buffer = "";
    options.onUpdate(text, isFirst);
    isFirst = false;
  };

  const scheduleFlush = () => {
    if (rafId !== null) return;
    rafId = scheduleFrame(() => {
      rafId = null;
      flush();
    });
  };

  return {
    onToken: (token: string) => {
      buffer += token;
      scheduleFlush();
    },
    flush,
    dispose: () => {
      if (rafId !== null) cancelFrame(rafId);
      rafId = null;
      buffer = "";
    },
  };
}
