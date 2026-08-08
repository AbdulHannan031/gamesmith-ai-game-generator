import OpenAI from "openai";

/**
 * One shared client. Lives in its own module so both the agent loop and the
 * sprite generator can reach it without importing each other.
 */
let client: OpenAI | null = null;

export function openai(): OpenAI {
  const key = process.env.OPENAI_API_KEY || process.env.openai_api;
  if (!key) {
    throw new Error("No OpenAI API key configured. Add OPENAI_API_KEY to .env and restart the server.");
  }
  client ??= new OpenAI({ apiKey: key });
  return client;
}
