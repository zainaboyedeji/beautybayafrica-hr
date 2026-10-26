// End-to-end test of the HR API: logins, staff, leave, payroll, guarantors,
// admins and the activity log. It writes test data, so run it only against a
// throwaway copy of the database (a Neon branch), never the real one:
//
//   1. Make a branch in Neon and copy its connection string.
//   2. cd apps/api && DATABASE_URL=<branch> npx tsx src/migrate.ts
//   3. DATABASE_URL=<branch> ADMIN_PASSWORD=test-owner-pass PORT=4199 npx tsx src/index.ts
//   4. In another terminal: ADMIN_PASSWORD=test-owner-pass pnpm --filter api test
//   5. Delete the branch.
const BASE = process.env.BASE ?? "http://localhost:4199";
if (!process.env.ADMIN_PASSWORD) {
  console.error("Set ADMIN_PASSWORD to the test API's owner password.");
  process.exit(1);
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let pass = 0, fail = 0;
const failures = [];

async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; failures.push(name); console.log("  FAIL", name, detail === undefined ? "" : JSON.stringify(detail)); }
}
const expectStatus = (name, r, status) => check(`${name} → ${status}`, r.status === status, { got: r.status, body: r.body });
const near = (a, b) => Math.abs(a - b) < 0.011;

const tag = Date.now().toString(36);

console.log("Basics");
expectStatus("GET /health", await call("GET", "/health"), 200);
expectStatus("no token", await call("GET", "/employees"), 401);
expectStatus("bad token", await call("GET", "/employees", { token: "abc.def" }), 401);
expectStatus("wrong admin password", await call("POST", "/auth/login", { body: { password: "nope" } }), 401);
const adminLogin = await call("POST", "/auth/login", { body: { password: ADMIN_PASSWORD } });
expectStatus("admin login", adminLogin, 200);
check("owner logs in as Owner", adminLogin.body.name === "Owner", adminLogin.body);
const A = adminLogin.body.token;
expectStatus("invalid JSON body", await call("POST", "/departments", { token: A, raw: "{bad", body: undefined }).then(r => r), 400);

console.log("Departments");
const dep = await call("POST", "/departments", { token: A, body: { name: `Sales ${tag}` } });
expectStatus("create department", dep, 201);
expectStatus("empty name", await call("POST", "/departments", { token: A, body: { name: " " } }), 400);
expectStatus("duplicate name", await call("POST", "/departments", { token: A, body: { name: `Sales ${tag}` } }), 409);
expectStatus("rename", await call("PUT", `/departments/${dep.body.id}`, { token: A, body: { name: `Retail ${tag}` } }), 200);
expectStatus("rename missing", await call("PUT", `/departments/nope`, { token: A, body: { name: "x" } }), 404);

console.log("Employees");
const e1Email = `ada.${tag}@example.com`;
const e1Form = {
  employeeNo: `T1-${tag}`, name: "Ada Test", email: e1Email.toUpperCase(), jobTitle: "Cashier",
  departmentId: dep.body.id, employmentType: "full_time", startDate: "2026-01-05",
  baseSalary: 300000, annualLeaveDays: 20, bankName: "GTBank", bankAccountNumber: "0123456789",
  bankAccountName: "Ada Test", password: "initialpass1", pensionPercent: 8, paye: "auto",
  nhf: true, employerPensionPercent: 10, taxId: "TIN-123", pensionProvider: "Test PFA", pensionPin: "PEN100200",
};
const e1 = await call("POST", "/employees", { token: A, body: e1Form });
expectStatus("create employee", e1, 201);
check("email stored lower-case", e1.body.email === e1Email, e1.body.email);
check("canLogIn true", e1.body.canLogIn === true);
check("department name joined", e1.body.departmentName === `Retail ${tag}`, e1.body.departmentName);
const E1 = e1.body.id;
expectStatus("bad email", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: "x", email: "nope" } }), 400);
expectStatus("duplicate email", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: `T9-${tag}` } }), 409);
expectStatus("duplicate staff no", await call("POST", "/employees", { token: A, body: { ...e1Form, email: `z.${tag}@example.com` } }), 409);
expectStatus("short password", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: "y", email: `y.${tag}@example.com`, password: "short" } }), 400);
expectStatus("end before start", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: "w", email: `w.${tag}@example.com`, endDate: "2025-01-01" } }), 400);
expectStatus("bad dept id", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: "v", email: `v.${tag}@example.com`, departmentId: "missing" } }), 400);

