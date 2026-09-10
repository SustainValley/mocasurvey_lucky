-- Keep the latest one-prize rule and 13:00 unlock for ranks 1 and 3.
-- This script separates the pre-existing 147 fourth-place draw tickets from the
-- real 105 cups. Sponsor substitutions must not consume future coffee stock.
select pg_advisory_xact_lock(hashtext('cafe_moca_lucky_draw_2026'));

create table if not exists moca_lucky_private.fourth_prize_tickets (
  singleton boolean primary key default true check (singleton),
  total_count integer not null check (total_count >= 0),
  remaining_count integer not null check (remaining_count between 0 and total_count)
);
alter table moca_lucky_private.fourth_prize_tickets enable row level security;
revoke all on moca_lucky_private.fourth_prize_tickets from public, anon, authenticated;

-- Capture the existing draw pool exactly once. Reapplication cannot reset it.
insert into moca_lucky_private.fourth_prize_tickets(singleton, total_count, remaining_count)
select true, total_count, remaining_count from public.lucky_draw_prizes where rank = 4
on conflict (singleton) do nothing;

-- Use the delivery schedule and saved coffee allocations as the source of truth.
update public.lucky_draw_prizes
set total_count = (select sum(quantity)::integer from moca_lucky_private.coffee_deliveries),
    remaining_count = (select sum(quantity)::integer from moca_lucky_private.coffee_deliveries)
      - (select count(*)::integer from public.lucky_draw_student_results where coffee_awarded),
    code = 'COMPOSE_AMERICANO', name = '컴포즈커피 아메리카노', updated_at = now()
where rank = 4;

comment on table moca_lucky_private.fourth_prize_tickets is
  '기존 4등 추첨 횟수. 컴포즈 잔 수나 협찬품 재고를 뜻하지 않습니다.';
comment on column public.lucky_draw_prizes.remaining_count is
  '실물 미지급 수량. 컴포즈는 아직 도착하지 않은 예정 수량도 포함합니다. 현재 지급 가능 잔 수는 coffee_stock에서 확인합니다.';

create or replace function moca_lucky_private.available_prize_tickets(p_local_time time)
returns table(rank smallint, code text, name text, total_count integer,
  remaining_count integer, is_active boolean, updated_at timestamptz, remaining_tickets integer)
language sql stable security invoker set search_path = ''
as $fn$
  select p.rank, p.code, p.name, p.total_count, p.remaining_count, p.is_active, p.updated_at,
    case when p.rank = 4 then t.remaining_count else p.remaining_count end as remaining_tickets
  from public.lucky_draw_prizes p
  cross join moca_lucky_private.fourth_prize_tickets t
  where t.singleton and p.is_active
    and (case when p.rank = 4 then t.remaining_count else p.remaining_count end) > 0
    and (p.rank in (2,4) or (p.rank in (1,3) and p_local_time >= time '13:00'));
