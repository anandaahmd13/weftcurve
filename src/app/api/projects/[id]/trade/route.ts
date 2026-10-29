import type { NextRequest } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { trade,state } from '@/server/service';
import { handle,body,idem } from '@/server/http';
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){return handle(async()=>{const session=await requireSession(req);await trade(session.wallet,idem(req),(await params).id,await body(req));return {state:await state(session.wallet,session.csrf)};});}