// Joins mid-September, so September pay is pro-rated.
const e2 = await call("POST", "/employees", { token: A, body: {
  employeeNo: `T2-${tag}`, name: "Bayo Test", email: `bayo.${tag}@example.com`, jobTitle: "Driver",
  startDate: "2026-09-15", baseSalary: 220000, bankName: "=HYPERLINK(\"x\")", bankAccountNumber: "999",
  bankAccountName: "Bayo, Test",
} });
expectStatus("create second employee", e2, 201);
check("no password → canLogIn false", e2.body.canLogIn === false);
const E2 = e2.body.id;
check("new employee defaults: no pension, no PAYE", e2.body.pensionPercent === 0 && e2.body.paye === "none", e2.body);
expectStatus("bad PAYE mode", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: "u", email: `u.${tag}@example.com`, paye: "lots" } }), 400);
expectStatus("fixed PAYE without amount", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: "u", email: `u.${tag}@example.com`, paye: "fixed" } }), 400);
expectStatus("pension over 100%", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: "u", email: `u.${tag}@example.com`, pensionPercent: 150 } }), 400);
expectStatus("bad pay line rolls back create", await call("POST", "/employees", { token: A, body: { ...e1Form, employeeNo: `T5-${tag}`, email: `t5.${tag}@example.com`, items: [{ kind: "allowance", name: "X", amount: -5 }] } }), 400);
check("…and no employee was created", !(await call("GET", "/employees", { token: A })).body.some((e) => e.employeeNo === `T5-${tag}`));
// Fixed PAYE, set up in one go with its pay lines, joining mid-September.
const e4 = await call("POST", "/employees", { token: A, body: {
  employeeNo: `T4-${tag}`, name: "Chi Test", email: `chi.${tag}@example.com`, jobTitle: "Stylist",
  startDate: "2026-09-15", baseSalary: 200000, paye: "fixed", payeAmount: 11000, pensionPercent: 0,
  items: [{ kind: "allowance", name: "Transport", amount: 20000 }],
} });
expectStatus("create with pay lines + fixed PAYE", e4, 201);
check("fixed PAYE saved", e4.body.paye === "fixed" && e4.body.payeAmount === 11000, e4.body);
const E4 = e4.body.id;
check("pay lines saved with employee", (await call("GET", `/employees/${E4}/pay-items`, { token: A })).body.length === 1);
const e4Edit = await call("PUT", `/employees/${E4}`, { token: A, body: { ...e4.body, paye: "fixed", payeAmount: 11000 } });
expectStatus("edit without items", e4Edit, 200);
check("edit without items keeps lines", (await call("GET", `/employees/${E4}/pay-items`, { token: A })).body.length === 1);

const items = await call("PUT", `/employees/${E1}/pay-items`, { token: A, body: { items: [
  { kind: "allowance", name: "Housing", amount: 50000 },
  { kind: "deduction", name: "Loan", amount: 10000 },
] } });
expectStatus("set pay items", items, 200);
check("two pay items", Array.isArray(items.body) && items.body.length === 2);
expectStatus("pay item zero amount", await call("PUT", `/employees/${E1}/pay-items`, { token: A, body: { items: [{ kind: "allowance", name: "X", amount: 0 }] } }), 400);
check("failed save left items intact", (await call("GET", `/employees/${E1}/pay-items`, { token: A })).body.length === 2);

const deps = await call("GET", "/departments", { token: A });
check("headcount 1", deps.body.find((d) => d.id === dep.body.id)?.headcount === 1, deps.body);

console.log("Staff portal");
expectStatus("employee wrong password", await call("POST", "/auth/login", { body: { email: e1Email, password: "wrongpass" } }), 401);
const empLogin = await call("POST", "/auth/login", { body: { email: e1Email.toUpperCase(), password: "initialpass1" } });
expectStatus("employee login (any case email)", empLogin, 200);
let T = empLogin.body.token;
expectStatus("employee on admin route", await call("GET", "/employees", { token: T }), 403);
expectStatus("admin on employee route", await call("GET", "/me", { token: A }), 403);
const me = await call("GET", "/me", { token: T });
expectStatus("GET /me", me, 200);
check("annualLeaveLeft 20", me.body.annualLeaveLeft === 20, me.body.annualLeaveLeft);
check("no password fields leaked", !("salt" in me.body) && !("passwordHash" in me.body) && !("password_hash" in me.body));
// Only HR sets staff passwords: there is no way to change your own.
expectStatus("staff can't change their own password", await call("PUT", "/me/password", { token: T, body: { currentPassword: "initialpass1", newPassword: "newpassword1" } }), 404);
const otherDevice = (await call("POST", "/auth/login", { body: { email: e1Email, password: "initialpass1" } })).body.token;
expectStatus("HR sets a new password", await call("PUT", `/employees/${E1}/password`, { token: A, body: { password: "newpassword1" } }), 204);
expectStatus("old logins end when HR sets a password", await call("GET", "/me", { token: otherDevice }), 401);
expectStatus("old password no longer works", await call("POST", "/auth/login", { body: { email: e1Email, password: "initialpass1" } }), 401);
T = (await call("POST", "/auth/login", { body: { email: e1Email, password: "newpassword1" } })).body.token;
expectStatus("new password works", await call("GET", "/me", { token: T }), 200);
expectStatus("login with new password", await call("POST", "/auth/login", { body: { email: e1Email, password: "newpassword1" } }), 200);

