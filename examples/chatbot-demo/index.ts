/**
 * Engrama — Chatbot with Persistent Memory
 *
 * This example shows how to build a chatbot that remembers
 * facts across conversations using the Engrama memory engine.
 *
 * Prerequisites:
 *   - Engrama server running on localhost:3000
 *     (run `docker compose up` from the repo root)
 *
 * Run:
 *   npm install axios
 *   npx tsx index.ts
 */

import axios from 'axios';
import * as readline from 'readline';

const ENGRAMA_URL = process.env.ENGRAMA_URL || 'http://localhost:3000';
const USER_ID     = 'demo-user-001';
const AGENT_ID    = 'chatbot-demo';

const client = axios.create({ baseURL: ENGRAMA_URL });

// ── Store a memory ────────────────────────────────────────
async function remember(content: string) {
  const res = await client.post('/api/remember', {
    userId:  USER_ID,
    agentId: AGENT_ID,
    content,
    source: 'user',
  });
  return res.data;
}

// ── Retrieve relevant memories ───────────────────────────
async function recall(query: string) {
  const res = await client.post('/api/recall', {
    userId:  USER_ID,
    agentId: AGENT_ID,
    query,
    limit: 5,
  });
  return res.data.memories || [];
}

// ── Build a context-aware prompt ─────────────────────────
async function buildPrompt(userMessage: string) {
  const res = await client.post('/api/assemble_prompt', {
    userId:       USER_ID,
    agentId:      AGENT_ID,
    currentInput: userMessage,
  });
  return res.data.prompt || userMessage;
}

// ── Simple REPL ──────────────────────────────────────────
async function main() {
  console.log('\n Engrama Chatbot Demo');
  console.log('═══════════════════════════════════════');
  console.log('Commands:');
  console.log('  /remember <text>  — store a memory manually');
  console.log('  /recall <query>   — search memories');
  console.log('  /prompt <text>    — build context-aware prompt');
  console.log('  /quit             — exit');
  console.log('  <anything else>   — chat naturally\n');

  // Verify the server is running
  try {
    await client.get('/health');
    console.log(' Connected to Engrama server at', ENGRAMA_URL);
  } catch {
    console.error(' Cannot reach Engrama server at', ENGRAMA_URL);
    console.error(' Start it with: docker compose up');
    process.exit(1);
  }

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string) =>
    new Promise<string>(resolve => rl.question(prompt, resolve));

  while (true) {
    const input = (await ask('\nYou: ')).trim();
    if (!input) continue;

    if (input === '/quit') {
      console.log('Goodbye!');
      rl.close();
      break;
    }

    if (input.startsWith('/remember ')) {
      const text = input.slice(10);
      const result = await remember(text);
      console.log(` Stored ${result.memoriesCreated ?? 0} memory fragment(s)`);
      continue;
    }

    if (input.startsWith('/recall ')) {
      const query = input.slice(8);
      const memories = await recall(query);
      if (memories.length === 0) {
        console.log(' No matching memories found.');
      } else {
        console.log(` Found ${memories.length} memory(s):`);
        memories.forEach((m: Record<string, unknown>, i: number) => {
          console.log(`  ${i + 1}. [${m.type}] ${m.content}`);
        });
      }
      continue;
    }

    if (input.startsWith('/prompt ')) {
      const text = input.slice(8);
      const prompt = await buildPrompt(text);
      console.log('\n Assembled prompt:\n');
      console.log(prompt);
      continue;
    }

    // Auto-remember the user's message and recall context
    await remember(input);
    const contextPrompt = await buildPrompt(input);
    console.log('\n[Context-aware prompt that would be sent to your LLM]:');
    console.log('─'.repeat(60));
    console.log(contextPrompt);
    console.log('─'.repeat(60));
  }
}

main().catch(console.error);
