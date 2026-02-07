import { writeFile } from 'fs/promises';
import { stringify } from 'csv-stringify/sync';
import type { SessionEntry, EnhancedSession, ExportFormat } from './types.js';

/**
 * Export sessions to JSON format
 */
export async function exportToJson(
  sessions: SessionEntry[] | EnhancedSession[],
  outputPath: string
): Promise<void> {
  const jsonContent = JSON.stringify(sessions, null, 2);
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

  // Get all unique keys from the sessions
  const allKeys = new Set<string>();
  sessions.forEach(session => {
    Object.keys(session).forEach(key => allKeys.add(key));
  });

  const columns = Array.from(allKeys);

  const csvContent = stringify(sessions, {
    header: true,
    columns: columns,
    cast: {
      boolean: (value) => value ? 'true' : 'false',
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
