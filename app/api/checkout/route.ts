import type { Order } from '@/lib/types';
import { z } from 'zod';
import { settings,sb } from '@/lib/server';
import { money } from '@/lib/catalog';
const input=z.object({requestId:z.string().uuid(),name:z.string().trim().min(2).max(100),phone:z.string().trim().min(7).max(25).regex(/^[+\d\s()-]+$/),address:z.string().trim().min(5).max(300),city:z.string().trim().min(2).max(100),state:z.string().trim().min(2).max(100)});
export async function POST(req:Request){
 const c=settings(); if(!(c.url&&c.key&&c.service&&c.mailKey&&c.domain&&c.from))return Response.json({error:'Checkout is not available yet. Please try again later.'},{status:503});
 if(req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)return Response.json({error:'Please sign in with Google.'},{status:401});
 let user;try{user=await sb<{id:string;is_anonymous:boolean;email:string;email_confirmed_at:string}>('/auth/v1/user',token);}catch{return Response.json({error:'Your session expired. Please sign in again.'},{status:401});}
 if(user.is_anonymous||!user.email||!user.email_confirmed_at)return Response.json({error:'Please sign in with Google before checkout.'},{status:401});
 let data;try{data=input.parse(await req.json());}catch{return Response.json({error:'Please check your delivery details.'},{status:400});}
 try{
  const order=await sb<Order>('/rest/v1/rpc/place_order',c.service,{method:'POST',body:JSON.stringify({p_user_id:user.id,p_request_id:data.requestId,p_name:data.name,p_phone:data.phone,p_address:data.address,p_city:data.city,p_state:data.state})});
  const headers={apikey:c.service,Prefer:'return=representation'};
  const claims=await sb<Order[]>(`/rest/v1/orders?id=eq.${order.id}&email_status=in.(pending,failed)`,c.service,{method:'PATCH',headers,body:JSON.stringify({email_status:'sending'})});
  let emailStatus=order.email_status;
  if(claims.length){
   const form=new FormData(); form.set('from',c.from);form.set('to',order.email);form.set('subject',`Order confirmed · ${order.reference}`);
   form.set('text',`Hi ${order.customer_name},\n\nYour Stark Supply order ${order.reference} is confirmed.\n\n${order.items.map((i:{name:string;quantity:number;price:number})=>`${i.name} × ${i.quantity}: ${money(i.price*i.quantity)}`).join('\n')}\nDelivery: ${money(order.delivery_fee)}\nTotal: ${money(order.total)}\n\nDeliver to: ${order.address}, ${order.city}, ${order.state}\nPayment: Cash on delivery.\n\nThank you for shopping with Stark Supply.`);
   try{const mail=await fetch(`https://${c.region==='EU'?'api.eu.mailgun.net':'api.mailgun.net'}/v3/${encodeURIComponent(c.domain)}/messages`,{method:'POST',headers:{Authorization:'Basic '+btoa('api:'+c.mailKey)},body:form,signal:AbortSignal.timeout(15000)});emailStatus=mail.ok?'sent':'failed';if(!mail.ok)console.error('Mailgun rejected receipt',mail.status);}catch{emailStatus='failed';}
   await sb(`/rest/v1/orders?id=eq.${order.id}`,c.service,{method:'PATCH',headers,body:JSON.stringify({email_status:emailStatus})});
  }
  return Response.json({...order,email_status:emailStatus});
 }catch(e){console.error('Checkout error',e instanceof Error?e.message:'Unknown error');return Response.json({error:'We could not complete checkout. Retry with the same details; your order will not be duplicated.'},{status:503});}
}
