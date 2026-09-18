import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const modelName = () => process.env.ECHO_MODEL || "gpt-5-mini";
export const embeddingModel = () => process.env.ECHO_EMBEDDING_MODEL || "text-embedding-3-small";
