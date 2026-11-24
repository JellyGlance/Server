import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  HOME_WIDGET_HEIGHT_LABELS,
  HOME_WIDGET_HEIGHTS,
  HOME_WIDGET_SIZE_COLUMNS,
  HOME_WIDGET_SNAP_COLUMNS,
  sizeForColumns,
} from "../../../lib/home-settings";

import AddLineIcon from "remixicon-react/AddLineIcon";
import ArrowGoBackLineIcon from "remixicon-react/ArrowGoBackLineIcon";
import CheckLineIcon from "remixicon-react/CheckLineIcon";
import CloseLineIcon from "remixicon-react/CloseLineIcon";
import DragMove2LineIcon from "remixicon-react/DragMove2LineIcon";
import RestartLineIcon from "remixicon-react/RestartLineIcon";
import Settings3LineIcon from "remixicon-react/Settings3LineIcon";

const LONG_PRESS_MS = 350;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 4;

function measure(stack, wrapper, sectionIds) {
  if (!stack || !wrapper) return { rects: {}, columns: null };
  const origin = wrapper.getBoundingClientRect();
  const rects = {};
  for (const sectionId of sectionIds) {
    const element = stack.querySelector(`:scope > .home-widget-id-${sectionId}`);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    rects[sectionId] = { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
  }
  const stackRect = stack.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(stack).columnGap) || 0;
  const columns = { left: stackRect.left - origin.left, top: stackRect.top - origin.top, width: stackRect.width, height: stackRect.height, gap, column: (stackRect.width - gap * 11) / 12 };
  return { rects, columns };
}

function findDropTarget(rects, draggedId, x, y) {
  let best = null;
  for (const [sectionId, rect] of Object.entries(rects)) {
    if (sectionId === draggedId) continue;
    const inside = x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const distance = inside ? -1 : Math.hypot(cx - x, cy - y);
    if (!best || distance < best.distance) {
      const after = y > rect.top + rect.height * 0.75 || (y >= rect.top && x > cx);
      best = { sectionId, distance, after };
    }
  }
  return best;
}

// Edit-in-place layer over the Home grid. Each visible widget gets a frame with
// a grip (drag with a mouse, long-press on touch, or Space + arrows from the
// keyboard), a hide button and a corner handle that resizes in 4/6/8/12 column
// steps.
// Quick picks in the size menu, as fractions of the 12-column grid.
const SIZE_MENU = [
  { size: "quarter", label: "¼" },
  { size: "small", label: "⅓" },
  { size: "medium", label: "½" },
  { size: "wide", label: "⅔" },
  { size: "threeQuarter", label: "¾" },
  { size: "large", label: "Full" },
];

