-- Additive schema for Cela task checkpoints. Apply after creating existing tasks
-- and task_events (see packages/store/task-events.sql). Service role only.
create table if not exists task_snapshots (
  task_id text primary key references tasks(id) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);
alter table task_snapshots enable row level security;
-- No browser policies: the server-side service role bypasses RLS.
-- The REST adapter rejects JSON payloads over 512 KB. A dedicated object
-- storage adapter, chunking and checksummed manifests are required for large blobs.
