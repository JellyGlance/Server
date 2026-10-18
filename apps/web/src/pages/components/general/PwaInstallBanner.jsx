import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useInstallPrompt } from "../../../lib/pwa-install";

const DISMISS_KEY = "jellyglance_pwa_install_dismissed";

// One shared install prompt (lib/pwa-install) so the banner and the "Install app" menu button never fight over the event.
export default function PwaInstallBanner({ enabled = true, viewerStart = false }) {
  const { t } = useTranslation();
  const { canInstall, iosManual, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "true");

  if (!enabled || dismissed || (!canInstall && !iosManual)) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return (
    <div className="pwa-install-banner" role="status">
      <span>{iosManual ? t("PWA_INSTALL.IOS_HINT") : viewerStart ? t("PWA_INSTALL.VIEWER") : t("PWA_INSTALL.OPS")}</span>
      <div>
        {canInstall ? (
          <button type="button" onClick={() => install()}>
            {t("PWA_INSTALL.INSTALL")}
          </button>
        ) : null}
        <button type="button" className="is-quiet" onClick={dismiss}>
          {t("PWA_INSTALL.NOT_NOW")}
        </button>
      </div>
    </div>
  );
}
