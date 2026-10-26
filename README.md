# Beauty Bay Africa HR

Staff records, leave and payroll. Same stack as the POS: a pnpm + Turborepo
monorepo with an Express 5 + `pg` API on Neon Postgres, and a Next.js 16 site
(static export, Tailwind 4).

| Folder | What |
| --- | --- |
| `apps/api` | HR API (port 4100). SQL migrations in `apps/api/migrations`. |
| `apps/web` | HR office for the admin, and the staff portal (`/me`) for employees. |
| `packages/types` | Types shared by both. |

## Setup

```bash
corepack pnpm install
cp apps/api/.env.example apps/api/.env   # fill in DATABASE_URL and ADMIN_PASSWORD
corepack pnpm --filter api db:migrate
corepack pnpm dev                        # API on :4100, site on :3100
```

Log in at http://localhost:3100/login: **Admin** tab, email left empty, with
`ADMIN_PASSWORD` (the owner's login). Under **Settings**, give each person who runs
HR their own admin login, so the **Activity** page shows who did what. Add
departments and employees, then on an employee's **Portal** button give them a
password; they log in on the **Employee** tab with their work email.

## How it works

**Leave.** Employees ask for leave in the staff portal; the admin approves or
rejects it on the Leave page (leave the admin records is approved straight away).
Only Monday to Friday counts, less the public holidays listed under **Settings**
(the fixed ones and Easter are filled in; add the Islamic holidays once they are
announced). Annual leave is limited to each employee's yearly
allowance, counting requests still waiting. Overlapping requests are refused.

**Payroll.** Pick a month and **Run payroll**: everyone employed in that month gets a
draft payslip:

- Basic salary and fixed allowances are paid for the working days they were
  employed, less approved **unpaid** leave (so joiners and leavers are pro-rated).
- Each employee's pay is set on their form (**Add / Edit employee**): basic salary,
  allowances, deductions, pension and PAYE.
- Pension: the % set for that employee, of basic + allowances (`0` for none). An
  employer pension % is worked out too; it is paid on top, not deducted.
- NHF, if ticked: 2.5% of basic salary.
- PAYE, per employee: **None**, a **fixed** monthly amount you enter (pro-rated
  like their pay), or **worked out** from the Nigeria Tax Act 2025 bands (from
  January 2026) on pay after pension and NHF. Reliefs the app doesn't track (rent
  relief, life insurance) are left out.
- Fixed deductions (loans, advances) are taken in full; a one-off bonus or deduction
  can be added per payslip while the payroll is a draft.

**Recalculate** updates a draft after changes. **Bank file (CSV)** lists each net
payment for a bulk transfer; **PAYE schedule** and **Pension schedule** are the
month's remittances, with each employee's tax ID, PFA and RSA PIN. **Mark paid**
locks the month and shows the payslips to employees. Payslips keep a copy of every
figure, so later changes don't rewrite them. To correct a locked month, **Reopen
month** with a reason, undo the payments that need changing, fix them and pay again.

**Staff portal.** Staff see a home page (leave left, latest pay, earnings this
year, the next public holiday, HR's notices and their upcoming leave), ask for and
cancel leave, view and print payslips with year-to-date totals, add a profile
photo, keep their phone, address, date of birth and emergency contact up to date,
and manage their guarantors. Bank details and passwords stay with HR: staff see
their account masked, and only HR sets portal passwords (Employees → **Portal**).
HR posts notices on the dashboard's **Noticeboard** (General, Important, Event or
Celebration; pinned ones stay on top), which also lists birthdays.

**Records.** Every change (who, what, when) goes in the **Activity** log, which
can't be edited. **Settings → Download backup** saves all the data as one file:
do it monthly and after each payroll, as Neon on the free plan can only roll
back 6 hours. A new password, or deactivating someone, ends their logins at once.

## Tests

`apps/api/test/smoke.mjs` runs the whole app through its API (about 200 checks).
It writes test data, so run it against a Neon branch, never the real database;
the steps are at the top of the file. Run it before each deploy.

## Deploy (Render + Neon)

Push to GitHub → Render → **New → Blueprint** → pick the repo, then fill in
`DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `ADMIN_PASSWORD`. The API runs new
migrations each time it starts. On Render's free plan the API sleeps when no one
uses it, so the first login after a quiet spell takes up to a minute (the login page
says so); the paid plan keeps it awake. If the API's address differs from
`https://beautybayafrica-hr-api.onrender.com`, change `NEXT_PUBLIC_API_URL` in `render.yaml`.
