# Google, OAuth, and what beta actually needs

*For the maintainer. Not a detachment document — the setup guide is what a
detachment follows.*

---

## The short version

**Verification is not a gate on anything.** It buys the app name and logo on the
consent screen. Capacity is gated on **publishing status**, which is a switch in
the Cloud console with no review behind it.

That was misunderstood here for weeks, because advice written for multi-tenant
Drive apps assumes a shared client and the `auth/drive` scope. This app has
neither. If you find yourself reading guidance about CASA, security assessments,
or annual reviews, you are reading about a different architecture.

| | |
|---|---|
| Scopes requested | `openid`, `email`, `profile`, `drive.file` — all **non-sensitive** |
| Verification needed to run | **No**, at any number of users |
| CASA / security assessment | **Never.** Attaches to *restricted* scopes only |
| 100-user cap | Applies to apps that present the unverified-app screen — which fires only on sensitive or restricted scopes |
| Cost | Zero |
| What verification buys | App name and logo on the consent screen. Declined — see §4 |

---

## 1. What is not required, and why

Three sources, all Google's own. Check them before believing anything else,
including this document.

- **`drive.file` is non-sensitive** —
  [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
  It grants access to files the app created and nothing else, which is why setup
  creates the folder rather than asking for a link to one.
- **Apps using only non-sensitive scopes need no verification** —
  [OAuth App Verification](https://support.google.com/cloud/answer/13463073):
  *"If your app utilizes only non-sensitive scopes, it is not mandatory for your
  app to complete the app verification process."*
- **The 100-user cap follows the unverified-app screen, not the publishing
  status** — [Manage App Audience](https://support.google.com/cloud/answer/15549945).
  That screen fires on sensitive or restricted scopes. This app requests neither.

Google names the resulting state **Unverified Published**: user type External,
status Published, verification Unverified → any Google user can access. The only
stated cost is that *"the app's name and logo are not displayed on the consent
screen."*

Google labels that state "strongly discouraged." Read the context: that guidance
is aimed at apps requesting sensitive and restricted scopes, where publishing
unverified means users consent to broad data access with nothing reviewed behind
it. A `drive.file` grant can only reach files this app created.

---

## 2. Before trusting §1 — the controlled test

**Do this on a throwaway Cloud project, never a detachment's.**

`tools/docs/setup-guide.html` currently tells every detachment *"Do not click
Publish app"* and warns that publishing hard-blocks everyone. **That warning was
correct when written**, under the old `auth/drive` scope. The scope narrowed to
`drive.file` afterwards and the warning has not been re-tested against it.

So §1 is a documentation reading, and this settles it against reality:

- [ ] New Cloud project, OAuth client, user type **External**
- [ ] Declare exactly `openid`, `email`, `profile`, `drive.file` — no more.
      A mismatch between declared and requested scopes triggers the
      unverified-app screen on its own, independent of sensitivity
- [ ] Point it at a scratch deployment of the app
- [ ] Click **Publish app**
- [ ] Sign in with an ordinary Gmail account that is **not** a test user
- [ ] Sign in with an Advanced Protection Program account, if one can be borrowed
      — this is the case Google's pages do not clearly cover
- [ ] Record the result in §5 below, with the date

**Clean consent** → §1 holds. Proceed to §3, and the setup guide gets shorter.
**Hard block** → §1 is wrong. Stop, keep detachments in Testing, and re-read.

---

## 3. What a detachment needs for beta

Assuming §2 came back clean. Each detachment owns its own Cloud project and
Client ID; there is no maintainer-owned client, and no detachment depends on
another.

- [ ] Create a Cloud project on the **Det Google Account**
- [ ] Enable the Google Drive API
- [ ] Configure the OAuth consent screen, user type **External**:
      app name, support email, privacy policy URL, authorised JavaScript origin
- [ ] Declare the four scopes above
- [ ] **Click Publish app**
- [ ] Copy the Client ID into the setup wizard

No test users. No cap. No review. No cost. The consent screen shows a project
identifier rather than the product name, because brand verification was declined
— see §4. That changes nothing about whether the app works.

---

## 4. Branding — declined

**Decided 29 Aug 2026: not doing it.** Recorded here so it is not re-proposed.

Brand verification would put the app name and logo on the consent screen. It is
per Cloud project, so with per-detachment Client IDs it does not scale anyway —
it only becomes coherent alongside a single shared client, which is a
support-burden decision nobody has needed to make.

The instinct to verify was a habit from working inside the ecosystem rather than
a requirement of this product: an open-source, niche tool tied to a seminar the
company sells does not need a branded consent screen to be trusted by the one
detachment running it. Revisit only if AFROTC HQ engages and asks for it.

**No custom domain either.** The app stays on GitHub Pages. Two consequences,
both accepted rather than pending:

- **`frame-ancestors` cannot be set.** Pages serves no custom response headers.
  `index.html` already refuses to run inside a frame in script, which is the
  mitigation available; it is not the header.
- **The origin is tied to the GitHub account.** Moving to a clean account is
  still a move — see §6, which applies to that move exactly as it would have to a
  custom domain.

---

## 5. What was actually observed

*The one section here that is evidence rather than documentation. The warning in
the setup guide was written from a real observation under a different scope and
outlived it; dated evidence is what stops that happening twice.*

| Date | Scopes | Publishing status | Account type | What the consent screen did |
|---|---|---|---|---|
| *(pending §2)* | | | | |

---

## 6. What breaks when the origin moves

The app is moving to a **clean GitHub account dedicated to it**, so the origin
changes from `dmg-arts.github.io/my-pwa/` even without a custom domain. All of
these are encoded against the origin and break on the move:

- **The OAuth authorised JavaScript origin** must be updated in each Cloud
  project, or nobody can sign in.
- **Every join link and QR code already handed out dies.** Regenerate and
  redistribute *after* the move, never before.
- **The privacy policy URL** in each consent screen configuration.

Because there is no custom domain, this cost recurs on any future host change.
That is the trade accepted in §4: a custom domain would have made the origin
stable for good, and was judged not worth it for one detachment.
