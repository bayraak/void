import type { CloudflareOperation } from '@void/deploy-cloudflare';
import { describe, expect, it, vi } from 'vite-plus/test';

vi.mock('@voidzero-dev/vite-plus-prompts', () => ({
  log: { error: vi.fn(), info: vi.fn(), message: vi.fn(), step: vi.fn(), warn: vi.fn() },
}));

const { log } = await import('@voidzero-dev/vite-plus-prompts');
const { applyAndVerifyRemoteD1Migrations } = await import('../../src/cli/deploy-migrations.ts');

type Answers = { pending: Array<Array<string>>; bookmark?: string };

function recordingRunner(answers: Answers) {
  const calls: Array<CloudflareOperation['type']> = [];
  const lists = [...answers.pending];
  const run = (operation: CloudflareOperation) => {
    calls.push(operation.type);
    if (operation.type === 'd1.migrations.list') {
      return { status: 0, stdout: '', stderr: '', data: { pending: lists.shift() ?? [] } };
    }
    if (operation.type === 'd1.time-travel.bookmark') {
      return answers.bookmark === undefined
        ? { status: 1, stdout: '', stderr: 'Time Travel is unavailable for this database.' }
        : {
            status: 0,
            stdout: '',
            stderr: '',
            data: {
              bookmark: answers.bookmark,
              databaseId: 'a1b2c3d4-0000-4000-8000-000000000001',
            },
          };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, run };
}

describe('the D1 restore point a deploy takes before migrating', () => {
  it('takes a Time Travel bookmark before applying pending migrations, and names how to restore it', async () => {
    const runner = recordingRunner({
      pending: [['0001_add_column.sql'], []],
      bookmark: '00000085-0000024c-00004ef2',
    });

    const applied = await applyAndVerifyRemoteD1Migrations(
      'app-db',
      'wrangler.json',
      runner.run,
      () => true,
    );

    expect(applied).toBe(true);
    expect(runner.calls).toEqual([
      'd1.migrations.list',
      'd1.time-travel.bookmark',
      'd1.migrations.apply',
      'd1.migrations.list',
    ]);
    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      expect.stringContaining(
        'npx cf d1 time-travel restore a1b2c3d4-0000-4000-8000-000000000001 --bookmark=00000085-0000024c-00004ef2',
      ),
    );
  });

  it('refuses to migrate when the bookmark cannot be taken, leaving the database unchanged', async () => {
    const runner = recordingRunner({ pending: [['0001_add_column.sql']] });

    const applied = await applyAndVerifyRemoteD1Migrations(
      'app-db',
      'wrangler.json',
      runner.run,
      () => true,
    );

    expect(applied).toBe(false);
    expect(runner.calls).not.toContain('d1.migrations.apply');
  });

  it('takes no bookmark when no migration is pending', async () => {
    const runner = recordingRunner({ pending: [[], []] });

    const applied = await applyAndVerifyRemoteD1Migrations(
      'app-db',
      'wrangler.json',
      runner.run,
      () => true,
    );

    expect(applied).toBe(true);
    expect(runner.calls).not.toContain('d1.time-travel.bookmark');
  });
});
