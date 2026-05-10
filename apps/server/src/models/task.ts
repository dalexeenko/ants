export type TaskSessionMode = 'newEachRun' | 'dedicatedSession';
export type TaskStatus = 'success' | 'error' | 'running';
export type WebhookEvent = 'success' | 'error' | 'complete';

export interface TaskWebhook {
  url: string;
  events: WebhookEvent[];
  headers?: Record<string, string>;
}

export interface WebhookResult {
  url: string;
  status: 'success' | 'error';
  statusCode?: number;
  error?: string;
}

export interface TaskRun {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: TaskStatus;
  sessionId: string;
  error?: string;
  webhookResults?: WebhookResult[];
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cronSchedule: string;
  enabled: boolean;
  sessionMode: TaskSessionMode;
  dedicatedSessionId?: string;
  model?: string;
  webhooks?: TaskWebhook[];
  lastRunAt?: string;
  lastRunStatus?: TaskStatus;
  lastRunSessionId?: string;
  runHistory: TaskRun[];
}

export interface CreateTaskRequest {
  name: string;
  prompt: string;
  cronSchedule: string;
  enabled?: boolean;
  sessionMode?: TaskSessionMode;
  model?: string;
  webhooks?: TaskWebhook[];
}

export interface UpdateTaskRequest {
  name?: string;
  prompt?: string;
  cronSchedule?: string;
  enabled?: boolean;
  sessionMode?: TaskSessionMode;
  model?: string;
  webhooks?: TaskWebhook[];
}
