create table if not exists users (
  id text primary key,
  nickname text not null,
  created_at timestamptz not null default now()
);

create table if not exists matches (
  id text primary key,
  room_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  winner_user_id text
);

create table if not exists match_players (
  id text primary key,
  match_id text not null references matches(id) on delete cascade,
  user_id text not null references users(id),
  seat int not null,
  final_score int not null default 0,
  remain_cards int not null default 0
);

create table if not exists match_events (
  id text primary key,
  match_id text not null references matches(id) on delete cascade,
  seq int not null,
  event_type text not null,
  payload_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_match_events_match_seq on match_events(match_id, seq);
