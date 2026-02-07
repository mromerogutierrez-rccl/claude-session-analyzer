import { readFile } from 'fs/promises';
import { glob } from 'glob';
import type { SessionsIndex, SessionEntry } from './types.js';

/**
 * Parse a single sessions-index.json file
 */
export async function parseSessionsFile(filePath: string): Promise<SessionEntry[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const data: SessionsIndex = JSON.parse(content);
    return data.entries || [];
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${error}`);
  }
}

/**
 * Find and parse all sessions-index.json files matching the pattern
 */
export async function findAndParseSessions(pattern: string): Promise<SessionEntry[]> {
  const files = await glob(pattern, { absolute: true });

  if (files.length === 0) {
    throw new Error(`No files found matching pattern: ${pattern}`);
  }

  const allSessions: SessionEntry[] = [];

  for (const file of files) {
    try {
      const sessions = await parseSessionsFile(file);
      allSessions.push(...sessions);
    } catch (error) {
      console.warn(`Warning: Could not parse ${file}:`, error);
    }
  }

  return allSessions;
}

/**
 * Get unique git branches from sessions
 */
export function getUniqueBranches(sessions: SessionEntry[]): string[] {
  const branches = new Set(sessions.map(s => s.gitBranch).filter(Boolean));
  return Array.from(branches).sort();
}
