/**
 * First-run setup: name the detachment, choose where the database lives,
 * connect it, and build the folder tree.
 */

import { BACKENDS, DB_LAYOUT, FOLDER_TREE_PREVIEW, APP } from '../config.js';
import { el, icon, field, notice, toast, spinner, clear, mount, remount } from '../util.js';
import { connection, markSetupComplete } from '../state.js';
import { db, adapters, parseFolderId } from '../storage/index.js';
import { navigate } from '../router.js';

const STEPS = ['Organization', 'Storage', 'Connect', 'Finish'];

/** Wizard-local draft; discarded if the user backs out. */
let draft = null;

export function renderSetup(root, { rerun = false } = {}) {
  if (!draft) {
    const saved = connection.get();
    draft = {
      step: 0,
      orgName: saved.orgName || '',
      backend: saved.backend || null,
      clientId: saved.clientId || '',
      folderInput: saved.folderUrl || saved.folderId || '',
      folderId: saved.folderId || '',
      folderName: saved.folderName || '',
      connected: false,
      rerun,
    };
  }
  draw(root);
}

export function resetSetupDraft() {
  draft = null;
}

function draw(root) {
  clear(root);
  const wizard = el('div', { class: 'wizard stack' });

  mount(wizard, 
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, draft.rerun ? 'Reconfigure storage' : `Set up ${APP.name}`),
      el('p', { class: 'page-sub' },
        'A one-time setup that tells this device where your detachment keeps its feedback data.')),
    stepper(),
  );

  const body = el('div', { class: 'card stack' });
  mount(wizard, body);

  switch (draft.step) {
    case 0: stepOrg(body, root); break;
    case 1: stepBackend(body, root); break;
    case 2: stepConnect(body, root); break;
    default: stepFinish(body, root); break;
  }

  mount(root, wizard);
}

function stepper() {
  const wrap = el('div', { class: 'steps', role: 'list' });
  STEPS.forEach((label, i) => {
    const state = i < draft.step ? 'done' : i === draft.step ? 'active' : 'todo';
    mount(wrap, el('div', { class: 'step', dataset: { state }, role: 'listitem' },
      el('span', { class: 'step__dot' }, state === 'done' ? icon('check') : String(i + 1)),
      el('span', { class: 'step__label' }, label)));
    if (i < STEPS.length - 1) mount(wrap, el('div', { class: 'step__bar' }));
  });
  return wrap;
}

function footer(root, { backLabel = 'Back', nextLabel = 'Continue', canNext = true, onNext, onBack }) {
  return el('div', { class: 'row row--end', style: { marginTop: 'var(--sp-5)' } },
    draft.step > 0 && el('button', {
      type: 'button', class: 'btn',
      onclick: () => { onBack ? onBack() : (draft.step--, draw(root)); },
    }, backLabel),
    el('button', {
      type: 'button', class: 'btn btn--primary', disabled: !canNext, onclick: onNext,
    }, nextLabel));
}

/* ------------------------------------------------------------------ *
 * Step 1 — organization
 * ------------------------------------------------------------------ */

function stepOrg(body, root) {
  const nameInput = el('input', {
    class: 'input', type: 'text', value: draft.orgName,
    placeholder: 'e.g. AFROTC Detachment 025',
    autocomplete: 'organization',
    oninput: (e) => { draft.orgName = e.target.value; next.disabled = !draft.orgName.trim(); },
  });

  mount(body, 
    el('h2', { class: 'section-title' }, 'Who is this installation for?'),
    field('Organization name', nameInput, {
      required: true,
      hint: 'Shown in the app header and stamped on exported reports.',
    }),
    notice('info', 'Your data stays yours',
      el('p', {}, `${APP.name} has no server. Every record is written to storage you control, `
        + 'under an account your detachment owns. Nothing is sent anywhere else.')),
  );

  const next = el('button', {
    type: 'button', class: 'btn btn--primary', disabled: !draft.orgName.trim(),
    onclick: () => { draft.step = 1; draw(root); },
  }, 'Continue');

  mount(body, el('div', { class: 'row row--end', style: { marginTop: 'var(--sp-5)' } }, next));
  setTimeout(() => nameInput.focus(), 40);
}

