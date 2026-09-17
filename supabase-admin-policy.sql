begin;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
revoke all on table public.app_admins from anon, authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

drop policy if exists "company admin reads all profiles" on public.profiles;
create policy "company admin reads all profiles" on public.profiles for select to authenticated using ((select public.is_app_admin()));
drop policy if exists "company admin reads all cognitive records" on public.cognitive_records;
create policy "company admin reads all cognitive records" on public.cognitive_records for select to authenticated using ((select public.is_app_admin()));
drop policy if exists "company admin reads all chronic records" on public.chronic_records;
create policy "company admin reads all chronic records" on public.chronic_records for select to authenticated using ((select public.is_app_admin()));
drop policy if exists "company admin reads all practice records" on public.practice_records;
create policy "company admin reads all practice records" on public.practice_records for select to authenticated using ((select public.is_app_admin()));

create or replace function public.admin_health_dashboard()
returns table (
  id uuid, name text, birth_date date, phone text, email text, created_at timestamptz,
  cognitive_score integer, cognitive_risk text, cognitive_at timestamptz,
  systolic integer, diastolic integer, blood_sugar integer, sugar_timing text, chronic_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return query
  select p.id, p.name, p.birth_date, p.phone, p.email, p.created_at,
    c.score, c.risk, c.created_at,
    h.systolic, h.diastolic, h.blood_sugar, h.sugar_timing, h.created_at
  from public.profiles p
  left join lateral (
    select cr.score, cr.risk, cr.created_at from public.cognitive_records cr
    where cr.user_id = p.id order by cr.created_at desc limit 1
  ) c on true
  left join lateral (
    select hr.systolic, hr.diastolic, hr.blood_sugar, hr.sugar_timing, hr.created_at from public.chronic_records hr
    where hr.user_id = p.id order by hr.created_at desc limit 1
  ) h on true
  order by greatest(coalesce(c.created_at, '-infinity'::timestamptz), coalesce(h.created_at, '-infinity'::timestamptz)) desc;
end;
$$;

revoke all on function public.admin_health_dashboard() from public;
grant execute on function public.admin_health_dashboard() to authenticated;

-- Verify the auth.users UUID for the intended administrator first, then add it in a separate reviewed statement:
-- insert into public.app_admins (user_id) values ('verified-auth-user-uuid');

commit;
