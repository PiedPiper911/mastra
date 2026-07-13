import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal drizzle stubs (mirrors sandbox.test.ts): selects consume a queue,
// inserts/deletes are recorded for assertions.
vi.mock('drizzle-orm', () => ({
  eq: (column: any, value: any) => ({ kind: 'eq', column: column?.name, value }),
}));

const dbSelectQueue: Array<Array<Record<string, unknown>>> = [];
const dbInserts: Array<Record<string, unknown>> = [];
const dbDeletes: Array<unknown> = [];
vi.mock('./db', () => ({
  getAppDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => dbSelectQueue.shift() ?? [],
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          dbInserts.push(vals);
        },
      }),
    }),
    delete: () => ({
      where: async (cond: unknown) => {
        dbDeletes.push(cond);
      },
    }),
  }),
}));

const refreshUserToken = vi.fn();
vi.mock('./client', () => ({
  refreshUserToken: (token: string) => refreshUserToken(token),
}));

import type { GithubUserTokenRow } from './schema';
import { getFreshUserToken, saveUserToken } from './user-token';

function makeRow(overrides: Partial<GithubUserTokenRow> = {}): GithubUserTokenRow {
  return {
    id: 'tok-1',
    userId: 'user-1',
    githubLogin: 'octocat',
    githubName: 'Octo Cat',
    githubEmail: null,
    accessToken: 'ghu_live',
    refreshToken: 'ghr_live',
    tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 180 * 24 * 3600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  dbSelectQueue.length = 0;
  dbInserts.length = 0;
  dbDeletes.length = 0;
  refreshUserToken.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveUserToken', () => {
  it('upserts the token set with the GitHub identity', async () => {
    await saveUserToken(
      'user-1',
      { accessToken: 'ghu_abc', refreshToken: 'ghr_def', expiresAt: new Date(1000) },
      { login: 'octocat', name: 'Octo Cat', email: 'octo@cat.dev' },
    );

    expect(dbInserts).toHaveLength(1);
    expect(dbInserts[0]).toMatchObject({
      userId: 'user-1',
      githubLogin: 'octocat',
      githubName: 'Octo Cat',
      githubEmail: 'octo@cat.dev',
      accessToken: 'ghu_abc',
      refreshToken: 'ghr_def',
      refreshTokenExpiresAt: null,
    });
  });
});

describe('getFreshUserToken', () => {
  it('returns null when the user never stored a token', async () => {
    expect(await getFreshUserToken('user-none')).toBeNull();
  });

  it('returns the stored token when it is not near expiry', async () => {
    dbSelectQueue.push([makeRow()]);

    const fresh = await getFreshUserToken('user-1');

    expect(fresh).toEqual({
      token: 'ghu_live',
      identity: { login: 'octocat', name: 'Octo Cat', email: null },
    });
    expect(refreshUserToken).not.toHaveBeenCalled();
  });

  it('returns a non-expiring token without refreshing', async () => {
    dbSelectQueue.push([makeRow({ tokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null })]);

    const fresh = await getFreshUserToken('user-1');

    expect(fresh?.token).toBe('ghu_live');
    expect(refreshUserToken).not.toHaveBeenCalled();
  });

  it('refreshes and persists when the token expires within the slack window', async () => {
    dbSelectQueue.push([makeRow({ tokenExpiresAt: new Date(Date.now() + 60_000) })]);
    refreshUserToken.mockResolvedValueOnce({
      accessToken: 'ghu_new',
      refreshToken: 'ghr_new',
      expiresAt: new Date(Date.now() + 8 * 3600_000),
    });

    const fresh = await getFreshUserToken('user-1');

    expect(fresh?.token).toBe('ghu_new');
    expect(refreshUserToken).toHaveBeenCalledWith('ghr_live');
    expect(dbInserts[0]).toMatchObject({ userId: 'user-1', accessToken: 'ghu_new', refreshToken: 'ghr_new' });
  });

  it('deletes the row and returns null when the refresh token is expired', async () => {
    dbSelectQueue.push([
      makeRow({
        tokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: new Date(Date.now() - 1000),
      }),
    ]);

    expect(await getFreshUserToken('user-1')).toBeNull();
    expect(dbDeletes).toHaveLength(1);
    expect(refreshUserToken).not.toHaveBeenCalled();
  });

  it('deletes the row and returns null when GitHub rejects the refresh grant', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    dbSelectQueue.push([makeRow({ tokenExpiresAt: new Date(Date.now() + 60_000) })]);
    refreshUserToken.mockRejectedValueOnce(new Error('GitHub OAuth token refresh returned no token: bad grant'));

    expect(await getFreshUserToken('user-1')).toBeNull();
    expect(dbDeletes).toHaveLength(1);
  });

  it('keeps the row on transient refresh failures so the next call retries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    dbSelectQueue.push([makeRow({ tokenExpiresAt: new Date(Date.now() + 60_000) })]);
    refreshUserToken.mockRejectedValueOnce(new Error('GitHub OAuth token refresh failed: 502'));

    expect(await getFreshUserToken('user-1')).toBeNull();
    expect(dbDeletes).toHaveLength(0);
  });
});
