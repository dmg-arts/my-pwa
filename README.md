# TOP-Feedback

A progressive web app for the student ↔ instructor feedback cycle, built for
AFROTC detachments. Every organization owns its own data: the app has no server
and no shared database, and writes only to storage the detachment controls.

- **Student** — signs in with a username and password issued by the detachment,
  then sees the feedback assigned to them, filtered by school year, semester,
  class and due date.
- **Instructor Portal** — behind an instructor sign-in. **Create Feedback**
  builds a standardized form; **Feedback Response and Analysis** filters
  responses by date, class, AS level or feedback ID and shows who still owes
  feedback.
- **Database Administration** — behind an admin sign-in. Creates and manages
  every account for the detachment, and resets any password.
- **Settings** — where the database lives, plus light/dark, color-vision
  palettes, contrast and text size.

---

## Running it

There is no build step and no dependencies. Any static HTTPS host will serve it.

```bash
python3 serve.py            # http://localhost:8000
python3 serve.py --https    # self-signed TLS, for testing on a phone
python3 tools/make_icons.py # regenerate the PNG icon set
```

A service worker, the folder picker, and Google sign-in all require a **secure
context**. `localhost` counts; a bare LAN IP over http does not — hence
`--https` for phone testing.

To deploy: upload the folder to GitHub Pages, Netlify, Cloudflare Pages, or an
internal web server. Nothing else to run.

---

## Where the data lives

The app talks to a storage adapter, chosen once during setup. All three present
the identical interface, so the rest of the app does not know which is in use.

| Backend | How it works | Works on |
|---|---|---|
| **Google Drive** *(recommended)* | Drive REST API + OAuth against the detachment's own Google account | Phones, tablets, computers |
| **Synced folder** | File System Access API pointed at the Google Drive for Desktop folder | Desktop Chrome / Edge only |
| **This device only** | IndexedDB in the browser | Anywhere, but nothing syncs |

> **A browser cannot be handed a filesystem path to Google Drive.** There is no
> path to give it on a phone, and web pages have no filesystem access on any
> platform. The Drive backend is therefore the real answer for multi-device use;
> the synced-folder backend is the closest thing to "point it at the folder" and
> works well on a detachment's desktop machines. Start on **This device only** if
> you want to try the app before setting up the Google account — export a backup
> and import it once you connect to Drive, and nothing is lost.

### Folder layout

The chosen folder becomes the database. Each record is one JSON document.

```
TOP-Feedback/
├── config/      org profile and shared settings
├── users/       accounts — students, instructors, admins
├── roster/      legacy roster (migrated into users/ automatically)
├── forms/       feedback form definitions
├── requests/    feedback issued to students, each with a feedback ID
├── responses/   submitted feedback, one folder per form
├── receipts/    who submitted (kept apart from what they said)
├── reports/     exported reports
└── archive/     closed terms retained for the record
```

### Two things that make this scale

**Roll-up indexes.** Reading a term of feedback one file at a time would mean
thousands of Drive API calls on the landing page. Each form keeps a
`_index.json` of its responses and there is a global `_counts.json`, so the home
screen costs a fixed ~6 reads no matter how much feedback exists. Rebuild them
from Database Administration if a restore ever leaves them stale.

**An offline write queue.** Cadets fill these out on classroom wifi. A
submission made offline is stored in IndexedDB, shown as pending in the header,
and replayed automatically on reconnect — never silently lost.

Because records are plain JSON in your own Drive, they are readable, greppable,
backed up by Google, and recoverable from the Drive trash for 30 days.

---

## One-time Google setup (Drive backend)

Done once by the detachment, on the account the detachment owns:

