import type { Metadata } from "next";
import { RewardsScreen } from "@/components/rewards-screen";

export const metadata: Metadata = { title: "Rewards" };

export default function Page() {
  return <RewardsScreen />;
}