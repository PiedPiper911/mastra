/**
 * Persistence + refresh for GitHub user-to-server tokens. One row per WorkOS
 * user (`github_user_tokens`), written when the user connects GitHub and read
 * whenever we act *as the user*: pushes, PR creation, and the git/gh
 * credentials injected into their sandbox.
 *
 * Tokens may be expiring (App has "Expire user authorization tokens" enabled:
 * 8h access token + refresh token) or non-expiring. `getFreshUserToken`
 * hides that difference: it refreshes when needed and deletes the row when the
 * refresh token is dead, so callers just get a usable token or `null` (→ fall
 * back to installation tokens).
 */

import { eq } from 'drizzle-orm';

import type { UserTokenSet } from './client';
import { refreshUserToken } from './client';
import { getAppDb } from './db';
import { githubUserTokens } from './schema';

/** GitHub identity stored alongside the token; used for git authorship. */
export interface GithubIdentity {
  login: string;
  name: string | null;
  email: string | null;
}

export interface FreshUserToken {
  token: string;
  identity: GithubIdentity;
}

/** Refresh when the access token expires within this window. */
const EXPIRY_SLACK_MS = 5 * 60_000;

/** Upsert the user's token set + GitHub identity (keyed by WorkOS user id). */
export async function saveUserToken(userId: string, tokenSet: UserTokenSet, identity: GithubIdentity): Promise<void> {
  const values = {
    userId,
    githubLogin: identity.login,
    githubName: identity.name,
    githubEmail: identity.email,
    accessToken: tokenSet.accessToken,
    refreshToken: tokenSet.refreshToken ?? null,
    tokenExpiresAt: tokenSet.expiresAt ?? null,
    refreshTokenExpiresAt: tokenSet.refreshTokenExpiresAt ?? null,
    updatedAt: new Date(),
  };
  await getAppDb()
    .insert(githubUserTokens)
    .values(values)
    .onConflictDoUpdate({ target: githubUserTokens.userId, set: values });
}

/**
 * Get a usable user token for `userId`, refreshing (and persisting the new
 * set) when it expires within {@link EXPIRY_SLACK_MS}. Returns `null` when the
 * user never stored a token or the refresh token is dead/expired — the row is
 * deleted in that case so callers fall back to installation tokens until the
 * user re-connects GitHub.
 */
export async function getFreshUserToken(userId: string): Promise<FreshUserToken | null> {
  const [row] = await getAppDb().select().from(githubUserTokens).where(eq(githubUserTokens.userId, userId));
  if (!row) return null;

  const identity: GithubIdentity = { login: row.githubLogin, name: row.githubName, email: row.githubEmail };

  const expiresSoon = row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() - Date.now() < EXPIRY_SLACK_MS;
  if (!expiresSoon) {
    return { token: row.accessToken, identity };
  }

  const refreshDead =
    !row.refreshToken || (row.refreshTokenExpiresAt !== null && row.refreshTokenExpiresAt.getTime() <= Date.now());
  if (refreshDead) {
    await getAppDb().delete(githubUserTokens).where(eq(githubUserTokens.id, row.id));
    return null;
  }

  try {
    const refreshed = await refreshUserToken(row.refreshToken!);
    await saveUserToken(userId, refreshed, identity);
    return { token: refreshed.accessToken, identity };
  } catch (error) {
    console.warn(`[GitHub] Failed to refresh user token for ${userId}; falling back to installation tokens.`, error);
    // GitHub *rejected* the grant (revoked/expired refresh token) — drop the
    // row so the user re-connects. Transient failures (network, 5xx) keep the
    // row; the next call retries the refresh.
    if (error instanceof Error && error.message.includes('returned no token')) {
      await getAppDb().delete(githubUserTokens).where(eq(githubUserTokens.id, row.id));
    }
    return null;
  }
}