console.log("Leave");
// 2026-11-02 is a Monday.
const l1 = await call("POST", "/leave", { token: T, body: { type: "annual", startDate: "2026-11-02", endDate: "2026-11-08", reason: "Trip" } });
expectStatus("request annual leave", l1, 201);
check("5 working days, pending", l1.body.days === 5 && l1.body.status === "pending", l1.body);
expectStatus("overlap refused", await call("POST", "/leave", { token: T, body: { type: "sick", startDate: "2026-11-06", endDate: "2026-11-10" } }), 409);
expectStatus("over allowance refused", await call("POST", "/leave", { token: T, body: { type: "annual", startDate: "2026-11-16", endDate: "2026-12-08" } }), 400);
expectStatus("cross-year refused", await call("POST", "/leave", { token: T, body: { type: "annual", startDate: "2026-12-30", endDate: "2027-01-02" } }), 400);
expectStatus("weekend only refused", await call("POST", "/leave", { token: T, body: { type: "sick", startDate: "2026-11-14", endDate: "2026-11-15" } }), 400);
expectStatus("bad type", await call("POST", "/leave", { token: T, body: { type: "party", startDate: "2026-11-16", endDate: "2026-11-16" } }), 400);
expectStatus("before start date", await call("POST", "/leave", { token: T, body: { type: "sick", startDate: "2026-01-02", endDate: "2026-01-02" } }), 400);
expectStatus("invalid date", await call("POST", "/leave", { token: T, body: { type: "sick", startDate: "2026-02-30", endDate: "2026-03-02" } }), 400);
const l2 = await call("POST", "/leave", { token: T, body: { type: "sick", startDate: "2026-11-16", endDate: "2026-11-16" } });
expectStatus("second request", l2, 201);
expectStatus("employee cancels own pending", await call("PUT", `/leave/${l2.body.id}/cancel`, { token: T }), 204);
expectStatus("cancel again", await call("PUT", `/leave/${l2.body.id}/cancel`, { token: T }), 404);
const approved = await call("PUT", `/leave/${l1.body.id}/status`, { token: A, body: { status: "approved", note: "Enjoy" } });
expectStatus("admin approves", approved, 200);
check("approved with note", approved.body.status === "approved" && approved.body.decisionNote === "Enjoy", approved.body);
expectStatus("employee can't cancel approved", await call("PUT", `/leave/${l1.body.id}/cancel`, { token: T }), 404);
check("leave left now 15", (await call("GET", "/me", { token: T })).body.annualLeaveLeft === 15);
expectStatus("employee can't approve", await call("PUT", `/leave/${l1.body.id}/status`, { token: T, body: { status: "approved" } }), 403);
// Unpaid leave in September (Mon 7 – Fri 11), recorded by the admin.
const unpaid = await call("POST", "/leave", { token: A, body: { employeeId: E1, type: "unpaid", startDate: "2026-09-07", endDate: "2026-09-11" } });
expectStatus("admin records unpaid leave", unpaid, 201);
check("admin leave approved immediately", unpaid.body.status === "approved");
expectStatus("admin leave without employee", await call("POST", "/leave", { token: A, body: { type: "sick", startDate: "2026-11-20", endDate: "2026-11-20" } }), 400);
const mine = await call("GET", "/leave/mine", { token: T });
check("/leave/mine has 3", mine.body.length === 3, mine.body.length);