/* ------------------------------------------------------------------ *
 * Step 2 — pick a backend
 * ------------------------------------------------------------------ */

function stepBackend(body, root) {
  const options = [
    {
      id: BACKENDS.drive,
      iconName: 'cloud',
      title: 'Google Drive (recommended)',
      desc: 'Connects to your detachment\'s Google account over the Drive API. '
        + 'Works on phones, tablets and computers, and every device sees the same data.',
      available: adapters.drive.isAvailable(),
      unavailableReason: 'Requires a secure (https) connection.',
    },
    {
      id: BACKENDS.folder,
      iconName: 'folder',
      title: 'Synced Drive folder on this computer',
      desc: 'Points at the TOP-Feedback folder inside Google Drive for Desktop. '
        + 'Google\'s own client handles syncing. Desktop Chrome or Edge only.',
      available: adapters.folder.isAvailable(),
      unavailableReason: 'This browser cannot open local folders — use Chrome or Edge on a computer.',
    },
    {
      id: BACKENDS.local,
      iconName: 'device',
      title: 'This device only',
      desc: 'Stores everything in this browser. Nothing syncs and nothing is shared. '
        + 'Good for trying the app out before the Google account exists.',
      available: adapters.local.isAvailable(),
      unavailableReason: 'Browser storage is unavailable.',
    },
  ];

  const list = el('div', { class: 'choice-list' });
  for (const option of options) {
    const input = el('input', {
      type: 'radio', name: 'backend', value: option.id,
      checked: draft.backend === option.id,
      disabled: !option.available,
      onchange: () => { draft.backend = option.id; next.disabled = false; },
    });
    mount(list, el('label', { class: 'choice' },
      input,
      el('span', { class: 'choice__mark', 'aria-hidden': 'true' }),
      el('div', {},
        el('div', { class: 'row' }, icon(option.iconName), el('span', { class: 'choice__title' }, option.title)),
        el('div', { class: 'choice__desc' },
          option.available ? option.desc : `${option.desc} — unavailable: ${option.unavailableReason}`))));
  }

  mount(body, 
    el('h2', { class: 'section-title' }, 'Where should the database live?'),
    el('p', { class: 'muted', style: { marginTop: 'calc(-1 * var(--sp-2))' } },
      'You can change this later in Settings, and export your data first if you do.'),
    list,
  );

  const next = el('button', {
    type: 'button', class: 'btn btn--primary', disabled: !draft.backend,
    onclick: () => { draft.step = 2; draft.connected = false; draw(root); },
  }, 'Continue');

  mount(body, el('div', { class: 'row row--end', style: { marginTop: 'var(--sp-5)' } },
    el('button', { type: 'button', class: 'btn', onclick: () => { draft.step = 0; draw(root); } }, 'Back'),
    next));
}

/* ------------------------------------------------------------------ *
 * Step 3 — connect
 * ------------------------------------------------------------------ */

function stepConnect(body, root) {
  if (draft.backend === BACKENDS.drive) return connectDrive(body, root);
  if (draft.backend === BACKENDS.folder) return connectFolder(body, root);
  return connectLocal(body, root);
}

