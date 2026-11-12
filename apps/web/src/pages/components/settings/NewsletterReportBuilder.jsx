import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Spinner } from "react-bootstrap";
import AddLineIcon from "remixicon-react/AddLineIcon";
import DeleteBinLineIcon from "remixicon-react/DeleteBinLineIcon";
import DragMove2LineIcon from "remixicon-react/DragMove2LineIcon";
import ExternalLinkLineIcon from "remixicon-react/ExternalLinkLineIcon";
import FileCopyLineIcon from "remixicon-react/FileCopyLineIcon";
import LayoutMasonryLineIcon from "remixicon-react/LayoutMasonryLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import axios from "../../../lib/axios_instance";
import { moveBlockBy, reorderBlocks } from "../../../lib/newsletter-report-blocks";

export const BLOCK_LIBRARY = [
  { type: "intro", label: "Intro message", text: "A heading and a short welcome.", fields: ["title", "text"] },
  { type: "stats", label: "Headline stats", text: "Plays, watch time, viewers and new items.", fields: ["title", "period"] },
  { type: "recentlyAdded", label: "Recently added", text: "Newest items, optionally from one library.", fields: ["title", "limit", "library", "addedType", "style"] },
  { type: "topWatched", label: "Most watched", text: "Top titles by plays.", fields: ["title", "limit", "period", "mediaType", "style"] },
  { type: "activeUsers", label: "Top viewers", text: "Who watched the most.", fields: ["title", "limit", "period"] },
  { type: "topClients", label: "Apps and devices", text: "Bar chart of the apps people used.", fields: ["title", "limit", "period"] },
  { type: "playMethods", label: "Play methods", text: "Direct play, direct stream and transcode split.", fields: ["title", "period"] },
  { type: "activityByDay", label: "Plays per day", text: "Daily bar chart (up to 31 days).", fields: ["title", "period"] },
  { type: "libraryOverview", label: "Library overview", text: "Item counts and new items per library.", fields: ["title", "limit", "period"] },
  { type: "repairSummary", label: "Repair snapshot", text: "Missing posters, logos and runtimes.", fields: ["title"] },
  { type: "continueWatching", label: "Continue watching", text: "Per-user campaigns only.", fields: ["title", "limit", "style"], perUser: true },
  { type: "myRequests", label: "My requests", text: "Per-user campaigns only (Seerr).", fields: ["title", "limit", "style"], perUser: true },
  { type: "forYou", label: "For you", text: "Picks and because-you-watched rows. Per-user campaigns only.", fields: ["title", "limit", "style"], perUser: true },
  { type: "wrappedRecap", label: "Wrapped recap", text: "Hours watched, top shows and films, and the busiest day.", fields: ["title", "limit", "wrappedPeriod", "style"] },
  { type: "leavingSoon", label: "Leaving soon", text: "Cleanup countdown matches, plus Maintainerr if it is configured. Read-only.", fields: ["title", "limit", "style"] },
  { type: "fulfilledRequests", label: "Newly available", text: "Seerr requests that became available since the last send. Per-user campaigns show only that person's requests.", fields: ["title", "limit", "period", "style"] },
  { type: "serverNews", label: "Server news", text: "An admin-written maintenance or new-feature note, with optional dates and a link to the public status page when it is enabled.", fields: ["title", "kind", "text", "startAt", "endAt"] },
  { type: "comingSoon", label: "Coming soon", text: "Upcoming titles from Sonarr, Radarr and Seerr over the next N days. Read-only.", fields: ["title", "limit", "comingDays", "style"] },
  { type: "text", label: "Text", text: "Free text. **bold** and blank lines for paragraphs.", fields: ["title", "text"] },
  { type: "customHtml", label: "Custom HTML", text: "Raw HTML dropped into the email.", fields: ["title", "html"] },
  { type: "divider", label: "Divider", text: "A thin line between sections.", fields: [] },
];

const BLOCK_BY_TYPE = Object.fromEntries(BLOCK_LIBRARY.map((block) => [block.type, block]));

