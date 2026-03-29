const ANSWER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Per-session pending answer resolvers keyed by sessionId
export const pendingAnswers = new Map<
  string,
  (answers: Record<string, string>) => void
>();

export function waitForAnswer(sessionId: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAnswers.delete(sessionId);
      reject(new Error(`Answer timeout for session ${sessionId}`));
    }, ANSWER_TIMEOUT_MS);
    pendingAnswers.set(sessionId, (answers) => {
      clearTimeout(timer);
      resolve(answers);
    });
  });
}
