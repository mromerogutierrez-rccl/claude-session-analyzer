import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { EXPORT_COLUMNS, exportToCsv, exportToJson } from '../../src/exporters.js';
import type { SessionEntry, EnhancedSession } from '../../src/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseSession: SessionEntry = {
  sessionId: 'sess-001',
  fullPath: '/Users/alice/.claude/projects/-Users-alice-Workspace-my-repo/session.jsonl',
  fileMtime: 1700000000000,
  firstPrompt: 'Write a function',
  summary: 'Wrote a helper function',
  messageCount: 5,
  created: '2026-04-01T10:00:00.000Z',
  modified: '2026-04-01T10:30:00.000Z',
  gitBranch: 'main',
  projectPath: '/Users/alice/.claude/projects/-Users-alice-Workspace-my-repo',
  isSidechain: false,
};

const enhancedSession: EnhancedSession = {
  ...baseSession,
  sessionId: 'sess-002',
  duration: 1800000,
  durationFormatted: '30 minutes',
  activeDuration: 900000,
  activeDurationFormatted: '15 minutes',
  accurateFirstTimestamp: '2026-04-01T10:00:01.000Z',
  accurateLastTimestamp: '2026-04-01T10:30:01.000Z',
  firstUserMessage: 'Write a function',
  lastAssistantMessage: 'Here is the function...',
  userMessageCount: 3,
  assistantMessageCount: 2,
  toolMessageCount: 0,
};

function tempPath(ext: string): string {
  return join(tmpdir(), `exporters-test-${randomUUID()}.${ext}`);
}

// ── A: mapSessionToExportRow (tested via exportToJson for access) ─────────────