console.log("Photos, details and noticeboard");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const withPhoto = await call("PUT", "/me/photo", { token: T, body: { photo: PNG } });
check("upload own photo", withPhoto.status === 200 && !!withPhoto.body.photoVersion, withPhoto.body);
const ownPhoto = await fetch(`${BASE}/employees/${E1}/photo`, { headers: { Authorization: `Bearer ${T}` } });
check("see own photo", ownPhoto.status === 200 && ownPhoto.headers.get("content-type") === "image/png", ownPhoto.status);
expectStatus("can't see a colleague's photo", await call("GET", `/employees/${E2}/photo`, { token: T }), 403);
const adminSees = await fetch(`${BASE}/employees/${E1}/photo`, { headers: { Authorization: `Bearer ${A}` } });
check("admin sees the photo", adminSees.status === 200);
check("employee list carries photo version", (await call("GET", "/employees", { token: A })).body.find((e) => e.id === E1)?.photoVersion === withPhoto.body.photoVersion);
expectStatus("fake image refused", await call("PUT", "/me/photo", { token: T, body: { photo: `data:image/png;base64,${Buffer.from("not an image").toString("base64")}` } }), 400);
expectStatus("non-image refused", await call("PUT", "/me/photo", { token: T, body: { photo: "data:text/html;base64,PGI+aGk8L2I+" } }), 400);
expectStatus("admin sets someone's photo", await call("PUT", `/employees/${E2}/photo`, { token: A, body: { photo: PNG } }), 200);
const noPhoto = await call("DELETE", "/me/photo", { token: T });
check("remove own photo", noPhoto.status === 200 && !noPhoto.body.photoVersion, noPhoto.body);
const details = await call("PUT", "/me/details", { token: T, body: { phone: "08030000000", dateOfBirth: "1995-05-04", homeAddress: "1 Lekki Rd", emergencyName: "Bisi", emergencyRelationship: "Sister", emergencyPhone: "08031111111" } });
check("update own details", details.status === 200 && details.body.emergencyName === "Bisi" && details.body.dateOfBirth === "1995-05-04", details.body);
expectStatus("future birthday refused", await call("PUT", "/me/details", { token: T, body: { dateOfBirth: "2999-01-01" } }), 400);
await call("PUT", "/me/details", { token: T, body: { ...details.body, bankAccountNumber: "6666666666" } });
check("staff can't change their bank account", (await call("GET", "/me", { token: T })).body.bankAccountNumber === "0123456789");
const posted = await call("POST", "/announcements", { token: A, body: { title: `Notice ${tag}`, body: "Office closed Friday", category: "important" } });
expectStatus("post a notice", posted, 201);
check("notice keeps its type, unpinned", posted.body.category === "important" && posted.body.pinned === false, posted.body);
expectStatus("unknown notice type refused", await call("POST", "/announcements", { token: A, body: { title: "x", body: "y", category: "gossip" } }), 400);
const pinnedOne = await call("POST", "/announcements", { token: A, body: { title: `Pinned ${tag}`, body: "Read me first", category: "event", pinned: true } });
const board = (await call("GET", "/announcements", { token: T })).body;
check("pinned notices come first", board[0]?.id === pinnedOne.body.id, board.map((n) => n.title));
const edited = await call("PUT", `/announcements/${posted.body.id}`, { token: A, body: { title: `Notice ${tag}`, body: "Office closed Friday and Monday", category: "celebration", pinned: true } });
check("edit a notice", edited.status === 200 && edited.body.category === "celebration" && edited.body.pinned && !!edited.body.updatedAt, edited.body);
expectStatus("employee can't edit notices", await call("PUT", `/announcements/${posted.body.id}`, { token: T, body: { title: "x", body: "y" } }), 403);
await call("DELETE", `/announcements/${pinnedOne.body.id}`, { token: A });
expectStatus("empty notice refused", await call("POST", "/announcements", { token: A, body: { title: "x" } }), 400);
expectStatus("employee can't post notices", await call("POST", "/announcements", { token: T, body: { title: "x", body: "y" } }), 403);
check("employee sees the notice", (await call("GET", "/announcements", { token: T })).body.some((n) => n.title === `Notice ${tag}` && n.postedBy === "Owner"));
expectStatus("take down notice", await call("DELETE", `/announcements/${posted.body.id}`, { token: A }), 204);

console.log("Public holidays");
const hols = await call("GET", "/holidays", { token: T });
check("holidays are seeded", hols.status === 200 && hols.body.some((h) => h.day === "2026-12-25"), hols.body.length);
expectStatus("employee can't add holidays", await call("POST", "/holidays", { token: T, body: { day: "2026-11-25", name: "x" } }), 403);
expectStatus("add holiday", await call("POST", "/holidays", { token: A, body: { day: "2026-11-25", name: `Test day ${tag}` } }), 201);
expectStatus("duplicate holiday", await call("POST", "/holidays", { token: A, body: { day: "2026-11-25", name: "again" } }), 409);
const sickWeek = await call("POST", "/leave", { token: T, body: { type: "sick", startDate: "2026-11-23", endDate: "2026-11-27" } });
check("holiday not counted as leave", sickWeek.status === 201 && sickWeek.body.days === 4, sickWeek.body);
await call("PUT", `/leave/${sickWeek.body.id}/cancel`, { token: T });
expectStatus("remove holiday", await call("DELETE", "/holidays/2026-11-25", { token: A }), 204);

