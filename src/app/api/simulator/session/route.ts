import { NextResponse, type NextRequest } from 'next/server';
import { checkOrigin, rateLimit, simulatorSession, logout, COOKIE } from '@/server/auth/session';
import { body,handle } from '@/server/http';
import { state } from '@/server/service';
import { origin } from '@/server/config';
export async function POST(req:NextRequest){
 let token:string|undefined;
 const response=await handle(async()=>{
  checkOrigin(req);
  if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('Simulator is only available on localhost.');
  await rateLimit('simulator-session',30);
  const input=await body(req) as {persona?:string};
  if(typeof input.persona!=='string')throw new Error('Choose a simulator identity.');
  await logout(req);const session=await simulatorSession(input.persona);token=session.token;
  return state(session.wallet,session.csrf);
 });
 if(token&&response instanceof NextResponse)response.cookies.set(COOKIE,token,{httpOnly:true,sameSite:'strict',secure:origin.startsWith('https:'),path:'/',maxAge:28800});return response;
}
