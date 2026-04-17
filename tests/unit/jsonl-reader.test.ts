import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readAllEnhancedData } from '../../src/jsonl-reader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = resolve(__dirname, '../fixtures');

describe('readAllEnhancedData - message count classification', () => {
  it('TC1: pure conversation — user+assistant text only, zero tool messages', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    expect(result!.breakdown.userMessageCount).toBe(2);
    expect(result!.breakdown.assistantMessageCount).toBe(2);
    expect(result!.breakdown.toolMessageCount).toBe(0);
  });

  it('TC2: tool-heavy session — all classification branches covered', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'tool-heavy.jsonl'));

    expect(result).not.toBeNull();
    // Line 1: user text → user
    // Line 2: assistant tool_use-only → tool
    // Line 3: user tool_result-only → tool
    // Line 4: assistant text → assistant
    // Line 5: user tool_result-only → tool
    // Line 6: assistant tool_use-only → tool
    expect(result!.breakdown.userMessageCount).toBe(1);
    expect(result!.breakdown.assistantMessageCount).toBe(1);
    expect(result!.breakdown.toolMessageCount).toBe(4);
  });

  it('TC3: mixed-content assistant entry (text + tool_use) counts as assistant', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'mixed-content-assistant.jsonl'));

    expect(result).not.toBeNull();
    // Line 1: user text → user
    // Line 2: assistant text + tool_use → assistant (text wins)
    // Line 3: user text → user
    expect(result!.breakdown.userMessageCount).toBe(2);
    expect(result!.breakdown.assistantMessageCount).toBe(1);
    expect(result!.breakdown.toolMessageCount).toBe(0);
  });

  it('TC4: user-role tool_result-only entry counts as tool', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'tool-heavy.jsonl'));

    expect(result).not.toBeNull();
    // Line 3 and line 5 are user+tool_result-only → both in toolMessageCount
    // Verified via TC2: toolMessageCount includes these
    expect(result!.breakdown.toolMessageCount).toBeGreaterThanOrEqual(2);
  });

  it('TC5: sum invariant — user + assistant + tool equals total parseable lines', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'tool-heavy.jsonl'));

    expect(result).not.toBeNull();
    const { userMessageCount, assistantMessageCount, toolMessageCount } = result!.breakdown;
    expect(userMessageCount + assistantMessageCount + toolMessageCount).toBe(6);
  });

  it('TC6: sum invariant holds for pure conversation', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    const { userMessageCount, assistantMessageCount, toolMessageCount } = result!.breakdown;
    expect(userMessageCount + assistantMessageCount + toolMessageCount).toBe(4);
  });

  it('TC7: empty file returns zero counts (not null)', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'empty.jsonl'));

    expect(result).not.toBeNull();
    expect(result!.breakdown.userMessageCount).toBe(0);
    expect(result!.breakdown.assistantMessageCount).toBe(0);
    expect(result!.breakdown.toolMessageCount).toBe(0);
  });

  it('TC8: malformed lines are skipped; valid lines are counted correctly', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'malformed.jsonl'));

    expect(result).not.toBeNull();
    // 3 valid lines: user, assistant, user → user=2, assistant=1, tool=0
    // 2 malformed lines are skipped
    expect(result!.breakdown.userMessageCount).toBe(2);
    expect(result!.breakdown.assistantMessageCount).toBe(1);
    expect(result!.breakdown.toolMessageCount).toBe(0);
    // Sum equals only parseable lines
    const { userMessageCount, assistantMessageCount, toolMessageCount } = result!.breakdown;
    expect(userMessageCount + assistantMessageCount + toolMessageCount).toBe(3);
  });

  it('TC9: file not found returns null', async () => {
    const result = await readAllEnhancedData('/nonexistent/path/session.jsonl');

    expect(result).toBeNull();
  });

  it('TC10: session with zero tool calls — toolMessageCount is explicit 0, not absent', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    // toolMessageCount must be 0, not undefined or null
    expect(result!.breakdown.toolMessageCount).toBe(0);
    expect(result!.breakdown.toolMessageCount).not.toBeUndefined();
    expect(result!.breakdown.toolMessageCount).not.toBeNull();
  });
});

