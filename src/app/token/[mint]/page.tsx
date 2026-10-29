import type { Metadata } from "next";
import { TokenScreen } from "@/components/token-screen";

export const metadata: Metadata = { title: "Token details" };

export default async function Page({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return <TokenScreen mint={mint} />;
}
