import { randomNonce, randomPKCECodeVerifier, randomState } from "openid-client";
import * as client from "openid-client";
import { eq } from "drizzle-orm";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { analytics } from "./analytics";
import { db } from "./db";
import {
  appUrl,
  authSubkey,
  newAccountsPerHour,
  oidcClientId,
  oidcClientSecret,
  oidcIssuer,
  oidcRedirectUri,
  OIDC_TRANSACTION_TTL_SECONDS,
  oidcTransactionCookieName,
  secureCookies,
} from "./env";
import { ApiError } from "./http";
import { log, summarizeError } from "./log";
import { consumeRateLimit, ensureSettings } from "./repo";
import { users } from "./schema";
import { createSession } from "./session";
import { ensureWorkspaceKey } from "./workspace-key";

const STATE_PATH = /^\/(chat|onboarding)(\/[0-9a-f-]{36})?$/i;

let configuration: Promise<client.Configuration> | undefined;

function oidcConfiguration(): Promise<client.Configuration> {
  configuration ??= (async () => {
    const issuer = new URL(oidcIssuer());
    const options = {
      ...(issuer.protocol === "http:" ? { execute: [client.allowInsecureRequests] } : {}),
      // Discovery must not hang a sign-in attempt indefinitely.
      timeout: 15_000,
    };
    return client.discovery(issuer, oidcClientId(), oidcClientSecret(), undefined, options);
  })().catch((error) => {
    configuration = undefined;
    throw error;
  });
  return configuration;
}

function transactionKey(): Buffer {
  return authSubkey("oidc-transaction");
}

export async function beginLogin(returnTo: string | null): Promise<string> {
  const config = await oidcConfiguration();
  const state = randomState();
  const nonce = randomNonce();
  const verifier = randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const redirectTo = returnTo && STATE_PATH.test(returnTo) ? returnTo : "/chat";

  const transaction = await new EncryptJWT({ state, nonce, verifier, returnTo: redirectTo })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${OIDC_TRANSACTION_TTL_SECONDS}s`)
    .encrypt(transactionKey());

  const store = await cookies();
  store.set(oidcTransactionCookieName(), transaction, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: OIDC_TRANSACTION_TTL_SECONDS,
  });

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: oidcRedirectUri(),
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return url.href;
}

interface OidcClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
}

function verifiedEmail(claims: OidcClaims): string {
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!email || !verified) {
    throw new ApiError("AUTH_EMAIL_UNVERIFIED", "Google did not provide a verified email address.", 403);
  }
  return email;
}

/** New accounts share a global hourly budget, so a flood of sign-ups cannot grow the database unbounded. */
export async function admitNewAccount(): Promise<void> {
  try {
    await consumeRateLimit("signups:all", newAccountsPerHour(), 3600);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "RATE_LIMITED") throw error;
    log.warn("Hourly new-account cap reached", { cap: newAccountsPerHour() });
    throw new ApiError("SIGNUPS_PAUSED", "New sign-ups are paused for a while. Try again later.", 429);
  }
}

async function upsertUser(claims: OidcClaims): Promise<{ id: string; isNew: boolean }> {
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) throw new ApiError("AUTH_FAILED", "Google did not return a stable account id.", 502);
  const email = verifiedEmail(claims);
  const name = typeof claims.name === "string" ? claims.name.trim().slice(0, 200) : null;
  const avatarUrl = typeof claims.picture === "string" ? claims.picture.trim().slice(0, 2000) : null;
  const now = new Date();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.googleSub, sub)).limit(1);
  // Returning users always get in; only new accounts count against the sign-up cap.
  if (!existing) await admitNewAccount();

  const [user] = await db
    .insert(users)
    .values({ googleSub: sub, email, emailVerified: true, name, avatarUrl, updatedAt: now })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: { email, emailVerified: true, name, avatarUrl, updatedAt: now },
    })
    .returning({ id: users.id });

  await ensureSettings(user.id);
  await ensureWorkspaceKey(user.id);
  return { id: user.id, isNew: !existing };
}

async function readTransaction(): Promise<{
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}> {
  const store = await cookies();
  const token = store.get(oidcTransactionCookieName())?.value;
  if (!token) throw new ApiError("AUTH_STATE_INVALID", "The sign-in request expired. Try again.", 400);
  try {
    const { payload } = await jwtDecrypt(token, transactionKey());
    const { state, nonce, verifier, returnTo } = payload as Record<string, unknown>;
    if (typeof state !== "string" || typeof nonce !== "string" || typeof verifier !== "string") {
      throw new Error("Missing transaction fields.");
    }
    return {
      state,
      nonce,
      verifier,
      returnTo: typeof returnTo === "string" && STATE_PATH.test(returnTo) ? returnTo : "/chat",
    };
  } catch (error) {
    log.warn("OIDC transaction cookie rejected", { error: summarizeError(error) });
    throw new ApiError("AUTH_STATE_INVALID", "The sign-in request expired. Try again.", 400);
  }
}

export async function completeLogin(requestUrl: string): Promise<{ returnTo: string }> {
  const transaction = await readTransaction();
  const config = await oidcConfiguration();
  const currentUrl = new URL(`${appUrl()}/api/auth/callback/google`);
  const incoming = new URL(requestUrl);
  currentUrl.search = incoming.search;

  let claims: client.IDToken;
  try {
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: transaction.verifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });
    const verified = tokens.claims();
    if (!verified) throw new Error("The identity provider returned no ID token claims.");
    claims = verified;
  } catch (error) {
    log.warn("Google OIDC exchange failed", { error: summarizeError(error) });
    throw new ApiError("AUTH_FAILED", "Google sign-in could not be completed. Try again.", 502);
  }

  const user = await upsertUser(claims as OidcClaims);
  await createSession(user.id);
  if (user.isNew) analytics.capture(user.id, "account_created", {});
  const store = await cookies();
  // `delete()` omits Secure, which browsers reject for a __Host- cookie; set an explicit expired
  // cookie with the same attributes instead.
  store.set(oidcTransactionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 0,
  });
  return { returnTo: user.isNew ? "/onboarding" : transaction.returnTo };
}
