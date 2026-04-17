import { spawn, execFile } from 'child_process';
import { platform } from 'os';
import type { EnhancedSession } from './types.js';
import type { AllEnhancedData } from './jsonl-reader.js';

export const DEFAULT_SUMMARY_PROMPT =
  'Summarize this Claude Code session in 2-3 sentences. Focus on: what was worked on, key decisions made, and the final outcome. Be concise and technical.';

export const MIN_USER_MESSAGES_FOR_SUMMARY = 3;
export const SUMMARY_TIMEOUT_MS = 60_000;
export const CONVERSATION_CHAR_LIMIT = 50_000;
export const CONVERSATION_HEAD_CHARS = 15_000;
export const CONVERSATION_TAIL_CHARS = 35_000;

export type SummaryStatus = 'generated' | 'skipped_low_count' | 'failed_exit' | 'failed_timeout';

export interface SessionSummaryResult {
  sessionId: string;
  status: SummaryStatus;
  aiSummary?: string;   // present only when status === 'generated'
  exitCode?: number;    // present only when status === 'failed_exit'
}

/**
 * Check if the claude CLI is available on PATH.
 */
export async function checkClaudeOnPath(): Promise<boolean> {
  const cmd = platform() === 'win32' ? 'where' : 'which';
  return new Promise(resolve => {
    execFile(cmd, ['claude'], err => {
      resolve(!err);
    });
  });
}

/**
 * Build conversation text from raw enhanced data.
 * Applies privacy masking, formats as User:/Assistant: labels,
 * and truncates if > CONVERSATION_CHAR_LIMIT chars.
 */
export function buildConversationText(rawData: AllEnhancedData): string {
  if (rawData.conversationMessages.length === 0) {
    return '';
  }

  const lines = rawData.conversationMessages.map(msg => {
    const label = msg.role === 'user' ? 'User' : 'Assistant';
    // text is already masked by readAllEnhancedData
    return `${label}: ${msg.text}`;
  });

  const full = lines.join('\n\n');

  if (full.length <= CONVERSATION_CHAR_LIMIT) {
    return full;
  }

  const head = full.slice(0, CONVERSATION_HEAD_CHARS);
  const tail = full.slice(full.length - CONVERSATION_TAIL_CHARS);
  return `${head}\n\n[... truncated ...]\n\n${tail}`;
}

/**
 * Summarize a single session using the claude -p subprocess.
 * Returns skipped_low_count if userMessageCount < MIN_USER_MESSAGES_FOR_SUMMARY
 * or if rawData is null.
 */
export async function summarizeSession(
  session: EnhancedSession,
  rawData: AllEnhancedData | null,
  prompt: string,
  timeoutMs: number
): Promise<SessionSummaryResult> {
  const userCount = session.userMessageCount ?? 0;

  if (rawData === null || userCount < MIN_USER_MESSAGES_FOR_SUMMARY) {
    return { sessionId: session.sessionId, status: 'skipped_low_count' };
  }

  const conversationText = buildConversationText(rawData);
  const fullPrompt = `${prompt}\n\n${conversationText}`;

  return new Promise(resolve => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      proc.kill();
      resolve({ sessionId: session.sessionId, status: 'failed_timeout' });
    }, timeoutMs);

    const proc = spawn('claude', ['-p', fullPrompt], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let aborted = false;

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    // Drain stderr silently
    proc.stderr.resume();

    proc.on('close', (code: number | null) => {
      if (aborted) return;
      clearTimeout(timer);

      if (code === 0) {
        resolve({
          sessionId: session.sessionId,
          status: 'generated',
          aiSummary: stdout.trim(),
        });
      } else {
        resolve({
          sessionId: session.sessionId,
          status: 'failed_exit',
          exitCode: code ?? -1,
        });
      }
    });

    proc.on('error', () => {
      if (aborted) return;
      clearTimeout(timer);
      resolve({ sessionId: session.sessionId, status: 'failed_exit', exitCode: -1 });
    });

    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
  });
}

/**
 * Summarize multiple sessions with a bounded concurrency queue.
 * Calls onResult as each completes (not after all).
 * Returns results array (index-aligned with input pairs).
 */
export async function summarizeSessions(
  pairs: Array<{ session: EnhancedSession; rawData: AllEnhancedData | null }>,
  prompt: string,
  maxConcurrency: number,
  timeoutMs: number,
  onResult: (result: SessionSummaryResult, session: EnhancedSession) => void
): Promise<SessionSummaryResult[]> {
  const results: SessionSummaryResult[] = new Array(pairs.length);
  let nextIndex = 0;
  let active = 0;

  return new Promise((resolveAll, reject) => {
    let completed = 0;

    function dispatch(): void {
      while (active < maxConcurrency && nextIndex < pairs.length) {
        const index = nextIndex++;
        active++;

        const { session, rawData } = pairs[index];
        summarizeSession(session, rawData, prompt, timeoutMs)
          .then(result => {
            results[index] = result;
            onResult(result, session);
            active--;
            completed++;

            if (completed === pairs.length) {
              resolveAll(results);
            } else {
              dispatch();
            }
          })
          .catch(reject);
      }
    }

    if (pairs.length === 0) {
      resolveAll(results);
      return;
    }

    dispatch();
  });
}
