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

Log in at http://localhost:3100/login: **Admin** tab with `ADMIN_PASSWORD`.
Add departments and employees, then on an employee's **Portal** button give them a
password; they log in on the **Employee** tab with their work email.

## How it works

**Leave.** Employees ask for leave in the staff portal; the admin approves or
rejects it on the Leave page (leave the admin records is approved straight away).
Only Monday to Friday counts. Annual leave is limited to each employee's yearly
allowance, counting requests still waiting. Overlapping requests are refused.

**Payroll.** Pick a month and **Run payroll**: everyone employed in that month gets a
draft payslip:

- Basic salary and fixed allowances are paid for the working days they were
  employed, less approved **unpaid** leave (so joiners and leavers are pro-rated).
- Each employee's pay is set on their form (**Add / Edit employee**): basic salary,
  allowances, deductions, pension and PAYE.
- Pension: the % set for that employee, of basic + allowances (`0` for none).
- PAYE, per employee: **None**, a **fixed** monthly amount you enter (pro-rated
  like their pay), or **worked out** from the Nigeria Tax Act 2025 bands (from
  January 2026) on pay after pension. Reliefs the app doesn't track (rent relief,
  NHF, life insurance) are left out.
- Fixed deductions (loans, advances) are taken in full; a one-off bonus or deduction
  can be added per payslip while the payroll is a draft.

**Recalculate** updates a draft after changes. **Bank file (CSV)** lists each net
payment for a bulk transfer. **Mark paid** locks the month and shows the payslips to
employees. Payslips keep a copy of every figure, so later changes don't rewrite them.

## Deploy (Render + Neon)

Push to GitHub → Render → **New → Blueprint** → pick the repo, then fill in
`DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `ADMIN_PASSWORD`. The API runs new
migrations each time it starts. If the API's address differs from
`https://beautybayafrica-hr-api.onrender.com`, change `NEXT_PUBLIC_API_URL` in `render.yaml`.
