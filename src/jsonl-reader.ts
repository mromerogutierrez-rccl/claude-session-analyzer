import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Message entry from .jsonl file
 */
interface JsonlMessage {
  timestamp: string;
  type?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  [key: string]: unknown;
}

/**
 * Patterns to mask sensitive information
 */
const SENSITIVE_PATTERNS = [
  // File paths - mask user directories and project names
  {
    pattern: /\/Users\/[^/\s]+/g,
    replacement: '/Users/***',
  },
  {
    pattern: /\/home\/[^/\s]+/g,
    replacement: '/home/***',
  },
  // Email addresses
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '***@***.com',
  },
  // API keys and tokens (very long alphanumeric strings, but not file paths)
  // Only match standalone tokens, not parts of paths
  {
    pattern: /(?<![/.])\b[A-Za-z0-9_-]{40,}\b(?![/.])/g,
    replacement: '***TOKEN***',
  },
  // IP addresses
  {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '***.***.***.***',
  },
  // URLs with domains (keep structure but mask domain)
  {
    pattern: /https?:\/\/([^\s/]+\.[^\s/]+)(\/[^\s]*)?/g,
    replacement: (match: string, domain: string, path: string = '') => {
      try {
        const url = new URL(match);
        return `${url.protocol}//***domain***${url.pathname}${url.search}${url.hash}`;
      } catch {
        return match;
      }
    },
  },
  // Company/project names in workspace paths (after masking user)
  {
    pattern: /\/Workspace\/[^/\s]+/g,
    replacement: '/Workspace/***project***',
  },
];

/**
 * Mask sensitive information in text
 */
function maskSensitiveInfo(text: string): string {
  let masked = text;

  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    if (typeof replacement === 'function') {
      masked = masked.replace(pattern, replacement as (match: string) => string);
    } else {
      masked = masked.replace(pattern, replacement);
    }
  }

  return masked;
}

/**
 * Message count breakdown by interaction type
 */
export interface MessageCountBreakdown {
  userMessageCount: number;
  assistantMessageCount: number;
  toolMessageCount: number;
}

/**
 * All enhanced data extracted from a single .jsonl file read
 */
export interface AllEnhancedData {
  first: string | null;
  last: string | null;
  firstUserMessage: string | null;
  lastAssistantMessage: string | null;
  breakdown: MessageCountBreakdown;
  timestamps: string[]; // Full sorted list of all message timestamps. Empty array when none found. Never null.
  conversationMessages: Array<{ role: 'user' | 'assistant'; text: string }>; // Ordered text-bearing messages (tool-use stripped). Empty array when none found.
}

/**
 * Determine if a content block is an IDE artifact (not human-authored)
 */
function isIdeArtifact(text: string): boolean {
  return (
    text.includes('<ide_opened_file>') ||
    text.includes('<ide_selection>') ||
    text.includes('<command-name>')
  );
}

/**
 * Read a .jsonl file in a single pass and extract all enhanced metadata:
 * - First and last timestamps
 * - First user message text (masked)
 * - Last assistant message text (masked)
 * - Message count breakdown by type
 *
 * Returns null if the file cannot be read. Returns zero counts (not null)
 * for empty files.
 */
