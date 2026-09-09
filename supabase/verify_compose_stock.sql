-- Regression checks for the event database after compose_actual_stock.sql.
-- Run the WHOLE file. All synthetic rows and inventory changes are rolled back.
begin;
set local lock_timeout = '3s';
select pg_advisory_xact_lock(hashtext('cafe_moca_lucky_draw_2026'));
do $$
begin
  if exists(select 1 from public.lucky_draw_student_results) then
    raise exception 'Run this pre-event regression only with no existing draw results';
  end if;
  if (select total_count from public.lucky_draw_prizes where rank = 4) <> 105 then
    raise exception 'Coffee total must be 105';
  end if;
  if (select sponsor_total from moca_lucky_private.event_config where singleton) <> 197 then
    raise exception 'Sponsor total must be 197';
  end if;
  if (select array_agg(rank order by rank) from moca_lucky_private.available_prize_tickets('12:59:59'))
      <> array[2,4]::smallint[] then raise exception '13:00 gate failed'; end if;
  if (select array_agg(rank order by rank) from moca_lucky_private.available_prize_tickets('13:00:00'))
      <> array[1,2,3,4]::smallint[] then raise exception '13:00 unlock failed'; end if;
end;
$$;
insert into public.moca_survey_participants(student_id, name, status, completed_at, offline_participated_at)
select (9999000000 + n)::text, 'ROLLBACK_ONLY_QA', 'completed', now(), now()
from generate_series(1, 160) n;
savepoint fixtures;

-- 28 coffee results -> 42 available at the next delivery.
-- 40 fourth-place results -> 35 coffee + 5 sponsor, without consuming future cups.
update public.lucky_draw_prizes set is_active = (rank = 4);
do $$
declare n integer; r record; s record;
begin
  for n in 1..40 loop
    select * into r from moca_lucky_private.draw_prize((9999000000 + n)::text, '2026-09-10 10:00+09');
    if r.coffee_awarded <> (n <= 35) or r.sponsor_included <> (n > 35) then
      raise exception 'Fourth-place allocation failed at %', n;
    end if;
    if n = 28 then
      select * into s from moca_lucky_private.coffee_stock('2026-09-10 12:50+09');
      if s.available <> 42 then raise exception '7 + 35 carryover failed'; end if;
    end if;
  end loop;
  if (select remaining_count from public.lucky_draw_prizes where rank = 4) <> 70 then
    raise exception 'Sponsor fallback incorrectly consumed coffee stock';
  end if;
  select * into r from moca_lucky_private.draw_prize('9999000040', '2026-09-10 13:00+09');
  if not r.was_existing or r.coffee_awarded then raise exception 'Retry changed the saved result'; end if;
  select * into s from moca_lucky_private.coffee_stock('2026-09-10 12:50+09');
  if s.available <> 35 then raise exception 'Next delivery or duplicate accounting failed'; end if;
  for n in 41..50 loop
    perform * from moca_lucky_private.draw_prize((9999000000 + n)::text, '2026-09-10 13:00+09');
  end loop;
  select * into s from moca_lucky_private.coffee_stock('2026-09-10 14:50+09');
  if s.available <> 60 then raise exception 'Second carryover failed'; end if;
end;
$$;
rollback to fixtures;

-- Dessert winners receive exactly that dessert; only fourth place can get coffee.
do $$
declare n integer; r record;
begin
  for n in 1..4 loop
    update public.lucky_draw_prizes set is_active = (rank = n);
    select * into r from moca_lucky_private.draw_prize((9999000000 + n)::text, '2026-09-10 13:00+09');
    if r.prize_rank <> n or r.coffee_awarded <> (n = 4) or r.sponsor_included then
      raise exception 'Exactly one prize rule failed';
    end if;
  end loop;
  if (select remaining_count from public.lucky_draw_prizes where rank = 4) <> 104 then
    raise exception 'Dessert wins consumed coffee';
  end if;
end;
$$;
rollback to fixtures;

-- All fourth-place draw tickets still work when physical coffee reaches zero.
update public.lucky_draw_prizes set is_active = (rank = 4);
do $$
declare n integer; r record;
begin
  for n in 1..147 loop
    select * into r from moca_lucky_private.draw_prize((9999000000 + n)::text, '2026-09-10 15:00+09');
    if r.coffee_awarded <> (n <= 105) or r.sponsor_included <> (n > 105) then
      raise exception 'Coffee/sponsor stock separation failed at %', n;
    end if;
  end loop;
  if (select remaining_count from public.lucky_draw_prizes where rank = 4) <> 0 then
    raise exception 'Physical coffee final stock failed';
  end if;
  if (select count(*) from public.lucky_draw_student_results where coffee_awarded) <> 105 then
    raise exception 'Coffee total allocation failed';
  end if;
end;
$$;
select 'PASS: actual coffee 105, sponsor 197, carryover, fallback, duplicate, one-prize rule, 13:00 gate; test writes rolled back' as verification;
rollback;
