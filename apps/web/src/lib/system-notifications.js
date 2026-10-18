import baseUrl from "./baseurl";

const ICON = `${baseUrl}/icon-192.png`;
let registrationPromise = null;

export function systemNotificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function secureContextAvailable() {
  return typeof window !== "undefined" && window.isSecureContext === true;
}

export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
    return navigator.userAgentData.mobile || /iPad|Tablet/i.test(navigator.userAgent);
  }
  return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || "");
}

export function isStandaloneApp() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function systemPermission() {
  if (!secureContextAvailable()) return "insecure";
  if (!systemNotificationsSupported()) return "unsupported";
  return Notification.permission;
}

export function systemChannelForDevice(settings) {
  return isMobileDevice() ? settings.mobile : settings.desktop;
}

async function notificationRegistration() {
  if (!secureContextAvailable() || !("serviceWorker" in navigator)) return null;
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register(`${baseUrl}/sw.js`, { scope: `${baseUrl}/` })
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return registrationPromise;
}

export async function requestSystemPermission() {
  const status = systemPermission();
  if (status === "insecure" || status === "unsupported") return status;
  await notificationRegistration();
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  return Notification.permission;
}

export async function showSystemNotification(title, body, { tag, url } = {}) {
  if (systemPermission() !== "granted") return false;
  const options = {
    body: String(body || ""),
    icon: ICON,
    badge: ICON,
    tag: tag || undefined,
    data: { url: url || `${baseUrl}/` },
  };
  try {
    const registration = await notificationRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return true;
    }
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function shouldSendSystemNotification(settings) {
  if (!systemChannelForDevice(settings)) return false;
  if (systemPermission() !== "granted") return false;
  if (settings.systemOnlyWhenHidden && document.visibilityState === "visible" && document.hasFocus()) return false;
  return true;
}
