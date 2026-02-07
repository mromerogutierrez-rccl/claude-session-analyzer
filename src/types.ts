/**
 * Session entry from sessions-index.json
 */
export interface SessionEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

/**
 * Sessions index file structure
 */
export interface SessionsIndex {
  version: number;
  entries: SessionEntry[];
}

/**
 * Enhanced session with calculated metadata from actual .jsonl files
 */
export interface EnhancedSession extends SessionEntry {
  duration?: number; // Duration in milliseconds (calculated from first to last message)
  durationFormatted?: string; // Human-readable duration (e.g., "2 hours", "45 minutes")
  accurateFirstTimestamp?: string; // Actual first message timestamp from .jsonl file
  accurateLastTimestamp?: string; // Actual last message timestamp from .jsonl file
  firstUserMessage?: string; // First user message text (with sensitive info masked)
  lastAssistantMessage?: string; // Last assistant message text (with sensitive info masked, excluding tool use)
}

/**
 * Filter options for session queries
 */
export interface FilterOptions {
  /**
   * Start date for filtering (inclusive).
   * Sessions on or after this date will be included.
   * Should be set to start of day (00:00:00.000 UTC).
   */
  dateFrom?: Date;

  /**
   * End date for filtering (inclusive).
   * Sessions on or before this date will be included.
   * Should be set to end of day (23:59:59.999 UTC).
   */
  dateTo?: Date;

  /** List of git branches to filter by */
  gitBranches?: string[];

  /** Minimum number of messages a session must have */
  minMessageCount?: number;

  /** Text to search for in summaries and prompts */
  searchText?: string;
}

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Export options
 */
export interface ExportOptions {
  format: ExportFormat;
  outputPath: string;
  includeEnhanced: boolean;
}
