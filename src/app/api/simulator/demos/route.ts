import type { NextRequest } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { handle } from '@/server/http';
import { loadDemoScenarios } from '@/server/simulator-tools';
import { state } from '@/server/service';

export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = await requireSession(req);
    const result = await loadDemoScenarios();
    return { ...result, state: await state(session.wallet, session.csrf) };
  });
}
