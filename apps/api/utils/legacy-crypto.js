const { createDecipheriv, createHash } = require("crypto");

// Older releases stored the SMTP password with crypto-js `AES.encrypt(text, passphrase)`.
// That is the OpenSSL "Salted__" format: base64("Salted__" + 8-byte salt + ciphertext),
// key and IV derived with EVP_BytesToKey (MD5, one iteration), AES-256-CBC, PKCS#7.
// This reads those values with Node's built-in crypto so crypto-js is no longer needed.
// It is read-only: new values are always written with encryptSecret() (AES-256-GCM).

const SALTED_PREFIX = Buffer.from("Salted__", "latin1");

function legacySecretKey() {
  return process.env.JWT_SECRET || process.env.POSTGRES_PASSWORD || "jellyglance-newsletter";
}

function evpBytesToKey(passphrase, salt, keyLength = 32, ivLength = 16) {
  const password = Buffer.from(passphrase, "utf8");
  const chunks = [];
  let total = 0;
  let previous = Buffer.alloc(0);
  while (total < keyLength + ivLength) {
    previous = createHash("md5").update(Buffer.concat([previous, password, salt])).digest();
    chunks.push(previous);
    total += previous.length;
  }
  const material = Buffer.concat(chunks);
  return { key: material.subarray(0, keyLength), iv: material.subarray(keyLength, keyLength + ivLength) };
}

function isLegacyCiphertext(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const raw = Buffer.from(value, "base64");
  return raw.length >= 32 && (raw.length - 16) % 16 === 0 && raw.subarray(0, 8).equals(SALTED_PREFIX);
}

// Returns the plaintext, or "" when the value isn't legacy ciphertext or the key is wrong.
function decryptLegacy(value, passphrase = legacySecretKey()) {
  if (!isLegacyCiphertext(value)) return "";
  try {
    const raw = Buffer.from(value, "base64");
    const { key, iv } = evpBytesToKey(passphrase, raw.subarray(8, 16));
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const plain = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
    const text = plain.toString("utf8");
    // crypto-js threw "Malformed UTF-8 data" here; keep the same "can't read it" outcome.
    if (!Buffer.from(text, "utf8").equals(plain)) return "";
    return text;
  } catch {
    return "";
  }
}

module.exports = { decryptLegacy, evpBytesToKey, isLegacyCiphertext, legacySecretKey };