export function HomeLayoutEditor({ stackRef, sectionIds, sizes, heights = {}, labels, onMove, onMoveBy, onResize, onHeight, onHide, announce }) {
  const wrapperRef = useRef(null);
  const [layout, setLayout] = useState({ rects: {}, columns: null });
  const [drag, setDrag] = useState(null);
  const [resize, setResize] = useState(null);
  const [picked, setPicked] = useState("");
  const [menuFor, setMenuFor] = useState("");

  useEffect(() => {
    if (!menuFor) return undefined;
    const onKey = (event) => event.key === "Escape" && setMenuFor("");
    const onDown = (event) => {
      if (!event.target.closest?.(".home-editor-menu, .home-editor-size")) setMenuFor("");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [menuFor]);
  const pressRef = useRef(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useLayoutEffect(() => {
    wrapperRef.current = stackRef.current?.parentElement || null;
    let frame = 0;
    let last = "";
    const tick = () => {
      const next = measure(stackRef.current, wrapperRef.current, sectionIds);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setLayout(next);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [stackRef, sectionIds]);

  const localPoint = useCallback((event) => {
    const origin = wrapperRef.current?.getBoundingClientRect();
    return origin ? { x: event.clientX - origin.left, y: event.clientY - origin.top } : { x: 0, y: 0 };
  }, []);

  const clearPress = () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  function startDrag(sectionId, event, point) {
    clearPress();
    navigator.vibrate?.(12);
    setDrag({ sectionId, x: point.x, y: point.y, target: null, pointerId: event.pointerId });
    announce?.(`Moving ${labels[sectionId]}. Release to drop.`);
  }

  function onGripPointerDown(sectionId, event) {
    if (event.button !== undefined && event.button !== 0) return;
    const point = localPoint(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const isTouch = event.pointerType === "touch";
    pressRef.current = { sectionId, start: point, isTouch, timer: null };
    if (isTouch) {
      pressRef.current.timer = setTimeout(() => startDrag(sectionId, event, pressRef.current?.last || point), LONG_PRESS_MS);
    }
  }

  function onGripPointerMove(sectionId, event) {
    const point = localPoint(event);
    if (drag?.sectionId === sectionId) {
      const target = findDropTarget(layoutRef.current.rects, sectionId, point.x, point.y);
      setDrag((current) => current && { ...current, x: point.x, y: point.y, target });
      return;
    }
    const press = pressRef.current;
    if (!press || press.sectionId !== sectionId) return;
    press.last = point;
    const moved = Math.hypot(point.x - press.start.x, point.y - press.start.y);
    if (press.isTouch && moved > TOUCH_SLOP) clearPress();
    else if (!press.isTouch && moved > MOUSE_SLOP) startDrag(sectionId, event, point);
  }

  function onGripPointerUp(sectionId) {
    clearPress();
    if (drag?.sectionId !== sectionId) return;
    if (drag.target) {
      onMove(sectionId, drag.target.sectionId, drag.target.after);
      announce?.(`${labels[sectionId]} moved ${drag.target.after ? "after" : "before"} ${labels[drag.target.sectionId]}.`);
    }
    setDrag(null);
  }

  function resizeStep(sectionId, direction) {
    const columns = HOME_WIDGET_SIZE_COLUMNS[sizes[sectionId] || "medium"] || 6;
    const index = HOME_WIDGET_SNAP_COLUMNS.indexOf(columns);
    const next = HOME_WIDGET_SNAP_COLUMNS[Math.min(HOME_WIDGET_SNAP_COLUMNS.length - 1, Math.max(0, index + direction))];
    onResize(sectionId, sizeForColumns(next));
    announce?.(`${labels[sectionId]} is ${next} of 12 columns wide.`);
  }

  function onGripKeyDown(sectionId, event) {
    const key = event.key;
    if (key === " " || key === "Enter") {
      event.preventDefault();
      if (picked === sectionId) {
        setPicked("");
        announce?.(`${labels[sectionId]} dropped.`);
      } else {
        setPicked(sectionId);
        announce?.(`${labels[sectionId]} picked up. Arrow keys move it, Shift with left or right resizes, Space drops.`);
      }
      return;
    }
    if (key === "Escape" && picked) {
      setPicked("");
      announce?.("Move finished.");
      return;
    }
    if (picked !== sectionId) return;
    if (event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
      event.preventDefault();
      resizeStep(sectionId, key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(key)) {
      event.preventDefault();
      const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      const position = onMoveBy(sectionId, direction);
      if (position) announce?.(`${labels[sectionId]} is now ${position.index + 1} of ${position.count}.`);
      // Keep focus on the grip after the widgets re-render.
      requestAnimationFrame(() => document.querySelector(`[data-home-grip="${sectionId}"]`)?.focus());
    }
  }

  function onResizePointerDown(sectionId, event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = layoutRef.current.rects[sectionId];
    setResize({ sectionId, columns: HOME_WIDGET_SIZE_COLUMNS[sizes[sectionId] || "medium"] || 6, left: rect?.left || 0, top: rect?.top || 0, height: rect?.height || 0 });
  }

  function onResizePointerMove(sectionId, event) {
    if (resize?.sectionId !== sectionId) return;
    const grid = layoutRef.current.columns;
    if (!grid) return;
    const point = localPoint(event);
    const raw = (point.x - resize.left + grid.gap) / (grid.column + grid.gap);
    const snapped = HOME_WIDGET_SIZE_COLUMNS[sizeForColumns(raw)];
    if (snapped !== resize.columns) setResize((current) => current && { ...current, columns: snapped });
  }

  function onResizePointerUp(sectionId) {
    if (resize?.sectionId !== sectionId) return;
    onResize(sectionId, sizeForColumns(resize.columns));
    announce?.(`${labels[sectionId]} is ${resize.columns} of 12 columns wide.`);
    setResize(null);
  }

  const grid = layout.columns;
  return (
    <div className="home-editor-layer" aria-hidden={false}>
      {resize && grid ? (
        <div className="home-editor-columns" style={{ left: grid.left, top: grid.top, width: grid.width, height: grid.height, gap: grid.gap }}>
          {Array.from({ length: 12 }, (_, index) => (
            <span key={index} className={HOME_WIDGET_SNAP_COLUMNS.includes(index + 1) ? "is-snap" : ""} />
          ))}
        </div>
      ) : null}
      {resize && grid ? (
        <div
          className="home-editor-resize-ghost"
          style={{ left: resize.left, top: resize.top, height: resize.height, width: resize.columns * grid.column + (resize.columns - 1) * grid.gap }}
        >
          <span>{resize.columns} / 12</span>
        </div>
      ) : null}
      {sectionIds.map((sectionId) => {
        const rect = layout.rects[sectionId];
        if (!rect) return null;
        const columns = HOME_WIDGET_SIZE_COLUMNS[sizes[sectionId] || "medium"] || 6;
        const isTarget = drag?.target?.sectionId === sectionId;
        return (
          <div
            key={sectionId}
            className={`home-editor-frame${drag?.sectionId === sectionId ? " is-drag-source" : ""}${picked === sectionId ? " is-picked" : ""}${isTarget ? (drag.target.after ? " is-drop-after" : " is-drop-before") : ""}`}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          >
            <div className="home-editor-handlebar">
              <button
                type="button"
                className="home-editor-grip"
                data-home-grip={sectionId}
                aria-label={`Move ${labels[sectionId]}. Press Space to pick up.`}
                aria-pressed={picked === sectionId}
                onPointerDown={(event) => onGripPointerDown(sectionId, event)}
                onPointerMove={(event) => onGripPointerMove(sectionId, event)}
                onPointerUp={() => onGripPointerUp(sectionId)}
                onPointerCancel={() => {
                  clearPress();
                  setDrag(null);
                }}
                onKeyDown={(event) => onGripKeyDown(sectionId, event)}
                onContextMenu={(event) => event.preventDefault()}
              >
                <DragMove2LineIcon size={15} />
                <span>{labels[sectionId]}</span>
              </button>
              <button
                type="button"
                className="home-editor-size"
                aria-haspopup="menu"
                aria-expanded={menuFor === sectionId}
                aria-label={`Size and height of ${labels[sectionId]}, now ${columns} of 12 columns`}
                onClick={() => setMenuFor((current) => (current === sectionId ? "" : sectionId))}
              >
                {columns}/12
                {heights[sectionId] ? ` · ${HOME_WIDGET_HEIGHT_LABELS[heights[sectionId]]}` : ""}
              </button>
              <button type="button" className="home-editor-hide" aria-label={`Hide ${labels[sectionId]}`} onClick={() => onHide(sectionId)}>
                <CloseLineIcon size={15} />
              </button>
            </div>
            {menuFor === sectionId ? (
              <div className="home-editor-menu" role="menu" aria-label={`${labels[sectionId]} size`}>
                <span className="home-editor-menu-label">Width</span>
                <div className="home-editor-menu-row">
                  {SIZE_MENU.map((option) => (
                    <button
                      key={option.size}
                      type="button"
                      role="menuitemradio"
                      aria-checked={(sizes[sectionId] || "medium") === option.size}
                      className={(sizes[sectionId] || "medium") === option.size ? "is-active" : ""}
                      onClick={() => {
                        onResize(sectionId, option.size);
                        announce?.(`${labels[sectionId]} is ${HOME_WIDGET_SIZE_COLUMNS[option.size]} of 12 columns wide.`);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {onHeight ? (
                  <>
                    <span className="home-editor-menu-label">Height</span>
                    <div className="home-editor-menu-row">
                      {HOME_WIDGET_HEIGHTS.map((height) => (
                        <button
                          key={height}
                          type="button"
                          role="menuitemradio"
                          aria-checked={(heights[sectionId] || "auto") === height}
                          className={(heights[sectionId] || "auto") === height ? "is-active" : ""}
                          onClick={() => {
                            onHeight(sectionId, height);
                            announce?.(`${labels[sectionId]} height is ${HOME_WIDGET_HEIGHT_LABELS[height]}.`);
                          }}
                        >
                          {HOME_WIDGET_HEIGHT_LABELS[height]}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="home-editor-resize"
              aria-label={`Resize ${labels[sectionId]}, now ${columns} of 12 columns. Left and right arrows change it.`}
              onPointerDown={(event) => onResizePointerDown(sectionId, event)}
              onPointerMove={(event) => onResizePointerMove(sectionId, event)}
              onPointerUp={() => onResizePointerUp(sectionId)}
              onPointerCancel={() => setResize(null)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  resizeStep(sectionId, event.key === "ArrowRight" ? 1 : -1);
                }
              }}
            />
          </div>
        );
      })}
      {drag ? (
        <div className="home-editor-ghost" style={{ left: drag.x, top: drag.y }}>
          <DragMove2LineIcon size={15} />
          {labels[drag.sectionId]}
        </div>
      ) : null}
    </div>
  );
}

export function HomeEditBar({ canUndo, onUndo, onReset, onDone, onAdd, onOptions, optionsOpen, hiddenCount }) {
  return (
    <div className="home-edit-bar home-glass-card" role="toolbar" aria-label="Editing Home">
      <div>
        <strong>Editing Home</strong>
        <span>Drag the grip (long-press on touch) or use Space and arrows. Pull the corner to resize.</span>
      </div>
      <button type="button" onClick={onAdd}>
        <AddLineIcon size={16} />
        Add widget{hiddenCount ? ` (${hiddenCount})` : ""}
      </button>
      <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <ArrowGoBackLineIcon size={16} />
        Undo
      </button>
      <button type="button" onClick={onReset}>
        <RestartLineIcon size={16} />
        Reset
      </button>
      <button type="button" onClick={onOptions} aria-pressed={optionsOpen}>
        <Settings3LineIcon size={16} />
        Options
      </button>
      <button type="button" className="is-done" onClick={onDone}>
        <CheckLineIcon size={16} />
        Done
      </button>
    </div>
  );
}

export const HOME_WIDGET_BLURBS = {
  sessions: "Who is watching right now, with an All quiet card when nobody is.",
  streamCapacity: "Active streams and transcodes against your caps.",
  overview: "Total plays, viewers and the daily hour curve.",
  hall: "Top viewers and titles.",
  library: "Library health at a glance.",
  catalog: "How much is in each library.",
  milestones: "Progress toward the next big numbers.",
  week: "This week's watching.",
  attention: "Things that need a look.",
  trends: "Today compared with last week.",
  issues: "Missing posters, metadata and other library issues.",
  watchParty: "Titles several people are watching.",
  watchTonight: "Ideas for tonight from the household's history.",
  upNext: "What airs or is next to watch in the next 24 hours.",
  peakHours: "When the household watches, by weekday and hour.",
  diskRunway: "Days until the media disks are full at the current rate.",
  recentlyAdded: "Posters of the newest movies and shows across your libraries.",
  downloadQueue: "Active downloads from your download clients, with progress and stalls.",
  requests: "Latest Jellyseerr or Overseerr requests and how many are pending.",
  playbackQuality: "How much plays direct, and what forces a transcode, over 30 days.",
  topClients: "The apps people watch with over the last 30 days.",
  clock: "A big clock and date, handy on a wall display.",
  appHealth: "One status light for Jellyfin and every connected app, with the last failure when one is red.",
  nowListening: "Who is listening on Audiobookshelf and what was just added.",
  autoCollections: "Each auto collection's poster, size and when it last refreshed.",
  spaceToFree: "Extra copies of duplicated movies and current cleanup rule matches.",
  seasonGaps: "Shows with whole seasons missing.",
  tdarr: "Tdarr transcode queue.",
  wizarr: "Pending Wizarr invites.",
  maintainerr: "What Maintainerr will clean up next.",
  bazarr: "Missing subtitles from Bazarr.",
  prowlarr: "Indexer health from Prowlarr.",
  automation: "Recent automation events.",
  quickActions: "Sync, backup and integration test buttons.",
  operations: "Requests, downloads and server health.",
};

export const HOME_WIDGET_INTEGRATIONS = {
  tdarr: { slug: "tdarr", name: "Tdarr" },
  wizarr: { slug: "wizarr", name: "Wizarr" },
  maintainerr: { slug: "maintainerr", name: "Maintainerr" },
  bazarr: { slug: "bazarr", name: "Bazarr" },
  prowlarr: { slug: "prowlarr", name: "Prowlarr" },
  upNext: { slug: "sonarr", name: "Sonarr", optional: true },
  nowListening: { slug: "audiobookshelf", name: "Audiobookshelf" },
};

// Groups for the Add widget drawer. Anything not listed falls under "More".
export const HOME_WIDGET_CATEGORIES = [
  { label: "Right now", ids: ["sessions", "streamCapacity", "nowListening", "upNext", "watchTonight", "watchParty"] },
  { label: "Stats", ids: ["overview", "hall", "week", "trends", "milestones", "peakHours", "playbackQuality", "topClients"] },
  { label: "Library", ids: ["recentlyAdded", "library", "catalog", "issues", "seasonGaps", "diskRunway", "autoCollections", "spaceToFree"] },
  { label: "Requests and downloads", ids: ["requests", "downloadQueue"] },
  { label: "Server and automation", ids: ["appHealth", "operations", "attention", "quickActions", "automation"] },
  { label: "Integrations", ids: ["tdarr", "wizarr", "maintainerr", "bazarr", "prowlarr"] },
  { label: "Display", ids: ["clock"] },
];

export function AddWidgetDrawer({ open, hiddenIds, labels, connected, onAdd, onClose }) {
  const searchRef = useRef(null);
  const [query, setQuery] = useState("");
  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    searchRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const matches = (sectionId) =>
    !needle || `${labels[sectionId] || sectionId} ${HOME_WIDGET_BLURBS[sectionId] || ""}`.toLowerCase().includes(needle);
  const listed = new Set(HOME_WIDGET_CATEGORIES.flatMap((category) => category.ids));
  const groups = [
    ...HOME_WIDGET_CATEGORIES.map((category) => ({ label: category.label, ids: category.ids.filter((id) => hiddenIds.includes(id)) })),
    { label: "More", ids: hiddenIds.filter((id) => !listed.has(id)) },
  ]
    .map((group) => ({ ...group, ids: group.ids.filter(matches) }))
    .filter((group) => group.ids.length);

  return (
    <div className="home-add-drawer-backdrop" onClick={close}>
      <aside className="home-add-drawer" role="dialog" aria-modal="true" aria-label="Add a widget" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Add a widget</strong>
          <button type="button" aria-label="Close" onClick={close}>
            <CloseLineIcon size={18} />
          </button>
        </header>
        {hiddenIds.length ? (
          <input
            ref={searchRef}
            className="home-add-drawer-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${hiddenIds.length} widgets`}
            aria-label="Search widgets"
          />
        ) : (
          <p>Every widget is already on Home.</p>
        )}
        {hiddenIds.length && !groups.length ? <p>No widgets match “{query}”.</p> : null}
        <div className="home-add-drawer-list">
          {groups.map((group) => (
            <section key={group.label} className="home-add-drawer-group">
              <h3>{group.label}</h3>
              {group.ids.map((sectionId) => {
                const integration = HOME_WIDGET_INTEGRATIONS[sectionId];
                const needsConnection = integration && !integration.optional && connected && !connected.has(integration.slug);
                return (
                  <article key={sectionId} className={needsConnection ? "is-unavailable" : ""}>
                    <div>
                      <strong>{labels[sectionId]}</strong>
                      <small>{HOME_WIDGET_BLURBS[sectionId] || ""}</small>
                    </div>
                    {needsConnection ? (
                      <Link to="/integrations" onClick={close}>
                        Connect {integration.name} first
                      </Link>
                    ) : (
                      <button type="button" onClick={() => onAdd(sectionId)}>
                        <AddLineIcon size={16} />
                        Add
                      </button>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function UndoToast({ message, onUndo, onClose }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [message, onClose]);
  if (!message) return null;
  return (
    <div className="home-undo-toast" role="status">
      <span>{message}</span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
