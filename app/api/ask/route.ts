import { NextRequest, NextResponse } from "next/server";
import { analyzeMessage, answerWithGemini, embedText, getGeminiKey } from "../../../lib/gemini";
import { ingestMemory, isMemoryWorthy, isQuestion } from "../../../lib/memory-engine";
import { listMemories, semanticSearch, storageMode } from "../../../lib/store";
import type { Memory } from "../../../lib/types";

const userId = () => process.env.ECHO_DEMO_USER_ID || "demo-user-01";
const projectIdOf = (body: Record<string, unknown>) =>
  String(body.projectId || process.env.ECHO_DEMO_PROJECT_ID || "echo-demo");

const GREETING = /^(hi|hey|hello|hiya|yo|sup|good morning|good afternoon|good evening|good night)[!.?\s]*$/i;
const THANKS = /^(thanks|thank you|thx|ty)[!.?\s]*$/i;
const BROAD = /what do you remember|what do you know|tell me what you remember|remember about me|what'?s my name|what is my name|who am i\b/i;
const IDENTITY_QUESTION = /who am i\b|what'?s my name|what is my name/i;
const STRONG_NAME_INTRO = /\b(?:my name is|call me)\s+([A-Za-z][a-z]{1,30})\b/i;
const I_AM_NAME_INTRO = /^(?:(?:hi|hey|hello)[,!?.\s]+)?(?:i am|i'm)\s+([A-Z][a-z]{1,30})[.!?]?\s*$/i;
const PERSON_STATEMENT = /^\s*(?!(?:today|tomorrow|yesterday|next|this|last|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)([A-Z][a-z]{1,30})\s+(?:is|was|likes?|loves?|hates?|needs?|uses?|has)\b/i;
const PERSON_QUESTION = /^\s*who\s+is\s+([A-Za-z][a-z]{1,30})\s*\??\s*$/i;
const SCHEDULE_QUESTION = /\b(?:when|what)\b.*\b(?:exam|exams|quiz|quizzes|test|tests|deadline|deadlines|meeting|meetings|appointment|appointments|ctf|presentation|interview|event|events)\b|\b(?:exam|exams|quiz|quizzes|test|tests|deadline|deadlines|meeting|meetings|appointment|appointments|ctf|presentation|interview|event|events)\b.*\b(?:when|what|tomorrow|today|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const ACTIVITY_QUESTION = /\b(?:what|where|when|which)\b.*\b(?:doing|play|playing|watch|watching|work|working|going|tonight|today|tomorrow)\b/i;

const STOP = new Set(
  "the a an is are am was were be been being i me my mine we our ours you your yours what when where who why how do does did will can could would should please tell about and or to of in on for with this that it remember what's who".split(" ")
);

function introducedName(query: string) {
  return query.match(STRONG_NAME_INTRO)?.[1] || query.match(I_AM_NAME_INTRO)?.[1] || null;
}

function displayName(name: string) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

function tokens(q: string) {
  return q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t));
}

function isActive(m: Memory) {
  return m.status === "ACTIVE";
}

function isRecallQuestionMemory(m: Memory) {
  return /^(?:what|when|where|who|why|how|can|could|would|should|do|does|did|is|are|am|will|have|has|tell me|remember)\b/i.test(m.content.trim()) || /\?\s*$/.test(m.content.trim());
}

function cleanLegacyMemory(m: Memory): Memory {
  if (!m || isRecallQuestionMemory(m)) return m;
  if (m.topic === "schedule" || /\b(exam|quiz|test|deadline|meeting|appointment|ctf|presentation|interview)\b/i.test(m.content)) {
    const c = m.content.replace(/[.!?]+$/, "").trim();
    const kindMatch = c.match(/\b(exam|quiz|test|deadline|meeting|appointment|ctf|presentation|interview)\b/i);
    const timeMatch = c.match(/\b(tomorrow|tmrw|today|tonight|next week|this week|next month|this month|yesterday|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i);
    if (kindMatch) {
      const kind = kindMatch[1].toLowerCase();
      let before = c.slice(0, kindMatch.index ?? 0).trim();
      before = before
        .replace(/^\s*(?:i|i'm|i am|we|we're|we are|there is|there's)\s+/i, "")
        .replace(/^\s*(?:have|got|gotta|need|need to|will be|going to|attending)\s+/i, "")
        .replace(/^\s*(?:my|the|a|an)\s+/i, "")
        .replace(/^\s*(?:today|tomorrow|tmrw|yesterday|tonight|next week|this week|last week|next month|this month|last month)\s+(?:is|are|was|were)?\s*/i, "")
        .replace(/\b(?:today|tomorrow|tmrw|yesterday|tonight|next week|this week|last week|next month|this month|last month)\b/ig, "")
        .trim();
      const subject = (before ? `${before} ${kind}` : kind)
        .replace(/\b(?:is|my|the|a|an)\b/ig, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, x => x.toUpperCase());
      const rawTime = timeMatch?.[1]?.toLowerCase() || m.value || "unspecified";
      return { ...m, topic: "schedule", subject: subject || kind.charAt(0).toUpperCase() + kind.slice(1), value: rawTime === "tmrw" ? "tomorrow" : rawTime };
    }
  }
  return m;
}

function canonicalizeMemories(input: Memory[]) {
  const cleaned = input.map(cleanLegacyMemory).filter(m => !isRecallQuestionMemory(m));
  const result: Memory[] = [];
  const seen = new Map<string, Memory>();
  for (const memory of cleaned) {
    if (memory.status !== "ACTIVE") { result.push(memory); continue; }
    let key: string | null = null;
    if (memory.topic === "schedule") {
      key = `schedule|${(memory.subject || "").toLowerCase().replace(/\b(exam|quiz|test|deadline|meeting|appointment|ctf|presentation|interview)\b/g, "").replace(/\s+/g, " ").trim()}|${(memory.subject || "").toLowerCase().match(/\b(exam|quiz|test|deadline|meeting|appointment|ctf|presentation|interview)\b/)?.[1] || "event"}`;
    } else if (memory.topic === "people") {
      key = `people|${(memory.subject || "").toLowerCase()}`;
    } else if (memory.topic === "identity") {
      key = "identity";
    }
    if (!key) { result.push(memory); continue; }
    const previous = seen.get(key);
    if (!previous || +new Date(memory.created_at) > +new Date(previous.created_at)) {
      if (previous) {
        const index = result.findIndex(x => x.id === previous.id);
        if (index >= 0) result.splice(index, 1);
      }
      seen.set(key, memory);
      result.push(memory);
    }
  }
  return result;
}
function scheduleQueryTokens(query: string) {
  return tokens(query).filter(t =>
    !["exam", "exams", "quiz", "quizzes", "test", "tests", "deadline", "deadlines",
      "meeting", "meetings", "appointment", "appointments", "ctf", "presentation",
      "interview", "event", "events"].includes(t)
  );
}

function scheduleRank(query: string, memory: Memory) {
  const q = query.toLowerCase();
  const hay = `${memory.subject || ""} ${memory.content} ${memory.value || ""}`.toLowerCase();
  const qt = scheduleQueryTokens(query);
  const genericOnly = qt.length === 0;
  let score = 0;

  if (genericOnly) score += 10;
  for (const token of qt) {
    if (hay.includes(token)) score += token.length >= 5 ? 8 : 3;
  }

  if (/\btoday\b/.test(q) && /\btoday\b/.test(hay)) score += 20;
  if (/\btomorrow\b/.test(q) && /\btomorrow\b/.test(hay)) score += 20;
  if (/\bnext week\b/.test(q) && /\bnext week\b/.test(hay)) score += 20;
  if (memory.topic === "schedule") score += 10;

  return score;
}

function scheduleSources(all: Memory[], query: string) {
  const candidates = all.filter(m => isActive(m) && m.topic === "schedule");
  const qt = scheduleQueryTokens(query);
  const nextOnly = /\bnext\b/i.test(query) && /\b(?:exam|quiz|test|deadline|event)\b/i.test(query);
  return candidates
    .map(m => ({ m, score: scheduleRank(query, m) }))
    .sort((a, b) => b.score - a.score || scheduleTimeRank(a.m.value) - scheduleTimeRank(b.m.value) || +new Date(a.m.created_at) - +new Date(b.m.created_at))
    .filter(x => x.score > 0 || qt.length === 0)
    .slice(0, nextOnly ? 1 : 20)
    .map(x => x.m);
}
function activitySources(all: Memory[], query: string) {
  const q = query.toLowerCase();
  const wantsTonight = /\btonight\b/.test(q);
  const wantsToday = /\btoday\b/.test(q);
  const wantsTomorrow = /\btomorrow|tmrw\b/.test(q);
  return all.filter(m => m.status === "ACTIVE").map(m => {
    const hay = `${m.content} ${m.value || ""}`.toLowerCase();
    let score = 0;
    if (/\b(play|playing|watch|watching|work|working|going|doing|game|gaming|study|studying|eat|eating)\b/i.test(m.content)) score += 8;
    if (wantsTonight && /\btonight\b/.test(hay)) score += 20;
    if (wantsToday && /\btoday\b/.test(hay)) score += 20;
    if (wantsTomorrow && /\b(?:tomorrow|tmrw)\b/.test(hay)) score += 20;
    return { m, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || +new Date(b.m.created_at)-+new Date(a.m.created_at)).slice(0,8).map(x=>x.m);
}

function activityAnswer(query: string, sources: Memory[]) {
  const q = query.toLowerCase();
  const m = sources.find(x => /\b(play|playing|watch|watching|work|working|going|doing|game|gaming|study|studying|eat|eating)\b/i.test(x.content));
  if (!m) return null;
  const content = m.content.replace(/[.!?]+$/, "");
  const play = content.match(/\b(?:i(?:'ll| will| am going to|m going to)\s+)?(?:be\s+)?playing\s+(.+?)(?:\s+(?:tonight|today|tomorrow)|$)/i);
  if (play?.[1]) return `You're planning to play ${play[1].trim()}${/tonight/i.test(content) ? " tonight" : ""}.`;
  return content.charAt(0).toUpperCase() + content.slice(1) + ".";
}

function scheduleTimeRank(value = "") {
  const v = value.toLowerCase();
  if (v.includes("today")) return 1;
  if (v.includes("tomorrow")) return 2;
  if (v.includes("yesterday")) return 8;
  if (v.includes("this week")) return 3;
  if (v.includes("monday") || v.includes("tuesday") || v.includes("wednesday") ||
      v.includes("thursday") || v.includes("friday") || v.includes("saturday") || v.includes("sunday")) return 4;
  if (v.includes("next week")) return 5;
  if (v.includes("this month")) return 6;
  if (v.includes("next month")) return 7;
  return 9;
}

function scheduleLabel(memory: Memory) {
  const subject = (memory.subject || "").trim();
  const value = (memory.value || "").trim();

  if (subject && value && value !== "unspecified") {
    return `${subject} — ${value}`;
  }
  return memory.content.replace(/[.!?]+$/, "");
}

function localAnswer(query: string, sources: Memory[]) {
  const q = query.trim();

  const introName = introducedName(q);
  if (introName) return `Nice to meet you, ${displayName(introName)}! What are you working on?`;

  const namedStatement = !isQuestion(q) ? q.match(PERSON_STATEMENT) : null;
  if (namedStatement) {
    return `Oh, I see 😄 What makes you say that about ${displayName(namedStatement[1])}?`;
  }

  if (GREETING.test(q)) return "Hey! I'm ECHO. What's up?";
  if (THANKS.test(q)) return "Anytime.";

  if (IDENTITY_QUESTION.test(q) && sources.length) {
    const identity = sources.find(m => m.topic === "identity");
    const name = identity?.value;
    if (name) return `You're ${name}.`;
  }

  if (SCHEDULE_QUESTION.test(q)) {
    const schedules = sources
      .filter(m => m.topic === "schedule" && m.status === "ACTIVE")
      .sort((a, b) =>
        scheduleTimeRank(a.value) - scheduleTimeRank(b.value) ||
        +new Date(a.created_at) - +new Date(b.created_at)
      );

    const specific = scheduleQueryTokens(q).length > 0;
    const nextOnly = /\bnext\b/i.test(q) && /\b(?:exam|quiz|test|deadline|event)\b/i.test(q);
    if (nextOnly && schedules.length) {
      const [subject, time] = scheduleLabel(schedules[0]).split(" — ");
      return time ? `Your next ${subject.toLowerCase()} is ${time}.` : `Your next ${subject.toLowerCase()} is coming up.`;
    }

    if (!schedules.length) {
      return "I don't have any upcoming exams, deadlines, or events stored yet.";
    }

    const labels = schedules.map(scheduleLabel);
    if (labels.length === 1) {
      const [subject, time] = labels[0].split(" — ");
      if (time) return `Your ${subject} is ${time}.`;
      return `${subject}.`;
    }

    const human = labels.map(label => {
      const [subject, time] = label.split(" — ");
      return time ? `${subject} ${time}` : subject;
    });

    if (human.length === 2) return `You have ${human[0].toLowerCase()} and ${human[1].toLowerCase()}.`;
    return `You have ${human.slice(0, -1).map(x => x.toLowerCase()).join(", ")}, and ${human.at(-1)?.toLowerCase()}.`;
  }

  const personQuestion = q.match(PERSON_QUESTION);
  if (personQuestion) {
    const person = personQuestion[1].toLowerCase();
    const personMemories = sources
      .filter(m => m.status === "ACTIVE" &&
        ((m.subject || "").toLowerCase() === person ||
          new RegExp(`\\b${person}\\b`, "i").test(m.content)))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

    if (personMemories.length) {
      return personMemories[0].content.replace(/[.]$/, "") + ".";
    }

    return `I don't have anything about ${displayName(person)} yet.`;
  }

  if (ACTIVITY_QUESTION.test(q)) {
    const activity = activityAnswer(q, sources);
    if (activity) return activity;
  }

  if (BROAD.test(q)) {
    if (!sources.length) return "I don't know much about you yet. Keep talking to me.";
    return `I remember that ${sources.slice(0, 8).map(m => m.content.replace(/[.]$/, "")).join("; ")}.`;
  }

  if (sources.length) {
    const memory = sources[0];
    if (memory.content) {
      if (/\bplaying\b/i.test(q) && /\bplaying\b/i.test(memory.content)) {
        const match = memory.content.match(/\bplaying\s+(.+?)(?:\s+tonight|\s+today|\s+tomorrow|[.!?]|$)/i);
        if (match?.[1]) return `You said you'll be playing ${match[1].trim()}${/tonight/i.test(memory.content) ? " tonight" : ""}.`;
      }
      return `I remember you mentioned that ${memory.content.replace(/[.!?]+$/, "")}.`;
    }
  }
  return "I'm listening. Tell me more.";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const query = String(body.query || "").trim();
    const projectId = projectIdOf(body);

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    let memoryWrite: { createdMemory?: Memory; event?: unknown } = {};
    const forcedMemory = !isQuestion(query) && (!!introducedName(query) || PERSON_STATEMENT.test(query));

    let kind: "chat" | "question" | "memory" =
      isQuestion(query) ? "question" : (isMemoryWorthy(query) ? "memory" : "chat");

    if (getGeminiKey()) {
      try {
        const analysis = await analyzeMessage(query);
        if (analysis) {
          // Every meaningful non-question statement is eligible for long-term memory.
          // The model can refine the type/topic, but must not silently discard a useful statement.
          if (analysis.kind === "memory" || (analysis.kind === "chat" && isMemoryWorthy(query))) kind = "memory";
          else if (isQuestion(query)) kind = "question";
        }
      } catch {
        // Local classification remains authoritative when Gemini fails.
      }
    }

    if (forcedMemory || (!isQuestion(query) && isMemoryWorthy(query) && !GREETING.test(query) && !THANKS.test(query))) kind = "memory";

    // Questions are never persisted. Only memory turns enter the memory engine.
    if (kind === "memory") {
      try {
        const result = await ingestMemory(userId(), projectId, query);
        if (result.memory) {
          memoryWrite = { createdMemory: result.memory, event: result.event };
        }
      } catch {
        // Conversation should still work if persistence temporarily fails.
      }
    }

    const all = canonicalizeMemories(await listMemories(userId(), projectId));

    // Schedule questions use structured retrieval, not vector similarity.
    // This is both more accurate and cheaper at scale.
    const structured = SCHEDULE_QUESTION.test(query) ? scheduleSources(all, query) : [];

    let semantic: Memory[] = [];
    if (!SCHEDULE_QUESTION.test(query) && getGeminiKey()) {
      try {
        const embedding = await embedText(query);
        if (embedding) {
          semantic = await semanticSearch(userId(), projectId, embedding, 8);
        }
      } catch {
        // Lexical retrieval below remains the fallback.
      }
    }

    const lexical = localSources(all, query);
    const activity = ACTIVITY_QUESTION.test(query) ? activitySources(all, query) : [];
    const seen = new Set<string>();
    const sourcePool = IDENTITY_QUESTION.test(query)
      ? lexical
      : SCHEDULE_QUESTION.test(query)
        ? [...structured, ...lexical, ...semantic]
        : [...activity, ...lexical, ...semantic];

    const sources = sourcePool
      .filter(m => !seen.has(m.id) && seen.add(m.id))
      .slice(0, 12);

    // Schedule, identity and direct people questions have deterministic
    // retrieval/answering so a generative model cannot hallucinate or miss
    // an obvious structured memory.
    if (SCHEDULE_QUESTION.test(query) || IDENTITY_QUESTION.test(query) || PERSON_QUESTION.test(query)) {
      return NextResponse.json({
        answer: localAnswer(query, sources),
        sources,
        memories: all,
        storage: storageMode(),
        mode: "structured-memory",
        memoryWrite
      });
    }

    const broadContext = BROAD.test(query)
      ? all.filter(m => m.status === "ACTIVE")
          .sort((a, b) =>
            (b.importance || 0) - (a.importance || 0) ||
            +new Date(b.created_at) - +new Date(a.created_at)
          )
          .slice(0, 20)
      : sources;

    // Natural conversation is generated only after memory retrieval.
    // The model is explicitly told to respond to the person, not echo the
    // sentence they just sent.
    if (getGeminiKey()) {
      try {
        const aiAnswer = await answerWithGemini(query, sources, broadContext);
        if (aiAnswer) {
          const words = (value: string): string[] =>
            value.toLowerCase().match(/[a-z0-9]+/g) || [];
          const inputWords = words(query);
          const answerWords = words(aiAnswer);
          const inputNorm = inputWords.join(" ");
          const answerNorm = answerWords.join(" ");
          const inputSet = new Set(inputWords);
          const shared = answerWords.filter((word, index) =>
            inputSet.has(word) && answerWords.indexOf(word) === index
          ).length;
          const coverage = inputSet.size ? shared / inputSet.size : 0;
          const wrapperOnly = coverage >= 0.9 && answerWords.length <= inputWords.length + 5;
          const isParrot =
            answerNorm === inputNorm ||
            (inputNorm.length >= 12 && answerNorm.includes(inputNorm)) ||
            wrapperOnly;

          if (!isParrot) {
            return NextResponse.json({
              answer: aiAnswer,
              sources,
              memories: all,
              storage: storageMode(),
              mode: "gemini",
              memoryWrite
            });
          }
        }
      } catch {
        // Local conversational fallback.
      }
    }

    return NextResponse.json({
      answer: localAnswer(query, sources),
      sources,
      memories: all,
      storage: storageMode(),
      mode: "local-memory-engine",
      memoryWrite
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "ECHO failed to answer."
    }, { status: 500 });
  }
}

function localSources(all: Memory[], query: string) {
  const q = query.toLowerCase();
  const ts = tokens(q);
  const broad = BROAD.test(q);
  const personMatch = query.trim().match(PERSON_QUESTION);
  const usable = all.filter(m =>
    m.status === "ACTIVE" || m.status === "SUPERSEDED" || m.status === "INVALIDATED"
  );

  if (personMatch) {
    const person = personMatch[1].toLowerCase();
    return usable
      .filter(m => m.status === "ACTIVE" && (
        (m.subject || "").toLowerCase() === person ||
        new RegExp(`\\b${person}\\b`, "i").test(m.content)
      ))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 8);
  }

  if (IDENTITY_QUESTION.test(q)) {
    return usable
      .filter(m => m.status === "ACTIVE" &&
        (m.topic === "identity" || /\b(my name is|i am|i'm|call me)\b/i.test(m.content)))
      .sort((a, b) =>
        (b.importance || 0) - (a.importance || 0) ||
        +new Date(b.created_at) - +new Date(a.created_at)
      )
      .slice(0, 4);
  }

  if (broad) {
    return usable
      .filter(m => m.status === "ACTIVE")
      .sort((a, b) =>
        (b.importance || 0) - (a.importance || 0) ||
        +new Date(b.created_at) - +new Date(a.created_at)
      )
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
    .sort((a, b) =>
      b.score - a.score ||
      (b.m.status === "ACTIVE" ? 1 : 0) - (a.m.status === "ACTIVE" ? 1 : 0) ||
      +new Date(b.m.created_at) - +new Date(a.m.created_at)
    )
    .slice(0, 8)
    .map(x => x.m);
}
