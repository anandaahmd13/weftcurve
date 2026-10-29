import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { db, transaction } from '../db/client';
import { network, origin, assertSimulator } from '../config';
import { personas } from '../service';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
export const COOKIE='weft_session';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export interface Session { wallet:string; csrf:string }
export async function getSession(req:NextRequest):Promise<Session|null>{
 const token=req.cookies.get(COOKIE)?.value;if(!token)return null;
 const r=(await db.query('SELECT wallet,csrf FROM sessions WHERE id_hash=$1 AND network=$2 AND expires_at>now()',[digest(token),network])).rows[0];return r??null;
}
export async function newSession(wallet:string){
 const token=randomBytes(32).toString('hex');const csrf=randomBytes(24).toString('hex');
 await db.query("INSERT INTO sessions(id_hash,wallet,csrf,network,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')",[digest(token),wallet,csrf,network]);return {token,csrf,wallet};
}
export async function simulatorSession(persona:string){
 assertSimulator();if(!(persona in personas))throw new Error('Invalid simulator identity.');
 const p=personas[persona as keyof typeof personas];
 await db.query('INSERT INTO wallets(address,label) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.address,p.label]);return newSession(p.address);
}
export async function logout(req:NextRequest){const token=req.cookies.get(COOKIE)?.value;if(token)await db.query('DELETE FROM sessions WHERE id_hash=$1',[digest(token)]);}
export function checkOrigin(req:NextRequest){
 if(req.headers.get('origin')!==origin)throw new Error('Origin is not allowed.');
 if(!req.headers.get('content-type')?.startsWith('application/json'))throw new Error('Content-Type must be application/json.');
}
export async function rateLimit(key:string,limit=60){
 const window=Math.floor(Date.now()/60000);
 const r=await db.query('INSERT INTO rate_limits(key,window_id,hits) VALUES($1,$2,1) ON CONFLICT(key,window_id) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits',[key,window]);
 if(r.rows[0].hits>limit)throw new Error('Too many requests. Please try again shortly.');
}
export async function requireSession(req:NextRequest){checkOrigin(req);const session=await getSession(req);if(!session)throw new Error('Sign in required.');if(req.headers.get('x-csrf-token')!==session.csrf)throw new Error('Invalid CSRF token.');await rateLimit('mutation:'+session.wallet);return session;}
export async function issueChallenge(wallet:string){
 if(network!=='devnet')throw new Error('Real wallet connections are only available on devnet.');
 if(bs58.decode(wallet).length!==32)throw new Error('Invalid wallet address.');
 const nonce=randomBytes(16).toString('hex');const issued=new Date();const expires=new Date(issued.getTime()+300000);
 const domain=new URL(origin).host;
 const message=`${domain} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to weftcurve.fun on devnet. This does not submit a transaction or grant permission to move funds.\n\nURI: ${origin}\nVersion: 1\nChain ID: solana:devnet\nNonce: ${nonce}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${expires.toISOString()}`;
 await db.query('INSERT INTO challenges(nonce,wallet,message,expires_at) VALUES($1,$2,$3,$4)',[nonce,wallet,message,expires]);return {nonce,message};
}
export async function verifyChallenge(nonce:string,signature:string){
 if(network!=='devnet')throw new Error('Real wallet connections are only available on devnet.');
 const wallet=await transaction(async c=>{
  const r=(await c.query('SELECT * FROM challenges WHERE nonce=$1 AND consumed=false AND expires_at>now() FOR UPDATE',[nonce])).rows[0];
  if(!r)throw new Error('Challenge has expired or has already been used.');
  const sig=bs58.decode(signature);const pub=bs58.decode(r.wallet);
  if(sig.length!==64||pub.length!==32||!nacl.sign.detached.verify(new TextEncoder().encode(r.message),sig,pub))throw new Error('Invalid signature.');
  await c.query('UPDATE challenges SET consumed=true WHERE nonce=$1',[nonce]);return r.wallet as string;
 });return newSession(wallet);
}
