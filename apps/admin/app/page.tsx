"use client";

import { useState } from "react";

const api = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";

type Health = { users?: number; reports?: number; outbox?: number };

export default function AdminHome() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState("Admin actions require the shared session and an admin role.");

  async function signIn() {
    const response = await fetch(`${api}/v1/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error?.message ?? "Sign-in failed");
      return;
    }
    setToken(body.token);
    setMessage("Session started. Health still needs an admin bearer token plus this session.");
  }

  async function loadHealth(adminBearer: string) {
    const response = await fetch(`${api}/v1/admin/health`, {
      headers: { authorization: `Bearer ${adminBearer}`, "x-admin-session": token },
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error?.message ?? "Health request failed");
      return;
    }
    setHealth(body);
  }

  return (
    <>
      <h1>solomad admin</h1>
      <p>{message}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signIn();
        }}
        style={{ display: "grid", gap: 12, maxWidth: 420 }}
      >
        <input aria-label="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email" />
        <input aria-label="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="password" />
        <button type="submit">start session</button>
      </form>
      <p>Paste the admin user's development bearer token to load health. The password session alone is not enough.</p>
      <AdminHealth token={token} onLoad={loadHealth} health={health} />
    </>
  );
}

function AdminHealth({ token, onLoad, health }: { token: string; onLoad: (bearer: string) => Promise<void>; health: Health | null }) {
  const [bearer, setBearer] = useState("");
  return (
    <section style={{ display: "grid", gap: 12, maxWidth: 640 }}>
      <textarea aria-label="admin bearer" value={bearer} onChange={(event) => setBearer(event.target.value)} rows={4} />
      <button type="button" disabled={!token || bearer.length < 20} onClick={() => void onLoad(bearer)}>
        load health
      </button>
      {health ? <pre>{JSON.stringify(health, null, 2)}</pre> : null}
    </section>
  );
}
