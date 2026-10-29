import type { NextRequest } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { claimReward } from '@/server/service';
import { handle,body,idem } from '@/server/http';
export async function POST(req:NextRequest){return handle(async()=>{const session=await requireSession(req);const input=await body(req) as {projectId?:string};if(typeof input.projectId!=='string')throw new Error('Token is required.');return claimReward(session.wallet,idem(req),input.projectId);});}
