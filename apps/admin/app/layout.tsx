import type { ReactNode } from "react";

export const metadata = { title: "solomad admin" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", background: "#f7f7f8", color: "#111" }}>
        <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
