import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { signLocalToken, verifyLocalToken } from "./auth";

const secret = "local-secret";

describe("development tokens", () => {
  it("keeps the subject from the signed token when a client user id claim is present", async () => {
    const token = await new SignJWT({ provider: "apple", userId: "someone-else" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("dev:mina")
      .setIssuer("solomad-dev")
      .setAudience("solomad")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    const identity = await verifyLocalToken(token, secret, "solomad-dev");
    expect(identity).toEqual({ provider: "apple", subject: "dev:mina" });
  });

  it("rejects missing, malformed, expired, and wrong-audience tokens", async () => {
    await expect(verifyLocalToken("", secret, "solomad-dev")).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verifyLocalToken("not-a-token", secret, "solomad-dev")).rejects.toMatchObject({ code: "invalid_token" });
    const expired = await new SignJWT({ provider: "apple" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("dev:mina")
      .setIssuer("solomad-dev")
      .setAudience("solomad")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(secret));
    await expect(verifyLocalToken(expired, secret, "solomad-dev")).rejects.toMatchObject({ code: "invalid_token" });
    const wrongIssuer = await signLocalToken(secret, "solomad-dev", "apple", "dev:mina");
    await expect(verifyLocalToken(wrongIssuer, secret, "solomad-test")).rejects.toMatchObject({ code: "invalid_token" });
    const wrongAudience = await new SignJWT({ provider: "apple" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("dev:mina")
      .setIssuer("solomad-dev")
      .setAudience("other-project")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    await expect(verifyLocalToken(wrongAudience, secret, "solomad-dev")).rejects.toMatchObject({ code: "invalid_token" });
  });
});
