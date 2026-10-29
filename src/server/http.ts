import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
export async function handle(fn:()=>Promise<unknown>){
 try{return NextResponse.json(await fn(),{headers:{'Cache-Control':'no-store'}});}
 catch(error){
  const validation=error instanceof ZodError;
  const message=validation?'Invalid input. Please check the form.':error instanceof Error?error.message:'Request failed.';
  const dbError=error&&typeof error==='object'&&'code' in error;
  const safe=dbError?'Database unavailable or operation failed. Start the database and run migrations.':message;
  return NextResponse.json({error:safe},{status:validation?400:/Sign in required/.test(message)?401:/Origin|CSRF/.test(message)?403:/Too many/.test(message)?429:dbError?503:400,headers:{'Cache-Control':'no-store'}});
 }
}
export async function body(req:NextRequest):Promise<unknown>{
 const content=await req.text();if(content.length>300000)throw new Error('Payload is too large.');return JSON.parse(content);
}
export const idem=(req:NextRequest)=>req.headers.get('idempotency-key')??'';
