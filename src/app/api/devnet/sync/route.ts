import type { NextRequest } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { syncDevnetProject } from '@/server/devnet-sync';
import { handle,body } from '@/server/http';
import { state } from '@/server/service';
export async function POST(req:NextRequest){return handle(async()=>{const session=await requireSession(req);const input=await body(req) as {projectId?:string};if(typeof input.projectId!=='string')throw new Error('Project is required.');await syncDevnetProject(input.projectId,session.wallet);return {state:await state(session.wallet,session.csrf)};});}
