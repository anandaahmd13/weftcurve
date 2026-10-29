import type { Metadata } from "next";
import { LaunchScreen } from "@/components/launch-screen";

export const metadata: Metadata = { title: "Launch token" };

export default function Page() {
  return <LaunchScreen />;
}
