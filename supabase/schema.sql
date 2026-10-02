-- Run once in the Supabase SQL editor. Prices are integer kobo.
begin;
create table public.products (
 id uuid primary key, name text not null, description text not null, category text not null,
 price bigint not null check(price > 0 and price < 1000000000), image text not null, tag text not null,
 active boolean not null default true, sort_order integer not null default 0
);
create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text, full_name text, created_at timestamptz not null default now()
);
create table public.cart_items (
 user_id uuid not null references auth.users(id) on delete cascade,
 product_id uuid not null references public.products(id),
 quantity integer not null check(quantity between 1 and 20),
 primary key(user_id,product_id)
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 request_id uuid not null, reference text not null unique,
 customer_name text not null, email text not null, phone text not null,
 address text not null, city text not null, state text not null,
 subtotal bigint not null, delivery_fee bigint not null, total bigint not null,
 payment_method text not null default 'cash_on_delivery', status text not null default 'confirmed',
 email_status text not null default 'pending' check(email_status in ('pending','sending','sent','failed')),
 created_at timestamptz not null default now(), unique(user_id,request_id)
);
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 product_id uuid not null references public.products(id), name text not null, image text not null,
 price bigint not null, quantity integer not null check(quantity between 1 and 20)
);
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
create policy "Read available products" on public.products for select to anon,authenticated using(active);
create policy "Read own profile" on public.profiles for select to authenticated using(auth.uid()=user_id);
create policy "Read own cart" on public.cart_items for select to authenticated using(auth.uid()=user_id);
create policy "Add own cart items" on public.cart_items for insert to authenticated with check(auth.uid()=user_id and exists(select 1 from public.products where id=product_id and active));
create policy "Update own cart items" on public.cart_items for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id and exists(select 1 from public.products where id=product_id and active));
create policy "Remove own cart items" on public.cart_items for delete to authenticated using(auth.uid()=user_id);
create policy "Read own orders" on public.orders for select to authenticated using(auth.uid()=user_id);
create policy "Read own order items" on public.order_items for select to authenticated using(exists(select 1 from public.orders where id=order_id and user_id=auth.uid()));
grant select on public.products to anon,authenticated;
grant select on public.profiles,public.orders,public.order_items to authenticated;
grant select,insert,update,delete on public.cart_items to authenticated;
-- The only writer of orders is the server's service-role checkout function.
revoke insert,update,delete on public.orders,public.order_items,public.profiles from anon,authenticated;
create function public.sync_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(user_id,email,full_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'))
 on conflict(user_id) do update set email=excluded.email,full_name=excluded.full_name;
 return new;
end; $$;
create trigger sync_shop_profile after insert or update on auth.users for each row execute function public.sync_profile();
insert into public.profiles(user_id,email,full_name) select id,email,raw_user_meta_data->>'full_name' from auth.users on conflict do nothing;
create function public.place_order(p_user_id uuid,p_request_id uuid,p_name text,p_phone text,p_address text,p_city text,p_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; sub bigint; fee bigint; mail text; item_count integer; available_count integer; oid uuid=gen_random_uuid();
begin
 -- Serialize checkout retries for one shopper, including requests with new IDs.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select * into o from public.orders where user_id=p_user_id and request_id=p_request_id;
 if not found then
  select email into mail from auth.users where id=p_user_id and not is_anonymous and email_confirmed_at is not null;
  if mail is null then raise exception 'Google sign-in required'; end if;
  if length(trim(p_name)) not between 2 and 100 or length(p_phone) not between 7 and 25 or length(trim(p_address)) not between 5 and 300 or length(trim(p_city)) not between 2 and 100 or length(trim(p_state)) not between 2 and 100 then raise exception 'Invalid delivery details'; end if;
  perform 1 from public.cart_items where user_id=p_user_id for update;
  select count(*) into item_count from public.cart_items where user_id=p_user_id;
  select count(*),sum(p.price*c.quantity) into available_count,sub from public.cart_items c join public.products p on c.product_id=p.id and p.active where c.user_id=p_user_id;
  if item_count=0 then raise exception 'Cart is empty'; end if;
  if available_count<>item_count then raise exception 'Some products are unavailable'; end if;
  fee=case when sub>=15000000 then 0 else 250000 end;
  insert into public.orders(id,user_id,request_id,reference,customer_name,email,phone,address,city,state,subtotal,delivery_fee,total)
  values(oid,p_user_id,p_request_id,'SS-'||upper(substr(replace(oid::text,'-',''),1,12)),trim(p_name),mail,p_phone,trim(p_address),trim(p_city),trim(p_state),sub,fee,sub+fee) returning * into o;
  insert into public.order_items(order_id,product_id,name,image,price,quantity) select o.id,p.id,p.name,p.image,p.price,c.quantity from public.cart_items c join public.products p on c.product_id=p.id where c.user_id=p_user_id;
  delete from public.cart_items where user_id=p_user_id;
 end if;
 return to_jsonb(o)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id=o.id));
end; $$;
revoke all on function public.place_order(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.place_order(uuid,uuid,text,text,text,text,text) to service_role;
insert into public.products(id,name,description,category,price,image,tag,sort_order) values
 ('11111111-1111-4111-8111-111111111111','Beats Mixr','Over-ear headphones · White','Audio',6500000,'/products/headphones.png','THE DAILY LISTEN',1),
 ('22222222-2222-4222-8222-222222222222','Keychron V2','Mechanical keyboard · RGB','Workspace',9500000,'/products/keyboard.jpg','MAKE EVERY KEY COUNT',2),
 ('33333333-3333-4333-8333-333333333333','onn Wireless Mouse','Wireless mouse · White','Workspace',1850000,'/products/mouse.jpg','LESS FRICTION',3),
 ('44444444-4444-4444-8444-444444444444','JBL Flip','Portable Bluetooth speaker · Black','Audio',7500000,'/products/speaker.jpg','SOUND THAT GOES WITH YOU',4);
commit;