function connectDrive(body, root) {
  const status = el('div');

  const clientInput = el('input', {
    class: 'input mono', type: 'text', value: draft.clientId,
    placeholder: '000000000000-abc123.apps.googleusercontent.com',
    spellcheck: 'false', autocapitalize: 'off',
    oninput: (e) => { draft.clientId = e.target.value.trim(); refresh(); },
  });

  const folderField = el('input', {
    class: 'input', type: 'text', value: draft.folderInput,
    placeholder: 'https://drive.google.com/drive/folders/…',
    spellcheck: 'false', autocapitalize: 'off',
    oninput: (e) => {
      draft.folderInput = e.target.value;
      draft.folderId = parseFolderId(e.target.value);
      draft.connected = false;
      refresh();
    },
  });

  const connectBtn = el('button', { type: 'button', class: 'btn btn--primary', onclick: doConnect },
    icon('cloud'), 'Sign in and connect');

  const nextBtn = el('button', {
    type: 'button', class: 'btn btn--primary', disabled: !draft.connected,
    onclick: () => { draft.step = 3; draw(root); },
  }, 'Continue');

  function refresh() {
    const ready = Boolean(draft.clientId && draft.folderId);
    connectBtn.disabled = !ready;
    nextBtn.disabled = !draft.connected;
    clear(status);
    if (draft.folderInput && !draft.folderId) {
      mount(status, notice('warn', 'That does not look like a folder link',
        el('p', {}, 'Open the folder in Drive and copy the address bar URL, or paste the folder ID on its own.')));
    } else if (draft.connected) {
      mount(status, notice('ok', `Connected to "${draft.folderName}"`,
        el('p', {}, 'This device can read and write in that folder.')));
    }
  }

  async function doConnect() {
    connectBtn.disabled = true;
    const busy = spinner('Talking to Google…');
    remount(status, busy);
    try {
      db.use(BACKENDS.drive, { clientId: draft.clientId, folderId: draft.folderId });
      const result = await adapters.drive.connect({ interactive: true });
      if (!result.ok) throw new Error(result.detail || describeConnectFailure(result.reason));
      draft.folderName = result.folderName || 'Drive folder';
      draft.connected = true;
      toast('Connected to Google Drive.', 'ok');
    } catch (err) {
      draft.connected = false;
      remount(status, notice('danger', 'Could not connect', el('p', {}, err.message)));
      connectBtn.disabled = false;
      nextBtn.disabled = true;
      return;
    }
    refresh();
    connectBtn.disabled = false;
  }

  mount(body, 
    el('h2', { class: 'section-title' }, 'Connect your detachment\'s Google Drive'),
    notice('info', 'One-time Google setup',
      el('ol', { style: { margin: '0', paddingLeft: '1.1rem' } },
        el('li', {}, 'Sign in to the Google account your detachment owns.'),
        el('li', {}, 'In Google Cloud Console, create a project and enable the ', el('strong', {}, 'Google Drive API'), '.'),
        el('li', {}, 'Create an ', el('strong', {}, 'OAuth client ID'), ' of type Web application, '
          + 'and add this site\'s address as an authorised JavaScript origin: ',
          el('code', { class: 'mono' }, location.origin), '.'),
        el('li', {}, 'In Drive, create a folder named ', el('strong', {}, DB_LAYOUT.root),
          ' and share it with the cadre who need access.'))),
    field('OAuth Client ID', clientInput, {
      required: true,
      hint: 'From Google Cloud Console → Credentials. Safe to store on the device: a browser client ID is an identifier, not a password.',
    }),
    field('Drive folder link or ID', folderField, {
      required: true,
      hint: 'Open the folder in Drive and copy the URL. All app folders are created inside it.',
    }),
    el('div', { class: 'row row--wrap' }, connectBtn),
    status,
    el('div', { class: 'row row--end', style: { marginTop: 'var(--sp-5)' } },
      el('button', { type: 'button', class: 'btn', onclick: () => { draft.step = 1; draw(root); } }, 'Back'),
      nextBtn),
  );
  refresh();
}

function connectFolder(body, root) {
  const status = el('div');
  const nextBtn = el('button', {
    type: 'button', class: 'btn btn--primary', disabled: !draft.connected,
    onclick: () => { draft.step = 3; draw(root); },
  }, 'Continue');

  async function choose() {
    try {
      const { name } = await adapters.folder.chooseFolder();
      draft.folderName = name;
      draft.folderId = 'root-folder';
      draft.connected = true;
      db.use(BACKENDS.folder);
      nextBtn.disabled = false;
      remount(status, notice('ok', `Folder selected: ${name}`,
        el('p', {}, 'The app will read and write JSON files here. Google Drive for Desktop syncs them.')));
    } catch (err) {
      if (err.name === 'AbortError') return;
      remount(status, notice('danger', 'Could not open that folder', el('p', {}, err.message)));
    }
  }

  mount(body, 
    el('h2', { class: 'section-title' }, 'Choose the synced folder'),
    notice('warn', 'Before you continue',
      el('p', {}, 'Install ', el('strong', {}, 'Google Drive for Desktop'), ', sign in to the detachment account, '
        + `and create a folder named ${DB_LAYOUT.root} inside the synced drive. Then select that folder below.`)),
    el('div', { class: 'row row--wrap' },
      el('button', { type: 'button', class: 'btn btn--primary', onclick: choose }, icon('folder'), 'Select folder…')),
    status,
    el('div', { class: 'row row--end', style: { marginTop: 'var(--sp-5)' } },
      el('button', { type: 'button', class: 'btn', onclick: () => { draft.step = 1; draw(root); } }, 'Back'),
      nextBtn),
  );
}

