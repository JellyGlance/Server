import { useState, useEffect, useMemo, useRef } from "react";
import axios from "../../../lib/axios_instance";
import Config from "../../../lib/config";
import Loading from "../general/loading";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import ArrowUpSLineIcon from "remixicon-react/ArrowUpSLineIcon";
import DragMove2LineIcon from "remixicon-react/DragMove2LineIcon";
import EyeLineIcon from "remixicon-react/EyeLineIcon";
import EyeOffLineIcon from "remixicon-react/EyeOffLineIcon";
import ExternalLinkLineIcon from "remixicon-react/ExternalLinkLineIcon";
import LockLineIcon from "remixicon-react/LockLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";

import "../../css/settings/settings.css";
import { Trans, useTranslation } from "react-i18next";
import i18n from "i18next";
import { FONT_WEIGHT_OPTIONS, getStoredFontWeight, saveFontWeightPreference } from "../../../lib/appearance";
import { languages } from "../../../lib/languages.js";
import { navData } from "../../../lib/navdata";
import { isBlobboHidden, setBlobboHidden } from "../../../lib/blobbo-settings";
import { DEFAULT_THEME, THEME_GROUPS, THEME_PRESETS, filterThemePresets, findMatchingThemePreset, getStoredTheme, resetTheme, saveTheme, themeColorFields } from "../../../lib/theme";
import {
  applyNavOrder,
  getStoredHiddenNavLinks,
  getStoredNavOrder,
  LOCKED_NAV_LINKS,
  resetHiddenNavLinks,
  resetNavOrder,
  saveHiddenNavLinks,
  saveNavOrder,
} from "../../../lib/nav-order";

function getNavLabel(item) {
  if (item.i18nKey) return i18n.t(item.i18nKey);
  if (typeof item.text === "string") return item.text;
  if (item.link === "") return i18n.t("MENU_TABS.HOME");
  return item.label || item.link;
}

