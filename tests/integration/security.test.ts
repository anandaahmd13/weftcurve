import { beforeAll,afterAll,it,expect } from 'vitest';
import { NextRequest } from 'next/server';
import { migrate } from '../../src/server/db/migrate';
import { db } from '../../src/server/db/client';
import { checkOrigin,getSession,newSession,requireSession } from '../../src/server/auth/session';
beforeAll(()=>migrate());afterAll(()=>db.end());
it('rejects cross-origin mutation',()=>{expect(()=>checkOrigin(new NextRequest('http://localhost:3000/api/claims',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'}}))).toThrow('Origin');});
it('requires session and CSRF, not a typed wallet address',async()=>{
 const request=(headers:Record<string,string>)=>new NextRequest('http://localhost:3000/api/claims',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',...headers}});
 await expect(requireSession(request({'x-wallet':'sim:holder-a'}))).rejects.toThrow('Sign in required');
 const session=await newSession('sim:security');
 const cookie=`weft_session=${session.token}`;
 expect(await getSession(request({cookie}))).toEqual({wallet:'sim:security',csrf:session.csrf});
 await expect(requireSession(request({cookie}))).rejects.toThrow('CSRF');
 await expect(requireSession(request({cookie,'x-csrf-token':session.csrf}))).resolves.toEqual({wallet:'sim:security',csrf:session.csrf});
});
