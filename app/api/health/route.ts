import { NextResponse } from "next/server";
import { storageMode } from "../../../lib/store";
import { getGeminiKey, getGeminiModel } from "../../../lib/gemini";

export async function GET() {
  return NextResponse.json({
    ok: true,
    storage: storageMode(),
    modelConfigured: Boolean(getGeminiKey()),
    model: getGeminiModel(),
  });
}
