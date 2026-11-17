create table profiles (
  id uuid primary key references auth.users (id),
  display_name text not null
);

alter table profiles enable row level security;

create policy profiles_owner_select on profiles
  for select using (auth.uid() = id);
