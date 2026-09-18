import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ECHO — The Assistant That Never Forgets",
  description: "Persistent memory, temporal reasoning, contradiction handling, and source-traceable answers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
