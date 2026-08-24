/**
 * TOP-Feedback submission proxy.
 *
 * Runs as a Google Apps Script web app inside the detachment's own Google
 * account. Deployment instructions are in README.md next to this file.
 *
 * WHY THIS EXISTS
 *
 * Without it, a cadet's browser writes their response straight into the
 * detachment's Drive folder. Google requires Editor permission to write, and
 * Drive has no write-without-read, so every cadet who can submit can also open
 * the folder and read every response in it, alter them, or delete the audit log.
 * The app's anonymity design is real within its own screens and worth nothing
 * against a cadet who opens Drive directly.
 *
 * This script breaks that chain. The folder is shared with cadre only. A cadet's
 * device sends its answers here instead, along with the Google ID token proving
 * who they are. This script verifies that token *server-side*, checks the
 * roster, and writes the files using the owner's credentials. The cadet never
 * touches Drive and never needs access to it.
 *
 * WHAT GUARDS THIS ENDPOINT
 *
 * It is deployed as "anyone can access", because cadets are not members of any
 * Workspace domain. So the URL is public and the token check is the only thing
 * standing there. Everything it enforces:
 *
 *   - The ID token is verified against Google, not merely decoded. A token this
 *     script cannot verify is refused.
 *   - The token's audience must equal this detachment's own client ID, so a
 *     token minted for some other app is refused.
 *   - The email must be on the roster, active, and hold the student role.
 *   - **Paths are constructed here, never accepted from the caller.** The client
 *     sends a request id, which is pattern-checked; it cannot send a path.
 *   - One submission per cadet per form, enforced under a script lock, so two
 *     taps on a slow connection cannot both land.
 *
 * IT SERVES READS TOO, AND HAS TO
 *
 * A cadet with no Drive access cannot read `requests/` or `forms/` either, so a
 * write-only proxy would leave them staring at an empty app. The `bundle` action
 * returns exactly what one cadet's screens need — their assignments, the forms
 * to render them, and which they have already done. No responses, not even
 * their own.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It serves cadets only. Cadre still reach Drive directly, because reading
 * responses to analyse them requires exactly the access this script removes from
 * cadets. Instructors remain inside the trust boundary.
 *
 * It does not re-validate answers against the form definition. The client does
 * that, and duplicating the form engine here would mean maintaining it twice.
 * What this enforces is *who* may write and *how often* — the parts a client
 * cannot be trusted with.
 */

/** Bump when the contract with the app changes. Reported by doGet. */
var PROXY_VERSION = '1.0.0';

/** Refuse anything larger; a submission is a few KB at most. */
var MAX_BODY_BYTES = 96 * 1024;

/** Ids come from the client, so they are pattern-checked before use in a path. */
var ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Every action this script will perform, and who may perform it.
 *
 * An action not listed here does not exist. That is the whole access model:
 * there is no generic "read a path" call to be talked into handing over the
 * wrong file, because the caller never names a path — it names an intention,
 * and this table decides whether it may.
 *
 * `commander` and `cadre` are accepted already so that rosters written by a
 * newer app do not fail against a proxy deployed slightly earlier.
 */
var ACTIONS = {
  bundle:       ['student'],
  submit:       ['student'],
  catalog:      ['instructor', 'cadre', 'commander', 'admin'],
  responses:    ['instructor', 'cadre', 'commander', 'admin'],
  allResponses: ['instructor', 'cadre', 'commander', 'admin'],
  roster:       ['instructor', 'cadre', 'commander', 'admin'],
  audit:        ['commander', 'admin'],
  overview:     ['instructor', 'cadre', 'commander', 'admin']
};

