// HTTP-level check of the public /auth/isConfigured endpoint using the real router.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const configPath = require.resolve(path.join(__dirname, "..", "classes", "config"));
const storedConfig = {
  state: 2,
  REQUIRE_LOGIN: true,
  APP_USER: "oidc",
  JF_API_KEY: "media-server-key",
  settings: {
    auth: { mode: "oidc", label: "OIDC / Authentik", clientId: "cid", clientSecret: "oidc-secret", discovery: { issuer: "https://auth.example" } },
    Integrations: { arrApps: [{ values: { secret: "sonarr-key" } }] },
  },
};
class FakeConfig {
  async getConfig() {
    return storedConfig;
  }
  clearCache() {}
}
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: FakeConfig };

const originalLog = console.log;
console.log = () => {};
const express = require("express");
const authRouter = require("../routes/auth");
console.log = originalLog;

test("GET /auth/isConfigured never returns secrets", async () => {
  const app = express();
  app.use("/auth", authRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/auth/isConfigured`);
    assert.equal(response.status, 200);
    const text = await response.text();
    const body = JSON.parse(text);
    assert.deepEqual(body.auth, { mode: "oidc", label: "OIDC / Authentik" });
    assert.equal(body.state, 2);
    for (const secret of ["oidc-secret", "sonarr-key", "media-server-key", "cid"]) assert.equal(text.includes(secret), false, secret);
  } finally {
    server.close();
  }
});

test("setup-only server checks are refused once JellyGlance is configured", async () => {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    for (const route of ["test-jellyfin", "configSetup"]) {
      const response = await fetch(`http://127.0.0.1:${port}/auth/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ JF_HOST: "http://127.0.0.1:9", JF_API_KEY: "x" }),
      });
      assert.equal(response.status, 403, route);
    }
  } finally {
    server.close();
  }
});

// OIDC callback: state/binding checks and error responses.
const { createHash } = require("node:crypto");
const jwt = require("jsonwebtoken");
const oidc = require("../classes/oidc");

const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const signState = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "10m" });
const validState = (binding = "browser-binding-value") =>
  signState({ type: "oidc", nonce: "n-123", verifier: "v-123", binding: sha256(binding) });

async function withAuthServer(run) {
  const app = express();
  app.use("/auth", authRouter);
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

async function withDiscoverStub(impl, run) {
  const original = oidc.discover;
  const calls = [];
  oidc.discover = async (...args) => {
    calls.push(args);
    return impl(...args);
  };
  try {
    await run(calls);
  } finally {
    oidc.discover = original;
  }
}

async function withCapturedLogs(run) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try {
    await run(lines);
  } finally {
    console.log = original;
  }
}

async function callback(base, { state, cookie, code = "auth-code" } = {}) {
  const params = new URLSearchParams();
  if (state !== undefined) params.set("state", state);
  if (code) params.set("code", code);
  const headers = cookie === undefined ? {} : { Cookie: cookie };
  const response = await fetch(`${base}/auth/oidc/callback?${params}`, { headers, redirect: "manual" });
  return { status: response.status, body: await response.text() };
}

test("OIDC callback rejects a valid state that has no browser binding cookie", async () => {
  await withDiscoverStub(
    () => {
      throw new Error("discovery must not run");
    },
    async (calls) => {
      await withAuthServer(async (base) => {
        const result = await callback(base, { state: validState() });
        assert.equal(result.status, 400);
        assert.match(result.body, /OIDC state is invalid or was started in another browser/);
        assert.equal(calls.length, 0);
      });
    }
  );
});

test("OIDC callback rejects a binding cookie from another browser", async () => {
  await withDiscoverStub(
    () => {
      throw new Error("discovery must not run");
    },
    async (calls) => {
      await withAuthServer(async (base) => {
        const result = await callback(base, { state: validState("real-binding"), cookie: "jg_oidc_binding=other-binding" });
        assert.equal(result.status, 400);
        assert.match(result.body, /started in another browser/);
        assert.equal(calls.length, 0);
      });
    }
  );
});

test("OIDC callback cannot be satisfied by an empty binding on both sides", async () => {
  await withDiscoverStub(
    () => {
      throw new Error("discovery must not run");
    },
    async (calls) => {
      await withAuthServer(async (base) => {
        const emptyBindingState = signState({ type: "oidc", nonce: "n", verifier: "v", binding: sha256("") });
        for (const cookie of [undefined, "jg_oidc_binding="]) {
          const result = await callback(base, { state: emptyBindingState, cookie });
          assert.equal(result.status, 400, String(cookie));
          assert.match(result.body, /started in another browser/);
        }
        const noBindingState = signState({ type: "oidc", nonce: "n", verifier: "v" });
        const result = await callback(base, { state: noBindingState, cookie: "jg_oidc_binding=" });
        assert.equal(result.status, 400);
        assert.equal(calls.length, 0);
      });
    }
  );
});

