import { useEffect, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import axios from "../../../lib/axios_instance";
import { APP_VERSION_STORAGE_KEY, OPEN_BLOBBO_CHAT_EVENT, WHATS_NEW_DISMISSED_EVENT } from "../../../lib/events";
import { markMeetBlobboSeen, shouldOfferMeetBlobbo, shouldWaitForWhatsNew } from "../../../lib/meet-blobbo";
import { lookAssets, resolveLook } from "../../../lib/blobbo-looks";
import { BLOBBO_PREFS_EVENT, getPrefs } from "../../../lib/blobbo-prefs";
import { BLOBBO_HIDDEN_KEY, BLOBBO_SETTING_EVENT, isBlobboHidden } from "../../../lib/blobbo-settings";
import BlobboLook from "./BlobboLook";

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return undefined;
    const onChange = (e) => setReduced(e.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export default function MeetBlobboModal({ enabled = true }) {
  const [version, setVersion] = useState("");
  const [show, setShow] = useState(false);
  const [hidden, setHidden] = useState(isBlobboHidden);
  const [lookId, setLookId] = useState(() => resolveLook(getPrefs()).id);
  const [wnDismissed, setWnDismissed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const lookArt = lookAssets(lookId);

  useEffect(() => {
    const syncHidden = () => setHidden(isBlobboHidden());
    const syncLook = () => setLookId(resolveLook(getPrefs()).id);
    const onStorage = (e) => {
      if (!e.key || e.key === BLOBBO_HIDDEN_KEY || e.key.startsWith("jellyglance.blobbo.")) {
        syncHidden();
        syncLook();
      }
    };
    window.addEventListener(BLOBBO_SETTING_EVENT, syncHidden);
    window.addEventListener(BLOBBO_PREFS_EVENT, syncLook);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BLOBBO_SETTING_EVENT, syncHidden);
      window.removeEventListener(BLOBBO_PREFS_EVENT, syncLook);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const onDismiss = () => setWnDismissed(true);
    window.addEventListener(WHATS_NEW_DISMISSED_EVENT, onDismiss);
    return () => window.removeEventListener(WHATS_NEW_DISMISSED_EVENT, onDismiss);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const cachedVersion = localStorage.getItem(APP_VERSION_STORAGE_KEY);
    if (cachedVersion) {
      setVersion(cachedVersion);
      return undefined;
    }

    let active = true;
    axios
      .get("/auth/isConfigured")
      .then((response) => {
        if (!active) return;
        const nextVersion = response.data?.version;
        if (nextVersion) setVersion(nextVersion);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || hidden || !shouldOfferMeetBlobbo(version, { hidden })) {
      if (hidden) setShow(false);
      return;
    }
    if (wnDismissed || !shouldWaitForWhatsNew(version)) {
      setShow(true);
    }
  }, [enabled, version, hidden, wnDismissed]);

  function dismiss(openChat = false) {
    markMeetBlobboSeen();
    setShow(false);
    if (openChat) {
      window.dispatchEvent(new Event(OPEN_BLOBBO_CHAT_EVENT));
    }
  }

  return (
    <Modal
      show={show}
      onHide={() => dismiss(false)}
      centered
      animation={!reducedMotion}
      dialogClassName="meet-blobbo-modal"
    >
      <Modal.Body>
        <button type="button" className="whats-new-close" onClick={() => dismiss(false)} aria-label="Close welcome">
          ×
        </button>
        <div className="meet-blobbo-hero">
          <div className="meet-blobbo-character">
            <BlobboLook svg={lookArt.svg} still={lookArt.still} size={148} animate={!reducedMotion} />
          </div>
          <span>Welcome</span>
          <h2>Meet Blobbo</h2>
          <p>
            I&apos;m Blobbo, your assistant here in JellyGlance. I can give you tips and answer
            questions about your server — who&apos;s watching, why something&apos;s buffering,
            where the disk went, that sort of thing. You can also press Shift+A any time.
          </p>
        </div>
        <div className="meet-blobbo-actions">
          <Button type="button" className="meet-blobbo-skip" variant="link" onClick={() => dismiss(false)}>
            Maybe later
          </Button>
          <Button type="button" className="meet-blobbo-cta" onClick={() => dismiss(true)}>
            Chat with Blobbo
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );
}
