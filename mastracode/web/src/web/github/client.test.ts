import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exchangeOAuthCode, normalizePrivateKey } from './client.js';

// Real RSA key so we can prove Node's PEM decoder accepts the normalized
// output (the failure mode is `error:1E08010C:DECODER routines::unsupported`).
const { privateKey: pem } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

describe('normalizePrivateKey', () => {
  it('passes a proper multi-line PEM through unchanged', () => {
    expect(normalizePrivateKey(pem)).toBe(pem);
    expect(() => createPrivateKey(normalizePrivateKey(pem))).not.toThrow();
  });

  it('converts \\n-escaped single-line PEMs', () => {
    const escaped = pem.replace(/\n/g, '\\n');
    expect(() => createPrivateKey(normalizePrivateKey(escaped))).not.toThrow();
  });

  it('rebuilds fully flattened PEMs (newlines stripped by env tooling)', () => {
    const flattened = pem.replace(/\n/g, '');
    expect(flattened).not.toContain('\n');
    const normalized = normalizePrivateKey(flattened);
    expect(() => createPrivateKey(normalized)).not.toThrow();
  });

  it('leaves non-PEM values untouched', () => {
    expect(normalizePrivateKey('not-a-key')).toBe('not-a-key');
  });
});

describe('user token exchange', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GITHUB_APP_ID', '1');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', pem);
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'client-id');
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GITHUB_APP_SLUG', 'test-app');
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('exchanges the code for an access token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'ghu_abc' }));

    const token = await exchangeOAuthCode('the-code', 'https://app/callback');

    expect(token).toBe('ghu_abc');
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ code: 'the-code', redirect_uri: 'https://app/callback' });
  });

  it('throws when GitHub returns no token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad_verification_code' }));

    await expect(exchangeOAuthCode('bad', 'https://app/callback')).rejects.toThrow(/returned no token/);
  });
});