console.log("Payroll (2026-09)");
const P = "2026-09";
// Clean up any earlier run of this script on this branch.
const run = await call("POST", "/payroll", { token: A, body: { period: P } });
expectStatus("run payroll", run, 201);
expectStatus("duplicate run", await call("POST", "/payroll", { token: A, body: { period: P } }), 409);
expectStatus("bad period", await call("POST", "/payroll", { token: A, body: { period: "2026-13" } }), 400);
expectStatus("nobody employed", await call("POST", "/payroll", { token: A, body: { period: "1999-01" } }), 400);
check("1999-01 run rolled back", (await call("GET", "/payroll/1999-01", { token: A })).status === 404);
const slip1 = run.body.payslips.find((p) => p.employeeId === E1);
const slip2 = run.body.payslips.find((p) => p.employeeId === E2);
check("working days in Sep 2026 = 22", slip1?.workingDays === 22, slip1?.workingDays);
check("E1 paid 17 days (5 unpaid)", slip1?.daysPaid === 17, slip1?.daysPaid);
// Expected: basic 300000*17/22, housing 50000*17/22.
const share1 = 17 / 22;
const basic1 = Math.round(300000 * share1 * 100) / 100;
const house1 = Math.round(50000 * share1 * 100) / 100;
check("E1 basic pro-rated", near(slip1.earnings[0].amount, basic1), slip1.earnings);
check("E1 housing pro-rated", near(slip1.earnings[1].amount, house1), slip1.earnings);
const regular1 = basic1 + house1;
const pension1 = Math.round(regular1 * 8) / 100;
const nhf1 = Math.round(basic1 * 0.025 * 100) / 100;
check("E1 NHF 2.5% of basic", near(slip1.deductions.find((d) => d.name.startsWith("NHF"))?.amount ?? 0, nhf1), slip1.deductions);
check("E1 employer pension 10%", near(slip1.employerPension, Math.round(regular1 * 10) / 100), slip1.employerPension);
check("payslip keeps tax/pension IDs", slip1.taxId === "TIN-123" && slip1.pensionPin === "PEN100200", slip1);
check("E1 pension 8%", near(slip1.deductions.find((d) => d.name.startsWith("Pension")).amount, pension1), slip1.deductions);
const tax = (y) => { const b = [[800000,0],[3000000,.15],[12000000,.18],[25000000,.21],[50000000,.23],[Infinity,.25]]; let t=0,f=0; for (const [u,r] of b){ if (y<=f) break; t+=(Math.min(y,u)-f)*r; f=u;} return t; };
const paye1 = Math.round(tax((regular1 - pension1 - nhf1) * 12) / 12 * 100) / 100;
check("E1 PAYE", near(slip1.deductions.find((d) => d.name === "PAYE tax")?.amount ?? 0, paye1), { expected: paye1, got: slip1.deductions });
check("E1 loan in full", slip1.deductions.find((d) => d.name === "Loan")?.amount === 10000);
check("E1 net = gross - deductions", near(slip1.net, slip1.gross - slip1.totalDeductions));
// Sep 15 (Tue) – Sep 30 (Wed): 12 weekdays.
check("E2 pro-rated 12 days", slip2?.daysPaid === 12, slip2?.daysPaid);
check("E2 basic", near(slip2.earnings[0].amount, Math.round(220000 * 12 / 22 * 100) / 100), slip2.earnings);
check("E2 (none/0%) has no pension or PAYE", slip2.deductions.length === 0 && near(slip2.net, slip2.gross), slip2.deductions);
const slip4 = run.body.payslips.find((p) => p.employeeId === E4);
check("E4 transport pro-rated", near(slip4.earnings[1].amount, Math.round(20000 * 12 / 22 * 100) / 100), slip4.earnings);
check("E4 fixed PAYE pro-rated", near(slip4.deductions.find((d) => d.name === "PAYE tax")?.amount ?? 0, Math.round(11000 * 12 / 22 * 100) / 100), slip4.deductions);
check("E4 no pension line", !slip4.deductions.some((d) => d.name.startsWith("Pension")));

const adj = await call("PUT", `/payroll/${P}/payslips/${E1}`, { token: A, body: { bonus: 25000, otherDeduction: 5000, note: "Sept bonus" } });
expectStatus("add bonus/deduction", adj, 200);
const a1 = adj.body.payslips.find((p) => p.employeeId === E1);
check("bonus in earnings", a1.earnings.some((e) => e.name === "Bonus" && e.amount === 25000));
check("gross up by bonus", near(a1.gross, slip1.gross + 25000), { before: slip1.gross, after: a1.gross });
expectStatus("negative bonus", await call("PUT", `/payroll/${P}/payslips/${E1}`, { token: A, body: { bonus: -1 } }), 400);
const recalc = await call("POST", `/payroll/${P}/recalculate`, { token: A });
expectStatus("recalculate", recalc, 200);
const r1 = recalc.body.payslips.find((p) => p.employeeId === E1);
check("recalculate keeps bonus+note", r1.bonus === 25000 && r1.otherDeduction === 5000 && r1.note === "Sept bonus", r1);
check("recalculate same net", near(r1.net, a1.net), { a: a1.net, r: r1.net });

const csv = await call("GET", `/payroll/${P}/bank.csv`, { token: A });
expectStatus("bank CSV", csv, 200);
check("CSV content-type", (csv.headers.get("content-type") ?? "").includes("text/csv"));
check("CSV has header + all payslips", csv.body.split("\n").length === 1 + recalc.body.payslips.length, csv.body);
check("CSV formula neutralised", csv.body.includes(`"'=HYPERLINK(""x"")"`), csv.body);
check("CSV quotes commas", csv.body.includes(`"Bayo, Test"`));

