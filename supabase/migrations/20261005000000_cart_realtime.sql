-- Apply once to the EXISTING shop project; do not rerun schema.sql.
-- Emit user-scoped versions instead of exposing deleted cart rows in Realtime.
begin;
create table if not exists public.cart_versions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0
);
alter table public.cart_versions enable row level security;
drop policy if exists "Read own cart version" on public.cart_versions;
create policy "Read own cart version" on public.cart_versions
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.cart_versions from anon, authenticated;
grant select on public.cart_versions to authenticated;
create or replace function public.notify_cart_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare shopper uuid;
begin
  if TG_OP = 'DELETE' then shopper = OLD.user_id; else shopper = NEW.user_id; end if;
  -- Do not recreate a version row during account deletion cascades.
  if exists (select 1 from auth.users where id = shopper) then
    insert into public.cart_versions (user_id, revision) values (shopper, 1)
    on conflict (user_id) do update set revision = public.cart_versions.revision + 1;
  end if;
  return null;
end; $$;
revoke all on function public.notify_cart_change() from public, anon, authenticated;
drop trigger if exists cart_changed on public.cart_items;
create trigger cart_changed after insert or update or delete on public.cart_items
  for each row execute function public.notify_cart_change();
insert into public.cart_versions (user_id, revision)
  select distinct user_id, 0 from public.cart_items on conflict do nothing;
do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cart_versions') then
    alter publication supabase_realtime add table public.cart_versions;
  end if;
end $$;
commit;
