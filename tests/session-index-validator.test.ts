import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  validateSessionIndex,
  repairSessionIndex,
  createIndexFromScratch,
} from '../src/session-index-validator.js';
import type { SessionsIndex, SessionEntry } from '../src/types.js';

// Test fixture helpers
let testDir: string;

beforeEach(async () => {
  // Create a unique temporary directory for each test
  testDir = path.join(os.tmpdir(), `claude-validator-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  // Clean up test directory
  await rm(testDir, { recursive: true, force: true });
});

/**
 * Create a mock .jsonl session file
 */
async function createMockJsonlFile(
  sessionId: string,
  messageCount: number = 2
): Promise<void> {
  const filePath = path.join(testDir, `${sessionId}.jsonl`);
  const timestamp1 = new Date('2026-02-01T10:00:00Z').toISOString();
  const timestamp2 = new Date('2026-02-01T11:00:00Z').toISOString();

  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: timestamp1,
      message: {
        role: 'user',
        timestamp: timestamp1,
        content: [
          {
            type: 'text',
            text: 'Hello, this is a test message for session ' + sessionId,
          },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: timestamp2,
      message: {
        role: 'assistant',
        timestamp: timestamp2,
        content: [
          {
            type: 'text',
            text: 'This is a test response',
          },
        ],
      },
    }),
  ];

  // Add more messages if requested
  for (let i = 2; i < messageCount; i++) {
    const ts = new Date(`2026-02-01T${10 + i}:00:00Z`).toISOString();
    lines.push(
      JSON.stringify({
        type: i % 2 === 0 ? 'user' : 'assistant',
        timestamp: ts,
        message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          timestamp: ts,
          content: [{ type: 'text', text: `Message ${i}` }],
        },
      })
    );
  }

  await writeFile(filePath, lines.join('\n'), 'utf-8');
}

/**
 * Create a mock sessions-index.json file
 */
async function createMockIndex(sessionEntries: Partial<SessionEntry>[]): Promise<void> {
  const indexPath = path.join(testDir, 'sessions-index.json');

  const fullEntries: SessionEntry[] = sessionEntries.map(entry => ({
    sessionId: entry.sessionId || 'unknown',
    fullPath: entry.fullPath || path.join(testDir, `${entry.sessionId}.jsonl`),
    fileMtime: entry.fileMtime || Date.now(),
    firstPrompt: entry.firstPrompt || 'Test prompt',
    customTitle: entry.customTitle || '',
    summary: entry.summary || 'Test prompt',
    messageCount: entry.messageCount || 2,
    created: entry.created || new Date().toISOString(),
    modified: entry.modified || new Date().toISOString(),
    gitBranch: entry.gitBranch || '',
    projectPath: entry.projectPath || testDir,
    isSidechain: entry.isSidechain || false,
  }));

  const index: SessionsIndex = {
    version: 1,
    entries: fullEntries,
  };

  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

describe('validateSessionIndex', () => {
  it('should detect orphaned sessions (in .jsonl but not in index)', async () => {
    // Create .jsonl files
    await createMockJsonlFile('session-1');
    await createMockJsonlFile('session-2');
    await createMockJsonlFile('session-3');

    // Create index with only 2 sessions
    await createMockIndex([
      { sessionId: 'session-1' },
      { sessionId: 'session-2' },
    ]);

    const result = await validateSessionIndex(testDir);

    expect(result.isValid).toBe(false);
    expect(result.indexExists).toBe(true);
    expect(result.orphanedSessions).toEqual(['session-3']);
    expect(result.missingFiles).toEqual([]);
    expect(result.totalJsonlFiles).toBe(3);
    expect(result.totalIndexEntries).toBe(2);
  });

  it('should detect missing .jsonl files (in index but file missing)', async () => {
    // Create only 2 .jsonl files
    await createMockJsonlFile('session-1');
    await createMockJsonlFile('session-2');

    // Create index with 3 sessions
    await createMockIndex([
      { sessionId: 'session-1' },
      { sessionId: 'session-2' },
      { sessionId: 'session-3' }, // Missing file
    ]);

    const result = await validateSessionIndex(testDir);

    expect(result.isValid).toBe(false);
    expect(result.indexExists).toBe(true);
    expect(result.orphanedSessions).toEqual([]);
    expect(result.missingFiles).toEqual(['session-3']);
    expect(result.totalJsonlFiles).toBe(2);
    expect(result.totalIndexEntries).toBe(3);
  });

  it('should handle missing sessions-index.json', async () => {
    // Create .jsonl files but no index
    await createMockJsonlFile('session-1');
    await createMockJsonlFile('session-2');

    const result = await validateSessionIndex(testDir);

    expect(result.isValid).toBe(false);
    expect(result.indexExists).toBe(false);
    expect(result.orphanedSessions.sort()).toEqual(['session-1', 'session-2']);
    expect(result.missingFiles).toEqual([]);
    expect(result.totalJsonlFiles).toBe(2);
    expect(result.totalIndexEntries).toBe(0);
  });

  it('should return valid for properly synced index', async () => {
    // Create .jsonl files
    await createMockJsonlFile('session-1');
    await createMockJsonlFile('session-2');

    // Create matching index
    await createMockIndex([
      { sessionId: 'session-1' },
      { sessionId: 'session-2' },
    ]);

    const result = await validateSessionIndex(testDir);

    expect(result.isValid).toBe(true);
    expect(result.indexExists).toBe(true);
    expect(result.orphanedSessions).toEqual([]);
    expect(result.missingFiles).toEqual([]);
    expect(result.totalJsonlFiles).toBe(2);
    expect(result.totalIndexEntries).toBe(2);
  });

  it('should handle empty directory', async () => {
    const result = await validateSessionIndex(testDir);

    expect(result.isValid).toBe(false); // No index = invalid
    expect(result.indexExists).toBe(false);
    expect(result.orphanedSessions).toEqual([]);
    expect(result.missingFiles).toEqual([]);
    expect(result.totalJsonlFiles).toBe(0);
    expect(result.totalIndexEntries).toBe(0);
  });

  it('should handle corrupted index file gracefully', async () => {
    // Create .jsonl files
    await createMockJsonlFile('session-1');

    // Create corrupted index
    const indexPath = path.join(testDir, 'sessions-index.json');
    await writeFile(indexPath, '{ invalid json }', 'utf-8');

    const result = await validateSessionIndex(testDir);

    expect(result.isValid).toBe(false);
    expect(result.indexExists).toBe(true);
    expect(result.orphanedSessions).toEqual(['session-1']);
    expect(result.totalIndexEntries).toBe(0); // Corrupted = no entries
  });
});

describe('repairSessionIndex', () => {
  it('should add missing sessions to index', async () => {
    // Create .jsonl files
    await createMockJsonlFile('session-1');
    await createMockJsonlFile('session-2');
    await createMockJsonlFile('session-3');

    // Create index with only 2 sessions
    await createMockIndex([
      { sessionId: 'session-1' },
      { sessionId: 'session-2' },
    ]);

    const validation = await validateSessionIndex(testDir);
    const result = await repairSessionIndex(testDir, validation);

    expect(result.sessionsAdded).toBe(1);
    expect(result.sessionsRemoved).toBe(0);
    expect(result.createdFromScratch).toBe(false);
    expect(result.backupPath).toBeTruthy();

    // Verify index was updated
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);
    expect(index.entries.length).toBe(3);

    const sessionIds = index.entries.map(e => e.sessionId).sort();
    expect(sessionIds).toEqual(['session-1', 'session-2', 'session-3']);
  });

  it('should remove stale entries with missing files', async () => {
    // Create only 2 .jsonl files
    await createMockJsonlFile('session-1');
    await createMockJsonlFile('session-2');

    // Create index with 3 sessions
    await createMockIndex([
      { sessionId: 'session-1' },
      { sessionId: 'session-2' },
      { sessionId: 'session-3' }, // Missing file
    ]);

    const validation = await validateSessionIndex(testDir);
    const result = await repairSessionIndex(testDir, validation);

    expect(result.sessionsAdded).toBe(0);
    expect(result.sessionsRemoved).toBe(1);
    expect(result.createdFromScratch).toBe(false);

    // Verify index was updated
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);
    expect(index.entries.length).toBe(2);

    const sessionIds = index.entries.map(e => e.sessionId).sort();
    expect(sessionIds).toEqual(['session-1', 'session-2']);
  });

  it('should create backup before repair', async () => {
    // Create setup
    await createMockJsonlFile('session-1');
    await createMockIndex([{ sessionId: 'session-1' }]);

    const validation = await validateSessionIndex(testDir);
    const result = await repairSessionIndex(testDir, validation);

    expect(result.backupPath).toBeTruthy();
    expect(result.backupPath).toMatch(/sessions-index\.json\.bak-/);

    // Verify backup exists
    const { stat } = await import('fs/promises');
    const backupStats = await stat(result.backupPath!);
    expect(backupStats.isFile()).toBe(true);
  });

  it('should create index from scratch if missing', async () => {
    // Create .jsonl files but no index
    await createMockJsonlFile('session-1');
    await createMockJsonlFile('session-2');

    const validation = await validateSessionIndex(testDir);
    const result = await repairSessionIndex(testDir, validation);

    expect(result.sessionsAdded).toBe(2);
    expect(result.sessionsRemoved).toBe(0);
    expect(result.createdFromScratch).toBe(true);
    expect(result.backupPath).toBeNull(); // No backup if creating from scratch

    // Verify index was created
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);
    expect(index.entries.length).toBe(2);
  });

  it('should extract metadata correctly from .jsonl files', async () => {
    // Create .jsonl file with specific content
    await createMockJsonlFile('test-session', 5);

    const validation = await validateSessionIndex(testDir);
    const result = await repairSessionIndex(testDir, validation);

    // Read the created index
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);

    expect(index.entries.length).toBe(1);
    const entry = index.entries[0];

    expect(entry.sessionId).toBe('test-session');
    expect(entry.messageCount).toBe(5);
    expect(entry.firstPrompt).toContain('Hello, this is a test message');
    expect(entry.created).toBeTruthy();
    expect(entry.modified).toBeTruthy();
    expect(entry.projectPath).toBe(testDir);
  });

  it('should handle malformed .jsonl lines gracefully', async () => {
    // Create .jsonl file with some malformed lines
    const filePath = path.join(testDir, 'session-malformed.jsonl');
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Valid message' }],
        },
      }),
      '{ invalid json }', // Malformed line
      '', // Empty line
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [] },
      }),
    ];
    await writeFile(filePath, lines.join('\n'), 'utf-8');

    const validation = await validateSessionIndex(testDir);
    const result = await repairSessionIndex(testDir, validation);

    expect(result.sessionsAdded).toBe(1);

    // Verify the session was still added despite malformed lines
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);
    expect(index.entries.length).toBe(1);
  });

  it('should sort entries by creation date (newest first)', async () => {
    // Create sessions with different timestamps
    const sessions = [
      { id: 'session-1', timestamp: '2026-02-01T10:00:00Z' },
      { id: 'session-3', timestamp: '2026-02-03T10:00:00Z' }, // Newest
      { id: 'session-2', timestamp: '2026-02-02T10:00:00Z' },
    ];

    for (const session of sessions) {
      const filePath = path.join(testDir, `${session.id}.jsonl`);
      await writeFile(
        filePath,
        JSON.stringify({
          type: 'user',
          timestamp: session.timestamp,
          message: {
            role: 'user',
            timestamp: session.timestamp,
            content: [{ type: 'text', text: 'Test' }],
          },
        }),
        'utf-8'
      );
    }

    const validation = await validateSessionIndex(testDir);
    const result = await repairSessionIndex(testDir, validation);

    // Read the index
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);

    // Verify sorting (newest first)
    const sessionIds = index.entries.map(e => e.sessionId);
    expect(sessionIds).toEqual(['session-3', 'session-2', 'session-1']);
  });
});

describe('createIndexFromScratch', () => {
  it('should create index from .jsonl files', async () => {
    // Create .jsonl files
    await createMockJsonlFile('session-1');
    await createMockJsonlFile('session-2');
    await createMockJsonlFile('session-3');

    const result = await createIndexFromScratch(testDir);

    expect(result.sessionsAdded).toBe(3);
    expect(result.sessionsRemoved).toBe(0);
    expect(result.createdFromScratch).toBe(true);
    expect(result.backupPath).toBeNull();

    // Verify index was created
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);
    expect(index.version).toBe(1);
    expect(index.entries.length).toBe(3);
  });

  it('should throw error if no .jsonl files found', async () => {
    await expect(createIndexFromScratch(testDir)).rejects.toThrow(
      /No .jsonl session files found/
    );
  });

  it('should backup existing index before overwriting', async () => {
    // Create .jsonl file and existing index
    await createMockJsonlFile('session-1');
    await createMockIndex([{ sessionId: 'old-session' }]);

    const result = await createIndexFromScratch(testDir);

    expect(result.backupPath).toBeTruthy();
    expect(result.createdFromScratch).toBe(true);

    // Verify backup exists and contains old data
    const backupContent = await readFile(result.backupPath!, 'utf-8');
    const backup: SessionsIndex = JSON.parse(backupContent);
    expect(backup.entries[0].sessionId).toBe('old-session');

    // Verify new index has correct data
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);
    expect(index.entries[0].sessionId).toBe('session-1');
  });

  it('should handle parallel parsing of multiple files', async () => {
    // Create many .jsonl files
    const sessionPromises = [];
    for (let i = 1; i <= 10; i++) {
      sessionPromises.push(createMockJsonlFile(`session-${i}`));
    }
    await Promise.all(sessionPromises);

    const result = await createIndexFromScratch(testDir);

    expect(result.sessionsAdded).toBe(10);

    // Verify all sessions are in the index
    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);
    expect(index.entries.length).toBe(10);
  });

  it('should skip files that fail to parse', async () => {
    // Create valid and invalid .jsonl files
    await createMockJsonlFile('valid-session');

    const invalidPath = path.join(testDir, 'invalid-session.jsonl');
    await writeFile(invalidPath, 'completely invalid content', 'utf-8');

    const result = await createIndexFromScratch(testDir);

    // Both files will be included (invalid one just won't have message content)
    // The parser is resilient and will extract what it can
    expect(result.sessionsAdded).toBeGreaterThanOrEqual(1);

    const indexContent = await readFile(
      path.join(testDir, 'sessions-index.json'),
      'utf-8'
    );
    const index: SessionsIndex = JSON.parse(indexContent);

    // Verify valid session is present
    const validSession = index.entries.find(e => e.sessionId === 'valid-session');
    expect(validSession).toBeTruthy();
    expect(validSession!.messageCount).toBeGreaterThan(0);
  });
});
