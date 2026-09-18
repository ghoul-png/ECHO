import { randomUUID } from "node:crypto";
import { analyzeMessage, embedText, type GeminiDecision } from "./gemini";
import { listMemories, saveMemory } from "./store";
import type { Memory, MemoryType } from "./types";

const GREETING = /^(hi|hey|hello|hiya|yo|sup|good morning|good afternoon|good evening|good night|thanks|thank you|thx|ty|ok|okay|cool|nice|lol|haha)[!.?\s]*$/i;
const QUESTION = /\?\s*$|^(what|when|where|who|why|how|can|could|would|should|do|does|did|is|are|am|will|have|has|tell me|remember)\b/i;
const STRONG_NAME_INTRO = /\b(?:my name is|call me)\s+([A-Za-z][a-z]{1,30})\b/i;
const I_AM_NAME_INTRO = /^(?:(?:[Hh]i|[Hh]ey|[Hh]ello)[,!?.\s]+)?(?:[Ii] am|[Ii]'m)\s+([A-Z][a-z]{1,30})[.!?]?\s*$/;
const PERSON_FACT = /^\s*(?!(?:today|tomorrow|yesterday|next|this|last|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)([A-Z][a-z]{1,30})\s+(?:is|was|likes?|loves?|hates?|needs?|uses?|has)\b/i;

const SCHEDULE_STATEMENT = /\b(?:exam|exams|quiz|quizzes|test|tests|deadline|deadlines|meeting|meetings|appointment|appointments|ctf|presentation|interview)\b/i;
const TIME_EXPRESSION = /\b(?:today|tomorrow|tmrw|yesterday|tonight|next week|this week|last week|next month|this month|last month|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const SCHEDULE_QUESTION = /\b(?:when|what)\b.*\b(?:exam|exams|quiz|quizzes|test|tests|deadline|deadlines|meeting|meetings|appointment|appointments|ctf|presentation|interview)\b|\b(?:exam|exams|quiz|quizzes|test|tests|deadline|deadlines|meeting|meetings|appointment|appointments|ctf|presentation|interview)\b.*\b(?:when|what|tomorrow|today|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

function introducedName(content: string) {
  return content.match(STRONG_NAME_INTRO)?.[1] || content.match(I_AM_NAME_INTRO)?.[1] || null;
}

export function isQuestion(content: string) {
  const text = content.trim();
  return QUESTION.test(text);
}

export function isMemoryWorthy(content: string) {
  const text = content.trim();
  if (!text || GREETING.test(text) || isQuestion(text)) return false;
  return /\b(i|i'm|i am|my|me|we|our|ours|team|tomorrow|today|yesterday|next|prefer|like|love|hate|need|want|have|using|use|switched|changed|decided|deadline|exam|ctf|meeting|appointment|birthday|project|name|called)\b/i.test(text)
    || PERSON_FACT.test(text)
    || text.split(/\s+/).length >= 4;
}

function extractSchedule(text: string) {
  const clean = text.trim().replace(/[.!?]+$/, "");
  const kindMatch = clean.match(/\b(exam|quiz|test|deadline|meeting|appointment|ctf|presentation|interview)\b/i);
  const kind = kindMatch?.[1]?.toLowerCase() || "event";
  const timeMatch = clean.match(TIME_EXPRESSION);
  const rawTime = timeMatch?.[0]?.toLowerCase() || "";
  const time = rawTime === "tmrw" ? "tomorrow" : rawTime;

  let beforeKind = kindMatch ? clean.slice(0, kindMatch.index ?? 0).trim() : clean;
  let subject = beforeKind
    .replace(/^\s*(?:i|i'm|i am|we|we're|we are|there is|there's)\s+/i, "")
    .replace(/^\s*(?:have|got|gotta|need|need to|will be|going to|attending)\s+/i, "")
    .replace(/^\s*(?:my|the|a|an)\s+/i, "")
    .replace(/^\s*(?:today|tomorrow|tmrw|yesterday|tonight|next week|this week|last week|next month|this month|last month)\s+(?:is|are|was|were)?\s*/i, "")
    .replace(/\b(?:today|tomorrow|tmrw|yesterday|tonight|next week|this week|last week|next month|this month|last month)\b/ig, "")
    .replace(/\b(?:is|are|was|were)\s+(?:my|the|a|an)\s*$/i, "")
    .trim();

  subject = subject ? `${subject} ${kind}` : displayScheduleSubject(kind);
  subject = titleCase(subject.replace(/\s+/g, " ").trim());
  return { subject, time: time || "unspecified", kind };
}
function displayScheduleSubject(kind: string) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\s+/g, " ").trim();
}

function localAnalysis(content: string): GeminiDecision {
  const text = content.trim();
  const lower = text.toLowerCase();
  const temporary = /\b(just testing|testing|for the next|temporary|experiment|for now)\b/.test(lower);
  const schedule = !isQuestion(text) && SCHEDULE_STATEMENT.test(text);
  const scheduleInfo = schedule ? extractSchedule(text) : null;

  const type: MemoryType = temporary
    ? "temporary"
    : /\b(prefer|like|love|hate|favorite|favourite)\b/.test(lower)
      ? "preference"
      : /\b(decided|decision|switched|changed|using|use)\b/.test(lower)
        ? "decision"
        : "fact";

  let topic = "general";
  let subject = "user";

  const name = introducedName(text);
  if (name) topic = "identity";
  else if (schedule) {
    topic = "schedule";
    subject = scheduleInfo!.subject;
  } else if (/\b(database|postgres|postgresql|mongo|mongodb|sql|supabase)\b/.test(lower)) topic = "database";
  else if (/\b(react|vue|angular|frontend|backend|python|java|framework)\b/.test(lower)) topic = "technology";
  else if (/\b(project|team|hackathon|presentation)\b/.test(lower)) topic = "project";
  else if (type === "preference") topic = "preference";

  const personMatch = text.match(/^\s*([A-Z][a-z]{1,30})\s+(?:is|was|likes?|loves?|hates?|needs?|uses?|has)\b/i);
  if (personMatch && !/^i\b/i.test(text)) {
    subject = personMatch[1];
    topic = "people";
  }

  const value = name
    ? name.charAt(0).toUpperCase() + name.slice(1)
    : schedule
      ? scheduleInfo!.time
      : text;

  const changeIntent = /\b(no longer|not anymore|not using|stop using|forget that|instead|switched|changed|actually|replace|moved to|move to)\b/.test(lower)
    ? "update"
    : temporary
      ? "temporary"
      : "create";

  return {
    kind: "memory",
    type,
    topic,
    subject,
    value,
    normalizedStatement: text,
    changeIntent,
    confidence: .82,
    importance: schedule ? .9 : temporary ? .25 : .65,
    ttlHours: temporary ? 24 : 0
  };
}

async function classify(content: string): Promise<GeminiDecision> {
  const forcedMemory = !isQuestion(content) && (!!introducedName(content) || PERSON_FACT.test(content));

  // Deterministic schedule extraction runs first. This prevents a generative
  // classifier from turning "I have my PAT exam next week" into an unstructured
  // generic fact and gives retrieval a stable event key.
  if (!isQuestion(content) && SCHEDULE_STATEMENT.test(content)) {
    const base = localAnalysis(content);
    if (process.env.GEMINI_API_KEY) {
      try {
        const result = await analyzeMessage(content);
        if (result?.kind === "memory") {
          const local = extractSchedule(content);
          return {
            ...result,
            type: result.type || "fact",
            topic: "schedule",
            subject: local.subject,
            value: local.time,
            normalizedStatement: content.trim(),
            importance: Math.max(Number(result.importance) || 0, .9),
            confidence: Math.max(Number(result.confidence) || 0, .82),
            changeIntent: result.changeIntent === "unknown" ? base.changeIntent : result.changeIntent
          };
        }
      } catch { /* deterministic fallback below */ }
    }
    return base;
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await analyzeMessage(content);
      if (result && (!forcedMemory || result.kind === "memory")) return result;
    } catch { /* local fallback keeps chat alive */ }
  }
  return localAnalysis(content);
}

function sameSubject(a: Memory, b: GeminiDecision) {
  const left = (a.subject || "user").toLowerCase().trim();
  const right = (b.subject || "user").toLowerCase().trim();
  return left === right;
}

function scheduleSubjectsOverlap(a: Memory, b: GeminiDecision) {
  const left = (a.subject || "").toLowerCase().replace(/\b(my|the|a|an)\b/g, "").trim();
  const right = (b.subject || "").toLowerCase().replace(/\b(my|the|a|an)\b/g, "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const lt = new Set(left.split(/\s+/).filter(x => x.length > 2));
  const rt = new Set(right.split(/\s+/).filter(x => x.length > 2));
  return [...lt].some(t => rt.has(t));
}

function canonicalScheduleKey(subject = "") {
  return subject.toLowerCase()
    .replace(/\b(exam|quiz|test|deadline|meeting|appointment|ctf|presentation|interview)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameTopicOrEntity(a: Memory, b: GeminiDecision) {
  if (!a.topic || !b.topic || a.topic !== b.topic) return false;
  if (b.topic === "people") return sameSubject(a, b);
  if (b.topic === "schedule") return scheduleSubjectsOverlap(a, b);
  return true;
}

export async function ingestMemory(userId: string, projectId: string, content: string, reason = "", alternatives = "") {
  const createdAt = new Date().toISOString();
  const analysis = await classify(content);
  if (analysis.kind !== "memory") return { memory: undefined, event: undefined, memories: await listMemories(userId, projectId) };

  const existing = await listMemories(userId, projectId);
  const relevant = existing.filter(m => m.status === "ACTIVE" && sameTopicOrEntity(m, analysis));
  const normalized = analysis.normalizedStatement || content.trim();
  const duplicate = relevant.find(m => {
    if (m.content.trim().toLowerCase() === normalized.trim().toLowerCase()) return true;
    if (analysis.topic === "schedule" && m.topic === "schedule") {
      return canonicalScheduleKey(m.subject) === canonicalScheduleKey(analysis.subject) &&
        String(m.value || "").toLowerCase() === String(analysis.value || "").toLowerCase();
    }
    return false;
  });
  if (duplicate) return { memory: undefined, event: undefined, memories: existing };

  const invalidates = analysis.changeIntent === "invalidate" || /\b(no longer|not anymore|not using|stop using|forget that)\b/i.test(content);
  const explicitUpdate = analysis.changeIntent === "update" || /\b(instead|switched|changed to|replace|actually|moved to|move to)\b/i.test(content);

  // For schedules, a new time for the same event supersedes the old event.
  // It does NOT supersede unrelated exams/deadlines.
  const implicitIdentityChange = analysis.topic === "identity" &&
    relevant.some(m => m.value && analysis.value && m.value.toLowerCase() !== analysis.value.toLowerCase());

  const supersede = (explicitUpdate || implicitIdentityChange)
    ? relevant.filter(m => m.content.toLowerCase() !== normalized.toLowerCase())
    : [];

  const oldIds = analysis.type === "temporary"
    ? []
    : (invalidates ? relevant.map(m => m.id) : supersede.map(m => m.id));

  const ttl = analysis.ttlHours > 0
    ? new Date(Date.now() + analysis.ttlHours * 3600000).toISOString()
    : undefined;

  let embedding: number[] | undefined;
  if (process.env.GEMINI_API_KEY) {
    try {
      embedding = (await embedText(`${analysis.normalizedStatement} ${analysis.topic} ${analysis.subject || ""}`)) || undefined;
    } catch { /* semantic search is an enhancement; structured retrieval remains available */ }
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
    change_reason: oldIds.length
      ? `Updated the previous ${analysis.topic} memory.`
      : alternatives
        ? `Alternatives considered: ${alternatives}`
        : undefined,
    embedding,
  };

  const replacementStatus = invalidates ? "INVALIDATED" as const : "SUPERSEDED" as const;
  const event = {
    id: `evt-${randomUUID().slice(0,8)}`,
    memory_id: memory.id,
    kind: oldIds.length ? "SUPERSESSION" : "CREATE",
    message: oldIds.length
      ? `${oldIds.join(", ")} ${replacementStatus.toLowerCase()} by ${memory.id}.`
      : `New memory promoted to ACTIVE: ${memory.id}.`,
    created_at: createdAt,
    metadata: {
      topic: analysis.topic,
      subject: analysis.subject,
      value: analysis.value,
      oldIds
    },
  };

  await saveMemory(memory, event, oldIds, replacementStatus);
  return { memory, event, memories: await listMemories(userId, projectId) };
}
