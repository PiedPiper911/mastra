/**
 * Persistence for GitHub user identities (`github_user_identities`, one row
 * per WorkOS user), captured during the connect flow's OAuth identify step.
 * No tokens are stored — all git writes use short-lived installation tokens.
 * The identity only drives commit authorship: GitHub attributes commits by
 * author email, so authoring as `login@users.noreply.github.com` links them
 * to the user's account even when the app pushes.
 */

import { eq } from 'drizzle-orm';

import { getAppDb } from './db';
import { githubUserIdentities } from './schema';

/** GitHub identity of a connected user, used for git authorship. */
export interface GithubIdentity {
  login: string;
  name: string | null;
  email: string | null;
}

/** Upsert the user's GitHub identity (keyed by WorkOS user id). */
export async function saveUserIdentity(userId: string, identity: GithubIdentity): Promise<void> {
  const values = {
    userId,
    githubLogin: identity.login,
    githubName: identity.name,
    githubEmail: identity.email,
    updatedAt: new Date(),
  };
  await getAppDb()
    .insert(githubUserIdentities)
    .values(values)
    .onConflictDoUpdate({ target: githubUserIdentities.userId, set: values });
}

/** The user's stored GitHub identity, or `null` when they never connected. */
export async function getUserIdentity(userId: string): Promise<GithubIdentity | null> {
  const [row] = await getAppDb().select().from(githubUserIdentities).where(eq(githubUserIdentities.userId, userId));
  if (!row) return null;
  return { login: row.githubLogin, name: row.githubName, email: row.githubEmail };
}