function hasAnyRole(account, allowed) {
  var held = account.roles || [];
  for (var i = 0; i < allowed.length; i++) {
    if (held.indexOf(allowed[i]) !== -1) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * configuration
 * ------------------------------------------------------------------ */

/**
 * Read from Script Properties rather than hard-coded, so the same script can be
 * pasted into any detachment's account without editing code.
 */
function config() {
  var props = PropertiesService.getScriptProperties();
  return {
    folderId: props.getProperty('FOLDER_ID'),
    clientId: props.getProperty('CLIENT_ID'),
  };
}

/* ------------------------------------------------------------------ *
 * entry points
 * ------------------------------------------------------------------ */

/**
 * Health check. Deliberately says nothing about the folder or the roster —
 * only whether this deployment is alive and configured, which is what an
 * administrator needs to confirm they pasted the right URL.
 */
function doGet() {
  var cfg = config();
  return json({
    ok: true,
    service: 'top-feedback-proxy',
    version: PROXY_VERSION,
    configured: Boolean(cfg.folderId && cfg.clientId),
  });
}

/**
 * A cadet submitting one response.
 *
 * The app posts with Content-Type text/plain on purpose. That makes this a CORS
 * "simple request", which skips the preflight — and Apps Script cannot answer a
 * preflight, so an application/json post from a browser fails before it arrives.
 * The body is still JSON; only the header is lying, and it is lying to get past
 * a limitation on Google's side rather than ours.
 */
function doPost(e) {
  try {
    var cfg = config();
    if (!cfg.folderId || !cfg.clientId) {
      return fail('This proxy has not been configured. Set FOLDER_ID and CLIENT_ID in Script Properties.');
    }

    if (!e || !e.postData || !e.postData.contents) return fail('Empty request.');
    if (e.postData.contents.length > MAX_BODY_BYTES) return fail('That submission is too large.');

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return fail('That request was not valid JSON.');
    }

    var required = ACTIONS[body.action];
    if (!required) return fail('Unknown action.');

    // --- 1. who is this, according to Google ---------------------------
    var identity = verifyIdToken(body.idToken, cfg.clientId);
    if (!identity.ok) return fail(identity.error);

    // --- 2. are they allowed, according to the roster ------------------
    var root = DriveApp.getFolderById(cfg.folderId);
    var account = findAccount(root, identity.email);
    if (!account) {
      return fail(identity.email + ' is not on this detachment\'s roster.');
    }
    if (account.active === false) {
      return fail('That account has been deactivated.');
    }
    if (!hasAnyRole(account, required)) {
      return fail('That account is not allowed to do this.');
    }

    // --- 3. read actions ------------------------------------------------
    // A cadet with no Drive access cannot read the folder to find out what was
    // assigned to them, and once cadre lose Drive access the same is true of
    // them. Every read is a named action with its own role requirement: the
    // caller can never name a path, so it can never reach a file this script
    // did not decide to hand over.
    if (body.action === 'bundle') {
      return json({ ok: true, bundle: buildBundle(root, account) });
    }
    if (body.action === 'catalog') {
      return json({ ok: true, catalog: readCatalog(root) });
    }
    if (body.action === 'responses') {
      var forId = String(body.requestId || '');
      if (!ID_PATTERN.test(forId)) return fail('That feedback request id is not valid.');
      return json({ ok: true, responses: readResponses(root, forId), receipts: readReceipts(root, forId) });
    }
    if (body.action === 'allResponses') {
      return json({ ok: true, responses: readAllResponses(root) });
    }
    if (body.action === 'roster') {
      return json({ ok: true, users: readRoster(root) });
    }
    if (body.action === 'audit') {
      return json({ ok: true, entries: readAudit(root, Number(body.months) || 6) });
    }
    if (body.action === 'overview') {
      return json({ ok: true, org: readJson(root, ['config'], 'org.json'), stats: readStats(root) });
    }

    // --- 4. the one write action ----------------------------------------
    // Explicit rather than a fall-through: an action added to ACTIONS and not
    // handled above would otherwise drop quietly into the submit path.
    if (body.action !== 'submit') return fail('That action is not implemented.');

    var requestId = String(body.requestId || '');
    if (!ID_PATTERN.test(requestId)) return fail('That feedback request id is not valid.');

    var request = readJson(root, ['requests'], requestId + '.json');
    if (!request) return fail('That feedback request no longer exists.');
    if (request.status && request.status !== 'open') {
      return fail('That feedback is closed.');
    }
    if (!isAddressedTo(request, account)) {
      return fail('That feedback was not assigned to you.');
    }

    // --- 4. write, once -------------------------------------------------
    // The lock is what makes "one submission per cadet" a rule rather than a
    // convention: without it two taps on a slow connection can both pass the
    // receipt check before either writes one.
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (err) {
      return fail('The server is busy. Try again in a moment.');
    }

    try {
      if (hasReceipt(root, requestId, account.username)) {
        return fail('You have already submitted this feedback.');
      }

      var record = buildResponse(body, request, account);
      writeJson(root, ['responses', requestId], record.id + '.json', record);
      writeJson(root, ['receipts', requestId], account.username + '.json', {
        schemaVersion: record.schemaVersion,
        requestId: requestId,
        username: account.username,
        submittedAt: record.submittedAt,
        viaProxy: true
      });

      return json({ ok: true, responseId: record.id, submittedAt: record.submittedAt });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // Never leak a stack trace to a public endpoint.
    console.error(err);
    return fail('The submission could not be saved. Tell your cadre if this keeps happening.');
  }
}

/* ------------------------------------------------------------------ *
 * identity
 * ------------------------------------------------------------------ */

/**
 * Verifies a Google ID token by asking Google.
 *
 * Deliberately not a local signature check. Google publishes rotating keys, and
 * a wrong or stale key cache here would either reject everyone or, far worse,
 * accept something it should not. The round trip costs a few hundred
 * milliseconds on a path that runs once per cadet per form.
 */
function verifyIdToken(token, expectedClientId) {
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'No sign-in was included with that submission.' };
  }

  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
  } catch (err) {
    return { ok: false, error: 'Could not reach Google to check your sign-in.' };
  }

  if (response.getResponseCode() !== 200) {
    return { ok: false, error: 'Your sign-in could not be verified. Sign in again.' };
  }

  var claims;
  try {
    claims = JSON.parse(response.getContentText());
  } catch (err) {
    return { ok: false, error: 'Your sign-in could not be read.' };
  }

  // tokeninfo returns every value as a string, including exp and
  // email_verified — comparing them as booleans or numbers silently passes.
  if (claims.aud !== expectedClientId) {
    return { ok: false, error: 'That sign-in was for a different application.' };
  }
  if (Number(claims.exp) * 1000 < Date.now()) {
    return { ok: false, error: 'Your sign-in has expired. Sign in again and resubmit.' };
  }
  if (String(claims.email_verified) !== 'true') {
    return { ok: false, error: 'That Google account has not verified its email address.' };
  }
  if (!claims.email) {
    return { ok: false, error: 'That Google account did not provide an email address.' };
  }

  return { ok: true, email: String(claims.email).trim().toLowerCase(), sub: claims.sub };
}

