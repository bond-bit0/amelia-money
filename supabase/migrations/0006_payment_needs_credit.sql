-- Loan payments come out of her credit, never from thin air.
-- A payment bigger than her credit is refused; if she can't pay, the payment is missed and that is a strike.
create or replace function private.loan_payment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare credit integer;
begin
  if new.type = 'loan_payment' and new.status = 'approved'
     and (tg_op = 'INSERT' or old.status <> 'approved') then
    credit := public.child_credit(new.child_id);
    if -new.amount_cents > credit then
      raise exception 'She only has % in credit. A payment can''t be bigger than that.', public.money(greatest(credit, 0));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists loan_payment_guard on public.entry;
create trigger loan_payment_guard before insert or update on public.entry for each row execute function private.loan_payment_guard();
revoke execute on all functions in schema private from public, anon, authenticated;
