const test = require("node:test");
const assert = require("node:assert/strict");
const { createDecipheriv } = require("crypto");

const { decryptLegacy, evpBytesToKey, isLegacyCiphertext } = require("../utils/legacy-crypto");
const { encryptSecret, decryptSecret } = require("../classes/integration-store");
const { decryptPassword, upgradeLegacyPassword } = require("../classes/smtp-mailer");

// Produced with crypto-js 4.2.0: CryptoJS.AES.encrypt(plain, passphrase).toString()
const FIXTURES = [
  { plain: "smtp-pass-under-crypto-js", passphrase: "test-jwt-secret", cipher: "U2FsdGVkX1+a4sucpacclvBGBF1RjKt2D+XGueFEoXW7HRKjmFHhQ16SxSlqkK5o" },
  {
    plain: "pässwörd ✓ with unicode & a much longer value to span several AES blocks",
    passphrase: "pg-password-fallback",
    cipher: "U2FsdGVkX1+5VXfuXnNmjMEYafuEZ3oCZRsBLO9SpPdJL9O+nNl2b39prx86m8AH0VgYWMW9OgN4VRI6t2tk2UVexa6tpjXDk6djIyNYZuGOQKhIN9Va2ZKy2Lz53F7N",
  },
  { plain: "x", passphrase: "jellyglance-newsletter", cipher: "U2FsdGVkX19/4+lIgOjtY+GRRtIXDad2NFzwbIFOOQI=" },
];

function withEnv(env, fn) {
  const keys = ["JWT_SECRET", "POSTGRES_PASSWORD", "INTEGRATION_SECRET_KEY"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("decrypts crypto-js ciphertext byte for byte", () => {
  for (const { plain, passphrase, cipher } of FIXTURES) {
    assert.equal(isLegacyCiphertext(cipher), true);
    assert.equal(decryptLegacy(cipher, passphrase), plain);
  }
});

test("EVP_BytesToKey(MD5) derives the OpenSSL key and IV, and the decrypted padding is consumed exactly", () => {
  const raw = Buffer.from(FIXTURES[0].cipher, "base64");
  const { key, iv } = evpBytesToKey(FIXTURES[0].passphrase, raw.subarray(8, 16));
  assert.equal(key.length, 32);
  assert.equal(iv.length, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
  const pad = padded[padded.length - 1];
  assert.equal(padded.subarray(0, padded.length - pad).toString("utf8"), FIXTURES[0].plain);
  assert.ok(padded.subarray(padded.length - pad).every((b) => b === pad));
});

test("uses the same key fallback order as before: JWT_SECRET, POSTGRES_PASSWORD, built-in default", () => {
  withEnv({ JWT_SECRET: "test-jwt-secret" }, () => assert.equal(decryptPassword(FIXTURES[0].cipher), FIXTURES[0].plain));
  withEnv({ POSTGRES_PASSWORD: "pg-password-fallback" }, () => assert.equal(decryptPassword(FIXTURES[1].cipher), FIXTURES[1].plain));
  withEnv({}, () => assert.equal(decryptPassword(FIXTURES[2].cipher), FIXTURES[2].plain));
});

test("wrong key returns an empty string instead of garbage", () => {
  assert.equal(decryptLegacy(FIXTURES[0].cipher, "not-the-key"), "");
  assert.equal(decryptLegacy(FIXTURES[1].cipher, "not-the-key"), "");
  withEnv({ JWT_SECRET: "a" }, () => {
    const current = encryptSecret("hello");
    withEnv({ JWT_SECRET: "b" }, () => assert.equal(decryptSecret(current), ""));
  });
});

test("non-legacy values are not treated as crypto-js ciphertext", () => {
  for (const value of ["", "plain-password", "jgenc:v1:abc", "U2FsdGVkX1", null, undefined, 42]) {
    assert.equal(isLegacyCiphertext(value), false);
    assert.equal(decryptLegacy(value, "k"), "");
  }
});

test("current scheme round-trips and uses a fresh IV each time", () => {
  withEnv({ JWT_SECRET: "round-trip" }, () => {
    const a = encryptSecret("smtp-secret");
    const b = encryptSecret("smtp-secret");
    assert.match(a, /^jgenc:v1:/);
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a), "smtp-secret");
    assert.equal(decryptPassword(a), "smtp-secret");
  });
});

test("tampered GCM ciphertext is rejected", () => {
  withEnv({ JWT_SECRET: "tamper" }, () => {
    const value = encryptSecret("smtp-secret");
    const payload = Buffer.from(value.slice("jgenc:v1:".length), "base64");
    payload[payload.length - 1] ^= 0x01;
    assert.equal(decryptSecret(`jgenc:v1:${payload.toString("base64")}`), "");
  });
});

test("legacy password is upgraded to the current scheme, and upgrading again changes nothing", () => {
  withEnv({ JWT_SECRET: "test-jwt-secret" }, () => {
    const upgraded = upgradeLegacyPassword(FIXTURES[0].cipher);
    assert.match(upgraded, /^jgenc:v1:/);
    assert.equal(decryptPassword(upgraded), FIXTURES[0].plain);
    assert.equal(upgradeLegacyPassword(upgraded), upgraded);
  });
});

test("upgrade leaves the value alone when it can't be read or there's no key to re-encrypt with", () => {
  withEnv({ JWT_SECRET: "wrong" }, () => assert.equal(upgradeLegacyPassword(FIXTURES[0].cipher), FIXTURES[0].cipher));
  // No JWT_SECRET: the legacy default key still reads it, but encryptSecret has no key, so keep the old value.
  withEnv({}, () => {
    assert.equal(decryptPassword(FIXTURES[2].cipher), "x");
    assert.equal(upgradeLegacyPassword(FIXTURES[2].cipher), FIXTURES[2].cipher);
  });
  assert.equal(upgradeLegacyPassword(""), "");
  assert.equal(upgradeLegacyPassword("plain"), "plain");
});
