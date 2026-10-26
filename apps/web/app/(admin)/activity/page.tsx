"use client";

import { useState } from "react";
import { TABLE, TABLE_CARD, TBODY, THEAD } from "../../components/form-styles";
import PageHeader from "../../components/page-header";
import SearchBox, { matches, NoMatches } from "../../components/search-box";
import { fetchActivity, useLoad } from "../../lib/api";
import { LoadError, Loading } from "../../lib/status";

const when = (at: string) =>
  new Date(at).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Every change made in the app, newest first: who did what, and when. */
export default function ActivityPage() {
  const activity = useLoad(fetchActivity);
  const [search, setSearch] = useState("");
  const visible = activity.data?.filter((a) => matches(search, a.actor, a.summary));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        icon="clock"
        eyebrow="Records"
        title="Activity"
        description="Who changed what, and when. Entries can't be edited or removed."
      />
      <div className="mt-6">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search by person, employee, month or change"
        />
      </div>
      <div className="mt-4">
        {activity.failed ? (
          <LoadError />
        ) : !visible ? (
          <Loading />
        ) : activity.data!.length === 0 ? (
          <p className="text-sm text-muted">Nothing has been changed yet.</p>
        ) : visible.length === 0 ? (
          <NoMatches />
        ) : (
          <div className={TABLE_CARD}>
            <table className={TABLE}>
              <thead className={THEAD}>
                <tr>
                  <th className="px-5 py-3.5">When</th>
                  <th className="px-5 py-3.5">Who</th>
                  <th className="px-5 py-3.5">What</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {visible.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-3.5 text-muted">{when(a.at)}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-medium">{a.actor}</td>
                    <td className="px-5 py-3.5">{a.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {activity.data && activity.data.length >= 500 && (
          <p className="mt-3 text-xs text-muted">
            Showing the latest 500 changes. Download a backup (Settings) for the full record.
          </p>
        )}
      </div>
    </div>
  );
}
