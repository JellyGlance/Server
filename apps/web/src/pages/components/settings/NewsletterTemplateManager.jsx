import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import AddLineIcon from "remixicon-react/AddLineIcon";
import DeleteBinLineIcon from "remixicon-react/DeleteBinLineIcon";
import FileCopyLineIcon from "remixicon-react/FileCopyLineIcon";
import MailSettingsLineIcon from "remixicon-react/MailSettingsLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import axios from "../../../lib/axios_instance";

const DEFAULT_FONTS = [
  { id: "arial", label: "Arial" },
  { id: "helvetica", label: "Helvetica" },
  { id: "verdana", label: "Verdana" },
  { id: "tahoma", label: "Tahoma" },
  { id: "trebuchet", label: "Trebuchet MS" },
  { id: "georgia", label: "Georgia" },
  { id: "times", label: "Times New Roman" },
  { id: "courier", label: "Courier New" },
];

export const emptyBranding = {
  logoUrl: "",
  accent: "#6ee7f9",
  background: "#0b111a",
  surface: "#151d29",
  mode: "dark",
  fontId: "arial",
  footer: "",
  theme: "base",
};

export const emptyTemplate = {
  name: "New template",
  htmlBody: "",
  branding: { ...emptyBranding },
};

function headers() {
  return {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
    "Content-Type": "application/json",
  };
}

function draftFromTemplate(template) {
  return {
    ...emptyTemplate,
    ...template,
    branding: { ...emptyBranding, ...(template?.branding || {}) },
  };
}