let blockCounter = 0;
function newBlock(type, { title = "", options = {} } = {}) {
  blockCounter += 1;
  return {
    id: `${type}-${Date.now().toString(36)}-${blockCounter}`,
    type,
    enabled: true,
    title,
    options: { limit: 8, periodDays: null, mediaType: "all", libraryId: "", text: "", html: "", style: "list", ...options },
  };
}

export const DEFAULT_REPORT = {
  enabled: false,
  periodDays: 7,
  accentColor: "#6ee7f9",
  subject: "{campaign} - {date}",
  showLogo: true,
  footer: "",
  blocks: [],
};

const PRESETS = [
  {
    key: "weekly",
    label: "Weekly digest",
    build: () => ({
      periodDays: 7,
      subject: "{campaign} - week to {date}",
      blocks: [
        newBlock("intro", { title: "Here's your week on Jellyfin", options: { text: "A quick look at what was added and what everyone watched." } }),
        newBlock("stats"),
        newBlock("recentlyAdded", { options: { limit: 8 } }),
        newBlock("topWatched", { options: { limit: 6 } }),
        newBlock("activeUsers", { options: { limit: 5 } }),
      ],
    }),
  },
  {
    key: "monthly",
    label: "Monthly server report",
    build: () => ({
      periodDays: 30,
      subject: "{campaign} - {period} report",
      blocks: [
        newBlock("stats"),
        newBlock("activityByDay"),
        newBlock("topWatched", { title: "Top movies", options: { limit: 5, mediaType: "movies" } }),
        newBlock("topWatched", { title: "Top shows", options: { limit: 5, mediaType: "shows" } }),
        newBlock("activeUsers", { options: { limit: 10 } }),
        newBlock("topClients", { options: { limit: 6 } }),
        newBlock("playMethods"),
        newBlock("libraryOverview", { options: { limit: 10 } }),
        newBlock("repairSummary"),
      ],
    }),
  },
  {
    key: "personal",
    label: "Personal digest",
    build: () => ({
      periodDays: 7,
      subject: "Your week on Jellyfin",
      blocks: [
        newBlock("continueWatching", { options: { limit: 6 } }),
        newBlock("myRequests", { options: { limit: 6 } }),
        newBlock("recentlyAdded", { options: { limit: 8 } }),
        newBlock("topWatched", { title: "Popular on the server", options: { limit: 5 } }),
      ],
    }),
  },
];

export function normalizeReportDraft(report) {
  return { ...DEFAULT_REPORT, ...(report || {}), blocks: Array.isArray(report?.blocks) ? report.blocks : [] };
}

