import type { NextRequest } from 'next/server';
import { requireSession,logout,COOKIE } from '@/server/auth/session';
import { handle } from '@/server/http';
export async function POST(req:NextRequest){const result=await handle(async()=>{await requireSession(req);await logout(req);return {ok:true};});if(result.ok)result.cookies.delete(COOKIE);return result;}
