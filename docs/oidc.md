# Single sign-on (OIDC)

JellyGlance can sign people in through any OpenID Connect provider. It uses the authorization code flow with PKCE and has been written against Authentik, Authelia and Keycloak.

Local accounts keep working alongside it. If single sign-on is misconfigured or your provider is down, choose **Sign in with a local account instead** on the login page, or use the `JS_USER` / `JS_PASSWORD` environment login as a break-glass account.

## How it works

1. **Login:** JellyGlance reads the provider's discovery document (`<issuer>/.well-known/openid-configuration`) and sends the browser to the provider with a PKCE challenge, a `nonce` and a signed `state`. A short-lived, HTTP-only cookie ties the login to that browser.
2. **Code exchange:** the provider sends the browser back to `/auth/oidc/callback`. JellyGlance checks the `state` and the browser cookie, swaps the code for tokens, and verifies the ID token:
   - The signature is checked against the provider's JWKS. Only RSA, RSA-PSS, EC and EdDSA keys are accepted; `none` and shared-secret algorithms are refused.
   - `iss` must equal the configured issuer, `aud` must contain the client ID (with `azp` checked when there are several audiences), `exp` must be in the future, and `nonce` must match the one sent at login.
3. **User and role:** the sign-in is linked to a JellyGlance user (see below), and its role comes from the group mapping.

## Settings

Set these under **Settings → Security → OIDC**. Environment variables take precedence over the UI.

| Setting | Environment variable | Notes |
| --- | --- | --- |
| Issuer URL | `OIDC_ISSUER_URL` | The issuer exactly as the provider reports it. |
| Client ID | `OIDC_CLIENT_ID` | |
| Client secret | `OIDC_CLIENT_SECRET` | Optional. Leave it empty for a public client, which then relies on PKCE alone. Secrets saved in the UI are encrypted at rest. |
| Redirect URI | `OIDC_REDIRECT_URI` | Defaults to `<your JellyGlance URL>/auth/oidc/callback`. Register exactly this URL with the provider. |
| Scopes | `OIDC_SCOPES` | Default `openid profile email`. Add `groups` (or your provider's equivalent) for role mapping. |
| Groups claim | `OIDC_GROUPS_CLAIM` | Default `groups`. Dotted paths work, e.g. `realm_access.roles` for Keycloak realm roles. |
| Group to role mapping | `OIDC_ROLE_MAPPING` | `group=Role` pairs, one per line (or comma-separated, or JSON). The highest matching role wins. |
| Link sign-ins to users | `OIDC_LINK_POLICY` | `verified_email` (default), `username` or `manual`. |
| Auto-provision | `OIDC_AUTO_PROVISION` | `true` creates a JellyGlance-only account for sign-ins that match no user. |
| Default role | `OIDC_DEFAULT_ROLE` | Used for auto-provisioned accounts and when no group matches. Default `Viewer`. |
| Button label | `OIDC_LABEL` | Shown on the login page. |

## Linking accounts, and why email matching is strict

Each sign-in is identified by the provider's issuer plus its `sub`. Once linked, a person always maps to the same JellyGlance user, even if they change their name or email at the provider.

The first time someone signs in, JellyGlance looks for a user to link them to:

- **`verified_email` (default):** link only if the provider says the email is verified (`email_verified: true`) and it matches exactly one user who isn't already linked.
- **`username`:** match the provider's `preferred_username` to a media server username. Only use this if users can't choose or change their own username at the provider. Otherwise anyone could register as `admin` and take over that account.
- **`manual`:** never link automatically.

If no user matches, sign-in is refused, unless **auto-provision** is on, in which case a JellyGlance-only account is created with the mapped or default role.

Roles are decided in this order:

1. A user set to **Disabled** on the Users page stays disabled.
2. The group mapping.
3. The role already assigned on the Users page.
4. Media server admins get `Admin`.
5. Otherwise the default role.

## Network safety

The discovery, token, JWKS and userinfo requests:

- never follow redirects;
- refuse loopback, link-local, unspecified and cloud metadata addresses, checked after DNS resolution (LAN addresses are allowed, since self-hosted providers usually live there);
- must stay on the issuer's own host. A discovery document that points elsewhere is rejected.

## Provider examples

The examples use `https://glance.example.com` for JellyGlance.

### Authentik

1. **Applications → Providers → Create → OAuth2/OpenID Provider.**
   - Client type: *Confidential* (or *Public* for no secret).
   - Redirect URIs: `https://glance.example.com/auth/oidc/callback`
   - Scopes: `openid`, `email`, `profile`. Authentik's `profile` scope already includes `groups`.
   - Signing key: pick a certificate so ID tokens are RS256-signed.
2. **Applications → Create:** slug `jellyglance`, linked to the provider.
3. In JellyGlance:
   - Issuer URL: `https://auth.bjr-home.uk/application/o/jellyglance/` (your Authentik host plus `/application/o/<slug>/`)
   - Groups claim: `groups`
   - Role mapping, for example:
     ```
     JellyGlance Admins=Admin
     JellyGlance Users=Viewer
     ```

### Authelia

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: jellyglance
        client_name: JellyGlance
        client_secret: '$pbkdf2-sha512$...'   # hash of the secret you put in JellyGlance
        public: false
        authorization_policy: two_factor
        require_pkce: true
        pkce_challenge_method: S256
        redirect_uris:
          - https://glance.example.com/auth/oidc/callback
        scopes: [openid, profile, email, groups]
        token_endpoint_auth_method: client_secret_basic
```

In JellyGlance:
- Issuer URL: `https://auth.example.com`
- Scopes: `openid profile email groups`
- Groups claim: `groups`

### Keycloak

1. **Clients → Create client:** OpenID Connect, client ID `jellyglance`.
   - Client authentication: on (confidential) or off (public).
   - Standard flow: on.
   - Valid redirect URIs: `https://glance.example.com/auth/oidc/callback`
   - Advanced: *Proof Key for Code Exchange Code Challenge Method* = `S256`.
2. For groups, add a **Group Membership** mapper to the client's dedicated scope, with token claim name `groups` and *Full group path* off.
3. In JellyGlance:
   - Issuer URL: `https://keycloak.example.com/realms/<realm>`
   - Groups claim: `groups` (or `realm_access.roles` to map realm roles instead)
