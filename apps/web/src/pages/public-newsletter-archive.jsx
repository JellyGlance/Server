import { useEffect, useState } from "react";
import baseUrl from "../lib/baseurl";
import "./css/public-newsletter-archive.css";

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function issueIdFromPath() {
  const parts = window.location.pathname.replace(/\/+$/, "").split("/");
  const last = parts[parts.length - 1];
  if (!last || last === "newsletter-archive") return "";
  return decodeURIComponent(last);
}

export default function PublicNewsletterArchive() {
  const [payload, setPayload] = useState(null);
  const [issue, setIssue] = useState(null);
  const [error, setError] = useState("");
  const selected = issueIdFromPath();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`${baseUrl}/newsletter-archive-data`);
        if (response.status === 404) {
          if (!cancelled) setError("off");
          return;
        }
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json();
        if (!cancelled) setPayload(data);
        if (selected) {
          const detail = await fetch(`${baseUrl}/newsletter-archive-data/${encodeURIComponent(selected)}`);
          if (detail.ok && !cancelled) setIssue(await detail.json());
        }
      } catch {
        if (!cancelled) setError("unavailable");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (error === "off") {
    return (
      <main className="newsletter-archive-page">
        <section className="newsletter-archive-card">
          <p>The newsletter archive is turned off.</p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="newsletter-archive-page">
        <section className="newsletter-archive-card">
          <p>The newsletter archive is unavailable right now.</p>
        </section>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="newsletter-archive-page">
        <section className="newsletter-archive-card">
          <p>Loading the archive…</p>
        </section>
      </main>
    );
  }

  if (selected && issue) {
    return (
      <main className="newsletter-archive-page">
        <section className="newsletter-archive-card">
          <p className="newsletter-archive-kicker">{payload.kicker}</p>
          <p>
            <a href={`${baseUrl}/newsletter-archive`}>Back to the archive</a>
          </p>
          <h1>{issue.subject}</h1>
          <p className="newsletter-archive-meta">
            {formatDate(issue.publishedAt)}
            {issue.audienceLabel ? ` · ${issue.audienceLabel}` : ""}
          </p>
        </section>
        <div className="newsletter-archive-frame">
          <iframe title={issue.subject} srcDoc={issue.html || ""} />
        </div>
      </main>
    );
  }

  return (
    <main className="newsletter-archive-page">
      <section className="newsletter-archive-card">
        <p className="newsletter-archive-kicker">{payload.kicker}</p>
        <h1>{payload.title}</h1>
        {!payload.entries?.length ? <p>{payload.empty}</p> : null}
        <ul className="newsletter-archive-list">
          {(payload.entries || []).map((entry) => (
            <li key={entry.id}>
              <a href={`${baseUrl}/newsletter-archive/${encodeURIComponent(entry.id)}`}>
                <strong>{entry.subject}</strong>
                <span>
                  {formatDate(entry.publishedAt)}
                  {entry.audienceLabel ? ` · ${entry.audienceLabel}` : ""}
                </span>
                {entry.excerpt ? <em>{entry.excerpt}</em> : null}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