function BlockFields({ block, fields, libraries, onChange }) {
  const setOption = (key, value) => onChange({ ...block, options: { ...block.options, [key]: value } });
  return (
    <div className="report-block-fields">
      {fields.includes("title") ? (
        <Form.Group>
          <Form.Label>Heading</Form.Label>
          <Form.Control value={block.title || ""} placeholder={BLOCK_BY_TYPE[block.type]?.label} onChange={(event) => onChange({ ...block, title: event.target.value })} />
        </Form.Group>
      ) : null}
      {fields.includes("limit") ? (
        <Form.Group>
          <Form.Label>Rows</Form.Label>
          <Form.Control type="number" min="1" max="25" value={block.options?.limit ?? 8} onChange={(event) => setOption("limit", Number(event.target.value))} />
        </Form.Group>
      ) : null}
      {fields.includes("period") ? (
        <Form.Group>
          <Form.Label>Period</Form.Label>
          <Form.Select value={block.options?.periodDays ?? ""} onChange={(event) => setOption("periodDays", event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">Report default</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </Form.Select>
        </Form.Group>
      ) : null}
      {fields.includes("mediaType") || fields.includes("addedType") ? (
        <Form.Group>
          <Form.Label>Show</Form.Label>
          <Form.Select value={block.options?.mediaType || "all"} onChange={(event) => setOption("mediaType", event.target.value)}>
            <option value="all">Movies and shows</option>
            <option value="movies">Movies only</option>
            <option value="shows">Shows only</option>
          </Form.Select>
        </Form.Group>
      ) : null}
      {fields.includes("library") ? (
        <Form.Group>
          <Form.Label>Library</Form.Label>
          <Form.Select value={block.options?.libraryId || ""} onChange={(event) => setOption("libraryId", event.target.value)}>
            <option value="">All libraries</option>
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
      ) : null}
      {fields.includes("text") ? (
        <Form.Group className="report-block-wide">
          <Form.Label>Text</Form.Label>
          <Form.Control as="textarea" rows={3} value={block.options?.text || ""} onChange={(event) => setOption("text", event.target.value)} />
        </Form.Group>
      ) : null}
      {fields.includes("html") ? (
        <Form.Group className="report-block-wide">
          <Form.Label>HTML</Form.Label>
          <Form.Control as="textarea" rows={4} className="report-code" value={block.options?.html || ""} onChange={(event) => setOption("html", event.target.value)} />
        </Form.Group>
      ) : null}
      {fields.includes("wrappedPeriod") ? (
        <Form.Group>
          <Form.Label>Recap period</Form.Label>
          <Form.Select value={block.options?.wrappedPeriod || "week"} onChange={(event) => setOption("wrappedPeriod", event.target.value)}>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="year">This year</option>
          </Form.Select>
        </Form.Group>
      ) : null}
      {fields.includes("comingDays") ? (
        <Form.Group>
          <Form.Label>Next</Form.Label>
          <Form.Select value={block.options?.comingDays || 7} onChange={(event) => setOption("comingDays", Number(event.target.value))}>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="31">31 days</option>
          </Form.Select>
        </Form.Group>
      ) : null}
      {fields.includes("kind") ? (
        <Form.Group>
          <Form.Label>Kind</Form.Label>
          <Form.Select value={block.options?.kind || "feature"} onChange={(event) => setOption("kind", event.target.value)}>
            <option value="feature">New feature</option>
            <option value="maintenance">Maintenance</option>
          </Form.Select>
        </Form.Group>
      ) : null}
      {fields.includes("startAt") ? (
        <Form.Group>
          <Form.Label>From</Form.Label>
          <Form.Control type="date" value={block.options?.startAt || ""} onChange={(event) => setOption("startAt", event.target.value)} />
        </Form.Group>
      ) : null}
      {fields.includes("endAt") ? (
        <Form.Group>
          <Form.Label>Until</Form.Label>
          <Form.Control type="date" value={block.options?.endAt || ""} onChange={(event) => setOption("endAt", event.target.value)} />
        </Form.Group>
      ) : null}
      {fields.includes("style") ? (
        <Form.Group>
          <Form.Label>Layout</Form.Label>
          <Form.Select value={block.options?.style || "list"} onChange={(event) => setOption("style", event.target.value)}>
            <option value="list">List</option>
            <option value="cards">Poster cards</option>
          </Form.Select>
          {block.options?.style === "cards" ? (
            <Form.Text>Posters use the public JellyGlance URL when it is set, or this preview&apos;s address. Titles still show if no public URL is configured.</Form.Text>
          ) : null}
        </Form.Group>
      ) : null}
    </div>
  );
}

export default function NewsletterReportBuilder({ report: reportInput, onChange, campaignType, campaignName, campaignId, previewLocale = "en-GB" }) {
  const report = useMemo(() => normalizeReportDraft(reportInput), [reportInput]);
  const [libraries, setLibraries] = useState([]);
  const [addType, setAddType] = useState("stats");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [openBlockId, setOpenBlockId] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const timer = useRef(null);
  const perUser = campaignType === "per-user";

  useEffect(() => {
    axios
      .get("/newsletter/report/libraries", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then((response) => setLibraries(response.data?.libraries || []))
      .catch(() => setLibraries([]));
  }, []);

  async function refreshPreview(nextReport = report) {
    try {
      setPreviewing(true);
      setPreviewError("");
      const response = await axios.post(
        "/newsletter/report/preview",
        { report: { ...nextReport, enabled: true }, type: perUser ? "per-user" : "global", campaignName, campaignId: campaignId || undefined, locale: previewLocale },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}`, "Content-Type": "application/json" } }
      );
      setPreview(response.data);
    } catch (error) {
      setPreviewError(error.response?.data?.error || "Unable to build the preview.");
    } finally {
      setPreviewing(false);
    }
  }

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => refreshPreview(report), 700);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, campaignType, campaignName, previewLocale]);

  const update = (changes) => onChange({ ...report, ...changes });
  const updateBlocks = (blocks) => update({ blocks });
  const updateBlock = (index, block) => updateBlocks(report.blocks.map((current, position) => (position === index ? block : current)));
  const moveBlock = (index, delta) => {
    updateBlocks(moveBlockBy(report.blocks, index, delta));
  };

  const handleDragStart = (event, index) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDragIndex(index);
    setOverIndex(index);
  };

  const handleDragOver = (event, index) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (overIndex !== index) setOverIndex(index);
  };

  const handleDrop = (event, index) => {
    event.preventDefault();
    const from = Number(event.dataTransfer.getData("text/plain"));
    const source = Number.isInteger(from) ? from : dragIndex;
    if (source != null) updateBlocks(reorderBlocks(report.blocks, source, index));
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleBlockKeyDown = (event, index) => {
    if (event.target !== event.currentTarget && !event.target.classList?.contains("report-block-handle")) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveBlock(index, -1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveBlock(index, 1);
    }
  };
  const addBlock = () => {
    const block = newBlock(addType);
    updateBlocks([...report.blocks, block]);
    setOpenBlockId(block.id);
  };
  const applyPreset = (preset) => {
    if (report.blocks.length && !window.confirm(`Replace the current blocks with the “${preset.label}” layout?`)) return;
    update({ ...preset.build(), enabled: true });
  };

  function openPreviewTab() {
    if (!preview?.html) return;
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) return;
    previewWindow.opener = null;
    previewWindow.document.open();
    previewWindow.document.write(preview.html);
    previewWindow.document.close();
  }

  return (
    <div className="report-builder">
      <div className="report-builder-editor">
        <section className="newsletter-panel">
          <div className="newsletter-panel-title">
            <LayoutMasonryLineIcon size={19} />
            <h3>Report builder</h3>
          </div>
          <Form.Check
            type="switch"
            id="report-builder-enabled"
            className="report-builder-toggle"
            label="Use this report layout when the campaign is sent"
            checked={report.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          <p className="newsletter-help">
            When this is off, the campaign uses the simple section switches on the Campaigns tab. Remember to save the campaign after editing the layout.
          </p>
          <div className="report-presets">
            <span>Start from</span>
            {PRESETS.map((preset) => (
              <Button key={preset.key} type="button" size="sm" variant="outline-primary" onClick={() => applyPreset(preset)}>
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="newsletter-form-grid">
            <Form.Group>
              <Form.Label>Subject</Form.Label>
              <Form.Control value={report.subject} onChange={(event) => update({ subject: event.target.value })} />
              <Form.Text>Use {"{campaign}"}, {"{date}"} and {"{period}"}.</Form.Text>
            </Form.Group>
            <Form.Group>
              <Form.Label>Default period</Form.Label>
              <Form.Select value={report.periodDays} onChange={(event) => update({ periodDays: Number(event.target.value) })}>
                <option value="1">Last 24 hours</option>
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last year</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Accent colour</Form.Label>
              <div className="report-accent">
                <Form.Control type="color" value={report.accentColor} onChange={(event) => update({ accentColor: event.target.value })} />
                <code>{report.accentColor}</code>
              </div>
            </Form.Group>
            <Form.Group>
              <Form.Label>Branding</Form.Label>
              <Form.Check type="switch" id="report-show-logo" label="Show the JellyGlance logo" checked={report.showLogo} onChange={(event) => update({ showLogo: event.target.checked })} />
            </Form.Group>
          </div>
          <Form.Group className="newsletter-recipient-box">
            <Form.Label>Footer</Form.Label>
            <Form.Control as="textarea" rows={2} value={report.footer} placeholder="Optional footer, e.g. how to request new content" onChange={(event) => update({ footer: event.target.value })} />
          </Form.Group>
        </section>

        <section className="newsletter-panel">
          <div className="newsletter-panel-title">
            <h3>Blocks</h3>
            <div className="report-add">
              <Form.Select size="sm" value={addType} onChange={(event) => setAddType(event.target.value)}>
                {BLOCK_LIBRARY.filter((block) => perUser || !block.perUser).map((block) => (
                  <option key={block.type} value={block.type}>
                    {block.label}
                  </option>
                ))}
              </Form.Select>
              <Button type="button" size="sm" onClick={addBlock}>
                <AddLineIcon size={15} /> Add
              </Button>
            </div>
          </div>
          <p className="newsletter-help">Drag the handle to reorder sections, or focus the handle and press the up or down arrow key.</p>
          <div className="report-block-list">
            {report.blocks.map((block, index) => {
              const definition = BLOCK_BY_TYPE[block.type] || { label: block.type, text: "", fields: [] };
              const open = openBlockId === block.id;
              const unsupported = definition.perUser && !perUser;
              return (
                <article
                  key={block.id}
                  className={`report-block${block.enabled === false ? " is-off" : ""}${unsupported ? " is-warning" : ""}${dragIndex === index ? " is-dragging" : ""}${overIndex === index && dragIndex != null && dragIndex !== index ? " is-drop-target" : ""}`}
                  onDragOver={(event) => handleDragOver(event, index)}
                  onDrop={(event) => handleDrop(event, index)}
                  onDragEnd={handleDragEnd}
                >
                  <header>
                    <button
                      type="button"
                      className="report-block-handle"
                      draggable
                      aria-label={`Reorder ${block.title || definition.label}. Use arrow keys to move.`}
                      title="Drag to reorder, or focus and use the up and down arrow keys"
                      onDragStart={(event) => handleDragStart(event, index)}
                      onKeyDown={(event) => handleBlockKeyDown(event, index)}
                    >
                      <DragMove2LineIcon size={18} />
                    </button>
                    <button type="button" className="report-block-name" onClick={() => setOpenBlockId(open ? "" : block.id)}>
                      <strong>{block.title || definition.label}</strong>
                      <small>{unsupported ? "Only shown in per-user campaigns" : definition.text}</small>
                    </button>
                    <div className="report-block-tools">
                      <Form.Check
                        type="switch"
                        id={`report-block-on-${block.id}`}
                        aria-label="Show block"
                        checked={block.enabled !== false}
                        onChange={(event) => updateBlock(index, { ...block, enabled: event.target.checked })}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="link"
                        title="Duplicate"
                        onClick={() => updateBlocks([...report.blocks.slice(0, index + 1), newBlock(block.type, { title: block.title, options: block.options }), ...report.blocks.slice(index + 1)])}
                      >
                        <FileCopyLineIcon size={16} />
                      </Button>
                      <Button type="button" size="sm" variant="link" className="text-danger" title="Remove" onClick={() => updateBlocks(report.blocks.filter((_, position) => position !== index))}>
                        <DeleteBinLineIcon size={16} />
                      </Button>
                    </div>
                  </header>
                  {open && definition.fields.length ? <BlockFields block={block} fields={definition.fields} libraries={libraries} onChange={(next) => updateBlock(index, next)} /> : null}
                </article>
              );
            })}
            {!report.blocks.length ? <div className="newsletter-empty">No blocks yet. Pick a starting layout above or add blocks one at a time.</div> : null}
          </div>
        </section>
      </div>

      <section className="newsletter-panel report-builder-preview">
        <div className="newsletter-panel-title">
          <h3>Live preview</h3>
          <div className="newsletter-preview-actions">
            <Button type="button" size="sm" variant="outline-primary" onClick={() => refreshPreview()} disabled={previewing}>
              {previewing ? <Spinner size="sm" animation="border" /> : <RefreshLineIcon size={15} />} Refresh
            </Button>
            <Button type="button" size="sm" variant="outline-primary" onClick={openPreviewTab} disabled={!preview?.html}>
              <ExternalLinkLineIcon size={15} /> Open in tab
            </Button>
          </div>
        </div>
        <div className="newsletter-preview-meta">
          <strong>{preview?.subject || "Report preview"}</strong>
          <span>{perUser ? "Previewed for the first opted-in user" : "Uses live server data"}</span>
        </div>
        {previewError ? <div className="newsletter-empty">{previewError}</div> : null}
        <div className="newsletter-preview-frame">
          {preview?.html ? <iframe title="Report preview" srcDoc={preview.html} /> : <div className="newsletter-empty">Building preview…</div>}
        </div>
      </section>
    </div>
  );
}
