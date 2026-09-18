import fs from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Memory, MemoryEvent } from "./types";

const fallbackPath = path.join(process.cwd(), ".data", "memories.json");

const DEFAULT_MEMORIES: Memory[] = [
  { id: "mem-react", user_id: "demo-user-01", project_id: "echo-demo", type: "decision", content: "Use React for the frontend.", topic: "frontend_framework", value: "React", reason: "Team is already comfortable with React and the build window is tight.", status: "SUPERSEDED", confidence: 0.91, importance: 0.84, created_at: "2026-09-10T10:00:00Z", valid_from: "2026-09-10T10:00:00Z", valid_until: "2026-09-14T14:00:00Z", superseded_by: "mem-vue", change_reason: "Team reassessed frontend fit." },
  { id: "mem-vue", user_id: "demo-user-01", project_id: "echo-demo", type: "decision", content: "Use Vue for the frontend.", topic: "frontend_framework", value: "Vue", reason: "Better perceived developer experience after the team reassessed the stack.", status: "ACTIVE", confidence: 0.96, importance: 0.9, created_at: "2026-09-14T15:20:00Z", valid_from: "2026-09-14T15:20:00Z" },
  { id: "mem-db", user_id: "demo-user-01", project_id: "echo-demo", type: "decision", content: "PostgreSQL is the project database.", topic: "database", value: "PostgreSQL", reason: "The team already knows SQL and Supabase integration is fast under the 24-hour hackathon constraint.", status: "ACTIVE", confidence: 0.95, importance: 0.95, created_at: "2026-09-15T08:30:00Z", valid_from: "2026-09-15T08:30:00Z" },
  { id: "mem-constraint", user_id: "demo-user-01", project_id: "echo-demo", type: "constraint", content: "The team has a 24-hour hackathon build window.", topic: "build_window", value: "24 hours", reason: "Hackathon constraint.", status: "ACTIVE", confidence: 0.99, importance: 0.78, created_at: "2026-09-15T07:00:00Z", valid_from: "2026-09-15T07:00:00Z" }
];

function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readFallback(): Promise<{ memories: Memory[]; events: MemoryEvent[] }> {
  try {
    const raw = await fs.readFile(fallbackPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { memories: [...DEFAULT_MEMORIES], events: [] };
  }
}

async function writeFallback(data: { memories: Memory[]; events: MemoryEvent[] }) {
  await fs.mkdir(path.dirname(fallbackPath), { recursive: true });
  await fs.writeFile(fallbackPath, JSON.stringify(data, null, 2));
}

export async function listMemories(userId: string, projectId: string) {
  const db = supabase();
  if (!db) {
    const data = await readFallback();
    const now = Date.now();
    return data.memories
      .filter(m=>m.user_id===userId && m.project_id===projectId)
      .map(m=>m.status !== "EXPIRED" && m.valid_until && +new Date(m.valid_until) < now ? {...m,status:"EXPIRED" as const} : m)
      .sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at));
  }
  const { data, error } = await db.from("memories").select("*").eq("user_id", userId).eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Memory[];
}

export async function saveMemory(memory: Memory, event: MemoryEvent, oldIds: string[] = [], replacementStatus: "SUPERSEDED" | "INVALIDATED" = "SUPERSEDED") {
  const db = supabase();
  if (!db) {
    const data = await readFallback();
    const updated = data.memories.map(m=>oldIds.includes(m.id) ? ({...m,status:replacementStatus as "SUPERSEDED" | "INVALIDATED", superseded_by:replacementStatus === "SUPERSEDED" ? memory.id : undefined, valid_until:memory.valid_from, updated_at:memory.created_at}) : m);
    updated.push(memory);
    data.events.push(event);
    await writeFallback({ memories: updated, events: data.events });
    return;
  }
  if (oldIds.length) {
    const { error: updateError } = await db.from("memories").update({ status: replacementStatus, superseded_by: replacementStatus === "SUPERSEDED" ? memory.id : null, valid_until: memory.valid_from, updated_at: memory.created_at, change_reason: memory.change_reason }).in("id", oldIds);
    if (updateError) throw updateError;
  }
  const { error: insertError } = await db.from("memories").insert(memory);
  if (insertError) throw insertError;
  const { error: eventError } = await db.from("memory_events").insert(event);
  if (eventError) throw eventError;
}

export async function saveEvent(event: MemoryEvent) {
  const db = supabase();
  if (!db) { const data = await readFallback(); data.events.push(event); await writeFallback(data); return; }
  const { error } = await db.from("memory_events").insert(event);
  if (error) throw error;
}

export async function semanticSearch(userId: string, projectId: string, queryEmbedding: number[], count = 7) {
  const db = supabase();
  if (!db) return [] as Memory[];
  const { data, error } = await db.rpc("match_memories", { query_embedding: queryEmbedding, match_threshold: 0.22, match_count: count, p_user_id: userId, p_project_id: projectId });
  if (error) throw error;
  return (data ?? []) as Memory[];
}

export function storageMode() { return supabase() ? "pgvector" : "local-fallback"; }
