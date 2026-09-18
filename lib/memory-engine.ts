import { randomUUID } from "node:crypto";
import { analyzeMessage, embedText, type GeminiDecision } from "./gemini";
import { listMemories, saveMemory } from "./store";
import type { Memory, MemoryType } from "./types";

const GREETING = /^(hi|hey|hello|hiya|yo|sup|good morning|good afternoon|good evening|good night|thanks|thank you|thx|ty|ok|okay|cool|nice|lol|haha)[!.?\s]*$/i;
const QUESTION = /\?\s*$|^(what|when|where|who|why|how|can|could|would|should|do|does|did|is|are|am|will|have|has|tell me|remember)\b/i;

export function isQuestion(content: string) {
  const text = content.trim();
  return QUESTION.test(text);
}

export function isMemoryWorthy(content: string) {
  const text = content.trim();
  if (!text || GREETING.test(text) || isQuestion(text)) return false;
  return /\b(i|i'm|i am|my|me|we|our|ours|team|tomorrow|today|yesterday|next|prefer|like|love|hate|need|want|have|using|use|switched|changed|decided|deadline|exam|ctf|meeting|appointment|birthday|project|name|called)\b/i.test(text)
    || /\b[A-Z][a-z]+\s+(is|was|likes?|loves?|hates?|needs?|uses?|has)\b/.test(text)
    || text.split(/\s+/).length >= 4;
}

function localAnalysis(content: string): GeminiDecision {
  const text = content.trim();
  const lower = text.toLowerCase();
  const temporary = /\b(just testing|testing|for the next|temporary|experiment|for now)\b/.test(lower);
  const type: MemoryType = temporary ? "temporary" : /\b(prefer|like|love|hate|favorite|favourite)\b/.test(lower) ? "preference" : /\b(decided|decision|switched|changed|using|use)\b/.test(lower) ? "decision" : "fact";
  let topic = "general";
  let subject = "user";
  const nameMatch = text.match(/\b(?:my name is|i am|i'm|i\s+am|call me)\s+([A-Z][a-z]{1,30})\b/i);
  if (nameMatch) topic = "identity";
  else if (/\b(exam|quiz|test|physics|ctf|deadline|meeting|appointment|tomorrow|today|yesterday|friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b/.test(lower)) topic = "schedule";
  else if (/\b(database|postgres|postgresql|mongo|mongodb|sql|supabase)\b/.test(lower)) topic = "database";
  else if (/\b(react|vue|angular|frontend|backend|python|java|framework)\b/.test(lower)) topic = "technology";
  else if (/\b(project|team|hackathon|presentation)\b/.test(lower)) topic = "project";
  else if (type === "preference") topic = "preference";
  const personMatch = text.match(/^\s*([A-Z][a-z]{1,30})\s+(?:is|was|likes?|loves?|hates?|needs?|uses?|has)\b/i);
  if (personMatch && !/^i\b/i.test(text)) { subject = personMatch[1]; topic = "people"; }
  const value = nameMatch ? nameMatch[1] : text;
  const changeIntent = /\b(no longer|not anymore|not using|stop using|forget that|instead|switched|changed|actually|replace)\b/.test(lower) ? "update" : temporary ? "temporary" : "create";
  return { kind: "memory", type, topic, subject, value, normalizedStatement: text, changeIntent, confidence: .75, importance: temporary ? .25 : .65, ttlHours: temporary ? 24 : 0 };
}

async function classify(content: string): Promise<GeminiDecision> {
  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await analyzeMessage(content);
      if (result) return result;
    } catch { /* local fallback keeps chat alive */ }
  }
  return localAnalysis(content);
}

function sameSubject(a: Memory, b: GeminiDecision) {
  const subject = (b.subject || "user").toLowerCase().trim();
  if (subject === "user" || subject === "") return true;
  const hay = `${a.content} ${a.topic || ""} ${a.value || ""} ${a.subject || ""}`.toLowerCase();
  return hay.includes(subject);
}

function sameTopicOrEntity(a: Memory, b: GeminiDecision) {
  if (a.topic && b.topic && a.topic === b.topic) return true;
  return sameSubject(a, b);
}

export async function ingestMemory(userId: string, projectId: string, content: string, reason = "", alternatives = "") {
  const createdAt = new Date().toISOString();
  const analysis = await classify(content);
  if (analysis.kind !== "memory") return { memory: undefined, event: undefined, memories: await listMemories(userId, projectId) };

  const existing = await listMemories(userId, projectId);
  const relevant = existing.filter(m => m.status === "ACTIVE" && sameTopicOrEntity(m, analysis));
  const normalized = analysis.normalizedStatement || content.trim();
  const invalidates = analysis.changeIntent === "invalidate" || /\b(no longer|not anymore|not using|stop using|forget that)\b/i.test(content);
  const explicitUpdate = analysis.changeIntent === "update" || /\b(instead|switched|changed to|replace|actually)\b/i.test(content);
  const supersede = (explicitUpdate || relevant.some(m => m.value && analysis.value && m.value.toLowerCase() !== analysis.value.toLowerCase()))
    ? relevant.filter(m => m.content.toLowerCase() !== normalized.toLowerCase()) : [];
  const oldIds = analysis.type === "temporary" ? [] : (invalidates ? relevant.map(m => m.id) : supersede.map(m => m.id));
  const ttl = analysis.ttlHours > 0 ? new Date(Date.now() + analysis.ttlHours * 3600000).toISOString() : undefined;
  let embedding: number[] | undefined;
  if (process.env.GEMINI_API_KEY) {
    try { embedding = (await embedText(`${analysis.normalizedStatement} ${analysis.topic} ${analysis.subject || ""}`)) || undefined; } catch { /* semantic search is an enhancement; lexical retrieval remains available */ }
  }
  const memory: Memory = {
    id: `mem-${randomUUID().slice(0,8)}`,
    user_id: userId,
    project_id: projectId,
    type: analysis.type,
    content: normalized,
    topic: analysis.topic,
    subject: analysis.subject,
    value: analysis.value,
    reason,
    status: "ACTIVE",
    confidence: Math.max(0, Math.min(1, analysis.confidence)),
    importance: Math.max(0, Math.min(1, analysis.importance)),
    created_at: createdAt,
    valid_from: createdAt,
    valid_until: ttl,
    supersedes_id: oldIds[0],
    contradiction_group: relevant[0]?.contradiction_group || `cg-${analysis.topic}-${analysis.subject || "user"}`,
    change_reason: oldIds.length ? `Updated the previous ${analysis.topic} memory.` : alternatives ? `Alternatives considered: ${alternatives}` : undefined,
    embedding,
  };
  const replacementStatus = invalidates ? "INVALIDATED" as const : "SUPERSEDED" as const;
  const event = {
    id: `evt-${randomUUID().slice(0,8)}`,
    memory_id: memory.id,
    kind: oldIds.length ? "SUPERSESSION" : "CREATE",
    message: oldIds.length ? `${oldIds.join(", ")} ${replacementStatus.toLowerCase()} by ${memory.id}.` : `New memory promoted to ACTIVE: ${memory.id}.`,
    created_at: createdAt,
    metadata: { topic: analysis.topic, subject: analysis.subject, value: analysis.value, oldIds },
  };
  await saveMemory(memory, event, oldIds, replacementStatus);
  return { memory, event, memories: await listMemories(userId, projectId) };
}
