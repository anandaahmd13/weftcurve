import type { NextRequest } from 'next/server';
import { COOKIE, requireSession } from '@/server/auth/session';
import { body, handle } from '@/server/http';
import { resetSimulator } from '@/server/simulator-tools';

export async function POST(req: NextRequest) {
  let reset = false;
  const response = await handle(async () => {
    await requireSession(req);
    const input = await body(req) as { confirmation?: string };
    if (input.confirmation !== 'RESET LOCAL SIMULATOR') throw new Error('Type RESET LOCAL SIMULATOR to confirm this destructive local action.');
    await resetSimulator();
    reset = true;
    return { reset: true };
  });
  if (reset) response.cookies.delete(COOKIE);
  return response;
}