expectStatus("employee sees no draft payslips", await call("GET", "/payslips/mine", { token: T }).then(r => ({ ...r, status: r.body.length === 0 ? 200 : 999 })), 200);
const paidOne = await call("POST", `/payroll/${P}/payslips/${E1}/paid`, { token: A, body: {} });
expectStatus("mark E1 paid", paidOne, 200);
const p1 = paidOne.body.payslips.find((p) => p.employeeId === E1);
check("default reference", p1.paymentReference === `SAL-202609-T1-${tag}`.toUpperCase(), p1.paymentReference);
expectStatus("mark E1 paid twice", await call("POST", `/payroll/${P}/payslips/${E1}/paid`, { token: A, body: {} }), 409);
expectStatus("adjust paid payslip", await call("PUT", `/payroll/${P}/payslips/${E1}`, { token: A, body: { bonus: 1 } }), 409);
const csv2 = await call("GET", `/payroll/${P}/bank.csv`, { token: A });
check("CSV excludes paid", !csv2.body.includes(`T1-${tag}`.toUpperCase()) && !csv2.body.includes(`T1-${tag}`));
const mySlips = await call("GET", "/payslips/mine", { token: T });
check("employee sees paid payslip", mySlips.body.length === 1 && mySlips.body[0].period === P, mySlips.body);
const rc2 = await call("POST", `/payroll/${P}/recalculate`, { token: A });
check("recalc keeps paid payslip", near(rc2.body.payslips.find((p) => p.employeeId === E1).net, p1.net));
expectStatus("delete run with paid people", await call("DELETE", `/payroll/${P}`, { token: A }), 409);
expectStatus("undo payment", await call("DELETE", `/payroll/${P}/payslips/${E1}/paid`, { token: A }), 200);
expectStatus("undo again", await call("DELETE", `/payroll/${P}/payslips/${E1}/paid`, { token: A }), 404);
const all = await call("POST", `/payroll/${P}/paid`, { token: A });
expectStatus("mark all paid", all, 200);
check("run status paid", all.body.status === "paid" && all.body.paidCount === all.body.employees, all.body);
expectStatus("locked: recalculate", await call("POST", `/payroll/${P}/recalculate`, { token: A }), 409);
expectStatus("locked: delete", await call("DELETE", `/payroll/${P}`, { token: A }), 409);
const dash = await call("GET", "/dashboard", { token: A });
expectStatus("dashboard", dash, 200);
check("dashboard shows a last paid run", !!dash.body.lastPaidRun, dash.body);

console.log("Reports and corrections");
const payeCsv = await call("GET", `/payroll/${P}/paye.csv`, { token: A });
check("PAYE schedule lists E1 with TIN", payeCsv.status === 200 && payeCsv.body.includes("TIN-123"), payeCsv.body);
const penCsv = await call("GET", `/payroll/${P}/pension.csv`, { token: A });
check("pension schedule has employee + employer", penCsv.status === 200 && penCsv.body.includes("PEN100200") && penCsv.body.includes("Test PFA"), penCsv.body);
expectStatus("reopen needs a reason", await call("POST", `/payroll/${P}/reopen`, { token: A, body: {} }), 400);
const reopened = await call("POST", `/payroll/${P}/reopen`, { token: A, body: { reason: "Wrong bonus" } });
check("reopen → draft, everyone still paid", reopened.status === 200 && reopened.body.status === "draft" && reopened.body.paidCount === reopened.body.employees, reopened.body);
expectStatus("reopen twice", await call("POST", `/payroll/${P}/reopen`, { token: A, body: { reason: "x" } }), 409);
expectStatus("undo one payment after reopening", await call("DELETE", `/payroll/${P}/payslips/${E1}/paid`, { token: A }), 200);
expectStatus("correct it", await call("PUT", `/payroll/${P}/payslips/${E1}`, { token: A, body: { bonus: 30000, otherDeduction: 5000, note: "Fixed bonus" } }), 200);
const repaid = await call("POST", `/payroll/${P}/payslips/${E1}/paid`, { token: A, body: {} });
check("re-paying locks the month again", repaid.status === 200 && repaid.body.status === "paid", repaid.body.status);
expectStatus("delete employee with payslips", await call("DELETE", `/employees/${E1}`, { token: A }), 409);
// A draft run that can be deleted.
// A draft that can be deleted, in a month real data won't have.
expectStatus("run 2026-02", await call("POST", "/payroll", { token: A, body: { period: "2026-02" } }), 201);
expectStatus("delete draft 2026-02", await call("DELETE", "/payroll/2026-02", { token: A }), 204);

