import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProvider } from "@/components/app-provider";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "weftcurve — Token rewards, clearly shared", template: "%s · weftcurve" },
  description: "Launch tokens and test transparent creator-fee sharing with your community. Local simulator, no real funds.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><AppProvider><AppShell>{children}</AppShell></AppProvider></body></html>;
}
