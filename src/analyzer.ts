import { formatDistanceStrict, differenceInMilliseconds } from 'date-fns';
import type { SessionEntry, EnhancedSession, FilterOptions } from './types.js';
import { getFirstAndLastTimestamp, getFirstUserMessage, getLastAssistantMessage } from './jsonl-reader.js';

/**
 * Calculate duration between created and modified timestamps
 */
export function calculateDuration(created: string, modified: string): {
  milliseconds: number;
  formatted: string;
} {
  const createdDate = new Date(created);
  const modifiedDate = new Date(modified);

  const milliseconds = differenceInMilliseconds(modifiedDate, createdDate);

  // Format the duration in a human-readable way
  const formatted = formatDistanceStrict(createdDate, modifiedDate, {
    addSuffix: false,
  });

  return {
    milliseconds,
    formatted,
  };
}

/**
 * Enhance session with calculated metadata using actual .jsonl file timestamps
 */
export async function enhanceSession(session: SessionEntry): Promise<EnhancedSession> {
  // Try to get accurate timestamps from the .jsonl file
  const { first, last } = await getFirstAndLastTimestamp(session.fullPath);

  // Try to get the first user message
  const firstUserMessage = await getFirstUserMessage(session.fullPath);

  // Try to get the last assistant message
  const lastAssistantMessage = await getLastAssistantMessage(session.fullPath);

  // Use actual timestamps if available, otherwise fall back to index metadata
  const createdTimestamp = first || session.created;
  const modifiedTimestamp = last || session.modified;

  const { milliseconds, formatted } = calculateDuration(
    createdTimestamp,
    modifiedTimestamp
  );

  const enhanced: EnhancedSession = {
    ...session,
    duration: milliseconds,
    durationFormatted: formatted,
  };

  // Include accurate timestamps if they were found in the .jsonl file
  if (first) {
    enhanced.accurateFirstTimestamp = first;
  }
  if (last) {
    enhanced.accurateLastTimestamp = last;
  }

  // Include first user message if found
  if (firstUserMessage) {
    enhanced.firstUserMessage = firstUserMessage;
  }

  // Include last assistant message if found
  if (lastAssistantMessage) {
    enhanced.lastAssistantMessage = lastAssistantMessage;
  }

  return enhanced;
}

/**
 * Enhance multiple sessions with accurate timestamps from .jsonl files
 */
export async function enhanceSessions(
  sessions: SessionEntry[]
): Promise<EnhancedSession[]> {
  const enhanced = await Promise.all(sessions.map(enhanceSession));
  return enhanced;
}

/**
 * Filter sessions based on provided criteria
 */
export function filterSessions(
  sessions: SessionEntry[],
  filters: FilterOptions
): SessionEntry[] {
  return sessions.filter(session => {
    // Filter by date range
    if (filters.dateFrom) {
      const sessionDate = new Date(session.created);
      if (sessionDate < filters.dateFrom) return false;
    }

    if (filters.dateTo) {
      const sessionDate = new Date(session.created);
      if (sessionDate > filters.dateTo) return false;
    }

    // Filter by git branches
    if (filters.gitBranches && filters.gitBranches.length > 0) {
      if (!filters.gitBranches.includes(session.gitBranch)) return false;
    }

    // Filter by minimum message count
    if (filters.minMessageCount !== undefined) {
      if (session.messageCount < filters.minMessageCount) return false;
    }

    // Filter by search text (in summary or firstPrompt)
    if (filters.searchText) {
      const searchLower = filters.searchText.toLowerCase();
      const summaryMatch = session.summary?.toLowerCase().includes(searchLower);
      const promptMatch = session.firstPrompt?.toLowerCase().includes(searchLower);
      if (!summaryMatch && !promptMatch) return false;
    }

    return true;
  });
}

/**
 * Sort sessions by created date (newest first)
 */
export function sortSessionsByDate(sessions: SessionEntry[]): SessionEntry[] {
  return [...sessions].sort((a, b) => {
    return new Date(b.created).getTime() - new Date(a.created).getTime();
  });
}
