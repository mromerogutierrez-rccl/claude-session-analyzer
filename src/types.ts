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
  activeDuration?: number; // Sum of message-to-message intervals below the gap threshold (ms). 0 for single-message sessions. Absent when enhancement skipped.
  activeDurationFormatted?: string; // Human-readable active duration. "0 seconds" for single-message sessions. Absent when enhancement skipped.
  accurateFirstTimestamp?: string; // Actual first message timestamp from .jsonl file
  accurateLastTimestamp?: string; // Actual last message timestamp from .jsonl file
  firstUserMessage?: string; // First user message text (with sensitive info masked)
  lastAssistantMessage?: string; // Last assistant message text (with sensitive info masked, excluding tool use)
  userMessageCount?: number; // Count of genuine human-authored messages (absent when enhancement skipped)
  assistantMessageCount?: number; // Count of assistant text-response messages (absent when enhancement skipped)
  toolMessageCount?: number; // Count of tool/internal messages — tool_use, tool_result, MCP (absent when enhancement skipped)
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

/**
 * Information about a discovered project directory
 */
export interface ProjectInfo {
  /** Path to the project directory */
  projectDir: string;

  /** Path to sessions-index.json (null if doesn't exist yet) */
  indexPath: string | null;

  /** Number of sessions found (populated after parsing) */
  sessionCount?: number;
}

/**
 * Result of validating a sessions-index.json file
 */
export interface ValidationResult {
  /** Whether the index is valid and in sync with .jsonl files */
  isValid: boolean;

  /** Path to the sessions-index.json file (may not exist) */
  indexPath: string;

  /** Path to the project directory */
  projectDir: string;

  /** Session IDs found in .jsonl files but not in index (orphaned) */
  orphanedSessions: string[];

  /** Session IDs in index but .jsonl files are missing */
  missingFiles: string[];

  /** Total number of .jsonl files found */
  totalJsonlFiles: number;

  /** Total number of entries in the index */
  totalIndexEntries: number;

  /** Whether the sessions-index.json file exists */
  indexExists: boolean;
}

/**
 * Result of repairing a sessions-index.json file
 */
export interface RepairResult {
  /** Number of sessions added to the index */
  sessionsAdded: number;

  /** Number of invalid sessions removed from the index */
  sessionsRemoved: number;

  /** Path to the backup file created (if any) */
  backupPath: string | null;

  /** Whether the index was created from scratch */
  createdFromScratch: boolean;

  /** Path to the repaired/created index file */
  indexPath: string;
}
