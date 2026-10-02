import { settings } from '@/lib/server';
export async function GET(){const c=settings();return Response.json({url:c.url,key:c.key,configured:!!(c.url&&c.key),checkoutReady:!!(c.url&&c.key&&c.service&&c.mailKey&&c.domain&&c.from)},{headers:{'Cache-Control':'no-store'}});}
