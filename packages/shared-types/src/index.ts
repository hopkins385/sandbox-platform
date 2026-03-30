export interface App {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  status: "creating" | "running" | "stopped" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface Collaborator {
  appId: string;
  userId: string;
  role: "editor" | "viewer";
  addedAt: string;
}

export interface Session {
  id: string;
  appId: string;
  userId: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt?: string;
}

export interface AppListResponse {
  owned: App[];
  collaborations: App[];
}

export interface SessionOpenRequest {
  appId: string;
}

export interface SessionOpenResponse {
  sessionId: string;
  app: App;
  previewUrl: string;
}

export interface QuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

export interface SendMessageResponse {
  type:
    | "text"
    | "text_delta"
    | "status"
    | "error"
    | "done"
    | "screenshot"
    | "question"
    | "result"
    | "worker_connected"
    | "worker_disconnected"
    | "pong";
  content: string; // for "question": JSON.stringify(QuestionItem[])
}

export interface WorkerConnectRequest {
  sessionId: string;
}

// WebSocket client → server message types
export type WsClientMessage =
  | { type: "send"; message: string }
  | { type: "cancel" }
  | { type: "answer"; answers: Record<string, string> }
  | { type: "ping" };

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  maxTurns?: number;
  abortController: AbortController;
}
