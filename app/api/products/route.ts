import { catalog } from '@/lib/catalog';
import { settings,sb } from '@/lib/server';
export async function GET(){const c=settings();if(!c.url||!c.key)return Response.json({products:catalog,preview:true});try{return Response.json({products:await sb('/rest/v1/products?select=*&active=eq.true&order=sort_order.asc',c.key),preview:false});}catch{return Response.json({error:'Products could not be loaded. Please refresh.'},{status:503});}}
