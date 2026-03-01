create extension if not exists "uuid-ossp";

create table if not exists events (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  banner_url text not null,
  starts_at timestamptz not null,
  venue text not null,
  type text not null check (type in ('FREE','PAID')),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists ticket_types (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0
);

create table if not exists registrations (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now()
);

create unique index if not exists uniq_reg_event_email on registrations(event_id, email);

create table if not exists tickets (
  id uuid primary key,
  event_id uuid not null references events(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete cascade,
  token text not null,
  status text not null check (status in ('ISSUED','USED')) default 'ISSUED',
  used_at timestamptz
);

create table if not exists checkins (
  id uuid primary key default uuid_generate_v4(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  scanned_at timestamptz not null,
  unique(ticket_id)
);

create index if not exists idx_reg_event_name on registrations(event_id, last_name, first_name);
create index if not exists idx_reg_event_email on registrations(event_id, email);
create index if not exists idx_ticket_event on tickets(event_id);
