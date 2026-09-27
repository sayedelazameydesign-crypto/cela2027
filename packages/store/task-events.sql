-- Run after the existing tasks table described in packages/store/src/index.ts.
-- Append-only replay journal, private to the server-side service role.
create table if not exists task_events (
  task_id text not null references tasks(id) on delete cascade,
  seq bigint not null check (seq >= 0),
  event jsonb not null,
  primary key (task_id, seq)
);
create index if not exists task_events_by_task on task_events(task_id, seq);
alter table task_events enable row level security;
-- No public policies: service role bypasses RLS. Never expose its key in the browser.
