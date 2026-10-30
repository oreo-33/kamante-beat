-- ============================================================
-- かまんてびーと  Supabase 作り直し版(ランキングとユーザー)
--   ・今のHTML(index / game / run-game / puzzle-game / ranking)を
--     書き換えずに、そのまま動くように作ってあります
--   ・game_rankings(ランキング記録)は【全部消えます】
--   ・ログインのアカウント自体は残し、users の行は自動で作り直します
--     (アカウントも全部消したいときは、いちばん下の「任意」を使う)
--   ・実行前に Database > Backups を確認してください
--   ・何回実行しても大丈夫です
-- ============================================================

-- 0) 古いテーブルを消す(ランキングは消えます)
drop table if exists public.game_rankings cascade;
drop table if exists public.users cascade;

-- 1) users(表示名だけ。メールやパスワードは auth 側にあり、ここには無い)
create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  game_id    text not null,
  created_at timestamptz not null default now(),
  constraint users_game_id_format
    check (game_id ~ '^[A-Za-z0-9_ぁ-んァ-ヶー一-龠]{3,16}$')
);
create unique index users_game_id_lower on public.users (lower(game_id));

-- 2) 新規登録で、users の行を自動で作る
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.users (id, game_id)
  values (new.id, new.raw_user_meta_data->>'game_id');
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 古い名前のトリガーが残っていると二重に動くので、先に全部消す
do $$
declare r record;
begin
  for r in
    select tgname from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and not tgisinternal
      and tgfoid = 'public.handle_new_user()'::regprocedure
  loop
    execute format('drop trigger %I on auth.users', r.tgname);
  end loop;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) 今あるアカウントの users 行を作り直す
insert into public.users (id, game_id)
select id, raw_user_meta_data->>'game_id'
from auth.users
where raw_user_meta_data->>'game_id' ~ '^[A-Za-z0-9_ぁ-んァ-ヶー一-龠]{3,16}$'
on conflict do nothing;

-- 4) ランキング(1人・1ゲームにつき1行)
--    score は numeric: パズルの秒数が小数でも保存できるようにするため
create table public.game_rankings (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  game_type  text not null,
  score      numeric not null,
  play_count integer not null default 0 check (play_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game_type),
  -- 変な値を入れられないようにする(上限・下限は目安。必要なら変更)
  constraint game_rankings_valid check (
       (game_type = 'rhythm'        and score between 0  and 1100000)
    or (game_type = 'run'           and score between 0  and 1000000)
    or (game_type = 'puzzle_easy'   and score between 5  and 36000)
    or (game_type = 'puzzle_normal' and score between 20 and 36000)
    or (game_type = 'puzzle_hard'   and score between 45 and 36000)
  )
);
create index idx_game_rankings_type_score on public.game_rankings (game_type, score);

-- 5) 更新のとき、記録が「悪くなる」変更は自動で無視する(ベストだけ残る)
create or replace function public.keep_best_score()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.user_id    := old.user_id;
  new.game_type  := old.game_type;
  new.created_at := old.created_at;
  new.updated_at := now();
  if old.game_type like 'puzzle\_%' then
    new.score := least(old.score, new.score);      -- パズルは小さい(速い)ほうが良い
  else
    new.score := greatest(old.score, new.score);   -- リズム・ランは大きいほうが良い
  end if;
  new.play_count := greatest(old.play_count, new.play_count);  -- 回数は減らせない
  return new;
end $$;

create trigger keep_best before update on public.game_rankings
  for each row execute function public.keep_best_score();

-- 6) RLS(行レベルセキュリティ): 誰が何をできるか
alter table public.users         enable row level security;
alter table public.game_rankings enable row level security;

-- users: 見るのは誰でもOK(中身は id と表示名だけ)。追加・変更・削除はできない
create policy users_read on public.users
  for select to anon, authenticated using (true);

-- game_rankings: 見るのは誰でもOK。書けるのは「自分の行」だけ
create policy rankings_read on public.game_rankings
  for select to anon, authenticated using (true);
create policy rankings_insert_own on public.game_rankings
  for insert to authenticated with check (auth.uid() = user_id);
create policy rankings_update_own on public.game_rankings
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select on public.users, public.game_rankings to anon, authenticated;
grant insert, update on public.game_rankings to authenticated;

-- 7) 退会: アカウントごと完全に消す(index.html が rpc('delete_my_account') で呼ぶ)
create or replace function public.delete_my_account()
returns void language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not logged in';
  end if;
  delete from auth.users where id = auth.uid();   -- users, game_rankings は CASCADE で消える
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ============================================================
-- (任意) アカウントも全部消して、まっさらにする
--   みんなログアウト状態になり、同じIDで登録し直せます。
--   使うときは、次の1行の先頭の「--」を消してから実行してください。
-- ============================================================
-- delete from auth.users;

-- 動作確認用(実行して、行数や制約を見る)
-- select count(*) from public.users;
-- select tablename, rowsecurity from pg_tables where schemaname='public';