const THEME_COLOR_FIELDS = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "background", label: "Background" },
  { key: "surface", label: "Surface" },
];
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function NavigationOrderSettings() {
  const { t } = useTranslation();
  const [navOrder, setNavOrder] = useState(() => getStoredNavOrder(navData));
  const [hiddenLinks, setHiddenLinks] = useState(() => getStoredHiddenNavLinks(navData));
  const [draggedLink, setDraggedLink] = useState("");
  const orderedItems = applyNavOrder(navData, navOrder);
  const lockedItems = orderedItems.filter((item) => LOCKED_NAV_LINKS.has(item.link));
  const reorderableItems = orderedItems.filter((item) => !LOCKED_NAV_LINKS.has(item.link));

  function commitOrder(nextOrder) {
    setNavOrder(saveNavOrder(nextOrder, navData));
  }

  function moveLink(link, direction) {
    const currentIndex = navOrder.indexOf(link);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= navOrder.length) return;
    const nextOrder = [...navOrder];
    const [movedLink] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(targetIndex, 0, movedLink);
    commitOrder(nextOrder);
  }

  function moveDraggedLink(targetLink) {
    if (!draggedLink || draggedLink === targetLink) return;
    const nextOrder = navOrder.filter((link) => link !== draggedLink);
    const targetIndex = nextOrder.indexOf(targetLink);
    nextOrder.splice(targetIndex < 0 ? nextOrder.length : targetIndex, 0, draggedLink);
    commitOrder(nextOrder);
  }

  function handleReset() {
    resetNavOrder();
    resetHiddenNavLinks();
    setNavOrder(getStoredNavOrder(navData));
    setHiddenLinks(getStoredHiddenNavLinks(navData));
  }

  function toggleHidden(link) {
    const nextHiddenLinks = hiddenLinks.includes(link) ? hiddenLinks.filter((hiddenLink) => hiddenLink !== link) : [...hiddenLinks, link];
    setHiddenLinks(saveHiddenNavLinks(nextHiddenLinks, navData));
  }

  return (
    <section className="settings-form nav-order-settings" aria-labelledby="nav-order-heading">
      <div className="nav-order-header">
        <div>
          <h2 id="nav-order-heading"><Trans i18nKey="SETTINGS_PAGE.NAVBAR_ORDER" /></h2>
          <p><Trans i18nKey="SETTINGS_PAGE.NAVBAR_ORDER_INTRO" /></p>
        </div>
        <Button type="button" variant="outline-secondary" onClick={handleReset}>
          <Trans i18nKey="SETTINGS_PAGE.RESET" />
        </Button>
      </div>

      <div className="nav-order-locked" aria-label="Locked navigation items">
        {lockedItems.map((item) => (
          <span key={item.link || "home"}>
            <LockLineIcon size={14} />
            {item.i18nKey ? t(item.i18nKey) : getNavLabel(item)}
          </span>
        ))}
      </div>

      <div className="nav-order-list">
        {reorderableItems.map((item, index) => {
          const isHidden = hiddenLinks.includes(item.link);
          const label = item.i18nKey ? t(item.i18nKey) : getNavLabel(item);

          return (
            <div
              key={item.link}
              className={`nav-order-row${draggedLink === item.link ? " is-dragging" : ""}${isHidden ? " is-hidden" : ""}`}
              draggable
              onDragStart={(event) => {
                setDraggedLink(item.link);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.link);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                moveDraggedLink(item.link);
                setDraggedLink("");
              }}
              onDragEnd={() => setDraggedLink("")}
            >
              <span className="nav-order-drag" aria-hidden="true">
                <DragMove2LineIcon size={18} />
              </span>
              <span className="nav-order-icon">{item.icon}</span>
              <strong>{label}</strong>
              <button
                type="button"
                className="nav-order-visibility"
                onClick={() => toggleHidden(item.link)}
                aria-pressed={!isHidden}
                aria-label={isHidden ? `Show ${label} in navbar` : `Hide ${label} from navbar`}
                title={isHidden ? "Show tab" : "Hide tab"}
              >
                {isHidden ? <EyeOffLineIcon size={18} /> : <EyeLineIcon size={18} />}
              </button>
              <div className="nav-order-actions">
                <button type="button" onClick={() => moveLink(item.link, -1)} disabled={index === 0} aria-label={`Move ${label} up`}>
                  <ArrowUpSLineIcon size={18} />
                </button>
                <button type="button" onClick={() => moveLink(item.link, 1)} disabled={index === reorderableItems.length - 1} aria-label={`Move ${label} down`}>
                  <ArrowDownSLineIcon size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ThemePicker({ value, onSelect }) {
  const { t } = useTranslation();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const active = findMatchingThemePreset(value);
  const presets = useMemo(() => filterThemePresets(query, group), [query, group]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className={`general-theme-picker${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="general-theme-picker-toggle"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="general-theme-swatches" aria-hidden="true">
          <i style={{ backgroundColor: value.primary }} />
          <i style={{ backgroundColor: value.secondary }} />
          <i style={{ backgroundColor: value.background }} />
          <i style={{ backgroundColor: value.surface }} />
        </span>
        <span>
          <strong>{active?.name || t("SETTINGS_PAGE.CUSTOM")}</strong>
          <small>{active ? t(`SETTINGS_PAGE.THEME_GROUP_${active.group.toUpperCase()}`) : t("SETTINGS_PAGE.CUSTOM")}</small>
        </span>
        <em>{t("SETTINGS_PAGE.THEME_COUNT", { count: THEME_PRESETS.length })}</em>
        <ArrowDownSLineIcon size={18} />
      </button>
      {open ? (
        <div className="general-theme-picker-panel" role="listbox" aria-label={t("SETTINGS_PAGE.THEME_PRESET")}>
          <label className="general-theme-picker-search">
            <SearchLineIcon size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("SETTINGS_PAGE.THEME_SEARCH")}
              autoFocus
            />
          </label>
          <div className="general-theme-picker-groups">
            {THEME_GROUPS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={group === item.id ? "is-active" : ""}
                onClick={() => setGroup(item.id)}
              >
                {t(`SETTINGS_PAGE.THEME_GROUP_${item.id.toUpperCase()}`)}
              </button>
            ))}
          </div>
          <div className="general-theme-picker-grid">
            {presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className={active?.name === preset.name ? "is-active" : ""}
                role="option"
                aria-selected={active?.name === preset.name}
                onClick={() => {
                  onSelect(themeColorFields(preset));
                  setOpen(false);
                }}
              >
                <span
                  className="general-theme-picker-card"
                  style={{
                    "--preview-primary": preset.primary,
                    "--preview-secondary": preset.secondary,
                    "--preview-background": preset.background,
                    "--preview-surface": preset.surface,
                  }}
                >
                  <i />
                  <i />
                  <b>{preset.name}</b>
                </span>
              </button>
            ))}
            {!presets.length ? <p className="general-theme-picker-empty">{t("SETTINGS_PAGE.THEME_EMPTY")}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThemePresetPreview({ label, theme }) {
  return (
    <div
      className="general-theme-preview"
      style={{
        "--preview-primary": theme.primary,
        "--preview-secondary": theme.secondary,
        "--preview-background": theme.background,
        "--preview-surface": theme.surface,
      }}
    >
      <div className="general-theme-preview-sidebar">
        <span />
        <i />
        <i />
        <i />
      </div>
      <div className="general-theme-preview-main">
        <div className="general-theme-preview-top">
          <strong>{label}</strong>
          <span>Live preview</span>
        </div>
        <div className="general-theme-preview-card">
          <div>
            <b>Active Sessions</b>
            <small>2 streams running</small>
          </div>
          <button type="button" tabIndex={-1}>
            Sync
          </button>
        </div>
        <div className="general-theme-preview-list">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export default function SettingsConfig() {
  const { t } = useTranslation();
  const [config, setConfig] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState(localStorage.getItem("i18nextLng") ?? "en-US");
  const [formValuesExternal, setFormValuesExternal] = useState({});
  const [isSubmittedExternal, setisSubmittedExternal] = useState("");
  const [loadSate, setloadSate] = useState("Loading");
  const [submissionMessage, setsubmissionMessage] = useState("");
  const [submissionMessageExternal, setsubmissionMessageExternal] = useState("");
  const [twelve_hr, set12hr] = useState(localStorage.getItem("12hr") === "true");
  const [blobboHidden, setBlobboHiddenState] = useState(isBlobboHidden);
  const updateBlobboHidden = (next) => {
    setBlobboHidden(next);
    setBlobboHiddenState(next);
  };
  const [fontWeight, setFontWeight] = useState(() => getStoredFontWeight());
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [themeDraft, setThemeDraft] = useState(() => getStoredTheme());

  const storage_12hr = localStorage.getItem("12hr");

  if (storage_12hr === null) {
    localStorage.setItem("12hr", false);
    set12hr(false);
  } else if (twelve_hr === null) {
    set12hr(Boolean(storage_12hr));
  }

  useEffect(() => {
    function handleThemeUpdated(event) {
      if (!event.detail) return;
      setTheme(event.detail);
    }
    window.addEventListener("jellyglance-theme-updated", handleThemeUpdated);
    return () => window.removeEventListener("jellyglance-theme-updated", handleThemeUpdated);
  }, []);

  useEffect(() => {
    Config.getConfig()
      .then((config) => {
        setFormValuesExternal({ ExternalUrl: config.settings?.EXTERNAL_URL });
        setConfig(config);
        setloadSate("Loaded");
      })
      .catch((error) => {
        console.log("Error updating config:", error);
        setloadSate("Critical");
        setsubmissionMessage("Error Retrieving Configuration. Unable to contact Backend Server");
      });
  }, []);

  async function handleFormSubmitExternal(event) {
    event.preventDefault();
    setisSubmittedExternal("");

    const ExternalUrl = typeof formValuesExternal.ExternalUrl === "string" ? formValuesExternal.ExternalUrl.trim() : "";

    try {
      const response = await axios.post(
        "/api/setExternalUrl",
        { ExternalUrl },
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("Config updated successfully:", response.data);
      setisSubmittedExternal("Success");
      setsubmissionMessageExternal("Successfully updated configuration");
      await Config.setConfig();
    } catch (error) {
      const data = error.response?.data;
      const errorMessage =
        (typeof data === "string" && data) || data?.errorMessage || data?.error || error.message || "Unknown error";
      console.log("Error updating config:", errorMessage);
      setisSubmittedExternal("Failed");
      setsubmissionMessageExternal(`Error Updating Configuration: ${errorMessage}`);
    }
  }

  function handleFormChangeExternal(event) {
    setFormValuesExternal({ ...formValuesExternal, [event.target.name]: event.target.value });
  }

  function updateLanguage(event) {
    const languageCode = event.target.value;
    setSelectedLanguage(languageCode);
    localStorage.setItem("i18nextLng", languageCode);
    i18n.changeLanguage(languageCode);
  }

  if (loadSate === "Loading") {
    return <Loading />;
  }

  if (loadSate === "Critical") {
    return <div className="submit critical">{submissionMessage}</div>;
  }

  function toggle12Hr(is_12_hr) {
    set12hr(is_12_hr);
    localStorage.setItem("12hr", is_12_hr);
  }

  function updateFontWeight(nextFontWeight) {
    setFontWeight(saveFontWeightPreference(nextFontWeight));
  }

  function updateThemePreset(nextTheme) {
    setThemeDraft(themeColorFields(nextTheme));
  }

  function updateThemeDraftColor(key, value) {
    if (!HEX_COLOR_PATTERN.test(value)) return;
    setThemeDraft((currentTheme) => ({
      ...currentTheme,
      [key]: value,
    }));
  }

  function applyThemeGlobally() {
    const colors = themeColorFields(themeDraft);
    setTheme(saveTheme(colors));
    setThemeDraft(colors);
  }

  function discardThemePreview() {
    setThemeDraft(themeColorFields(theme));
  }

  function restoreTheme() {
    const restoredTheme = resetTheme();
    setTheme(restoredTheme);
    setThemeDraft(restoredTheme);
  }

  const activeThemePreset = findMatchingThemePreset(themeDraft);
  const externalUrl = formValuesExternal.ExternalUrl || "";
  const previewTheme = themeColorFields(activeThemePreset || themeDraft);
  const previewThemeName = activeThemePreset?.name || t("SETTINGS_PAGE.CUSTOM");
  const hasThemeChanges = JSON.stringify(themeColorFields(themeDraft)) !== JSON.stringify(themeColorFields(theme));

  return (
    <div className="general-settings-page">
      <div className="general-settings-content">
        <div className="settings-form general-settings-card is-single-form">
          <div className="general-settings-card-head">
            <div>
              <h3><Trans i18nKey="SETTINGS_PAGE.CORE_PREFERENCES" /></h3>
              <p><Trans i18nKey="SETTINGS_PAGE.CORE_PREFERENCES_INTRO" /></p>
            </div>
            <ExternalLinkLineIcon />
          </div>
          <div className="general-form-section">
            <h4><Trans i18nKey="SETTINGS_PAGE.DISPLAY_PREFERENCES" /></h4>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column>
                <Trans i18nKey={"SETTINGS_PAGE.HOUR_FORMAT"} />
              </Form.Label>
              <Col sm="10">
                <Form.Select value={twelve_hr ? "12" : "24"} onChange={(event) => toggle12Hr(event.target.value === "12")}>
                  <option value="24">
                    <Trans i18nKey={"SETTINGS_PAGE.HOUR_FORMAT_24"} />
                  </option>
                  <option value="12">
                    <Trans i18nKey={"SETTINGS_PAGE.HOUR_FORMAT_12"} />
                  </option>
                </Form.Select>
              </Col>
            </Form.Group>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column>
                <Trans i18nKey={"SETTINGS_PAGE.LANGUAGE"} />
              </Form.Label>
              <Col sm="10">
                <Form.Select value={selectedLanguage} onChange={updateLanguage}>
                  {languages
                    .slice()
                    .sort((a, b) => a.description.localeCompare(b.description))
                    .map((language) => (
                      <option value={language.id} key={language.id}>
                        {language.description}
                      </option>
                    ))}
                </Form.Select>
              </Col>
            </Form.Group>
            <Form.Group as={Row} className="mb-0">
              <Form.Label column><Trans i18nKey="SETTINGS_PAGE.FONT_WEIGHT" /></Form.Label>
              <Col sm="10">
                <Form.Select value={fontWeight} onChange={(event) => updateFontWeight(event.target.value)}>
                  {FONT_WEIGHT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            </Form.Group>
            <Form.Group as={Row} className="mb-0 mt-3">
              <Form.Label column htmlFor="blobbo-visibility">Blobbo helper</Form.Label>
              <Col sm="10">
                <Form.Select id="blobbo-visibility" value={blobboHidden ? "hidden" : "shown"} onChange={(event) => updateBlobboHidden(event.target.value === "hidden")}>
                  <option value="shown">Show Blobbo (Shift+A to say hello)</option>
                  <option value="hidden">Hide Blobbo</option>
                </Form.Select>
              </Col>
            </Form.Group>
          </div>

          <Form onSubmit={handleFormSubmitExternal}>
          <div className="general-form-section">
            <h4><Trans i18nKey="SETTINGS_PAGE.SERVER_ACCESS" /></h4>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column>
                <Trans i18nKey={"SETTINGS_PAGE.EXTERNAL_URL"} />
              </Form.Label>
              <Col sm="10">
                <Form.Control id="ExternalUrl" name="ExternalUrl" value={externalUrl} onChange={handleFormChangeExternal} placeholder="https://jellyglance.example.com" />
              </Col>
            </Form.Group>
          </div>

          {isSubmittedExternal !== "" ? (
            <Alert bg="dark" data-bs-theme="dark" variant={isSubmittedExternal === "Failed" ? "danger" : "success"}>
              {submissionMessageExternal}
            </Alert>
          ) : null}
          <div className="general-form-section">
            <h4><Trans i18nKey="SETTINGS_PAGE.THEME_PRESET" /></h4>
            <p className="general-theme-hint"><Trans i18nKey="SETTINGS_PAGE.THEME_HINT" /></p>
            <ThemePicker value={previewTheme} onSelect={updateThemePreset} />
            <div className="general-theme-selected">
              <div>
                <span className="general-theme-swatches" aria-hidden="true">
                  <i style={{ backgroundColor: previewTheme.primary }} />
                  <i style={{ backgroundColor: previewTheme.secondary }} />
                  <i style={{ backgroundColor: previewTheme.background }} />
                  <i style={{ backgroundColor: previewTheme.surface }} />
                </span>
                <strong>{previewThemeName}</strong>
              </div>
              <div className="general-theme-custom-grid">
                {THEME_COLOR_FIELDS.map((field) => (
                  <label key={field.key} className="general-theme-custom-control">
                    <span>{field.label}</span>
                    <div>
                      <input
                        type="color"
                        value={themeDraft[field.key]}
                        onChange={(event) => updateThemeDraftColor(field.key, event.target.value)}
                        aria-label={`${field.label} colour`}
                      />
                      <input
                        type="text"
                        value={themeDraft[field.key]}
                        onChange={(event) => updateThemeDraftColor(field.key, event.target.value)}
                        aria-label={`${field.label} hex colour`}
                        maxLength={7}
                      />
                    </div>
                  </label>
                ))}
              </div>
              <ThemePresetPreview label={previewThemeName} theme={previewTheme} />
            </div>
            <div className="general-theme-actions">
              <Button variant="outline-success" type="button" onClick={applyThemeGlobally} disabled={!hasThemeChanges}>
                <Trans i18nKey="SETTINGS_PAGE.APPLY_THEME" />
              </Button>
              <Button variant="outline-secondary" type="button" onClick={discardThemePreview} disabled={!hasThemeChanges}>
                <Trans i18nKey="SETTINGS_PAGE.DISCARD_THEME" />
              </Button>
              <Button
                variant="outline-secondary"
                type="button"
                onClick={restoreTheme}
                disabled={JSON.stringify(themeColorFields(theme)) === JSON.stringify(DEFAULT_THEME) && JSON.stringify(themeColorFields(themeDraft)) === JSON.stringify(DEFAULT_THEME)}
              >
                <Trans i18nKey="SETTINGS_PAGE.RESET_THEME" />
              </Button>
              {hasThemeChanges ? <span className="general-settings-pending"><Trans i18nKey="SETTINGS_PAGE.THEME_PREVIEW_PENDING" /></span> : null}
            </div>
          </div>
          <div className="general-settings-actions">
            <Button variant="outline-success" type="submit">
              <Trans i18nKey={"SETTINGS_PAGE.UPDATE"} />
            </Button>
          </div>
        </Form>
        </div>

        <NavigationOrderSettings />
      </div>
    </div>
  );
}