console.log("Guarantors");
const g = [];
for (let i = 0; i < 3; i++) {
  const r = await call("POST", "/me/guarantors", { token: T, body: { name: `G${i}`, relationship: "Uncle", phone: "080", address: "Lagos" } });
  g.push(r.body);
  expectStatus(`add guarantor ${i + 1}`, r, 201);
}
expectStatus("4th guarantor refused", await call("POST", "/me/guarantors", { token: T, body: { name: "G4", relationship: "x", phone: "1", address: "y" } }), 409);
expectStatus("missing fields", await call("POST", `/employees/${E2}/guarantors`, { token: A, body: { name: "x" } }), 400);
const ver = await call("PUT", `/guarantors/${g[0].id}/verified`, { token: A, body: { verified: true } });
check("admin verifies", ver.status === 200 && !!ver.body.verifiedAt, ver.body);
const adminEdit = await call("PUT", `/guarantors/${g[0].id}`, { token: A, body: { name: "G0b", relationship: "Uncle", phone: "080", address: "Lagos" } });
check("admin edit keeps verified", adminEdit.status === 200 && !!adminEdit.body.verifiedAt, adminEdit.body);
const empEdit = await call("PUT", `/guarantors/${g[0].id}`, { token: T, body: { name: "G0c", relationship: "Uncle", phone: "080", address: "Lagos" } });
check("employee edit clears verified", empEdit.status === 200 && !empEdit.body.verifiedAt, empEdit.body);
const g2 = await call("POST", `/employees/${E2}/guarantors`, { token: A, body: { name: "Other", relationship: "x", phone: "1", address: "y" } });
expectStatus("employee can't edit someone else's", await call("PUT", `/guarantors/${g2.body.id}`, { token: T, body: { name: "hack", relationship: "x", phone: "1", address: "y" } }), 404);
expectStatus("employee can't delete someone else's", await call("DELETE", `/guarantors/${g2.body.id}`, { token: T }), 404);
expectStatus("employee deletes own", await call("DELETE", `/guarantors/${g[2].id}`, { token: T }), 204);
check("employee list shows counts", (await call("GET", "/employees", { token: A })).body.find((e) => e.id === E1)?.guarantors === 2);

console.log("Leaving date (company time zone)");
const lagosDay = (offsetDays) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TIME_ZONE ?? "Africa/Lagos" }).format(new Date(Date.now() + offsetDays * 86400000));
const { password: _pw, ...e1Edit } = e1Form;
const setEnd = (endDate) => call("PUT", `/employees/${E1}`, { token: A, body: { ...e1Edit, departmentId: dep.body.id, endDate } });
expectStatus("last day is today", await setEnd(lagosDay(0)), 200);
expectStatus("still has access on last day", await call("GET", "/me", { token: T }), 200);
expectStatus("can log in on last day", await call("POST", "/auth/login", { body: { email: e1Email, password: "newpassword1" } }), 200);
expectStatus("last day was yesterday", await setEnd(lagosDay(-1)), 200);
expectStatus("open session revoked after leaving", await call("GET", "/me", { token: T }), 401);
expectStatus("login refused after leaving", await call("POST", "/auth/login", { body: { email: e1Email, password: "newpassword1" } }), 401);
expectStatus("leaving date cleared", await setEnd(null), 200);
const relog = await call("POST", "/auth/login", { body: { email: e1Email, password: "newpassword1" } });
expectStatus("access back when re-hired", relog, 200);
T = relog.body.token;

console.log("Deactivation");
expectStatus("session works before", await call("GET", "/me", { token: T }), 200);
const deact = await call("PUT", `/employees/${E1}/active`, { token: A, body: { active: false } });
expectStatus("deactivate", deact, 200);
check("deactivatedAt set", !!deact.body.deactivatedAt, deact.body);
expectStatus("open session revoked at once", await call("GET", "/me", { token: T }), 401);
expectStatus("leave request refused", await call("POST", "/leave", { token: T, body: { type: "sick", startDate: "2026-11-23", endDate: "2026-11-23" } }), 401);
expectStatus("login refused while deactivated", await call("POST", "/auth/login", { body: { email: e1Email, password: "newpassword1" } }), 401);
const again = await call("PUT", `/employees/${E1}/active`, { token: A, body: { active: false } });
check("deactivating twice keeps first time", again.body.deactivatedAt === deact.body.deactivatedAt);
expectStatus("employee can't reactivate self", await call("PUT", `/employees/${E1}/active`, { token: T, body: { active: true } }), 401);
expectStatus("deactivate missing", await call("PUT", `/employees/nope/active`, { token: A, body: { active: false } }), 404);
const react = await call("PUT", `/employees/${E1}/active`, { token: A, body: { active: true } });
check("reactivate clears it", react.status === 200 && !react.body.deactivatedAt && react.body.canLogIn, react.body);
const back = await call("POST", "/auth/login", { body: { email: e1Email, password: "newpassword1" } });
expectStatus("same password works after reactivating", back, 200);
T = back.body.token;
expectStatus("new session works", await call("GET", "/me", { token: T }), 200);

