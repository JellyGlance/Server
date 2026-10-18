const nodemailer = require("nodemailer");
const db = require("../db");
const { encryptSecret, decryptSecret } = require("./integration-store");
const { isValidEmail } = require("../utils/security");
const { decryptLegacy, isLegacyCiphertext } = require("../utils/legacy-crypto");

const SETTINGS_KEY = "Newsletter";


function defaultNewsletterSettings() {
  return {
    enabled: false,
    senderName: "JellyGlance",
    senderEmail: "",
    recipients: [],
    frequency: "manual",
    smtp: {
      host: "",
      port: 587,
      secure: false,
      username: "",
      password: "",
      rejectUnauthorized: true,
    },
    history: [],
  };
}

async function getAppSettings() {
  const { rows } = await db.query('SELECT settings FROM app_config where "ID"=1');
  return rows[0]?.settings || {};
}

function getNewsletterSettings(settings) {
  return {
    ...defaultNewsletterSettings(),
    ...(settings[SETTINGS_KEY] || {}),
    smtp: {
      ...defaultNewsletterSettings().smtp,
      ...((settings[SETTINGS_KEY] || {}).smtp || {}),
    },
  };
}

function decryptPassword(value) {
  if (!value) return "";
  const modern = decryptSecret(value);
  if (modern && modern !== value) {
    return modern;
  }
  return decryptLegacy(value);
}

// Re-encrypt an old crypto-js password with the current AES-256-GCM scheme. Anything else
// (already current, empty, unreadable, or no key to encrypt with) comes back unchanged,
// so running it again is a no-op.
function upgradeLegacyPassword(value) {
  if (!isLegacyCiphertext(value)) return value;
  const plain = decryptLegacy(value);
  if (!plain) return value;
  const upgraded = encryptSecret(plain);
  return typeof upgraded === "string" && upgraded.startsWith("jgenc:") ? upgraded : value;
}

function validateEmail(value) {
  return isValidEmail(value);
}

function validateSmtpSettings(newsletter) {
  if (!newsletter.smtp.host) return "SMTP host is required";
  if (!newsletter.smtp.port || Number(newsletter.smtp.port) <= 0) return "SMTP port is required";
  if (!newsletter.senderEmail || !validateEmail(newsletter.senderEmail)) return "A valid sender email is required";
  if (!decryptPassword(newsletter.smtp.password) && newsletter.smtp.username) return "SMTP password is required when a username is set";
  return "";
}

function createTransport(newsletter) {
  return nodemailer.createTransport({
    host: newsletter.smtp.host,
    port: Number(newsletter.smtp.port || 587),
    secure: Boolean(newsletter.smtp.secure),
    auth: newsletter.smtp.username
      ? {
          user: newsletter.smtp.username,
          pass: decryptPassword(newsletter.smtp.password),
        }
      : undefined,
    tls: {
      rejectUnauthorized: newsletter.smtp.rejectUnauthorized !== false,
    },
  });
}

async function sendConfiguredMail({ to, subject, text, html, attachments = [] }) {
  const settings = await getAppSettings();
  const newsletter = getNewsletterSettings(settings);
  const validationError = validateSmtpSettings(newsletter);
  if (validationError) {
    const error = new Error(validationError);
    error.statusCode = 400;
    throw error;
  }

  const recipients = Array.isArray(to) ? to : [to];
  const targets = recipients.map((recipient) => String(recipient || "").trim()).filter(Boolean);
  if (!targets.length || targets.some((email) => !validateEmail(email))) {
    const error = new Error("At least one valid recipient is required");
    error.statusCode = 400;
    throw error;
  }

  const transporter = createTransport(newsletter);
  const result = await transporter.sendMail({
    from: `"${newsletter.senderName || "JellyGlance"}" <${newsletter.senderEmail}>`,
    to: targets,
    subject,
    text,
    html,
    attachments,
  });

  return { ok: true, messageId: result.messageId, recipientCount: targets.length };
}

module.exports = {
  createTransport,
  decryptPassword,
  upgradeLegacyPassword,
  defaultNewsletterSettings,
  getAppSettings,
  getNewsletterSettings,
  sendConfiguredMail,
  validateEmail,
  validateSmtpSettings,
};
