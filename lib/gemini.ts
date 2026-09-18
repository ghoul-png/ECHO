import type { Memory } from "./types";

export type GeminiDecision = {
  kind: "chat" | "question" | "memory";
  type: "fact" | "preference" | "decision" | "constraint" | "temporary";
  topic: string;
  subject: string;
  value: string;
  normalizedStatement: string;
  changeIntent: "create" | "update" | "invalidate" | "temporary" | "unknown";
  confidence: number;
  importance: number;
  ttlHours: number;
};

export function getGeminiKey() { return process.env.GEMINI_API_KEY?.trim() || ""; }
export function getGeminiModel() { return process.env.GEMINI_MODEL || "gemini-2.5-flash"; }

async function callGemini(system: string, user: string, json = false) {
  const key = getGeminiKey();
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getGeminiModel())}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: json ? { temperature: 0.15, responseMimeType: "application/json" } : { temperature: 0.7 },
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Gemini API ${response.status}`);
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || null;
}

const ANALYSIS_SCHEMA = `Return ONLY valid JSON with these fields:
{"kind":"chat|question|memory","type":"fact|preference|decision|constraint|temporary","topic":"short stable topic","subject":"person or entity the fact is about","value":"current fact/value","normalizedStatement":"one concise statement preserving the user's meaning","changeIntent":"create|update|invalidate|temporary|unknown","confidence":0.0,"importance":0.0,"ttlHours":0}`;


export async function embedText(text: string): Promise<number[] | null> {
  const key = getGeminiKey();
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      outputDimensionality: 1536,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Gemini embedding API ${response.status}`);
  const data = await response.json();
  return data?.embedding?.values ?? null;
}

export async function analyzeMessage(text: string): Promise<GeminiDecision | null> {
  const raw = await callGemini(
    `You are ECHO's memory router. ECHO is a normal conversational assistant with persistent long-term memory.

Classify the user's message:
- chat = greeting, small talk, casual conversation, acknowledgement, or a message with no useful personal/project information.
- question = the user is asking for information or asking ECHO to recall something. Questions MUST NEVER become memories.
- memory = a useful fact, identity detail, relationship/person fact, preference, plan, date, deadline, event, project fact, decision, constraint, or other durable information that could improve a future conversation.

IMPORTANT:
1. "Hi, I am Hriday", "My name is Hriday", and similar introductions are MEMORY because the name is useful later. Do not classify them as chat merely because they start with a greeting.
2. A statement about another person is also a memory when useful, e.g. "Amogh is a good boy".
3. Never store a question such as "Who is Amogh?", "When is my physics exam?", or "Who am I?".
4. Do not invent information that is not in the user's message.
5. Detect changes/corrections such as "actually", "we switched", "instead", "no longer", "not anymore", "changed to" and mark them update/invalidate when appropriate.
6. Temporary statements such as "I'm testing this for 20 minutes" should be temporary and receive a finite ttlHours.
7. For identity facts, use topic "identity". For facts about a named person, use the person's name as subject and topic "people" when appropriate.
8. Preserve relative time words such as tomorrow/today exactly; do not invent a calendar date.

${ANALYSIS_SCHEMA}`,
    text,
    true,
  );
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned) as Partial<GeminiDecision>;
  return {
    kind: parsed.kind || "chat",
    type: parsed.type || "fact",
    topic: parsed.topic || "general",
    subject: parsed.subject || "user",
    value: parsed.value || parsed.normalizedStatement || text,
    normalizedStatement: parsed.normalizedStatement || text,
    changeIntent: parsed.changeIntent || "unknown",
    confidence: Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : 0.8,
    importance: Number.isFinite(parsed.importance) ? Number(parsed.importance) : 0.6,
    ttlHours: Number.isFinite(parsed.ttlHours) ? Number(parsed.ttlHours) : 0,
  };
}

export async function answerWithGemini(query: string, sources: Memory[], allRelevant: Memory[] = []) {
  const context = sources.map(m => `[${m.id}] ${m.status}; topic=${m.topic}; subject=${m.subject || ""}; value=${m.value}; content=${m.content}; reason=${m.reason || ""}; created=${m.created_at}; valid_until=${m.valid_until || "open"}`).join("\n");
  const history = allRelevant.map(m => `[${m.id}] ${m.status}; ${m.content}`).join("\n");
  const raw = await callGemini(
    `You are ECHO, a warm, natural conversational assistant with persistent memory.

Speak like a person, not a database. Never say "memory stored", "vector database", "Supabase", "memory ID", "retrieval", or similar implementation details in the conversational answer. The interface can show technical memory evidence separately.

Use supplied memory only when relevant. ACTIVE memories represent current information. SUPERSEDED and INVALIDATED memories are historical and should not be treated as current truth.

For identity questions such as "Who am I?", use ONLY memories whose topic is identity (or an explicit name statement). Do not infer identity from unrelated first-person memories such as mood, plans, or preferences.
For people questions, use relevant people memories. For dates/events, use the relevant active schedule/event memory. Preserve relative time accurately: if the memory says "next week", answer "next week" unless an exact date is actually stored.

When a user tells you something new, respond to the person first. For example, if they say they have an exam next week, be warm and useful ("Got it — good luck with your exam!") rather than merely repeating their sentence. The memory is handled silently in the background. Do not expose storage mechanics.

When answering from memory, answer the user's actual question directly. Do not begin with "I remember you mentioned...", "You said...", or "According to memory..." unless the user explicitly asks what you remember. If the answer is known, state it naturally and confidently. If several memories answer the question, combine them clearly without dumping raw memory records. If the user tells you something new, acknowledge it naturally rather than repeating it word-for-word. For example, "I have a chemistry exam next week" should get something like "Got it — I'll keep your chemistry exam next week in mind." For "what will I be doing tonight?" and a memory saying the user will play GTA tonight, answer "You're planning to play GTA tonight." Normal conversation matters: greetings should get a friendly greeting, not a memory lecture. Keep responses concise, human, and useful. Never invent a fact.`,
    `USER MESSAGE:\n${query}\n\nRELEVANT MEMORY:\n${context || "(none)"}\n\nADDITIONAL ACTIVE MEMORY CONTEXT:\n${history || "(none)"}`,
    false,
  );
  return raw ? raw.trim() : null;
}