test("OIDC callback treats a malformed binding cookie as missing instead of failing", async () => {
  await withCapturedLogs(async () => {
    await withAuthServer(async (base) => {
      const result = await callback(base, { state: validState(), cookie: "jg_oidc_binding=%E0%A4%A" });
      assert.equal(result.status, 400);
      assert.match(result.body, /started in another browser/);
      assert.equal(/URI malformed|URIError/.test(result.body), false);
    });
  });
});

test("OIDC callback with a matching binding reaches the provider", async () => {
  await withDiscoverStub(
    () => {
      throw new oidc.OidcError("unknown_key", "stop here");
    },
    async (calls) => {
      await withCapturedLogs(async () => {
        await withAuthServer(async (base) => {
          const result = await callback(base, { state: validState("b-1"), cookie: "jg_oidc_binding=b-1" });
          assert.equal(result.status, 400);
          assert.equal(calls.length, 1);
        });
      });
    }
  );
});

test("OIDC callback never reflects provider error text into the page", async () => {
  const hostile = '<img src=x onerror=alert(1)></script><script>alert(2)</script>';
  await withDiscoverStub(
    () => {
      throw new oidc.OidcError("issuer_mismatch", `The provider says its issuer is ${hostile}, not https://auth.example`);
    },
    async () => {
      await withCapturedLogs(async (logs) => {
        await withAuthServer(async (base) => {
          const result = await callback(base, { state: validState("b-2"), cookie: "jg_oidc_binding=b-2" });
          assert.equal(result.status, 400);
          assert.match(result.body, /the provider's issuer does not match the configured issuer/);
          for (const fragment of ["onerror", "alert(", "<img", "provider says"]) {
            assert.equal(result.body.includes(fragment), false, fragment);
          }
          assert.ok(logs.some((line) => line.includes("[OIDC] callback failed") && line.includes("issuer_mismatch")));
        });
      });
    }
  );
});

test("OIDC callback hides unexpected errors behind a generic message and redacts the log", async () => {
  // Token-shaped values are built at run time so the test file holds no credential-like literals.
  const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const leakedJwt = [b64url({ alg: "RS256" }), b64url({ sub: "user" }), b64url("signature-value")].join(".");
  const leakedSecret = "x".repeat(20) + "Y".repeat(20);
  await withDiscoverStub(
    () => {
      const error = new Error(`token endpoint said ${leakedJwt} for client secret ${leakedSecret} <b>bold</b>`);
      error.code = "ERR_BAD_RESPONSE";
      throw error;
    },
    async () => {
      await withCapturedLogs(async (logs) => {
        await withAuthServer(async (base) => {
          const result = await callback(base, { state: validState("b-3"), cookie: "jg_oidc_binding=b-3" });
          assert.equal(result.status, 502);
          assert.match(result.body, /"Unable to complete OIDC login"/);
          for (const fragment of ["token endpoint said", leakedJwt, leakedSecret, "<b>", "ERR_BAD_RESPONSE"]) {
            assert.equal(result.body.includes(fragment), false, fragment);
          }
          const logged = logs.join("\n");
          assert.match(logged, /\[OIDC\] callback failed/);
          assert.equal(logged.includes(leakedJwt), false);
          assert.equal(logged.includes(leakedSecret), false);
          assert.match(logged, /\[redacted-jwt\]/);
        });
      });
    }
  );
});

test("isValidOidcCallbackState requires every check to pass", () => {
  const check = authRouter.isValidOidcCallbackState;
  const good = { type: "oidc", nonce: "n", verifier: "v", binding: sha256("b") };
  assert.equal(check(good, "b"), true);
  assert.equal(check(good, ""), false);
  assert.equal(check(good, undefined), false);
  assert.equal(check(good, "c"), false);
  assert.equal(check({ ...good, type: "local" }, "b"), false);
  assert.equal(check({ ...good, nonce: 1 }, "b"), false);
  assert.equal(check({ ...good, verifier: "" }, "b"), false);
  assert.equal(check({ ...good, binding: undefined }, "b"), false);
  assert.equal(check({ ...good, binding: sha256("") }, ""), false);
  assert.equal(check(null, "b"), false);
  assert.equal(check("not-an-object", "b"), false);
});

test("describeOidcCallbackError only returns fixed messages", () => {
  const describe = authRouter.describeOidcCallbackError;
  assert.deepEqual(describe(new oidc.OidcError("bad_token", "ID token rejected: <script>")), {
    status: 400,
    errorMessage: "Unable to complete OIDC login: the ID token was rejected",
  });
  assert.deepEqual(describe(new oidc.OidcError("made_up", "<script>")), { status: 502, errorMessage: "Unable to complete OIDC login" });
  const plain = new Error("<script>");
  plain.code = "bad_token";
  assert.deepEqual(describe(plain), { status: 502, errorMessage: "Unable to complete OIDC login" });
  assert.deepEqual(describe(undefined), { status: 502, errorMessage: "Unable to complete OIDC login" });
});
