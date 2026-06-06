import 'dotenv/config';

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  ollamaUrl: optional('OLLAMA_URL', 'http://localhost:11434'),
  ollamaModel: optional('OLLAMA_MODEL', 'mistral'),
  maxTextChars: parseInt(optional('MAX_TEXT_CHARS', '24000'), 10),
} as const;
