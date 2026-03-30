/**
 * useTokenSmoothening
 *
 * Buffers incoming text (e.g. full sentences from a WebSocket) and drains it
 * word-by-word at a configurable rate so that it appears to stream in smoothly.
 *
 * Usage:
 *   const { displayedText, wordsPerSecond, feed, flush, reset } = useTokenSmoothening({ wordsPerSecond: 12 })
 *
 *   wordsPerSecond.value = 20   // change speed at any time
 *
 *   // on text_delta:  feed(event.content)
 *   // on done:        flush()   ← immediately drains any remaining buffer
 *   // on new message: reset()
 */
export interface TokenSmootheningOptions {
  /** Words revealed per second. Default: 12 */
  wordsPerSecond?: number;
}

export function useTokenSmoothening(options?: TokenSmootheningOptions) {
  const wordsPerSecond = options?.wordsPerSecond ?? 12;
  const intervalMs = Math.round(1000 / wordsPerSecond);

  const displayedText = ref("");
  const wordQueue = ref<string[]>([]);
  let drainTimer: ReturnType<typeof setInterval> | null = null;

  function splitIntoTokens(text: string): string[] {
    // Each token is a word + its trailing whitespace, or a standalone whitespace run.
    // This preserves newlines, multiple spaces, etc.
    return text.match(/\S+\s*|\s+/g) ?? [];
  }

  function startDraining() {
    stopDraining();
    drainTimer = setInterval(() => {
      if (wordQueue.value.length === 0) {
        stopDraining();
        return;
      }
      displayedText.value += wordQueue.value.shift()!;
    }, intervalMs);
  }

  function stopDraining() {
    if (drainTimer !== null) {
      clearInterval(drainTimer);
      drainTimer = null;
    }
  }

  /** Feed new text into the buffer. */
  function feed(text: string) {
    const tokens = splitIntoTokens(text);
    if (tokens.length === 0) return;
    wordQueue.value.push(...tokens);
    if (drainTimer === null) startDraining();
  }

  /** Immediately drain all remaining buffered words (call on stream end). */
  function flush() {
    stopDraining();
    displayedText.value += wordQueue.value.join("");
    wordQueue.value = [];
  }

  /** Reset state for the next message. */
  function reset() {
    stopDraining();
    wordQueue.value = [];
    displayedText.value = "";
  }

  onUnmounted(stopDraining);

  return { displayedText, feed, flush, reset };
}
