// Hosted Supabase Auth diagnostic. Does not call the solomad API or gateway.
// Prints statuses and field names only.
import { assertDotenvParser } from "./dotenv.mjs";
import { derivedAuth, readStagingFile, validateStagingAuth } from "./staging-env.mjs";

assertDotenvParser();
const values = readStagingFile();
const errors = validateStagingAuth(values ?? {});
if (!values || errors.length > 0) {
  console.log(`SKIPPED  hosted auth diagnostic: ${errors.join("; ") || "missing .env.supabase.staging.local"}`);
  process.exit(3);
}

const auth = derivedAuth(values);
const host = new URL(auth.SUPABASE_URL).hostname;
let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASSED" : "FAILED"}  ${name}${detail ? ` (${detail})` : ""}`);
}

async function statusOnly(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  return response.status;
}

const publishable = { apikey: auth.SUPABASE_PUBLISHABLE_KEY };
const secret = { apikey: auth.SUPABASE_SECRET_KEY, authorization: `Bearer ${auth.SUPABASE_SECRET_KEY}` };
const health = await statusOnly(`${auth.SUPABASE_URL}/auth/v1/health`, publishable);
const secretHealth = await statusOnly(`${auth.SUPABASE_URL}/auth/v1/health`, { apikey: auth.SUPABASE_SECRET_KEY });
check(`publishable key accepted by ${host}`, health >= 200 && health < 300, `status ${health}`);
check(`secret key accepted by the same host`, secretHealth >= 200 && secretHealth < 300, `status ${secretHealth}`);

const adminWithPublishable = await statusOnly(`${auth.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, publishable);
const adminWithSecret = await statusOnly(`${auth.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, secret);
check("publishable key is rejected by the admin API", adminWithPublishable === 401 || adminWithPublishable === 403, `status ${adminWithPublishable}`);
check("secret key can call the admin API", adminWithSecret >= 200 && adminWithSecret < 300, `status ${adminWithSecret}`);

const jwks = await fetch(auth.SUPABASE_JWKS_URL, { signal: AbortSignal.timeout(15000) });
const jwksBody = jwks.ok ? await jwks.json() : null;
check("hosted JWKS is reachable", jwks.ok && Array.isArray(jwksBody?.keys) && jwksBody.keys.length > 0, `status ${jwks.status}, keys ${jwksBody?.keys?.length ?? 0}`);

const signIn = await fetch(`${auth.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { ...publishable, "content-type": "application/json" },
  body: JSON.stringify({ email: auth.SUPABASE_SMOKE_EMAIL, password: auth.SUPABASE_SMOKE_PASSWORD }),
  signal: AbortSignal.timeout(15000),
});
let signInCode = "";
if (!signIn.ok) {
  const body = await signIn.json().catch(() => ({}));
  const code = body.error_code ?? body.error ?? "";
  signInCode = typeof code === "string" ? code : "";
}
check("hosted password sign-in", signIn.ok, `status ${signIn.status}${signInCode ? ` code ${signInCode}` : ""}`);
let session = signIn.ok ? await signIn.json() : null;
if (!session && signInCode === "invalid_credentials") {
  const prepared = await prepareSmokeUser(auth, secret);
  console.log(prepared);
  if (prepared.startsWith("PASSED")) {
    const retry = await fetch(`${auth.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { ...publishable, "content-type": "application/json" },
      body: JSON.stringify({ email: auth.SUPABASE_SMOKE_EMAIL, password: auth.SUPABASE_SMOKE_PASSWORD }),
      signal: AbortSignal.timeout(15000),
    });
    if (retry.ok) {
      session = await retry.json();
      failed -= 1;
      console.log("PASSED  hosted password sign-in after preparing the Auth user (status 200)");
    } else {
      const body = await retry.json().catch(() => ({}));
      const code = typeof (body.error_code ?? body.error) === "string" ? (body.error_code ?? body.error) : "";
      check("hosted password sign-in after preparing the Auth user", false, `status ${retry.status}${code ? ` code ${code}` : ""}`);
    }
  }
}
if (!session) {
  console.log(failed ? `hosted auth diagnostic: ${failed} failed` : "hosted auth diagnostic failed");
  process.exit(1);
}
const user = await fetch(`${auth.SUPABASE_URL}/auth/v1/user`, {
  headers: { ...publishable, authorization: `Bearer ${session.access_token}` },
  signal: AbortSignal.timeout(15000),
});
const userBody = user.ok ? await user.json() : null;
check("hosted user lookup", user.ok && Boolean(userBody?.id), `status ${user.status}`);

const refresh = await fetch(`${auth.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
  method: "POST",
  headers: { ...publishable, "content-type": "application/json" },
  body: JSON.stringify({ refresh_token: session.refresh_token }),
  signal: AbortSignal.timeout(15000),
});
check("hosted refresh", refresh.ok, `status ${refresh.status}`);
const refreshed = refresh.ok ? await refresh.json() : null;
const logout = await fetch(`${auth.SUPABASE_URL}/auth/v1/logout?scope=local`, {
  method: "POST",
  headers: { ...publishable, authorization: `Bearer ${refreshed?.access_token ?? session.access_token}` },
  signal: AbortSignal.timeout(15000),
});
check("hosted logout", logout.status === 204, `status ${logout.status}`);
const after = await fetch(`${auth.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
  method: "POST",
  headers: { ...publishable, "content-type": "application/json" },
  body: JSON.stringify({ refresh_token: refreshed?.refresh_token ?? session.refresh_token }),
  signal: AbortSignal.timeout(15000),
});
check("refresh is rejected after logout", !after.ok, `status ${after.status}`);

console.log(failed ? `hosted auth diagnostic: ${failed} failed` : "hosted auth diagnostic passed");
process.exit(failed ? 1 : 0);

async function prepareSmokeUser(auth, secretHeaders) {
  const listed = await fetch(`${auth.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: secretHeaders,
    signal: AbortSignal.timeout(15000),
  });
  if (!listed.ok) return `FAILED  could not list Auth users before creating the smoke user (status ${listed.status})`;
  const body = await listed.json();
  const existing = (body.users ?? []).find((user) => user.email === auth.SUPABASE_SMOKE_EMAIL);
  if (existing) {
    if (existing.email_confirmed_at) {
      return "FAILED  the smoke Auth user already exists and the password was rejected. Update SUPABASE_SMOKE_PASSWORD to that user's password. The existing password was not changed.";
    }
    const confirm = await fetch(`${auth.SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: { ...secretHeaders, "content-type": "application/json" },
      body: JSON.stringify({ email_confirm: true }),
      signal: AbortSignal.timeout(15000),
    });
    return confirm.ok
      ? "PASSED  confirmed the existing unconfirmed smoke Auth user without changing the password"
      : `FAILED  could not confirm the existing smoke Auth user (status ${confirm.status})`;
  }
  const created = await fetch(`${auth.SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...secretHeaders, "content-type": "application/json" },
    body: JSON.stringify({ email: auth.SUPABASE_SMOKE_EMAIL, password: auth.SUPABASE_SMOKE_PASSWORD, email_confirm: true }),
    signal: AbortSignal.timeout(15000),
  });
  return created.ok
    ? "PASSED  created a confirmed smoke Auth user"
    : `FAILED  could not create the smoke Auth user (status ${created.status})`;
}
