import { NextRequest, NextResponse } from "next/server";
import { ingestMemory } from "../../../lib/memory-engine";
import { listMemories, storageMode } from "../../../lib/store";

const userId = () => process.env.ECHO_DEMO_USER_ID || "demo-user-01";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId") || process.env.ECHO_DEMO_PROJECT_ID || "echo-demo";
    const memories = await listMemories(userId(), projectId);
    return NextResponse.json({ memories, storage: storageMode() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Memory service failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projectId = body.projectId || process.env.ECHO_DEMO_PROJECT_ID || "echo-demo";
    if (!body.content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });
    const result = await ingestMemory(userId(), projectId, body.content.trim(), body.reason?.trim() || "", body.alternatives?.trim() || "");
    return NextResponse.json({ createdMemory: result.memory, event: result.event, memories: result.memories, storage: storageMode() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Memory write failed." }, { status: 500 });
  }
}
