/** Worker-only boundary. Never import signer modules into client components. */
export function assertServerRuntime(): void {
  if (typeof window !== "undefined") throw new Error("Server signing is unavailable in browser runtimes");
}