export async function readAllEnhancedData(filePath: string): Promise<AllEnhancedData | null> {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    const timestamps: string[] = [];
    let firstUserMessage: string | null = null;
    // Track last assistant message by overwriting on each qualifying line (forward pass)
    let lastAssistantMessage: string | null = null;
    const conversationMessages: Array<{ role: 'user' | 'assistant'; text: string }> = [];

    const breakdown: MessageCountBreakdown = {
      userMessageCount: 0,
      assistantMessageCount: 0,
      toolMessageCount: 0,
    };

    for (const line of lines) {
      let json: JsonlMessage;
      try {
        json = JSON.parse(line);
      } catch {
        // Skip malformed lines
        continue;
      }

      // Collect timestamp
      if (json.timestamp) {
        timestamps.push(json.timestamp);
      }

      const role = json.message?.role;
      const contentItems = json.message?.content;

      if (!role || !Array.isArray(contentItems)) {
        // No recognizable message structure — not counted
        continue;
      }

      const hasTextBlock = contentItems.some(
        item => item.type === 'text' && item.text && item.text.trim().length > 0 && !isIdeArtifact(item.text)
      );
      const hasOnlyNonTextBlocks =
        contentItems.length > 0 &&
        contentItems.every(item => item.type !== 'text' || !item.text || item.text.trim().length === 0 || isIdeArtifact(item.text ?? ''));

      if (role === 'assistant') {
        if (hasTextBlock) {
          // Assistant message with text (may also have tool_use — text wins)
          breakdown.assistantMessageCount++;

          // Track for lastAssistantMessage — overwrite on each qualifying line
          const textParts = contentItems
            .filter(item => item.type === 'text' && item.text && item.text.trim().length > 0 && !isIdeArtifact(item.text))
            .map(item => item.text!.trim());
          if (textParts.length > 0) {
            const maskedText = maskSensitiveInfo(textParts.join('\n\n'));
            lastAssistantMessage = maskedText;
            conversationMessages.push({ role: 'assistant', text: maskedText });
          }
        } else {
          // Assistant with only tool_use/tool_result — no text
          breakdown.toolMessageCount++;
        }
      } else if (role === 'user') {
        if (hasTextBlock) {
          // Genuine human-authored message
          breakdown.userMessageCount++;

          // Capture first user message and accumulate conversation
          const textParts = contentItems
            .filter(item => item.type === 'text' && item.text && item.text.trim().length > 0 && !isIdeArtifact(item.text))
            .map(item => item.text!.trim());
          if (textParts.length > 0) {
            const maskedText = maskSensitiveInfo(textParts.join('\n\n'));
            if (firstUserMessage === null) {
              firstUserMessage = maskedText;
            }
            conversationMessages.push({ role: 'user', text: maskedText });
          }
        } else {
          // User entry with only tool_result or IDE artifacts — not human-authored
          breakdown.toolMessageCount++;
        }
      }
      // Entries with unrecognized roles are not counted (no else branch)
    }

    // Derive first/last timestamps and retain sorted array for gap calculation
    const sortedTimestamps = [...timestamps].sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );
    const first = sortedTimestamps.length > 0 ? sortedTimestamps[0] : null;
    const last = sortedTimestamps.length > 0 ? sortedTimestamps[sortedTimestamps.length - 1] : null;

    return { first, last, firstUserMessage, lastAssistantMessage, breakdown, timestamps: sortedTimestamps, conversationMessages };
  } catch {
    return null;
  }
}

/**
 * Read a .jsonl file and extract all timestamps.
 * @deprecated Use readAllEnhancedData for new callers — this performs a separate file read.
 */
export async function readJsonlTimestamps(filePath: string): Promise<string[]> {
  try {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    const timestamps: string[] = [];

    for (const line of lines) {
      try {
        const json: JsonlMessage = JSON.parse(line);
        if (json.timestamp) {
          timestamps.push(json.timestamp);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return timestamps;
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error}`);
  }
}

/**
 * Get first and last timestamps from a .jsonl file.
 * Thin wrapper around readAllEnhancedData for backward compatibility.
 */
export async function getFirstAndLastTimestamp(
  filePath: string
): Promise<{ first: string | null; last: string | null }> {
  const data = await readAllEnhancedData(filePath);
  if (!data) {
    return { first: null, last: null };
  }
  return { first: data.first, last: data.last };
}

/**
 * Extract the first user message from a .jsonl file.
 * Returns the concatenated text content with sensitive info masked.
 * Thin wrapper around readAllEnhancedData for backward compatibility.
 */
export async function getFirstUserMessage(
  filePath: string
): Promise<string | null> {
  const data = await readAllEnhancedData(filePath);
  return data?.firstUserMessage ?? null;
}

/**
 * Extract the last assistant message from a .jsonl file.
 * Excludes tool use blocks and system messages.
 * Returns the concatenated text content with sensitive info masked.
 * Thin wrapper around readAllEnhancedData for backward compatibility.
 */
export async function getLastAssistantMessage(
  filePath: string
): Promise<string | null> {
  const data = await readAllEnhancedData(filePath);
  return data?.lastAssistantMessage ?? null;
}