describe('readAllEnhancedData - timestamps array (TR1-TR5)', () => {
  it('TR1: timestamps field is present on return value', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    expect('timestamps' in result!).toBe(true);
  });

  it('TR2: timestamps length matches message count with valid timestamps', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    // pure-conversation.jsonl has 4 lines, all with timestamps
    expect(result!.timestamps).toHaveLength(4);
  });

  it('TR3: timestamps array is sorted ascending', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'gapped-session.jsonl'));

    expect(result).not.toBeNull();
    const ts = result!.timestamps;
    for (let i = 1; i < ts.length; i++) {
      expect(new Date(ts[i]).getTime()).toBeGreaterThanOrEqual(new Date(ts[i - 1]).getTime());
    }
  });

  it('TR4: empty file returns timestamps: [] (not null)', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'empty.jsonl'));

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.timestamps)).toBe(true);
    expect(result!.timestamps).toHaveLength(0);
  });

  it('TR5: first and last are consistent with timestamps[0] and timestamps[N-1]', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    expect(result!.first).toBe(result!.timestamps[0]);
    expect(result!.last).toBe(result!.timestamps[result!.timestamps.length - 1]);
  });
});

describe('readAllEnhancedData - conversationMessages (TR6-TR10)', () => {
  it('TR6: conversationMessages field exists on returned AllEnhancedData', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    expect('conversationMessages' in result!).toBe(true);
  });

  it('TR7: pure-conversation fixture returns 4 conversationMessages entries (2 user + 2 assistant), alternating roles, in order', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    expect(result!.conversationMessages).toHaveLength(4);
    expect(result!.conversationMessages[0].role).toBe('user');
    expect(result!.conversationMessages[1].role).toBe('assistant');
    expect(result!.conversationMessages[2].role).toBe('user');
    expect(result!.conversationMessages[3].role).toBe('assistant');
    expect(result!.conversationMessages[0].text).toBe('What is TypeScript?');
    expect(result!.conversationMessages[1].text).toBe('TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.');
    expect(result!.conversationMessages[2].text).toBe('How do I compile a TypeScript file?');
    expect(result!.conversationMessages[3].text).toBe('Use the tsc command: tsc yourfile.ts');
  });

  it('TR8: tool-heavy fixture returns only text-bearing entries (tool-only excluded)', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'tool-heavy.jsonl'));

    expect(result).not.toBeNull();
    // tool-heavy has: user text, assistant tool-only, user tool-only, assistant text, user tool-only, assistant tool-only
    // Only user text (line 1) and assistant text (line 4) have text blocks → 2 entries
    expect(result!.conversationMessages).toHaveLength(2);
    expect(result!.conversationMessages[0].role).toBe('user');
    expect(result!.conversationMessages[1].role).toBe('assistant');
  });

  it('TR9: empty .jsonl file returns empty conversationMessages array', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'empty.jsonl'));

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.conversationMessages)).toBe(true);
    expect(result!.conversationMessages).toHaveLength(0);
  });

  it('TR10: message ordering in conversationMessages matches .jsonl line order', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    // First entry should be the first user message
    expect(result!.conversationMessages[0].text).toBe('What is TypeScript?');
    // Last entry should be the last assistant message
    expect(result!.conversationMessages[3].text).toBe('Use the tsc command: tsc yourfile.ts');
  });
});

describe('readAllEnhancedData - timestamps and messages', () => {
  it('returns first and last timestamps from pure conversation', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    expect(result!.first).toBe('2026-04-01T09:00:00.000Z');
    expect(result!.last).toBe('2026-04-01T09:03:00.000Z');
  });

  it('returns first user message (masked) from pure conversation', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    expect(result!.firstUserMessage).toBe('What is TypeScript?');
  });

  it('returns last assistant message from pure conversation', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'pure-conversation.jsonl'));

    expect(result).not.toBeNull();
    expect(result!.lastAssistantMessage).toBe('Use the tsc command: tsc yourfile.ts');
  });

  it('returns null timestamps and messages for empty file', async () => {
    const result = await readAllEnhancedData(resolve(FIXTURES, 'empty.jsonl'));

    expect(result).not.toBeNull();
    expect(result!.first).toBeNull();
    expect(result!.last).toBeNull();
    expect(result!.firstUserMessage).toBeNull();
    expect(result!.lastAssistantMessage).toBeNull();
  });
});
