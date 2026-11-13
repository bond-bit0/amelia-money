-- End-to-end check of the money rules. Runs inside a transaction and rolls back.
begin;
insert into auth.users(id, email, aud, role) values
 ('00000000-0000-0000-0000-00000000000a','dad@test.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-00000000000b','mom@test.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-00000000000c','kid@test.local','authenticated','authenticated');

create temp table out(step text, val text);
grant all on out to authenticated;

-- dad creates family, invites mom and kid
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
select public.create_family('Bond','Dad');
insert into out select 'mom_code', public.create_invite('parent','Mom');
insert into out select 'kid_code', public.create_invite('child','Amelia');
with c as (insert into public.chore(family_id,name,amount_cents,min_hours_between,created_by) values (public.my_family_id(),'Clean room',500,48,auth.uid()) returning id)
insert into out select 'chore', id::text from c;
insert into public.chore(family_id,name,amount_cents,max_per_day,created_by) values (public.my_family_id(),'Wash dishes',200,2,auth.uid());

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
select public.join_family((select val from out where step='mom_code'));
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}',true);
select public.join_family((select val from out where step='kid_code'));

-- kid claims
select public.claim_chore((select val::uuid from out where step='chore'));
do $$ begin perform public.claim_chore((select val::uuid from out where step='chore')); insert into out values ('second_claim','ALLOWED (bad)');
exception when others then insert into out values ('second_claim_err', sqlerrm); end $$;
select public.claim_chore((select id from public.chore where name='Wash dishes'));
select public.claim_chore((select id from public.chore where name='Wash dishes'));
do $$ begin perform public.claim_chore((select id from public.chore where name='Wash dishes')); insert into out values ('third_dishes','ALLOWED (bad)');
exception when others then insert into out values ('third_dishes_err', sqlerrm); end $$;
-- kid tries a direct insert (must fail)
do $$ begin insert into public.entry(family_id,child_id,type,amount_cents) values (public.my_family_id(), auth.uid(),'gift',100000); insert into out values ('direct_insert','ALLOWED (bad)');
exception when others then insert into out values ('direct_insert_err', sqlerrm); end $$;
select public.submit_request('gift', 2000, 'Grandma');
insert into out select 'kid_balance', row_to_json(b)::text from public.balances() b;

-- mom approves gift, reverses one dishes claim, logs purchase, creates 0% loan
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
select public.decide_entry((select id from public.entry where type='gift'), true, null);
select public.reverse_entry((select id from public.entry where note='Wash dishes' order by created_at limit 1), 'Dishes still dirty');
select public.parent_entry('00000000-0000-0000-0000-00000000000c','purchase',1800,'Bought on Mom''s card');
insert into out select 'loan', public.create_loan('00000000-0000-0000-0000-00000000000c','Bike',30000,0,'monthly',12,current_date - 40)::text;
insert into out select 'sched', string_agg(payment_no||':'||due_date||':'||payment_cents||':'||status||':'||coalesce(struck_at::date::text,'-'), ' ' order by payment_no) from public.loan_schedule;
-- a payment bigger than her credit is refused
do $$ begin perform public.parent_entry('00000000-0000-0000-0000-00000000000c','loan_payment',2500,'too big',(select val::uuid from out where step='loan')); insert into out values ('overpay','ALLOWED (bad)');
exception when others then insert into out values ('overpay_err', sqlerrm); end $$;
select public.parent_entry('00000000-0000-0000-0000-00000000000c','business',5000,'Lemonade');
-- pay first payment (late) and part of the second
select public.parent_entry('00000000-0000-0000-0000-00000000000c','loan_payment',2500,'Payment 1',(select val::uuid from out where step='loan'));
select public.parent_entry('00000000-0000-0000-0000-00000000000c','loan_payment',1000,'Part 2',(select val::uuid from out where step='loan'));
insert into out select 'sched_after', string_agg(payment_no||':'||payment_cents||':'||paid_cents||':'||status||':'||coalesce(days_late::text,'-')||':'||(struck_at is not null), ' ' order by payment_no) from public.loan_schedule where payment_no<=3;
insert into out select 'interest_loan', public.create_loan('00000000-0000-0000-0000-00000000000c','Test',10000,0.12,'monthly',6,current_date+10)::text;
insert into out select 'int_sched', string_agg(payment_no||':'||payment_cents||'/'||interest_cents||'/'||principal_cents||'/'||balance_after_cents, ' ' order by payment_no) from public.loan_schedule where loan_id=(select val::uuid from out where step='interest_loan');
insert into out select 'mom_balance', row_to_json(b)::text from public.balances() b;
-- entries can't be edited
do $$ begin update public.entry set amount_cents = 1 where type='purchase'; insert into out values ('edit','ALLOWED? rows hidden by grants');
exception when others then insert into out values ('edit_err', sqlerrm); end $$;
insert into out select 'notif_count', count(*)::text from public.notification;
reset role;
insert into out select 'all_notifs', string_agg(title, ' | ') from public.notification;
select * from out;
rollback;