function connectLocal(body, root) {
  draft.connected = true;
  draft.folderName = 'This device';
  db.use(BACKENDS.local);
  mount(body, 
    el('h2', { class: 'section-title' }, 'Use this device only'),
    notice('warn', 'Nothing will sync',
      el('p', {}, 'Records live in this browser\'s storage. Other devices will not see them, and clearing '
        + 'site data erases them. Export a backup from Settings regularly, and switch to Google Drive '
        + 'once the detachment account exists — your export imports straight in.')),
    el('div', { class: 'row row--end', style: { marginTop: 'var(--sp-5)' } },
      el('button', { type: 'button', class: 'btn', onclick: () => { draft.step = 1; draw(root); } }, 'Back'),
      el('button', {
        type: 'button', class: 'btn btn--primary',
        onclick: () => { draft.step = 3; draw(root); },
      }, 'Continue')),
  );
}

/* ------------------------------------------------------------------ *
 * Step 4 — build the folder tree
 * ------------------------------------------------------------------ */

function stepFinish(body, root) {
  const status = el('div');
  const finishBtn = el('button', { type: 'button', class: 'btn btn--primary btn--lg', onclick: finish },
    icon('check'), 'Create folders and finish');

  async function finish() {
    finishBtn.disabled = true;
    remount(status, spinner('Creating folders…'));
    try {
      connection.set({
        backend: draft.backend,
        orgName: draft.orgName.trim(),
        folderId: draft.folderId,
        folderName: draft.folderName,
        folderUrl: draft.backend === BACKENDS.drive
          ? `https://drive.google.com/drive/folders/${draft.folderId}` : '',
        clientId: draft.clientId,
        connectedAt: new Date().toISOString(),
      });
      db.use(draft.backend, { clientId: draft.clientId, folderId: draft.folderId });
      await db.initialize({ orgName: draft.orgName.trim(), seed: true });
      markSetupComplete(true);
      resetSetupDraft();
      toast('Setup complete.', 'ok');
      navigate('/home');
    } catch (err) {
      remount(status, notice('danger', 'Setup could not finish', el('p', {}, err.message)));
      finishBtn.disabled = false;
    }
  }

  mount(body, 
    el('h2', { class: 'section-title' }, 'Ready to build the database'),
    el('p', { class: 'muted' }, 'These folders will be created if they do not already exist. '
      + 'Existing data is left untouched, so it is safe to point a second device at the same folder.'),
    el('pre', { class: 'tree' }, FOLDER_TREE_PREVIEW),
    el('dl', { class: 'stack-sm' },
      summaryRow('Organization', draft.orgName),
      summaryRow('Storage', adapters[draft.backend]?.label || draft.backend),
      summaryRow('Location', draft.folderName || '—')),
    status,
    el('div', { class: 'row row--end', style: { marginTop: 'var(--sp-5)' } },
      el('button', { type: 'button', class: 'btn', onclick: () => { draft.step = 2; draw(root); } }, 'Back'),
      finishBtn),
  );
}

function summaryRow(label, value) {
  return el('div', { class: 'row row--between' },
    el('dt', { class: 'muted' }, label),
    el('dd', { style: { fontWeight: '570' } }, value));
}

function describeConnectFailure(reason) {
  const reasons = {
    auth: 'Google sign-in did not complete.',
    'no-folder': 'Enter the Drive folder link first.',
    'not-a-folder': 'That link points at a file, not a folder.',
    'read-only': 'This account cannot write to that folder.',
    permission: 'Permission to the folder was denied.',
    'no-handle': 'No folder has been selected.',
  };
  return reasons[reason] || 'The connection could not be verified.';
}
