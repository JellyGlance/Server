import { useEffect, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import MagicLineIcon from "remixicon-react/MagicLineIcon";
import UploadCloud2LineIcon from "remixicon-react/UploadCloud2LineIcon";
import PaletteLineIcon from "remixicon-react/PaletteLineIcon";
import SpeedLineIcon from "remixicon-react/SpeedLineIcon";
import Movie2LineIcon from "remixicon-react/Movie2LineIcon";
import MailLineIcon from "remixicon-react/MailLineIcon";
import ShieldCheckLineIcon from "remixicon-react/ShieldCheckLineIcon";
import RocketLineIcon from "remixicon-react/RocketLineIcon";
import ChatCheckLineIcon from "remixicon-react/ChatCheckLineIcon";
import GroupLineIcon from "remixicon-react/GroupLineIcon";
import axios from "../../../lib/axios_instance";
import { APP_VERSION_STORAGE_KEY, OPEN_WHATS_NEW_EVENT } from "../../../lib/events";
import releaseNotes from "../../../whats-new.json";
import { findReleaseNotes, formatDisplayVersion, isBetaVersion } from "../../../lib/release-channel";

const SEEN_VERSION_KEY = "jellyglance_whats_new_seen_version";

const iconMap = {
  magic: MagicLineIcon,
  movie: Movie2LineIcon,
  palette: PaletteLineIcon,
  speed: SpeedLineIcon,
  upload: UploadCloud2LineIcon,
  mail: MailLineIcon,
  shield: ShieldCheckLineIcon,
  rocket: RocketLineIcon,
  chat: ChatCheckLineIcon,
  users: GroupLineIcon,
};

function getNotes(version) {
  return findReleaseNotes(releaseNotes, version) || [
    {
      icon: MagicLineIcon,
      title: "JellyGlance updated",
      body: "Fresh improvements are ready. Keep an eye on Activity, Settings, and the dashboard for new polish.",
    },
  ];
}

function resolveIcon(icon) {
  return iconMap[icon] || MagicLineIcon;
}

export default function WhatsNewModal({ enabled = true }) {
  const [version, setVersion] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const cachedVersion = localStorage.getItem(APP_VERSION_STORAGE_KEY);
    if (cachedVersion) {
      setVersion(cachedVersion);
      if (localStorage.getItem(SEEN_VERSION_KEY) !== cachedVersion) {
        setShow(true);
      }
      return;
    }

    let active = true;
    axios
      .get("/auth/isConfigured")
      .then((response) => {
        if (!active) return;
        const nextVersion = response.data?.version;
        if (!nextVersion) return;

        setVersion(nextVersion);
        if (localStorage.getItem(SEEN_VERSION_KEY) !== nextVersion) {
          setShow(true);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [enabled]);

  useEffect(() => {
    const openWhatsNew = () => {
      if (!enabled) return;
      if (version) {
        setShow(true);
        return;
      }

      axios
        .get("/auth/isConfigured")
        .then((response) => {
          const nextVersion = response.data?.version || "";
          setVersion(nextVersion);
          setShow(Boolean(nextVersion));
        })
        .catch(() => {});
    };

    window.addEventListener(OPEN_WHATS_NEW_EVENT, openWhatsNew);
    return () => window.removeEventListener(OPEN_WHATS_NEW_EVENT, openWhatsNew);
  }, [enabled, version]);

  function closeModal() {
    if (version) {
      localStorage.setItem(SEEN_VERSION_KEY, version);
    }
    setShow(false);
  }

  const notes = getNotes(version);

  return (
    <Modal show={show} onHide={closeModal} centered dialogClassName="whats-new-modal">
      <Modal.Body>
        <button type="button" className="whats-new-close" onClick={closeModal} aria-label="Close what's new">
          ×
        </button>
        <div className="whats-new-hero">
          <span>
            <MagicLineIcon size={17} />
            What&apos;s new{isBetaVersion(version) ? " (beta)" : ""}
          </span>
          {isBetaVersion(version) ? <em className="release-channel-badge">Beta channel</em> : null}
          <h2>JellyGlance {formatDisplayVersion(version)}</h2>
          <p>A quick look at the newest bits before you dive back in.</p>
        </div>
        <div className="whats-new-list">
          {notes.map((item) => {
            const Icon = resolveIcon(item.icon);
            return (
              <article key={item.title}>
                <Icon size={22} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
              </article>
            );
          })}
        </div>
        <div className="whats-new-actions">
          <Button type="button" variant="primary" onClick={closeModal}>
            Got it
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );
}
