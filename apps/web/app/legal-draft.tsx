import type { ReactNode } from "react";

export function LegalDraft({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <p>Draft awaiting operator approval.</p>
      <h1>{title}</h1>
      {children}
      <p>
        <a href="/privacy">Privacy</a>
        {" · "}
        <a href="/terms">Terms</a>
        {" · "}
        <a href="/guidelines">Guidelines</a>
        {" · "}
        <a href="/contact">Contact</a>
        {" · "}
        <a href="/deletion">Deletion</a>
      </p>
    </>
  );
}