console.log("Admin accounts");
const adminEmail = `boss.${tag}@example.com`;
expectStatus("add admin", await call("POST", "/admins", { token: A, body: { name: "Bola Admin", email: adminEmail.toUpperCase(), password: "adminpass1" } }), 201);
expectStatus("duplicate admin email", await call("POST", "/admins", { token: A, body: { name: "x", email: adminEmail, password: "adminpass1" } }), 409);
expectStatus("short admin password", await call("POST", "/admins", { token: A, body: { name: "x", email: `x.${tag}@example.com`, password: "short" } }), 400);
expectStatus("employee can't add admins", await call("POST", "/admins", { token: T, body: { name: "x", email: `y.${tag}@example.com`, password: "adminpass1" } }), 403);
expectStatus("admin email on employee tab fails", await call("POST", "/auth/login", { body: { email: adminEmail, password: "adminpass1" } }), 401);
const bolaLogin = await call("POST", "/auth/login", { body: { role: "admin", email: adminEmail, password: "adminpass1" } });
expectStatus("admin logs in with email", bolaLogin, 200);
check("admin session has their name", bolaLogin.body.name === "Bola Admin" && bolaLogin.body.role === "admin", bolaLogin.body);
let B = bolaLogin.body.token;
expectStatus("admin token works", await call("GET", "/employees", { token: B }), 200);
const bolaId = (await call("GET", "/admins", { token: A })).body.find((a) => a.email === adminEmail)?.id;
expectStatus("can't deactivate yourself", await call("PUT", `/admins/${bolaId}/active`, { token: B, body: { active: false } }), 400);
expectStatus("Bola adds a department", await call("POST", "/departments", { token: B, body: { name: `Bola dept ${tag}` } }), 201);
expectStatus("reset Bola's password", await call("PUT", `/admins/${bolaId}/password`, { token: A, body: { password: "adminpass2" } }), 204);
expectStatus("old admin token ended by reset", await call("GET", "/employees", { token: B }), 401);
B = (await call("POST", "/auth/login", { body: { role: "admin", email: adminEmail, password: "adminpass2" } })).body.token;
expectStatus("new admin password works", await call("GET", "/employees", { token: B }), 200);
expectStatus("deactivate Bola", await call("PUT", `/admins/${bolaId}/active`, { token: A, body: { active: false } }), 200);
expectStatus("deactivated admin logged out", await call("GET", "/employees", { token: B }), 401);
expectStatus("deactivated admin can't log in", await call("POST", "/auth/login", { body: { role: "admin", email: adminEmail, password: "adminpass2" } }), 401);

console.log("Activity log and backup");
const log = await call("GET", "/activity", { token: A });
expectStatus("activity log", log, 200);
const said = (re, by) => log.body.some((a) => re.test(a.summary) && (!by || a.actor === by));
check("logs who added an employee", said(new RegExp(`Added employee Ada Test \\(T1-${tag}\\)`), "Owner"));
check("logs a leaving-date change", said(/Updated Ada Test: leaving date/));
check("logs an employee's own leave request", log.body.some((a) => /Asked for Ada Test's annual leave/.test(a.summary) && a.actor === "Ada Test (staff portal)"));
check("logs the reopen with reason", said(/Reopened September 2026 to correct it: Wrong bonus/));
check("logs payments with amount", said(/Marked Ada Test paid for September 2026: /));
check("logs a named admin's change", said(new RegExp(`Added the Bola dept ${tag} department`), "Bola Admin (admin)"));
check("logs deactivating an admin", said(/Deactivated admin Bola Admin/));
const backup = await call("GET", "/backup", { token: A });
expectStatus("backup", backup, 200);
check("backup has every table", ["employees", "payslips", "activity_log", "admins", "employee_photos", "announcements"].every((t) => Array.isArray(backup.body.tables?.[t])));
check("backup leaves out password hashes", !JSON.stringify(backup.body).includes("password_hash"));
expectStatus("employee can't download backup", await call("GET", "/backup", { token: T }), 403);

console.log("Access removal");
expectStatus("admin password reset ends employee logins", await call("PUT", `/employees/${E1}/password`, { token: A, body: { password: "resetpass1" } }), 204);
expectStatus("employee token ended by admin reset", await call("GET", "/me", { token: T }), 401);
T = (await call("POST", "/auth/login", { body: { email: e1Email, password: "resetpass1" } })).body.token;
expectStatus("remove portal access", await call("DELETE", `/employees/${E1}/password`, { token: A }), 204);
expectStatus("old token rejected", await call("GET", "/me", { token: T }), 401);
expectStatus("delete E2 (no payslips? has Sep payslip)", await call("DELETE", `/employees/${E2}`, { token: A }), 409);
const e3 = await call("POST", "/employees", { token: A, body: { employeeNo: `T3-${tag}`, name: "Temp", email: `t3.${tag}@example.com`, jobTitle: "x", startDate: "2026-10-01", baseSalary: 1 } });
expectStatus("delete employee without payslips", await call("DELETE", `/employees/${e3.body.id}`, { token: A }), 204);
expectStatus("delete department", await call("DELETE", `/departments/${dep.body.id}`, { token: A }), 204);
const after = await call("GET", "/employees", { token: A });
check("employee kept, department cleared", after.body.find((e) => e.id === E1) && !after.body.find((e) => e.id === E1).departmentId);

console.log("Lockout");
let last;
for (let i = 0; i < 6; i++) last = await call("POST", "/auth/login", { body: { password: "wrong" } });
expectStatus("locked out after 5 wrong", last, 429);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("Failures:\n - " + failures.join("\n - "));
process.exit(fail ? 1 : 0);