describe('A: mapSessionToExportRow (via exportToJson)', () => {
  it('A1: fully-enhanced session has all 14 keys with correct values', async () => {
    const outPath = tempPath('json');
    await exportToJson([enhancedSession], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    const row = rows[0];

    expect(Object.keys(row)).toEqual([...EXPORT_COLUMNS]);
    expect(row.sessionId).toBe('sess-002');
    expect(row.gitBranch).toBe('main');
    expect(row.projectName).toBe('-Users-alice-Workspace-my-repo');
    expect(row.messageCount).toBe(5);
    expect(row.userMessageCount).toBe(3);
    expect(row.assistantMessageCount).toBe(2);
    expect(row.toolMessageCount).toBe(0);
    expect(row.duration).toBe(1800000);
    expect(row.durationFormatted).toBe('30 minutes');
    expect(row.activeDuration).toBe(900000);
    expect(row.activeDurationFormatted).toBe('15 minutes');
    expect(row.summary).toBe('Wrote a helper function');
    expect(row.accurateFirstTimestamp).toBe('2026-04-01T10:00:01.000Z');
    expect(row.accurateLastTimestamp).toBe('2026-04-01T10:30:01.000Z');
  });

  it('A2: non-enhanced session has all 14 keys with null for enhancement-only fields', async () => {
    const outPath = tempPath('json');
    await exportToJson([baseSession], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    const row = rows[0];

    expect(Object.keys(row)).toEqual([...EXPORT_COLUMNS]);
    expect(row.sessionId).toBe('sess-001');
    expect(row.userMessageCount).toBeNull();
    expect(row.assistantMessageCount).toBeNull();
    expect(row.toolMessageCount).toBeNull();
    expect(row.duration).toBeNull();
    expect(row.durationFormatted).toBeNull();
    expect(row.activeDuration).toBeNull();
    expect(row.activeDurationFormatted).toBeNull();
    expect(row.accurateFirstTimestamp).toBeNull();
    expect(row.accurateLastTimestamp).toBeNull();
  });

  it('A3: empty projectPath yields projectName of empty string, not "."', async () => {
    const outPath = tempPath('json');
    await exportToJson([{ ...baseSession, projectPath: '' }], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    expect(rows[0].projectName).toBe('');
  });

  it('A4: null-like (cast to empty string) projectPath yields empty string without error', async () => {
    const outPath = tempPath('json');
    // TypeScript forces projectPath to string; simulate a falsy string from the index
    await exportToJson([{ ...baseSession, projectPath: '' }], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    expect(rows[0].projectName).toBe('');
  });

  it('A5: key order matches EXPORT_COLUMNS exactly', async () => {
    const outPath = tempPath('json');
    await exportToJson([enhancedSession], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    expect(Object.keys(rows[0])).toEqual([...EXPORT_COLUMNS]);
  });
});

// ── B: exportToCsv ────────────────────────────────────────────────────────────

describe('B: exportToCsv', () => {
  it('B1: CSV header exactly matches EXPORT_COLUMNS', async () => {
    const outPath = tempPath('csv');
    await exportToCsv([baseSession], outPath);
    const content = await readFile(outPath, 'utf-8');
    const headerLine = content.split('\n')[0];
    expect(headerLine).toBe(EXPORT_COLUMNS.join(','));
  });

  it('B2: non-enhanced row has empty cells in enhancement columns', async () => {
    const outPath = tempPath('csv');
    await exportToCsv([baseSession], outPath);
    const content = await readFile(outPath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    const values = lines[1].split(',');
    const dataRow: Record<string, string> = {};
    headers.forEach((h, i) => { dataRow[h] = values[i]; });

    // Enhancement-only fields should be empty (null serialized as empty by csv-stringify)
    expect(dataRow['userMessageCount']).toBe('');
    expect(dataRow['assistantMessageCount']).toBe('');
    expect(dataRow['toolMessageCount']).toBe('');
    expect(dataRow['duration']).toBe('');
    expect(dataRow['durationFormatted']).toBe('');
    expect(dataRow['activeDuration']).toBe('');
    expect(dataRow['activeDurationFormatted']).toBe('');
    expect(dataRow['accurateFirstTimestamp']).toBe('');
    expect(dataRow['accurateLastTimestamp']).toBe('');
  });

  it('B3: mixed batch (enhanced + non-enhanced) maintains column count of 14', async () => {
    const outPath = tempPath('csv');
    await exportToCsv([baseSession, enhancedSession], outPath);
    const content = await readFile(outPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows

    lines.forEach(line => {
      // Count commas — CSV with 14 columns has 13 commas per line (no quoted commas in test data)
      const cols = line.split(',');
      expect(cols).toHaveLength(14);
    });
  });

  it('B4: empty session array throws error', async () => {
    const outPath = tempPath('csv');
    await expect(exportToCsv([], outPath)).rejects.toThrow('No sessions to export');
  });
});

// ── C: exportToJson ───────────────────────────────────────────────────────────

describe('C: exportToJson', () => {
  it('C1: JSON objects have exactly 14 keys in EXPORT_COLUMNS order', async () => {
    const outPath = tempPath('json');
    await exportToJson([enhancedSession], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    expect(Object.keys(rows[0])).toHaveLength(14);
    expect(Object.keys(rows[0])).toEqual([...EXPORT_COLUMNS]);
  });

  it('C2: non-enhanced batch has null values, not omitted keys', async () => {
    const outPath = tempPath('json');
    await exportToJson([baseSession], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    const row = rows[0];
    // Keys must be present and explicitly null
    expect('duration' in row).toBe(true);
    expect(row.duration).toBeNull();
    expect('userMessageCount' in row).toBe(true);
    expect(row.userMessageCount).toBeNull();
  });

  it('C3: mixed batch — all objects have identical 14-key structure', async () => {
    const outPath = tempPath('json');
    await exportToJson([baseSession, enhancedSession], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    expect(rows).toHaveLength(2);
    rows.forEach((row: Record<string, unknown>) => {
      expect(Object.keys(row)).toEqual([...EXPORT_COLUMNS]);
    });
  });
});

// ── D: projectName derivation ─────────────────────────────────────────────────

describe('D: projectName derivation', () => {
  it('D1: path.basename() extracts the final path segment as projectName', async () => {
    const outPath = tempPath('json');
    const session: SessionEntry = {
      ...baseSession,
      projectPath: '/Users/alice/.claude/projects/-Users-alice-Workspace-my-repo',
    };
    await exportToJson([session], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    expect(rows[0].projectName).toBe('-Users-alice-Workspace-my-repo');
  });

  it('D2: empty projectPath produces empty string, not "."', async () => {
    const outPath = tempPath('json');
    await exportToJson([{ ...baseSession, projectPath: '' }], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    expect(rows[0].projectName).toBe('');
  });
});

// ── E: Dropped columns not present ────────────────────────────────────────────

describe('E: dropped columns are absent', () => {
  const DROPPED = [
    'fullPath', 'fileMtime', 'firstPrompt', 'firstUserMessage',
    'lastAssistantMessage', 'created', 'modified', 'projectPath', 'isSidechain',
  ];

  it('E1: JSON export has no dropped columns', async () => {
    const outPath = tempPath('json');
    await exportToJson([enhancedSession], outPath);
    const rows = JSON.parse(await readFile(outPath, 'utf-8'));
    DROPPED.forEach(col => {
      expect(col in rows[0]).toBe(false);
    });
  });

  it('E2: CSV header has no dropped columns', async () => {
    const outPath = tempPath('csv');
    await exportToCsv([enhancedSession], outPath);
    const content = await readFile(outPath, 'utf-8');
    const headerLine = content.split('\n')[0];
    DROPPED.forEach(col => {
      expect(headerLine.split(',').includes(col)).toBe(false);
    });
  });
});
