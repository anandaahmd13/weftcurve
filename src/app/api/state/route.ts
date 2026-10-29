import type { NextRequest } from 'next/server';
import { getSession } from '@/server/auth/session';
import { state } from '@/server/service';
import { handle } from '@/server/http';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>{const session=await getSession(req);return state(session?.wallet??null,session?.csrf??null);});}
