export interface App {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  containerId?: string;
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

export interface SendMessageRequest {
  sessionId: string;
  message: string;
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
    | "status"
    | "error"
    | "done"
    | "screenshot"
    | "question"
    | "result";
  content: string; // for "question": JSON.stringify(QuestionItem[])
}

export interface AnswerMessageRequest {
  sessionId: string;
  answers: Record<string, string>; // question text -> selected label(s)
}

export interface AnswerMessageResponse {
  delivered: boolean;
}

export interface CancelMessageRequest {
  sessionId: string;
}

export interface CancelMessageResponse {
  cancelled: boolean;
}
