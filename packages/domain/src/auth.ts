import { jwtVerify, SignJWT } from "jose";
import { DomainError } from "./errors";

export type Provider = "apple" | "google" | "phone" | "supabase";
export type VerifiedIdentity = {
  provider: Provider;
  subject: string;
  email?: string | null;
  phone?: string | null;
  sessionId?: string;
  expiresAt?: number;
};

const providers = new Set<Provider>(["apple", "google", "phone"]);

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signLocalToken(
  secret: string,
  issuer: "solomad-dev" | "solomad-test",
  provider: Provider,
  subject: string,
  expiresIn?: string,
): Promise<string> {
  return new SignJWT({ provider })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience("solomad")
    .setIssuedAt()
    .setExpirationTime(expiresIn ?? (issuer === "solomad-test" ? "1h" : "12h"))
    .sign(secretKey(secret));
}

export async function verifyLocalToken(token: string, secret: string, issuer: "solomad-dev" | "solomad-test"): Promise<VerifiedIdentity> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer,
      audience: "solomad",
      algorithms: ["HS256"],
    });
    const provider = payload.provider;
    if (typeof payload.sub !== "string" || typeof provider !== "string" || !providers.has(provider as Provider)) {
      throw new DomainError("invalid_token", 401, "Token identity is incomplete");
    }
    return { provider: provider as Provider, subject: payload.sub };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("invalid_token", 401, "Token could not be verified");
  }
}
