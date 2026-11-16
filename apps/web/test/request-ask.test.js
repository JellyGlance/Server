import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeRequest, extractRequestQuery, findRequests, parseIntent, pendingRequests, rankSuggestions, stuckRequests, suggestionState } from "../src/pages/requests/ask.js";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const req = (id, status, extra = {}) => ({ id: `S-${id}`, title: `Title ${id}`, status, createdAt: day(1), requestedBy: "Ann", ...extra });

describe("parseIntent", () => {
  it("recognises stuck questions", () => {
    for (const q of ["what's stuck?", "anything failed", "why is nothing downloading, it's taking ages", "any problems with requests"]) assert.equal(parseIntent(q).intent, "stuck", q);
  });

  it("recognises stats and pending questions", () => {
    assert.equal(parseIntent("request stats").intent, "stats");
    assert.equal(parseIntent("who's the busiest requester?").intent, "stats");
    assert.equal(parseIntent("what is the average time to fulfil").intent, "stats");
    assert.equal(parseIntent("any pending requests?").intent, "pending");
    assert.equal(parseIntent("what's waiting for approval").intent, "pending");
  });

  it("recognises a status question and pulls the title out", () => {
    assert.deepEqual(parseIntent("is Dune available yet?"), { intent: "status", query: "dune" });
    assert.equal(parseIntent("where is the expanse").query, "expanse");
    assert.equal(parseIntent("status of Severance").intent, "status");
  });

  it("recognises a request and extracts the title", () => {
    const parsed = parseIntent("get me the new Nolan film");
    assert.equal(parsed.intent, "request");
    assert.equal(parsed.query, "nolan");
    assert.equal(parsed.preferNew, true);
    assert.deepEqual(extractRequestQuery("Can you please request Dune Part Two"), { query: "dune part two", preferNew: false });
    assert.equal(parseIntent("I want to watch Alien").query, "alien");
    assert.equal(parseIntent("i want Alien Romulus").query, "alien romulus");
  });

  it("leaves other questions to the regular helper", () => {
    assert.equal(parseIntent("who's watching now?").intent, null);
    assert.equal(parseIntent("").intent, null);
    assert.equal(parseIntent("hello").intent, null);
  });
});

describe("stuckRequests", () => {
  it("lists failed first, then stalled downloads, then old approvals", () => {
    const list = [
      req(1, "Approved", { createdAt: day(5) }),
      req(2, "Failed"),
      req(3, "Approved", { createdAt: day(1) }),
      req(4, "Approved"),
      req(5, "Available"),
    ];
    const out = stuckRequests(list, { "S-4": { state: "stalled" } }, NOW);
    assert.deepEqual(out.map((o) => [o.request.id, o.reason]), [["S-2", "Failed"], ["S-4", "Download stalled"], ["S-1", "Waiting 5 days"]]);
    assert.deepEqual(stuckRequests([req(9, "Available")], {}, NOW), []);
  });
});

describe("lookups", () => {
  it("finds requests by every word in the title", () => {
    const list = [req(1, "Approved", { title: "The Dark Knight" }), req(2, "Approved", { title: "Dark Matter" })];
    assert.deepEqual(findRequests(list, "dark knight").map((r) => r.id), ["S-1"]);
    assert.deepEqual(findRequests(list, "dark").length, 2);
    assert.deepEqual(findRequests(list, ""), []);
  });

  it("lists pending requests", () => {
    assert.deepEqual(pendingRequests([req(1, "Pending"), req(2, "Approved")]).map((r) => r.id), ["S-1"]);
  });

  it("describes where a request is up to", () => {
    assert.equal(describeRequest(req(1, "Approved"), { state: "downloading", progress: 62.6, etaLabel: "12 min" }), "Approved \u00b7 downloading 63%, 12 min left \u00b7 requested by Ann");
    assert.match(describeRequest(req(2, "Failed"), { state: "failed" }), /download failed/);
  });
});

describe("suggestions", () => {
  const results = [
    { id: 1, title: "Old", releaseDate: "2010-01-01", popularity: 50 },
    { id: 2, title: "Newest", releaseDate: "2026-07-01", popularity: 5 },
    { id: 3, title: "Future", releaseDate: "2030-01-01", popularity: 99 },
    { id: 4, title: "" },
  ];

  it("puts the newest released title first when they asked for new", () => {
    assert.deepEqual(rankSuggestions(results, { preferNew: true }).map((r) => r.title), ["Newest", "Old"]);
    assert.deepEqual(rankSuggestions(results).map((r) => r.title), ["Future", "Old", "Newest"]);
    assert.deepEqual(rankSuggestions(undefined), []);
  });

  it("reports library and request state", () => {
    assert.equal(suggestionState({ availability: "Available" }).key, "available");
    assert.equal(suggestionState({ requested: true }).key, "requested");
    assert.equal(suggestionState({}).key, "open");
  });
});
