import { writeFile } from 'fs/promises';
import { stringify } from 'csv-stringify/sync';
import path from 'path';
import type { SessionEntry, EnhancedSession, ExportFormat } from './types.js';

// Single source of truth for CSV schema
export const EXPORT_COLUMNS = [
  'sessionId',
  'gitBranch',
  'projectName',
  'messageCount',
  'userMessageCount',
  'assistantMessageCount',
  'toolMessageCount',
  'duration',
  'durationFormatted',
  'activeDuration',
  'activeDurationFormatted',
  'summary',
  'accurateFirstTimestamp',
  'accurateLastTimestamp',
  'aiSummary',
] as const;

// Internal type for 15-field export rows
type ExportRow = {
  sessionId: string;
  gitBranch: string;
  projectName: string;
  messageCount: number;
  userMessageCount: number | null;
  assistantMessageCount: number | null;
  toolMessageCount: number | null;
  duration: number | null;
  durationFormatted: string | null;
  activeDuration: number | null;
  activeDurationFormatted: string | null;
  summary: string;
  accurateFirstTimestamp: string | null;
  accurateLastTimestamp: string | null;
  aiSummary: string | null;
};

function mapSessionToExportRow(session: SessionEntry | EnhancedSession): ExportRow {
  const enhanced = session as EnhancedSession;
  return {
    sessionId: session.sessionId,
    gitBranch: session.gitBranch,
    projectName: session.projectPath ? path.basename(session.projectPath) : '',
    messageCount: session.messageCount,
    userMessageCount: enhanced.userMessageCount ?? null,
    assistantMessageCount: enhanced.assistantMessageCount ?? null,
    toolMessageCount: enhanced.toolMessageCount ?? null,
    duration: enhanced.duration ?? null,
    durationFormatted: enhanced.durationFormatted ?? null,
    activeDuration: enhanced.activeDuration ?? null,
    activeDurationFormatted: enhanced.activeDurationFormatted ?? null,
    summary: session.summary,
    accurateFirstTimestamp: enhanced.accurateFirstTimestamp ?? null,
    accurateLastTimestamp: enhanced.accurateLastTimestamp ?? null,
    aiSummary: enhanced.aiSummary ?? null,
  };
}

/**
 * Export sessions to JSON format
 */
export async function exportToJson(
  sessions: SessionEntry[] | EnhancedSession[],
  outputPath: string
): Promise<void> {
  const rows = sessions.map(s => {
    const row = mapSessionToExportRow(s);
    // Omit aiSummary key entirely when null (spec: JSON null-key filtering)
    if (row.aiSummary === null) {
      const { aiSummary: _, ...rest } = row;
      return rest;
    }
    return row;
  });
  const jsonContent = JSON.stringify(rows, null, 2);
  await writeFile(outputPath, jsonContent, 'utf-8');
}

/**
 * Export sessions to CSV format
 */
export async function exportToCsv(
  sessions: SessionEntry[] | EnhancedSession[],
  outputPath: string
): Promise<void> {
  if (sessions.length === 0) {
    throw new Error('No sessions to export');
  }

  const rows = sessions.map(s => mapSessionToExportRow(s));

  const csvContent = stringify(rows, {
    header: true,
    columns: EXPORT_COLUMNS,
    cast: {
      date: (value) => value.toISOString(),
    },
  });

  await writeFile(outputPath, csvContent, 'utf-8');
}

/**
 * Export sessions based on format
 */
export async function exportSessions(
  sessions: SessionEntry[] | EnhancedSession[],
  format: ExportFormat,
  outputPath: string
): Promise<void> {
  switch (format) {
    case 'json':
      await exportToJson(sessions, outputPath);
      break;
    case 'csv':
      await exportToCsv(sessions, outputPath);
      break;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
