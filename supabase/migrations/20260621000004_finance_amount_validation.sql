-- Server-side validation of finance amounts: reject negative values.
-- Front-end-supplied amounts must not be trusted; enforce non-negativity in the DB.

alter table public.church_finance drop constraint if exists church_finance_nonneg;
alter table public.church_finance add constraint church_finance_nonneg
  check (
    coalesce(cash_total,0)   >= 0 and
    coalesce(tithe,0)        >= 0 and
    coalesce(reimbursement,0)>= 0 and
    coalesce(grand_total,0)  >= 0
  );
