"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PublicContract } from "@hr/types";
import { CARD, INPUT, PRIMARY_BUTTON } from "../components/form-styles";
import ContractText from "../components/contract-text";
import Icon from "../components/icons";
import { API_URL, describeError, publicCall } from "../lib/api";

/** Where a new starter reads and accepts their contract, from the emailed link. */
export default function ContractPage() {
  return (
    <Suspense>
      <ContractFromLink />
    </Suspense>
  );
}

function ContractFromLink() {
  const token = useSearchParams().get("t") ?? "";
  const [contract, setContract] = useState<PublicContract | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupEmailSent, setSetupEmailSent] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    publicCall<PublicContract>(`/public/contracts/${encodeURIComponent(token)}`)
      .then(setContract)
      .catch((e) => setFailed(describeError(e, "This link isn't valid")));
  }, [token]);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      const answer = await publicCall<{ setupEmailSent: boolean }>(
        `/public/contracts/${encodeURIComponent(token)}/accept`,
        { method: "POST", body: { fullName, agree } },
      );
      setSetupEmailSent(answer.setupEmailSent);
      setContract(
        await publicCall<PublicContract>(`/public/contracts/${encodeURIComponent(token)}`),
      );
    } catch (e) {
      setError(describeError(e, "Could not accept the contract"));
    } finally {
      setSaving(false);
    }
  };

  const problem = !token ? "This link is missing its code. Open it again from your email." : failed;

  return (
    <div className="min-h-screen px-4 py-8 text-ink sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-11 w-11" />
          <span className="font-display text-lg font-semibold">
            {contract?.company ?? "Beauty Bay Africa"}
          </span>
        </div>

        {problem ? (
          <div className={`${CARD} mt-8 text-center`}>
            <Icon name="alert" className="mx-auto h-8 w-8 text-red-600" />
            <p className="mt-3 font-semibold">{problem}</p>
          </div>
        ) : !contract ? (
          <p className="mt-8 text-sm text-muted">Loading your contract…</p>
        ) : (
          <>
            <h1 className="mt-8 text-4xl font-semibold">{contract.title}</h1>
            <p className="mt-2 text-muted">
              For {contract.employeeName}. Please read it all before you accept.
            </p>

            <article className={`${CARD} mt-6`}>
              <ContractText body={contract.body} />
            </article>

            {contract.status === "accepted" ? (
              <section className="mt-6 rounded-3xl bg-emerald-50 p-6 ring-1 ring-emerald-200">
                <p className="flex items-center gap-2 text-lg font-semibold text-emerald-800">
                  <Icon name="check" />
                  Accepted
                </p>
                <p className="mt-2 text-sm text-emerald-900">
                  You accepted this contract as <strong>{contract.acceptedName}</strong> on{" "}
                  {new Date(contract.acceptedAt!).toLocaleString("en-NG", {
                    dateStyle: "long",
                    timeStyle: "short",
                  })}
                  .{" "}
                  {setupEmailSent
                    ? "We've emailed you a link to set up your HR account. Check your inbox (and spam folder)."
                    : setupEmailSent === false
                      ? "You can log in to the staff portal as usual."
                      : ""}
                </p>
                <a
                  href={`${API_URL}/public/contracts/${encodeURIComponent(token)}/pdf`}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200"
                >
                  <Icon name="download" className="h-4 w-4" />
                  Download your signed contract (PDF)
                </a>
              </section>
            ) : contract.expired ? (
              <p className="mt-6 rounded-3xl bg-amber-50 p-6 text-sm text-amber-900 ring-1 ring-amber-200">
                This link has expired. Ask HR to send your contract again.
              </p>
            ) : (
              <form
                className={`${CARD} mt-6 flex flex-col gap-4`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void accept();
                }}
              >
                <h2 className="text-xl font-semibold">Accept your contract</h2>
                <label className="text-sm font-medium">
                  Type your full name to sign{" "}
                  <span className="font-normal text-muted">({contract.employeeName})</span>
                  <input
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={`${INPUT} font-display text-lg`}
                  />
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    required
                    type="checkbox"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-brand-deep"
                  />
                  I have read this contract and agree to its terms. I understand that typing my
                  name above is my signature.
                </label>
                {error && <p className="text-sm text-red-700">{error}</p>}
                <button type="submit" disabled={saving} className={`${PRIMARY_BUTTON} h-12`}>
                  {saving ? "Accepting…" : "Accept contract"}
                </button>
                <p className="text-xs text-muted">
                  Questions first? Reply to the email this link came in, or speak to HR before
                  accepting.
                </p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