$fn$;
revoke all on function moca_lucky_private.available_prize_tickets(time) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION moca_lucky_private.draw_prize(p_student_id text, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(result_id uuid, prize_rank smallint, prize_code text, prize_name text, was_existing boolean, drawn_at timestamp with time zone, coffee_awarded boolean, coffee_unavailable_reason text, coffee_next_delivery_at timestamp with time zone, sponsor_included boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_student_id text;
  v_participant public.moca_survey_participants%rowtype;
  v_result public.lucky_draw_student_results%rowtype;
  v_prize public.lucky_draw_prizes%rowtype;
  v_stock record;
  v_total integer;
  v_pick integer;
  v_at timestamptz;
  v_local_time time;
  v_coffee_awarded boolean := false;
  v_coffee_reason text := null;
  v_coffee_next timestamptz := null;
  v_sponsor_included boolean := false;
  v_saved_prize_name text;
begin
  v_student_id := regexp_replace(coalesce(p_student_id, ''), '[^0-9]', '', 'g');
  if char_length(v_student_id) < 6 or char_length(v_student_id) > 10 then
    raise exception 'INVALID_STUDENT_ID';
  end if;

  select * into v_participant
  from public.moca_survey_participants
  where student_id = v_student_id;

  if not found then raise exception 'NOT_REGISTERED_PARTICIPANT'; end if;
  if v_participant.status <> 'completed' or v_participant.completed_at is null then
    raise exception 'ONLINE_NOT_COMPLETED';
  end if;
  if v_participant.offline_participated_at is null then
    raise exception 'OFFLINE_NOT_COMPLETED';
  end if;

  perform pg_advisory_xact_lock(hashtext('cafe_moca_lucky_draw_2026'));
  v_at := coalesce(p_at, clock_timestamp());
  v_local_time := (v_at at time zone 'Asia/Seoul')::time;

  select * into v_result
  from public.lucky_draw_student_results
  where student_id = v_student_id;

  if found then
    return query select
      v_result.id,
      v_result.prize_rank,
      v_result.prize_code,
      v_result.prize_name,
      true,
      v_result.drawn_at,
      v_result.coffee_awarded,
      v_result.coffee_unavailable_reason,
      v_result.coffee_next_delivery_at,
      v_result.sponsor_included;
    return;
  end if;

  select * into v_stock from moca_lucky_private.coffee_stock(v_at);

  -- 1등과 3등은 한국시간 13:00 이후에만 랜덤 풀에 포함.
  -- 2등과 4등은 운영 시작부터 계속 랜덤 풀에 포함.
  select coalesce(sum(remaining_tickets), 0)::integer
  into v_total
  from moca_lucky_private.available_prize_tickets(v_local_time);

  -- 기존 197명분 추첨권이 모두 소진되어도 럭키드로우를 막지 않는다.
  -- 이후 참여자는 재고 차감 없이 협찬품으로 기록한다.
  if v_total <= 0 then
    insert into public.lucky_draw_student_results (
      student_id,
      prize_rank,
      prize_code,
      prize_name,
      drawn_at,
      coffee_awarded,
      coffee_unavailable_reason,
      coffee_next_delivery_at,
      sponsor_included
    ) values (
      v_student_id,
      4,
      'COMPOSE_AMERICANO',
      '협찬품',
      v_at,
      false,
      'out_of_stock',
      null,
      true
    )
    returning * into v_result;

    return query select
      v_result.id,
      v_result.prize_rank,
      v_result.prize_code,
      v_result.prize_name,
      false,
      v_result.drawn_at,
      v_result.coffee_awarded,
      v_result.coffee_unavailable_reason,
      v_result.coffee_next_delivery_at,
      v_result.sponsor_included;
    return;
  end if;

  v_pick := floor(random() * v_total)::integer + 1;

  select p.rank, p.code, p.name, p.total_count, p.remaining_count, p.is_active, p.updated_at
  into v_prize
  from (
    select lp.*, sum(lp.remaining_tickets) over (order by lp.rank) as cumulative_count
    from moca_lucky_private.available_prize_tickets(v_local_time) lp
  ) p
  where p.cumulative_count >= v_pick
  order by p.rank
  limit 1;

  if v_prize.rank = 4 then
    update moca_lucky_private.fourth_prize_tickets
    set remaining_count = remaining_count - 1
    where singleton and remaining_count > 0;
  else
    update public.lucky_draw_prizes
    set remaining_count = remaining_count - 1, updated_at = v_at
    where rank = v_prize.rank and remaining_count > 0;
  end if;
  if not found then raise exception 'PRIZE_INVENTORY_CONFLICT'; end if;

  -- 한 사람은 1~4등 결과 중 하나만 받음.
  -- 4등은 컴포즈 재고가 있으면 컴포즈, 없으면 협찬품으로 대체.
  if v_prize.rank = 4 then
    v_coffee_awarded := v_stock.available > 0;

    if v_coffee_awarded then
      -- Only an actual coffee allocation consumes physical coffee stock.
      update public.lucky_draw_prizes
      set remaining_count = remaining_count - 1, updated_at = v_at
      where rank = 4 and remaining_count > 0;
      if not found then raise exception 'COFFEE_INVENTORY_CONFLICT'; end if;
      v_coffee_reason := null;
      v_coffee_next := null;
      v_sponsor_included := false;
      v_saved_prize_name := '컴포즈커피 아메리카노';
    else
      v_coffee_reason := case
        when v_stock.received = 0 then 'before_first_delivery'
        else 'out_of_stock'
      end;
      v_coffee_next := v_stock.next_delivery_at;
      v_sponsor_included := true;
      v_saved_prize_name := '협찬품';
    end if;
  else
    v_coffee_awarded := false;
    v_coffee_reason := null;
    v_coffee_next := null;
    v_sponsor_included := false;
    v_saved_prize_name := v_prize.name;
  end if;

  insert into public.lucky_draw_student_results (
    student_id,
    prize_rank,
    prize_code,
    prize_name,
    drawn_at,
    coffee_awarded,
    coffee_unavailable_reason,
    coffee_next_delivery_at,
    sponsor_included
  ) values (
    v_student_id,
    v_prize.rank,
    v_prize.code,
    v_saved_prize_name,
    v_at,
    v_coffee_awarded,
    v_coffee_reason,
    v_coffee_next,
    v_sponsor_included
  )
  returning * into v_result;

  return query select
    v_result.id,
    v_result.prize_rank,
    v_result.prize_code,
    v_result.prize_name,
    false,
    v_result.drawn_at,
    v_result.coffee_awarded,
    v_result.coffee_unavailable_reason,
    v_result.coffee_next_delivery_at,
    v_result.sponsor_included;
end;
$function$;

notify pgrst, 'reload schema';
