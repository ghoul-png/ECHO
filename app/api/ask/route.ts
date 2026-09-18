import { NextRequest, NextResponse } from "next/server";
import { analyzeMessage, answerWithGemini, embedText, getGeminiKey } from "../../../lib/gemini";
import { ingestMemory, isMemoryWorthy, isQuestion } from "../../../lib/memory-engine";
import { listMemories, semanticSearch, storageMode } from "../../../lib/store";
import type { Memory } from "../../../lib/types";

const userId = () => process.env.ECHO_DEMO_USER_ID || "demo-user-01";
const projectIdOf = (body: Record<string, unknown>) => String(body.projectId || process.env.ECHO_DEMO_PROJECT_ID || "echo-demo");
const GREETING = /^(hi|hey|hello|hiya|yo|sup|good morning|good afternoon|good evening|good night)[!.?\s]*$/i;
const THANKS = /^(thanks|thank you|thx|ty)[!.?\s]*$/i;
const STOP = new Set("the a an is are am was were be been being i me my mine we our ours you your yours what when where who why how do does did will can could would should please tell about and or to of in on for with this that it remember my name what's who".split(" "));
const BROAD = /what do you remember|what do you know|tell me what you remember|remember about me|what's my name|what is my name|who am i\b/i;
const IDENTITY = /who am i\b|what'?s my name|what is my name|my name/i;

function tokens(q: string) {
  return q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t));
}

function localSources(all: Memory[], query: string) {
  const q = query.toLowerCase();
  const ts = tokens(q);
  const broad = BROAD.test(q);
  const identity = IDENTITY.test(q);
  const usable = all.filter(m => m.status === "ACTIVE" || m.status === "SUPERSEDED" || m.status === "INVALIDATED");

  if (identity) {
    const identityMemories = usable.filter(m => m.topic === "identity" || /\b(my name is|i am|i\'m|call me)\b/i.test(m.content));
    return (identityMemories.length ? identityMemories : usable.filter(m => m.subject === "user"))
      .sort((a,b) => (a.status === "ACTIVE" ? 1 : 0) - (b.status === "ACTIVE" ? 1 : 0) || (b.importance || 0) - (a.importance || 0) || +new Date(b.created_at)-+new Date(a.created_at))
      .slice(0, 4);
  }
  if (broad) {
    return usable
      .filter(m => m.status === "ACTIVE")
      .sort((a,b) => (b.importance || 0) - (a.importance || 0) || +new Date(b.created_at)-+new Date(a.created_at))
      .slice(0, 12);
  }

  if (!ts.length) return [];
  return usable
    .map(m => {
      const hay = `${m.content} ${m.topic || ""} ${m.subject || ""} ${m.value || ""} ${m.reason || ""}`.toLowerCase();
      let score = 0;
      for (const token of ts) {
        if (hay.includes(token)) score += token.length >= 5 ? 5 : 2;
        if ((m.value || "").toLowerCase() === token) score += 4;
      }
      if (m.status === "ACTIVE") score += 1;
      return { m, score };
    })
    .filter(x => x.score >= 5)
    .sort((a,b) => b.score-a.score || (b.m.status === "ACTIVE" ? 1 : 0) - (a.m.status === "ACTIVE" ? 1 : 0) || +new Date(b.m.created_at)-+new Date(a.m.created_at))
    .slice(0, 6)
    .map(x => x.m);
}

function localAnswer(query: string, sources: Memory[]) {
  const q = query.trim();
  if (GREETING.test(q)) return "Hey! I'm ECHO. What's up?";
  if (THANKS.test(q)) return "Anytime.";
  if (IDENTITY.test(q) && sources.length) {
    const name = sources.find(m => m.topic === "identity")?.value || sources.find(m => /\b(my name is|i am|i'm|call me)\b/i.test(m.content))?.value;
    if (name) return `You're ${name}.`;
  }
  if (BROAD.test(q)) {
    if (!sources.length) return "I don't know much about you yet. Keep talking to me.";
    return `I remember that ${sources.slice(0, 8).map(m => m.content.replace(/[.]$/, "")).join("; ")}.`;
  }
  if (!sources.length) return "I don't have that in my memory yet — but we can keep talking normally.";
  const current = sources.find(m => m.status === "ACTIVE") || sources[0];
  return current.content.endsWith(".") ? current.content : `${current.content}.`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const query = String(body.query || "").trim();
    const projectId = projectIdOf(body);
    if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });

    let memoryWrite: { createdMemory?: Memory; event?: unknown } = {};
    let kind: "chat" | "question" | "memory" = isQuestion(query) ? "question" : (isMemoryWorthy(query) ? "memory" : "chat");

    if (getGeminiKey()) {
      try {
        const analysis = await analyzeMessage(query);
        if (analysis) kind = analysis.kind;
      } catch { /* fallback below */ }
    }

    // A chat or question is NEVER persisted. Only a deliberate memory classification writes.
    if (kind === "memory") {
      try {
        const result = await ingestMemory(userId(), projectId, query);
        if (result.memory) memoryWrite = { createdMemory: result.memory, event: result.event };
      } catch { /* answer can still be produced */ }
    }

    const all = await listMemories(userId(), projectId);
    let semantic: Memory[] = [];
    if (getGeminiKey()) {
      try {
        const embedding = await embedText(query);
        if (embedding) semantic = await semanticSearch(userId(), projectId, embedding, 8);
      } catch { /* lexical retrieval below remains the fallback */ }
    }
    const lexical = localSources(all, query);
    const seen = new Set<string>();
    // Identity questions are intentionally strict: semantic similarity can surface
    // unrelated first-person facts (for example "I am very good"). Prefer the
    // explicit identity topic so ECHO answers "Who am I?" with the user's name.
    const sourcePool = IDENTITY.test(query) ? lexical : [...semantic, ...lexical];
    const sources = sourcePool.filter(m => !seen.has(m.id) && seen.add(m.id)).slice(0, 8);
    const broadContext = BROAD.test(query)
      ? all.filter(m => m.status === "ACTIVE").sort((a,b) => (b.importance || 0)-(a.importance || 0)).slice(0, 20)
      : sources;

    if (getGeminiKey()) {
      try {
        const aiAnswer = await answerWithGemini(query, sources, broadContext);
        if (aiAnswer) return NextResponse.json({ answer: aiAnswer, sources, storage: storageMode(), mode: "gemini", memoryWrite });
      } catch { /* local answer fallback */ }
    }

    return NextResponse.json({ answer: localAnswer(query, sources), sources, storage: storageMode(), mode: "local-memory-engine", memoryWrite });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ECHO failed to answer." }, { status: 500 });
  }
}
