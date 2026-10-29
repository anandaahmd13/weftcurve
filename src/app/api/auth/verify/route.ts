import type { NextRequest } from 'next/server';
import { checkOrigin,verifyChallenge,rateLimit,COOKIE,logout } from '@/server/auth/session';
import { handle,body } from '@/server/http';
import { origin } from '@/server/config';
import { state } from '@/server/service';
export async function POST(req:NextRequest){let token:string|undefined;const result=await handle(async()=>{checkOrigin(req);await rateLimit('auth-verify',30);const input=await body(req) as {nonce?:string;signature?:string};if(typeof input.nonce!=='string'||typeof input.signature!=='string'||input.signature.length>100)throw new Error('Invalid signature.');const session=await verifyChallenge(input.nonce,input.signature);await logout(req);token=session.token;return state(session.wallet,session.csrf);});if(token)result.cookies.set(COOKIE,token,{httpOnly:true,sameSite:'strict',secure:origin.startsWith('https:'),path:'/',maxAge:28800});return result;}
