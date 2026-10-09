import type { ReactNode } from "react";

export const metadata = {
  title: "solomad",
  description: "Public pages for shared activities, legal drafts, and app download fallback.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#ffffff", color: "#111111", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
        <header style={{ padding: "24px", fontWeight: 700, fontSize: 24 }}>solomad</header>
        <main style={{ maxWidth: 720, padding: "0 24px 48px" }}>{children}</main>
      </body>
    </html>
  );
}