1. Sign in to that Google account.
2. In [Google Cloud Console](https://console.cloud.google.com), create a project
   and enable the **Google Drive API**.
3. **OAuth consent screen** → *Internal* if the account is on Google Workspace,
   otherwise *External* and add each cadre member as a test user.
4. **Credentials** → **OAuth client ID** → *Web application*. Add the address the
   app is served from as an **Authorised JavaScript origin**.
5. In Drive, create a folder named `TOP-Feedback` and share it with the cadre who
   need access.
6. In the app's setup wizard, paste the **Client ID** and the **folder link**.

The OAuth client ID is public by design — it identifies the app, it is not a
password. Who can read the data is governed by Google sign-in and the folder's
sharing settings.

---

## Accounts and sign-in

Everyone signs in. Students get a 6-character minimum (they type it on a phone
before every submission); instructors and admins get 8.

**The built-in administrator is always available**, so a detachment can never
lock itself out of its own database:

```
Username: Admin          (not case sensitive)
Password: #admin-Password
```

It is the same for every installation, which means it is only as private as your
Drive folder. The app shows a standing warning while it is the only way in, and
prompts you to create a named admin account so access can be traced to a person.

Bulk-importing students by CSV generates a password for each one and offers the
list as a download. **That is the only time those passwords can be read** —
they are stored as hashes — so save the file or reset them individually later.

---

## Schema migrations

A detachment's records outlive any single release. `APP.schemaVersion` is the
version this build expects; the version a folder is actually at is stored in
`config/org.json`.

When a device opens a folder written by an older release, the pending migrations
run automatically before any view reads the data, and a toast reports the
upgrade. Database Administration → Schema version shows both numbers and can
re-run them by hand after restoring an old backup.

Migrations are forward-only and idempotent, and a folder written by a *newer*
build refuses to load rather than being silently downgraded. Add one in
`js/migrations.js` alongside every change to a record shape.

---

## Security model — read this

- **Sign-in gates the UI on a shared device. It is not encryption.** Anyone who
  can open the Drive folder can read every record directly, whatever the app
  shows them. Control access through the folder's Drive sharing.
- Passwords are stored as PBKDF2-SHA256 hashes (150k iterations) in
  `users/users.json`. There is no server, so a stolen file is a stolen file —
  the hash only makes it expensive, it does not make it private.
- **Anonymous feedback is anonymous in the data.** The username is used to
  verify the cadet and to write a *receipt*, then discarded. The response record
  carries no name, so nothing links an answer to a person. Receipts live in
  `receipts/`, a different folder from `responses/`.
- **Student identity is authenticated.** Cadets sign in, so a submission receipt
  records a verified person rather than a typed claim, and nobody can burn a
  classmate's single submission.
- **Development mode** (Settings → Access) unlocks both portals on one device so
  the app can be built out before accounts exist. It is device-local, shown as a
  banner on every gated screen, and must be off before fielding.
- Nothing is transmitted anywhere except the detachment's own Google Drive.

---

## Anonymity and disclosure control

Anonymity has a hard floor. With *n* responses from a known set of *n*
submitters, the best anyone can do is a 1-in-*n* guess — and at *n*=1 that is a
certainty. Receipts make the submitters known by design, so a single anonymous
response shown beside a completion list identifies its author by elimination.

So **anonymous results are withheld until 3 people have responded**
(`PRIVACY.minResponsesToShow` in `js/config.js`). Below that, the form is
excluded from the statistics, the comments, the individual responses *and the
CSV export* — while the counts stay visible so cadre can still chase the people
who owe feedback. The form creator warns at build time if an anonymous form is
going to fewer people than the threshold, since such a form could never show
results.

The threshold is applied **per form**, not to the running total: a form is the
unit an author can be identified within, and pooling a thin form into a larger
total would not protect it anyway, because the feedback-ID filter can isolate it
again in one click.

Attributed (non-anonymous) feedback is never withheld — the names are already
attached, so withholding would cost visibility and buy nothing.

---

## Known limits

- **Receipt timing can correlate.** For anonymous feedback, a receipt and a
  response are written seconds apart, the response ID encodes its creation time,
  and both index arrays are in submission order — so someone reading the **raw
  Drive files** could line them up. The disclosure threshold above does not
  address this; it defends the app's own screens. Anyone with raw folder access
  is already inside your trust boundary, so restrict who can read the folder.
- **The built-in admin password is public.** By design — it is a recovery path,
  not a front door. Create a named admin account.
- **Concurrent edits overwrite.** Two instructors editing one form last-write-
  wins; there is no revision check yet.
- **No password self-service.** There is no email out of this app, so a
  forgotten password is reset by an admin in person.

---

## Project layout

```
index.html              app shell; resolves theme before first paint
manifest.json           PWA manifest
service-worker.js       precached shell, network-first navigation, never caches Drive
serve.py                dev server (http, or --https for phones)
tools/make_icons.py     icon generator, standard library only
css/styles.css          design system: tokens, themes, color-vision palettes
js/
  app.js                bootstrap, routes, app bar, PWA plumbing
  config.js             constants + the shape of every record
  router.js             hash router with per-route guards
  state.js              device-local settings, connection, cadre session
  util.js               DOM helpers, formatting, stats, crypto, modals, toasts
  forms.js              renders form templates and collects answers
  storage/
    index.js            facade — every view talks to this
    queue.js            offline write queue, replayed on reconnect
    drive.js            Google Drive REST + OAuth
    folder.js           File System Access API
    local.js            IndexedDB
    idb.js              IndexedDB wrapper
  auth.js               accounts, sign-in, roles, username and password rules
  migrations.js         forward-only schema upgrades, one entry per version
  views/
    setup.js            first-run wizard
    home.js             the three entry points + settings
    student.js          username filter, fill-out, one-submission guard
    instructor.js       portal shell, feedback forms, students, database
    formCreator.js      the standardized form builder
    analysis.js         filtering, statistics, completion tracking
    admin.js            account maintenance and sign-in screens
    settings.js         storage, appearance, accessibility, access, about
```

---

## Accessibility

Both color-vision palettes and status colors are handled together: every status
carries an **icon and a text label** as well as a hue, so no meaning depends on
color alone. Palettes for deuteranopia, protanopia, tritanopia and monochrome
remap the status hues to separable pairs. Also: full keyboard operation, visible
focus rings, a skip link, `prefers-reduced-motion` support, 2.75rem touch
targets, and heading focus on navigation.

---

## Where this is going

Currently shipped: the complete shell and a working end-to-end cycle — issue a
request, fill it out, read it, report on it, back it up.

Not yet built:

- **The analysis maths.** The page does counts, means, medians, spread and
  distributions, and tracks completion per student. Trends across terms,
  per-instructor baselines and outlier flagging come next.
- **Concurrent-edit protection** (Drive `If-Match` on revision ids).

### The rating scale

**Students pick a word. The number behind it is what gets averaged, and they
never see it.** `SCALE_ANCHORS` in `js/config.js` defines both at once:

```
1 Detrimental   2 Significant   3 Unfavorable   4 Minor        5 Neutral
6 Slight        7 Favorable     8 Major         9 Outstanding
```

All nine points are named, so the full 1-9 resolution is actually reachable.
The vocabulary alternates by design: **odd points carry the direction**
(Detrimental -> Unfavorable -> Neutral -> Favorable -> Outstanding) and **even
points carry the magnitude** of the step either side of centre, paired
symmetrically - Significant (2) mirrors Major (8), Minor (4) mirrors Slight (6).

Position in the row is what supplies direction for the magnitude words: "Major"
between Favorable and Outstanding reads as a large positive; "Significant"
between Detrimental and Unfavorable reads as a large negative. The options are
therefore always rendered in numeric order and never re-sorted, and on a narrow
screen they stack in a single column rather than a grid, so "the next step up"
stays unambiguous.

A visible number would invite people to average it in their heads while
answering, so cadets never see one. Instructors see both: the response viewer
shows the word and its value, the analysis table has a *Reads as* column, and
CSV export emits a numeric column and a word column per question.

This object **drives the UI directly** - one option per entry, so changing the
vocabulary or the number of points needs no code change. Every form records the
anchor set it was built with, so changing the wording later leaves issued
feedback untouched: old responses keep their original words and numbers and stay
comparable among themselves. Forms created before the word scale existed still
render as numbers.

`nearestAnchor()` maps a computed score back to a word for reporting. Ties round
**down**, so a mean is never described more favourably than it earned: a mean of
6.5 reads as "Slight", not "Favorable".
