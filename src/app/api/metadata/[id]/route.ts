import { NextResponse } from 'next/server';
import { db } from '@/server/db/client';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Not found'},{status:404});const row=(await db.query('SELECT metadata FROM launch_intents WHERE id=$1',[id])).rows[0];return row?NextResponse.json(row.metadata):NextResponse.json({error:'Not found'},{status:404});}
