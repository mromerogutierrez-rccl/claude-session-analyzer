import { formatDistanceStrict, differenceInMilliseconds } from 'date-fns';
import type { SessionEntry, EnhancedSession, FilterOptions } from './types.js';
import { readAllEnhancedData } from './jsonl-reader.js';
import type { AllEnhancedData } from './jsonl-reader.js';

/**
 * Result of enhanceSession — pairs the enhanced session with its raw .jsonl data
 * so summarization can reuse already-read data without a second file read.
 */
export interface EnhancementResult {
  session: EnhancedSession;
  rawData: AllEnhancedData | null;
}

/**
 * Default idle gap threshold: 30 minutes in milliseconds.
 * Any consecutive message interval >= this value is treated as an idle gap
 * and excluded from activeDuration.
 */
export const DEFAULT_GAP_THRESHOLD_MS = 30 * 60 * 1_000;

/**
 * Result of calculateActiveDuration
 */
export interface ActiveDurationResult {
  activeMs: number;
  gapCount: number;
  longestGapMs: number;
}

/**
 * Calculate active duration from a sorted list of message timestamps.
 * Sums only consecutive intervals strictly shorter than gapThresholdMs.
 * Intervals equal to or longer than gapThresholdMs are treated as idle gaps.
 */
export function calculateActiveDuration(
  timestamps: string[],
  gapThresholdMs: number
): ActiveDurationResult {
  if (timestamps.length <= 1) {
    return { activeMs: 0, gapCount: 0, longestGapMs: 0 };
  }

  let activeMs = 0;
  let gapCount = 0;
  let longestGapMs = 0;

  for (let i = 1; i < timestamps.length; i++) {
    const intervalMs =
      new Date(timestamps[i]).getTime() - new Date(timestamps[i - 1]).getTime();

    if (intervalMs < gapThresholdMs) {
      activeMs += intervalMs;
    } else {
      gapCount++;
      if (intervalMs > longestGapMs) longestGapMs = intervalMs;
    }
  }

  return { activeMs, gapCount, longestGapMs };
}

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
 * Enhance session with calculated metadata using actual .jsonl file.
 * Performs a single file read to extract all enhanced metadata simultaneously.
 * Returns EnhancementResult pairing the enhanced session with raw data for summarization reuse.
 */
export async function enhanceSession(
  session: SessionEntry,
  gapThresholdMs: number = DEFAULT_GAP_THRESHOLD_MS
): Promise<EnhancementResult> {
  // Single file read — extracts all enhanced metadata in one pass
  const data = await readAllEnhancedData(session.fullPath);

  const first = data?.first ?? null;
  const last = data?.last ?? null;
  const firstUserMessage = data?.firstUserMessage ?? null;
  const lastAssistantMessage = data?.lastAssistantMessage ?? null;

  // Use accurate timestamps if available, otherwise fall back to index metadata
  const createdTimestamp = first || session.created;
  const modifiedTimestamp = last || session.modified;

  const { milliseconds, formatted } = calculateDuration(
    createdTimestamp,
    modifiedTimestamp
  );

  // Spread SessionEntry fields first (includes messageCount), then add breakdown
  // fields before duration. This insertion order controls CSV column position:
  // breakdown columns appear immediately after messageCount in the output.
  const enhanced: EnhancedSession = { ...session };

  // Conditionally assign breakdown fields — absent (not null/0) when data unavailable
  if (data !== null) {
    enhanced.userMessageCount = data.breakdown.userMessageCount;
    enhanced.assistantMessageCount = data.breakdown.assistantMessageCount;
    enhanced.toolMessageCount = data.breakdown.toolMessageCount;
  }

  // Enhanced timestamp and message fields come after breakdown in insertion order
  enhanced.duration = milliseconds;
  enhanced.durationFormatted = formatted;

  // Active duration: sum of intervals below gapThresholdMs. Absent when data unavailable.
  // Insertion here (after durationFormatted) controls CSV column position.
  if (data !== null) {
    const { activeMs } = calculateActiveDuration(data.timestamps, gapThresholdMs);
    enhanced.activeDuration = activeMs;
    enhanced.activeDurationFormatted =
      activeMs === 0
        ? '0 seconds'
        : formatDistanceStrict(new Date(0), new Date(activeMs), { addSuffix: false });
  }

  if (first) {
    enhanced.accurateFirstTimestamp = first;
  }
  if (last) {
    enhanced.accurateLastTimestamp = last;
  }
  if (firstUserMessage) {
    enhanced.firstUserMessage = firstUserMessage;
  }
  if (lastAssistantMessage) {
    enhanced.lastAssistantMessage = lastAssistantMessage;
  }

  return { session: enhanced, rawData: data };
}

/**
 * Enhance multiple sessions with accurate timestamps from .jsonl files
 */
export async function enhanceSessions(
  sessions: SessionEntry[],
  gapThresholdMs: number = DEFAULT_GAP_THRESHOLD_MS
): Promise<EnhancementResult[]> {
  return Promise.all(sessions.map(session => enhanceSession(session, gapThresholdMs)));
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