/* ------------------------------------------------------------------ *
 * the cadet's view
 * ------------------------------------------------------------------ */

/**
 * Everything one cadet is allowed to see, and nothing else.
 *
 * Note what is absent: no responses, not even their own. A submitted response
 * is not shown back to anyone, and on an anonymous form there is deliberately
 * nothing linking it to them to show. What comes back is the assignment list,
 * the forms needed to render them, and which ones they have already done.
 */
function buildBundle(root, account) {
  var requests = [];
  var formIds = {};
  var requestsFolder = findFolder(root, ['requests']);

  if (requestsFolder) {
    var files = requestsFolder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (file.getName().indexOf('_') === 0) continue;   // roll-up indexes
      var request;
      try {
        request = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
      } catch (err) {
        continue;
      }
      if (!request || !request.id) continue;
      if (!isAddressedTo(request, account)) continue;

      requests.push(request);
      if (request.formId) formIds[request.formId] = true;
    }
  }

  var forms = {};
  var wanted = Object.keys(formIds);
  for (var i = 0; i < wanted.length; i++) {
    if (!ID_PATTERN.test(wanted[i])) continue;
    var form = readJson(root, ['forms'], wanted[i] + '.json');
    if (form) forms[wanted[i]] = form;
  }

  var submitted = [];
  for (var j = 0; j < requests.length; j++) {
    if (hasReceipt(root, requests[j].id, account.username)) submitted.push(requests[j].id);
  }

  return {
    account: {
      username: account.username,
      name: account.name,
      email: account.email,
      asClass: account.asClass || '',
      section: account.section || '',
      roles: account.roles || []
    },
    requests: requests,
    forms: forms,
    submitted: submitted
  };
}

