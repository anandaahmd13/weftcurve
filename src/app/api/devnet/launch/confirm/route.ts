import type { NextRequest } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { confirmDevnetLaunch } from '@/server/devnet';
import { handle,body } from '@/server/http';
export async function POST(req:NextRequest){return handle(async()=>{const session=await requireSession(req);const input=await body(req) as {intentId?:string};if(typeof input.intentId!=='string')throw new Error('Launch intent is required.');return confirmDevnetLaunch(session.wallet,input.intentId);});}
