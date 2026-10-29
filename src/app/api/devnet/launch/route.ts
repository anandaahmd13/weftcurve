import type { NextRequest } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { prepareDevnetLaunch } from '@/server/devnet';
import { handle,body,idem } from '@/server/http';
export async function POST(req:NextRequest){return handle(async()=>{const session=await requireSession(req);return prepareDevnetLaunch(session.wallet,idem(req),await body(req));});}