/* ------------------------------------------------------------------ *
 * cadre reads
 *
 * Every one of these returns records the caller was already entitled to read
 * from Drive directly. Moving them here changes who holds the Drive permission,
 * not who may see what — that comes later, when the cadre and commander spaces
 * arrive and these functions start filtering by folder.
 * ------------------------------------------------------------------ */

/** Reads every JSON file in a folder, skipping the roll-up index files. */
function readFolderDocs(root, segments) {
  var folder = findFolder(root, segments);
  var out = [];
  if (!folder) return out;

  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    // Files beginning with an underscore are caches the app rebuilds for
    // itself; sending them would only invite the client to trust them.
    if (name.indexOf('_') === 0 || name.slice(-5) !== '.json') continue;
    try {
      out.push(JSON.parse(file.getBlob().getDataAsString('UTF-8')));
    } catch (err) {
      // One unreadable record must not take the whole listing down.
      console.warn('unreadable: ' + segments.join('/') + '/' + name);
    }
  }
  return out;
}

/** Forms and requests together — what the portal lists on arrival. */
function readCatalog(root) {
  return {
    forms: readFolderDocs(root, ['forms']),
    requests: readFolderDocs(root, ['requests'])
  };
}

function readResponses(root, requestId) {
  return readFolderDocs(root, ['responses', requestId]);
}

function readReceipts(root, requestId) {
  return readFolderDocs(root, ['receipts', requestId]);
}

/**
 * Every response across every request, for cross-form analysis.
 *
 * Deliberately the one call that can get large. A detachment with a term of
 * feedback is comfortably inside Apps Script's response limit, but this is the
 * first thing that will need paging if a detachment runs for years.
 */
function readAllResponses(root) {
  var parent = findFolder(root, ['responses']);
  var out = [];
  if (!parent) return out;

  var subs = parent.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    var rows = readFolderDocs(root, ['responses', sub.getName()]);
    for (var i = 0; i < rows.length; i++) out.push(rows[i]);
  }
  return out;
}

function readRoster(root) {
  var doc = readJson(root, ['users'], 'users.json');
  return (doc && doc.users) || [];
}

/** Audit entries, newest month first, walking back from today. */
function readAudit(root, months) {
  var out = [];
  var cursor = new Date();
  for (var i = 0; i < Math.min(months, 24); i++) {
    var key = Utilities.formatDate(cursor, 'UTC', 'yyyy-MM');
    var rows = readFolderDocs(root, ['audit', key]);
    for (var j = 0; j < rows.length; j++) out.push(rows[j]);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return out;
}

/** Counts only — enough for the portal's summary without shipping records. */
function readStats(root) {
  var requests = readFolderDocs(root, ['requests']);
  var open = 0;
  for (var i = 0; i < requests.length; i++) {
    if (!requests[i].status || requests[i].status === 'open') open++;
  }
  return {
    requests: requests.length,
    openRequests: open,
    forms: readFolderDocs(root, ['forms']).length,
    accounts: readRoster(root).length
  };
}

/* ------------------------------------------------------------------ *
 * roster and addressing
 * ------------------------------------------------------------------ */

function findAccount(root, email) {
  var doc = readJson(root, ['users'], 'users.json');
  var users = (doc && doc.users) || [];
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').trim().toLowerCase() === email) return users[i];
  }
  return null;
}

/**
 * Mirrors the client's audience rule: a named list wins, otherwise the AS level.
 * Checked here as well as there, because the client is the thing being guarded
 * against.
 */
function isAddressedTo(request, account) {
  var named = request.assignedUsernames || [];
  if (named.length) return named.indexOf(account.username) !== -1;
  if (!request.asClass) return true;
  return String(request.asClass) === String(account.asClass || '');
}

function hasReceipt(root, requestId, username) {
  var folder = findFolder(root, ['receipts', requestId]);
  if (!folder) return false;
  return folder.getFilesByName(username + '.json').hasNext();
}

/**
 * Builds the stored record.
 *
 * The identity decision happens here rather than being taken from the client: an
 * anonymous form stores no respondent, full stop. A client that asked to be
 * attributed on an anonymous form would be ignored, and vice versa.
 */
