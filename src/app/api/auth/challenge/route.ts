import type { NextRequest } from 'next/server';
import { checkOrigin, issueChallenge, rateLimit } from '@/server/auth/session';
import { handle,body } from '@/server/http';
export async function POST(req:NextRequest){return handle(async()=>{checkOrigin(req);await rateLimit('auth-challenge',30);const input=await body(req) as {wallet?:string};if(typeof input.wallet!=='string'||input.wallet.length>50)throw new Error('Invalid wallet address.');return issueChallenge(input.wallet);});}
