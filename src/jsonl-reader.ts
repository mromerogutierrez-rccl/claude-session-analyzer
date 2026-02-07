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
 * Read a .jsonl file and extract all timestamps
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
      } catch (error) {
        // Skip malformed lines
        console.warn(`Warning: Could not parse line in ${filePath}`);
      }
    }

    return timestamps;
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error}`);
  }
}

/**
 * Get first and last timestamps from a .jsonl file
 */
export async function getFirstAndLastTimestamp(
  filePath: string
): Promise<{ first: string | null; last: string | null }> {
  try {
    const timestamps = await readJsonlTimestamps(filePath);

    if (timestamps.length === 0) {
      return { first: null, last: null };
    }

    // Sort timestamps to ensure we get the actual first and last
    // even if the file is not in chronological order
    const sortedTimestamps = timestamps.sort((a, b) => {
      return new Date(a).getTime() - new Date(b).getTime();
    });

    return {
      first: sortedTimestamps[0],
      last: sortedTimestamps[sortedTimestamps.length - 1],
    };
  } catch (error) {
    console.warn(`Warning: Could not get timestamps from ${filePath}:`, error);
    return { first: null, last: null };
  }
}

/**
 * Extract the first user message from a .jsonl file
 * Returns the concatenated text content with sensitive info masked
 */
export async function getFirstUserMessage(
  filePath: string
): Promise<string | null> {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    for (const line of lines) {
      try {
        const json: JsonlMessage = JSON.parse(line);

        // Check if this is a user message
        if (
          json.type === 'user' &&
          json.message?.role === 'user' &&
          json.message?.content &&
          Array.isArray(json.message.content)
        ) {
          // Extract and concatenate all text content
          const textParts: string[] = [];

          for (const contentItem of json.message.content) {
            if (contentItem.type === 'text' && contentItem.text) {
              // Skip system messages and IDE artifacts
              if (
                !contentItem.text.includes('<ide_opened_file>') &&
                !contentItem.text.includes('<ide_selection>') &&
                !contentItem.text.includes('<command-name>') &&
                contentItem.text.trim().length > 0
              ) {
                textParts.push(contentItem.text.trim());
              }
            }
          }

          if (textParts.length > 0) {
            const userMessage = textParts.join('\n\n');
            // Mask sensitive information
            return maskSensitiveInfo(userMessage);
          }
        }
      } catch (error) {
        // Skip malformed lines
        continue;
      }
    }

    return null;
  } catch (error) {
    console.warn(`Warning: Could not extract first user message from ${filePath}`);
    return null;
  }
}

/**
 * Extract the last assistant message from a .jsonl file
 * Excludes tool use blocks and system messages
 * Returns the concatenated text content with sensitive info masked
 */
export async function getLastAssistantMessage(
  filePath: string
): Promise<string | null> {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    // Iterate backward through lines to find the last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const json: JsonlMessage = JSON.parse(lines[i]);

        // Check if this is an assistant message
        if (
          json.type === 'assistant' &&
          json.message?.role === 'assistant' &&
          json.message?.content &&
          Array.isArray(json.message.content)
        ) {
          // Extract and concatenate text content, excluding tool use
          const textParts: string[] = [];

          for (const contentItem of json.message.content) {
            // Skip tool_use blocks (as per user preference)
            if (contentItem.type === 'tool_use') {
              continue;
            }

            // Only process text blocks
            if (contentItem.type === 'text' && contentItem.text) {
              // Skip system messages and IDE artifacts
              if (
                !contentItem.text.includes('<ide_opened_file>') &&
                !contentItem.text.includes('<ide_selection>') &&
                !contentItem.text.includes('<command-name>') &&
                contentItem.text.trim().length > 0
              ) {
                textParts.push(contentItem.text.trim());
              }
            }
          }

          // Return if we found valid text content
          if (textParts.length > 0) {
            const assistantMessage = textParts.join('\n\n');
            // Mask sensitive information
            return maskSensitiveInfo(assistantMessage);
          }
          // If this assistant message had no valid text, continue searching backward
        }
      } catch (error) {
        // Skip malformed lines
        continue;
      }
    }

    return null;
  } catch (error) {
    console.warn(`Warning: Could not extract last assistant message from ${filePath}`);
    return null;
  }
}