function buildResponse(body, request, account) {
  var anonymous = request.anonymous !== false;
  return {
    schemaVersion: Number(body.schemaVersion) || 4,
    id: 'res_' + Utilities.getUuid().replace(/-/g, '').slice(0, 14),
    requestId: request.id,
    formId: request.formId || body.formId || null,
    anonymous: anonymous,
    asClass: request.asClass || account.asClass || '',
    schoolYear: request.schoolYear || '',
    semester: request.semester || '',
    answers: sanitizeAnswers(body.answers),
    respondent: anonymous ? null : {
      username: account.username,
      name: account.name,
      asClass: account.asClass || ''
    },
    submittedAt: new Date().toISOString(),
    viaProxy: true
  };
}

/**
 * Keeps answers to flat scalars.
 *
 * Not form validation — the client does that, and duplicating the form engine
 * here would mean maintaining it twice. This only ensures nothing structural
 * gets stored that the reading code would choke on.
 */
function sanitizeAnswers(answers) {
  var clean = {};
  if (!answers || typeof answers !== 'object') return clean;
  var keys = Object.keys(answers);
  for (var i = 0; i < keys.length && i < 200; i++) {
    var key = keys[i];
    if (!ID_PATTERN.test(key)) continue;
    var value = answers[key];
    if (typeof value === 'number' && isFinite(value)) clean[key] = value;
    else if (typeof value === 'string') clean[key] = value.slice(0, 8000);
    else if (typeof value === 'boolean') clean[key] = value;
  }
  return clean;
}

/* ------------------------------------------------------------------ *
 * Drive helpers
 *
 * Paths are always built from literal segment names plus pattern-checked ids.
 * No caller-supplied string ever reaches Drive as a path.
 * ------------------------------------------------------------------ */

function findFolder(root, segments) {
  var current = root;
  for (var i = 0; i < segments.length; i++) {
    var children = current.getFoldersByName(segments[i]);
    if (!children.hasNext()) return null;
    current = children.next();
  }
  return current;
}

function ensureFolder(root, segments) {
  var current = root;
  for (var i = 0; i < segments.length; i++) {
    var children = current.getFoldersByName(segments[i]);
    current = children.hasNext() ? children.next() : current.createFolder(segments[i]);
  }
  return current;
}

function readJson(root, segments, name) {
  var folder = findFolder(root, segments);
  if (!folder) return null;
  var files = folder.getFilesByName(name);
  if (!files.hasNext()) return null;
  try {
    return JSON.parse(files.next().getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    return null;
  }
}

function writeJson(root, segments, name, value) {
  var folder = ensureFolder(root, segments);
  var blob = Utilities.newBlob(JSON.stringify(value, null, 2), 'application/json', name);
  var existing = folder.getFilesByName(name);
  if (existing.hasNext()) {
    existing.next().setContent(JSON.stringify(value, null, 2));
    return;
  }
  folder.createFile(blob);
}

/* ------------------------------------------------------------------ *
 * responses
 * ------------------------------------------------------------------ */

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * A refusal.
 *
 * Always HTTP 200 with `ok: false`, because Apps Script turns a thrown error
 * into an HTML page the app cannot parse, and a cadet would see "something went
 * wrong" instead of the reason. The message is written to be read by a
 * nineteen-year-old on a phone, not by a developer.
 */
function fail(message) {
  return json({ ok: false, error: message });
}

/* ------------------------------------------------------------------ *
 * setup helper
 * ------------------------------------------------------------------ */

/**
 * Run once from the editor to store configuration, instead of editing code.
 * Fill in the two values, press Run, then delete them from this function.
 */
function setUp() {
  var FOLDER_ID = '';   // the detachment's TOP-Feedback folder id
  var CLIENT_ID = '';   // ends .apps.googleusercontent.com

  if (!FOLDER_ID || !CLIENT_ID) {
    throw new Error('Fill in FOLDER_ID and CLIENT_ID before running setUp().');
  }
  PropertiesService.getScriptProperties().setProperties({
    FOLDER_ID: FOLDER_ID,
    CLIENT_ID: CLIENT_ID
  });
  DriveApp.getFolderById(FOLDER_ID);   // fails loudly now rather than at 2am
  console.log('Configured. Deploy as a web app: execute as me, access to anyone.');
}
