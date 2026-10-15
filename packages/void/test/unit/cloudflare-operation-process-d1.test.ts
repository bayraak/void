import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vite-plus/test';
import { encodeCloudflareOperation } from '../../src/cli/cloudflare-process.ts';

it('passes the validated custom D1 migration pattern to cf', () => {
  const directory = mkdtempSync(join(tmpdir(), 'void-cf-d1-pattern-test-'));
  try {
    const config = join(directory, 'wrangler.json');
    const capture = join(directory, 'cf-args.json');
    const preload = join(directory, 'capture-cf.mjs');
    writeFileSync(
      config,
      JSON.stringify({
        d1_databases: [
          {
            binding: 'DB',
            database_id: 'database-id',
            migrations_dir: 'db/migrations',
            migrations_pattern: 'db/migrations/*/migration.sql',
          },
        ],
      }),
    );
    writeFileSync(
      preload,
      `import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
child.spawnSync = (_binary, args) => {
  writeFileSync(process.env.VOID_TEST_CF_CAPTURE, JSON.stringify(args));
  return { status: 0, stdout: '[]', stderr: '' };
};
syncBuiltinESMExports();
`,
    );
    const entry = join(
      import.meta.dirname,
      '..',
      '..',
      'src',
      'cli',
      'cloudflare-operation-process.ts',
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        entry,
        ...encodeCloudflareOperation({
          type: 'd1.migrations.list',
          database: 'DB',
          configPath: config,
        }),
      ],
      {
        env: { ...process.env, VOID_TEST_CF_CAPTURE: capture },
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect((JSON.parse(readFileSync(capture, 'utf8')) as Array<string>).slice(1)).toEqual([
      'd1',
      'migrations',
      'list',
      'database-id',
      '--dir',
      'db/migrations',
      '--pattern',
      'db/migrations/*/migration.sql',
      '--table',
      'd1_migrations',
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('takes the D1 Time Travel bookmark through cf by database id', () => {
  const directory = mkdtempSync(join(tmpdir(), 'void-cf-d1-bookmark-test-'));
  try {
    const config = join(directory, 'wrangler.json');
    const capture = join(directory, 'cf-args.json');
    const preload = join(directory, 'capture-cf.mjs');
    writeFileSync(
      config,
      JSON.stringify({ d1_databases: [{ binding: 'DB', database_id: 'database-id' }] }),
    );
    writeFileSync(
      preload,
      `import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
child.spawnSync = (_binary, args) => {
  writeFileSync(process.env.VOID_TEST_CF_CAPTURE, JSON.stringify(args));
  return { status: 0, stdout: '{"bookmark":"00000085-0000024c-00004ef2"}', stderr: '' };
};
syncBuiltinESMExports();
`,
    );
    const entry = join(
      import.meta.dirname,
      '..',
      '..',
      'src',
      'cli',
      'cloudflare-operation-process.ts',
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        entry,
        ...encodeCloudflareOperation({
          type: 'd1.time-travel.bookmark',
          database: 'DB',
          configPath: config,
        }),
      ],
      {
        env: { ...process.env, VOID_TEST_CF_CAPTURE: capture },
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect((JSON.parse(readFileSync(capture, 'utf8')) as Array<string>).slice(1)).toEqual([
      'd1',
      'time-travel',
      'get-bookmark',
      'database-id',
    ]);
    expect(result.stdout).toContain('00000085-0000024c-00004ef2');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
