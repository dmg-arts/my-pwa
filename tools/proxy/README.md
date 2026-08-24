# The submission proxy

A small Google Apps Script that runs inside your detachment's own Google account
and files cadets' feedback for them.

**About 15 minutes to deploy. Optional, but do it before you field the app.**

---

## Why bother

Without it, a cadet's phone writes their response straight into your Drive
folder. Google requires **Editor** permission to write, and Drive has no
write-without-read. So every cadet who can submit can also:

- open the folder and read **every response to every form**, including anonymous ones
- line up receipt and response timestamps to work out **who wrote what**
- **alter or delete** other cadets' feedback
- **delete the audit log**, which exists specifically so deletions leave a trace

The app's anonymity design is real inside its own screens and worth nothing
against a cadet who opens Drive directly.

With the proxy, cadets need **no Drive access at all**. They never see the
folder, and they are never asked to approve access to their own Google Drive —
which also means they never meet the alarming full-Drive consent screen.

What it does not change: cadre still read Drive directly, because analysing
responses requires exactly the access this removes from cadets.

---

## Before you start

You need the two values from your existing setup:

| Value | Where it is |
|---|---|
| **Folder ID** | The long string in your Drive folder's URL, after `/folders/` |
| **Client ID** | Settings → Storage, or Google Cloud → Credentials. Ends `.apps.googleusercontent.com` |

---

## 1. Create the script

1. Go to **[script.google.com](https://script.google.com)**, signed in as the
   account that **owns the Drive folder**. This matters: the script writes files
   as whoever owns it.
2. **New project**. Name it `TOP-Feedback Proxy`.
3. Delete the contents of `Code.gs` and paste in this folder's `Code.gs`.
4. Save.

## 2. Configure it

1. Find the `setUp()` function at the bottom of the file.
2. Fill in `FOLDER_ID` and `CLIENT_ID` between the quotes.
3. Choose `setUp` in the function dropdown at the top, then **Run**.
4. Google will ask you to authorise the script — this is your own script asking
   for your own Drive. Review and allow. You will see the unverified-app screen
   here too; choose **Advanced**, then continue.
5. The log should say `Configured.` If it throws, the folder ID is wrong or the
   account does not own that folder.
6. **Clear the two values back out of `setUp()` and save.** They are stored in
   Script Properties now, and leaving them in the source is untidy rather than
   dangerous.

## 3. Deploy it

1. **Deploy → New deployment**.
2. Click the gear beside *Select type* and choose **Web app**.
3. Set:
   - **Execute as: Me** — the whole point; files are written with your access
   - **Who has access: Anyone** — cadets are not in a Workspace domain, so there
     is no narrower option that works
4. **Deploy**, authorise if asked, and copy the **Web app URL**. It ends in
   `/exec`.

> **"Anyone" sounds wrong. It is not.** The URL is public, and the script refuses
> everything that does not carry a valid Google ID token for an account on your
> roster. It verifies that token with Google on every request. Access is decided
> by your roster, not by the obscurity of the URL.

> **Use the `/exec` URL, not `/dev`.** The `/dev` one only works for you and will
> fail for every cadet. The app refuses it with an explanation if you paste it.

## 4. Point the app at it

1. In TOP-Feedback: **Settings → Submission proxy**.
2. Paste the `/exec` URL and press **Save and test**. It checks the deployment is
   reachable, is the right script, and is configured — so you find out now rather
   than when a cadet cannot submit.
3. Go to **Database Administration → Invite people** and send the new join link.
   It now carries the proxy, so anyone who joins with it submits through the
   script and is never asked for Drive access.

## 5. Take back the folder access you no longer need

The proxy stops *new* exposure. It does not revoke what you already granted.

1. Open the Drive folder → **Share**.
2. Remove every cadet. The folder should be shared with **cadre only**.
3. Re-send the join link to anyone already set up, so their device switches to
   the proxy. Until they open it, their app still tries to reach Drive directly
   and will simply stop working once you remove their access — which is safe, but
   confusing if nobody warned them.

---

## After you change the script

Apps Script keeps serving the *deployed* version, not the saved one. After
editing, go to **Deploy → Manage deployments**, click the pencil, set **Version**
to *New version*, and **Deploy**. The URL stays the same.

Editing and forgetting to redeploy is the most common reason a fix appears to do
nothing.

---

## What it serves

Every action is named and carries its own role requirement. **The caller never
names a file** — it names an intention, and the script decides whether this
account may have it. That is the whole access model: a generic "read this path"
call would put the decision back in the browser, which is the arrangement being
replaced.

| Action | Who | What comes back |
|---|---|---|
| `bundle` | student | Their assignments, the forms to render them, what they have already answered |
| `submit` | student | Writes one response and its receipt, under a lock |
| `catalog` | instructor, cadre, commander, admin | Forms and requests |
| `responses` | instructor, cadre, commander, admin | Responses and receipts for one request |
| `allResponses` | instructor, cadre, commander, admin | Every response, for analysis across forms |
| `roster` | instructor, cadre, commander, admin | The roster |
| `audit` | commander, admin | Audit entries, newest first |
| `overview` | instructor, cadre, commander, admin | Org record and headline counts |

Roll-up index files (names beginning `_`) are never served. They are caches the
app rebuilds for itself, and handing them over would invite the client to trust
them as though the server had vouched for them.

`allResponses` is the one call that can get large. A detachment with a term of
feedback is comfortably inside Apps Script's limits; it is the first thing that
will need paging if one runs for years.

## Limits

- **Quota.** A consumer Gmail account gets about 90 minutes of script runtime a
  day. A submission takes roughly a second, so a detachment of fifty is nowhere
  near it.
- **It serves cadets only.** Cadre keep direct Drive access.
- **It does not re-validate answers** against the form definition — the app does
  that. What the script enforces is *who* may write and *how often*, which is the
  part a browser cannot be trusted with.
- **One submission per cadet per form** is enforced here under a script lock,
  which makes it a genuine rule rather than a convention. This is stricter than
  the app alone can be.

## Troubleshooting

| What you see | What it means |
|---|---|
| "returned a sign-in page instead of an answer" | Deployment access is not set to **Anyone**. Fix and redeploy. |
| "That is the test URL" | You copied the `/dev` address. Use `/exec`. |
| "deployed but not configured" | `setUp()` was never run, or it failed. |
| "is not on this detachment's roster" | Correct behaviour — add the address in Database Administration. |
| Cadets see an empty feedback list | Their join link predates the proxy. Re-send it. |
| A change to the script did nothing | You saved but did not redeploy a new version. |
