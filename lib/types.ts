export type MemoryStatus = "ACTIVE" | "SUPERSEDED" | "INVALIDATED" | "EXPIRED";
export type MemoryType = "decision" | "fact" | "preference" | "constraint" | "temporary";

export interface Memory {
  id: string;
  user_id: string;
  project_id: string;
  type: MemoryType;
  content: string;
  topic?: string;
  subject?: string;
  value?: string;
  reason?: string;
  status: MemoryStatus;
  confidence: number;
  importance: number;
  created_at: string;
  updated_at?: string;
  valid_from?: string;
  valid_until?: string;
  supersedes_id?: string;
  superseded_by?: string;
  contradiction_group?: string;
  change_reason?: string;
  embedding?: number[];
}

export interface MemoryEvent {
  id: string;
  memory_id?: string;
  kind: string;
  message: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}
