import type { NextRequest } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { distribute,state } from '@/server/service';
import { handle,idem } from '@/server/http';
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){return handle(async()=>{const session=await requireSession(req);await distribute(session.wallet,idem(req),(await params).id);return {state:await state(session.wallet,session.csrf)};});}