export default function NewsletterTemplateManager({ templates, fonts, onChange, onError }) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id || "");
  const [draft, setDraft] = useState(draftFromTemplate(templates[0] || emptyTemplate));
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("Template preview");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (selectedId && templates.some((template) => template.id === selectedId)) return;
    const next = templates[0];
    setSelectedId(next?.id || "");
    setDraft(draftFromTemplate(next || emptyTemplate));
  }, [templates, selectedId]);

  function selectTemplate(templateId) {
    const current = templates.find((template) => template.id === templateId);
    setSelectedId(templateId);
    setDraft(draftFromTemplate(current || emptyTemplate));
  }

  function updateBranding(field, value) {
    setDraft((current) => {
      const branding = { ...current.branding, [field]: value };
      if (field === "mode") {
        if (value === "light") {
          if (branding.background === emptyBranding.background) branding.background = "#eef2f7";
          if (branding.surface === emptyBranding.surface) branding.surface = "#ffffff";
          if (branding.accent === emptyBranding.accent) branding.accent = "#0f766e";
        } else {
          if (branding.background === "#eef2f7") branding.background = emptyBranding.background;
          if (branding.surface === "#ffffff") branding.surface = emptyBranding.surface;
          if (branding.accent === "#0f766e") branding.accent = emptyBranding.accent;
        }
      }
      return { ...current, branding };
    });
  }

  async function refreshPreview(nextDraft = draft) {
    try {
      setBusy((current) => current || "preview");
      const response = await axios.post(
        "/newsletter/templates/preview",
        { name: nextDraft.name, htmlBody: nextDraft.htmlBody, branding: nextDraft.branding },
        { headers: headers() }
      );
      setPreviewHtml(response.data?.html || "");
      setPreviewSubject(response.data?.subject || "Template preview");
    } catch (error) {
      const text = error.response?.data?.error || "Unable to preview this template.";
      setMessage({ type: "danger", text });
      onError?.(text);
    } finally {
      setBusy((current) => (current === "preview" ? "" : current));
    }
  }

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => refreshPreview(draft), 500);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.name, draft.htmlBody, JSON.stringify(draft.branding)]);

  async function saveTemplate() {
    try {
      setBusy("save");
      setMessage(null);
      const saved = await axios.post("/newsletter/templates", { ...draft, id: selectedId || undefined }, { headers: headers() });
      setSelectedId(saved.data.id);
      setDraft(draftFromTemplate(saved.data));
      await onChange?.();
      setMessage({ type: "success", text: "Template saved." });
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to save template." });
    } finally {
      setBusy("");
    }
  }

  async function createTemplate() {
    setSelectedId("");
    setDraft({ ...emptyTemplate, name: "New template" });
  }

  async function duplicateTemplate() {
    if (!selectedId) return;
    try {
      setBusy("duplicate");
      const copied = await axios.post(`/newsletter/templates/${encodeURIComponent(selectedId)}/duplicate`, {}, { headers: headers() });
      await onChange?.();
      setSelectedId(copied.data.id);
      setDraft(draftFromTemplate(copied.data));
      setMessage({ type: "success", text: "Template duplicated." });
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to duplicate template." });
    } finally {
      setBusy("");
    }
  }

  async function deleteTemplate() {
    if (!selectedId) return;
    if (!window.confirm(`Delete “${draft.name}”? Campaigns using it will fall back to the default layout.`)) return;
    try {
      setBusy("delete");
      await axios.delete(`/newsletter/templates/${encodeURIComponent(selectedId)}`, { headers: headers() });
      await onChange?.();
      setSelectedId("");
      setMessage({ type: "success", text: "Template deleted." });
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to delete template." });
    } finally {
      setBusy("");
    }
  }

  const fontOptions = fonts?.length ? fonts : DEFAULT_FONTS;

  return (
    <div className="newsletter-settings-grid newsletter-templates">
      <section className="newsletter-panel">
        <div className="newsletter-panel-title">
          <MailSettingsLineIcon size={19} />
          <h3>Templates</h3>
          <Button type="button" size="sm" variant="outline-primary" onClick={createTemplate}>
            <AddLineIcon size={15} /> New
          </Button>
        </div>
        <div className="newsletter-history">
          {templates.map((template) => (
            <article
              key={template.id}
              role="button"
              tabIndex={0}
              className={template.id === selectedId ? "is-ok" : ""}
              onClick={() => selectTemplate(template.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") selectTemplate(template.id);
              }}
            >
              <strong>{template.name}</strong>
              <span>{template.branding?.mode || "dark"} · {template.branding?.fontId || "arial"}</span>
            </article>
          ))}
          {!templates.length ? <div className="newsletter-empty">No templates yet. Create one to brand the newsletter.</div> : null}
        </div>
      </section>

      <div className="newsletter-template-editor">
        {message ? (
          <Alert variant={message.type} onClose={() => setMessage(null)} dismissible>
            {message.text}
          </Alert>
        ) : null}
        <section className="newsletter-panel">
          <div className="newsletter-panel-title">
            <h3>{selectedId ? "Edit template" : "New template"}</h3>
          </div>
          <div className="newsletter-form-grid">
            <Form.Group>
              <Form.Label>Name</Form.Label>
              <Form.Control value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </Form.Group>
            <Form.Group>
              <Form.Label>Mode</Form.Label>
              <Form.Select value={draft.branding.mode} onChange={(event) => updateBranding("mode", event.target.value)}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Accent colour</Form.Label>
              <div className="report-accent">
                <Form.Control type="color" value={draft.branding.accent} onChange={(event) => updateBranding("accent", event.target.value)} />
                <code>{draft.branding.accent}</code>
              </div>
            </Form.Group>
            <Form.Group>
              <Form.Label>Background</Form.Label>
              <div className="report-accent">
                <Form.Control type="color" value={draft.branding.background} onChange={(event) => updateBranding("background", event.target.value)} />
                <code>{draft.branding.background}</code>
              </div>
            </Form.Group>
            <Form.Group>
              <Form.Label>Email font</Form.Label>
              <Form.Select value={draft.branding.fontId} onChange={(event) => updateBranding("fontId", event.target.value)}>
                {fontOptions.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Logo URL</Form.Label>
              <Form.Control value={draft.branding.logoUrl} onChange={(event) => updateBranding("logoUrl", event.target.value)} placeholder="https://example.com/logo.png" />
            </Form.Group>
          </div>
          <Form.Group className="newsletter-recipient-box">
            <Form.Label>Footer</Form.Label>
            <Form.Control as="textarea" rows={2} value={draft.branding.footer} onChange={(event) => updateBranding("footer", event.target.value)} placeholder="Optional footer shown at the bottom of every email" />
          </Form.Group>
          <Form.Group className="newsletter-recipient-box">
            <Form.Label>Custom HTML wrapper</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              value={draft.htmlBody}
              onChange={(event) => setDraft((current) => ({ ...current, htmlBody: event.target.value }))}
              placeholder={"Optional. Use {{body}}, {{subject}}, {{logo}}, {{footer}}, {{accent}} and {{background}}."}
            />
            <Form.Text>Leave this blank to use the standard branded layout. The live preview on the right uses the same renderer as a real send, without sending mail.</Form.Text>
          </Form.Group>
          <div className="newsletter-actions">
            <Button type="button" onClick={saveTemplate} disabled={Boolean(busy)}>
              {busy === "save" ? <Spinner size="sm" animation="border" /> : <MailSettingsLineIcon size={17} />}
              Save template
            </Button>
            <Button type="button" variant="outline-primary" onClick={duplicateTemplate} disabled={!selectedId || Boolean(busy)}>
              {busy === "duplicate" ? <Spinner size="sm" animation="border" /> : <FileCopyLineIcon size={17} />}
              Duplicate
            </Button>
            <Button type="button" variant="outline-danger" onClick={deleteTemplate} disabled={!selectedId || Boolean(busy)}>
              {busy === "delete" ? <Spinner size="sm" animation="border" /> : <DeleteBinLineIcon size={17} />}
              Delete
            </Button>
            <Button type="button" variant="outline-primary" onClick={() => refreshPreview()} disabled={Boolean(busy)}>
              {busy === "preview" ? <Spinner size="sm" animation="border" /> : <RefreshLineIcon size={17} />}
              Refresh preview
            </Button>
          </div>
        </section>

        <section className="newsletter-panel newsletter-preview-panel">
          <div className="newsletter-panel-title">
            <h3>Live preview</h3>
          </div>
          <div className="newsletter-preview-meta">
            <strong>{previewSubject}</strong>
            <span>Preview only. Nothing is sent.</span>
          </div>
          <div className="newsletter-preview-frame">
            {previewHtml ? <iframe title="Template preview" srcDoc={previewHtml} /> : <div className="newsletter-empty">Building preview…</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
