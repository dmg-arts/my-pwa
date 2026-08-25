/**
 * The proxy, executed.
 *
 *     npm run test:proxy
 *
 * `tests/unit/proxy.test.mjs` reads the script and checks the shape of its
 * access model. This runs it. The distinction matters: source checks catch a
 * missing guard, and miss a wrong argument order, an id that escapes its folder,
 * or a role that reaches a space through a path nobody thought about.
 *
 * The real `tools/proxy/Code.gs` runs unmodified against an in-memory Drive.
 * What this cannot check is the environment — quotas, real lock contention
 * across concurrent executions, a deployment misconfigured in the console. A
 * real deployment still has to happen; this means it will be checking those
 * rather than discovering the logic was wrong.
 */

import { createProxy, validToken, seedRoster, account } from './harness.mjs';

const CID = 'test-client.apps.googleusercontent.com';

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (err) { console.log(`  FAIL ${label}: ${err.message}`); failures++; }
};

/** A detachment with one of everything, and a token per person. */
function detachment(extraAccounts = []) {
  const people = [
    account('cadet', 'cadet@x.edu', ['student']),
    account('instructor', 'instructor@x.edu', ['instructor']),
    account('cadre', 'cadre@x.edu', ['cadre']),
    account('commander', 'commander@x.edu', ['commander']),
    account('admin', 'admin@x.edu', ['admin']),
    ...extraAccounts,
  ];
  const tokens = {};
  for (const person of people) tokens[`tok-${person.username}`] = validToken(person.email);

  const proxy = createProxy({ tokens });
  seedRoster(proxy.root, people);

  // One request in each space, all addressed to every AS200 cadet.
  for (const [space, segments] of [
    ['shared', ['requests']],
    ['cadre', ['cadre', 'requests']],
    ['commander', ['commander', 'requests']],
  ]) {
    proxy.root.put(segments, `req_${space}.json`, {
      id: `req_${space}`, formId: 'form_1', title: `${space} feedback`,
      status: 'open', asClass: 'AS200', anonymous: true, space,
      assignedUsernames: [],
    });
  }
  proxy.root.put(['forms'], 'form_1.json', { id: 'form_1', name: 'Form', sections: [] });
  return proxy;
}

const as = (person) => `tok-${person}`;
const ids = (result) => (result.catalog?.requests || []).map((r) => r.id).sort();

/* ------------------------------------------------------------------ *
 * identity
 * ------------------------------------------------------------------ */

check('a request with no token is refused', () => {
  const proxy = detachment();
  const out = proxy.post({ action: 'catalog' });
  if (out.ok) throw new Error('accepted');
  if (!/sign-in/i.test(out.error)) throw new Error(out.error);
});

check('a token Google will not verify is refused', () => {
  const proxy = detachment();
  const out = proxy.post({ action: 'catalog', idToken: 'made-up' });
  if (out.ok) throw new Error('accepted an unverifiable token');
});

check('a token for another application is refused', () => {
  const proxy = createProxy({ tokens: { bad: { ...validToken('x@x.edu'), aud: 'someone-else' } } });
  seedRoster(proxy.root, [account('x', 'x@x.edu', ['admin'])]);
  const out = proxy.post({ action: 'catalog', idToken: 'bad' });
  if (out.ok) throw new Error('accepted a token minted for a different client');
  if (!/different application/i.test(out.error)) throw new Error(out.error);
});

check('an expired token is refused', () => {
  const expired = { ...validToken('x@x.edu'), exp: String(Math.floor(Date.now() / 1000) - 60) };
  const proxy = createProxy({ tokens: { old: expired } });
  seedRoster(proxy.root, [account('x', 'x@x.edu', ['admin'])]);
  const out = proxy.post({ action: 'catalog', idToken: 'old' });
  if (out.ok) throw new Error('accepted an expired token');
  if (!/expired/i.test(out.error)) throw new Error(out.error);
});

check('an unverified email is refused', () => {
  const unverified = { ...validToken('x@x.edu'), email_verified: 'false' };
  const proxy = createProxy({ tokens: { u: unverified } });
  seedRoster(proxy.root, [account('x', 'x@x.edu', ['admin'])]);
  const out = proxy.post({ action: 'catalog', idToken: 'u' });
  if (out.ok) throw new Error('accepted an unverified address');
});

check('an address not on the roster is refused', () => {
  const proxy = createProxy({ tokens: { ghost: validToken('ghost@x.edu') } });
  seedRoster(proxy.root, [account('x', 'x@x.edu', ['admin'])]);
  const out = proxy.post({ action: 'catalog', idToken: 'ghost' });
  if (out.ok) throw new Error('accepted someone not on the roster');
  if (!/roster/i.test(out.error)) throw new Error(out.error);
});

check('a deactivated account is refused', () => {
  const proxy = createProxy({ tokens: { off: validToken('off@x.edu') } });
  seedRoster(proxy.root, [account('off', 'off@x.edu', ['admin'], { active: false })]);
  const out = proxy.post({ action: 'catalog', idToken: 'off' });
  if (out.ok) throw new Error('accepted a deactivated account');
  if (!/deactivated/i.test(out.error)) throw new Error(out.error);
});

/* ------------------------------------------------------------------ *
 * role gating
 * ------------------------------------------------------------------ */

check('a cadet cannot read the catalogue', () => {
  const proxy = detachment();
  if (proxy.post({ action: 'catalog', idToken: as('cadet') }).ok) {
    throw new Error('a cadet read the instructor catalogue');
  }
});

check('a cadet cannot read anyone\'s responses', () => {
  const proxy = detachment();
  for (const action of ['responses', 'allResponses']) {
    if (proxy.post({ action, idToken: as('cadet'), requestId: 'req_shared' }).ok) {
      throw new Error(`a cadet called ${action}`);
    }
  }
});

check('an instructor cannot read the audit log', () => {
  const proxy = detachment();
  if (proxy.post({ action: 'audit', idToken: as('instructor') }).ok) {
    throw new Error('an instructor read the audit log');
  }
});

check('an instructor cannot change the roster', () => {
  const proxy = detachment();
  for (const action of ['accountCreate', 'accountUpdate', 'accountDelete', 'rollover']) {
    if (proxy.post({ action, idToken: as('instructor'), account: {}, id: 'x' }).ok) {
      throw new Error(`an instructor called ${action}`);
    }
  }
});

check('cadre inherit instructor access without holding the role', () => {
  const proxy = detachment();
  if (!proxy.post({ action: 'catalog', idToken: as('cadre') }).ok) {
    throw new Error('a cadre-only account could not read the catalogue');
  }
});

check('an unknown action is refused', () => {
  const proxy = detachment();
  if (proxy.post({ action: 'dropDatabase', idToken: as('admin') }).ok) {
    throw new Error('an unknown action was accepted');
  }
});

/* ------------------------------------------------------------------ *
 * locked spaces
 * ------------------------------------------------------------------ */

check('an instructor sees only shared feedback', () => {
  const proxy = detachment();
  const seen = ids(proxy.post({ action: 'catalog', idToken: as('instructor') }));
  if (seen.join() !== 'req_shared') throw new Error(`saw ${seen.join(', ')}`);
});

check('cadre see shared and cadre feedback, not the commander\'s', () => {
  const proxy = detachment();
  const seen = ids(proxy.post({ action: 'catalog', idToken: as('cadre') }));
  if (seen.join() !== 'req_cadre,req_shared') throw new Error(`saw ${seen.join(', ')}`);
});

check('the commander sees everything', () => {
  const proxy = detachment();
  const seen = ids(proxy.post({ action: 'catalog', idToken: as('commander') }));
  if (seen.join() !== 'req_cadre,req_commander,req_shared') throw new Error(`saw ${seen.join(', ')}`);
});

check('an instructor naming a commander request gets nothing', () => {
  // Naming an id you cannot see must not reach past the space check.
  const proxy = detachment();
  const out = proxy.post({ action: 'responses', idToken: as('instructor'), requestId: 'req_commander' });
  if (out.ok) throw new Error('an instructor read commander responses');
  if (!/not available/i.test(out.error)) throw new Error(out.error);
});

check('an instructor cannot delete a commander request', () => {
  const proxy = detachment();
  const out = proxy.post({ action: 'deleteRequest', idToken: as('instructor'), requestId: 'req_commander' });
  if (out.ok) throw new Error('an instructor deleted a commander request');
  if (proxy.root.read(['commander', 'requests'], 'req_commander.json') === null) {
    throw new Error('the commander request was removed anyway');
  }
});

check('an instructor cannot file feedback into a locked space', () => {
  const proxy = detachment();
  const out = proxy.post({
    action: 'saveRequest', idToken: as('instructor'),
    request: { id: 'req_sneak', formId: 'form_1', space: 'commander' },
  });
  if (out.ok) throw new Error('an instructor filed into the commander space');
  if (proxy.root.read(['commander', 'requests'], 'req_sneak.json')) {
    throw new Error('the request landed in the commander space anyway');
  }
});

check('feedback cannot be moved between spaces once it exists', () => {
  // Moving it would carry its responses somewhere they were never readable.
  const proxy = detachment();
  const out = proxy.post({
    action: 'saveRequest', idToken: as('commander'),
    request: { id: 'req_shared', formId: 'form_1', space: 'commander' },
  });
  if (out.ok) throw new Error('a request was moved between spaces');
  if (!/cannot be moved/i.test(out.error)) throw new Error(out.error);
});

check('an unknown space falls back to shared rather than creating one', () => {
  const proxy = detachment();
  proxy.post({
    action: 'saveRequest', idToken: as('commander'),
    request: { id: 'req_odd', formId: 'form_1', space: 'nonsense' },
  });
  if (!proxy.root.read(['requests'], 'req_odd.json')) {
    throw new Error('it did not land in the shared space');
  }
  if (proxy.root.read(['nonsense', 'requests'], 'req_odd.json')) {
    throw new Error('a folder was created from a made-up space name');
  }
});

/* ------------------------------------------------------------------ *
 * cadets and the spaces
 * ------------------------------------------------------------------ */

check('a cadet is offered requests from every space', () => {
  // A commander's request is still meant to be answered.
  const proxy = detachment();
  const bundle = proxy.post({ action: 'bundle', idToken: as('cadet') }).bundle;
  const seen = bundle.requests.map((r) => r.id).sort();
  if (seen.join() !== 'req_cadre,req_commander,req_shared') throw new Error(`saw ${seen.join(', ')}`);
});

check('a cadet bundle carries no responses at all', () => {
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared', answers: { q1: 5 } });
  const bundle = proxy.post({ action: 'bundle', idToken: as('cadet') }).bundle;
  if ('responses' in bundle) throw new Error('the bundle contains a responses key');
  if (JSON.stringify(bundle).includes('res_')) throw new Error('a response id leaked into the bundle');
});

check('an answer is filed in its request\'s own space', () => {
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_commander', answers: { q1: 9 } });
  const shared = proxy.root.snapshot();
  const inCommander = Object.keys(shared).some((k) => k.startsWith('commander/responses/'));
  const inShared = Object.keys(shared).some((k) => /^responses\//.test(k));
  if (!inCommander) throw new Error('the answer did not land in the commander space');
  if (inShared) throw new Error('the answer also landed in the shared space');
});

check('an instructor cannot read a cadet\'s answer to a commander request', () => {
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_commander', answers: { q1: 9 } });
  const out = proxy.post({ action: 'allResponses', idToken: as('instructor') });
  if (!out.ok) throw new Error(out.error);
  if (out.responses.length) throw new Error(`instructor received ${out.responses.length} responses`);
});

check('the commander can read it', () => {
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_commander', answers: { q1: 9 } });
  const out = proxy.post({ action: 'allResponses', idToken: as('commander') });
  if (out.responses.length !== 1) throw new Error(`commander received ${out.responses.length}`);
});

/* ------------------------------------------------------------------ *
 * submissions
 * ------------------------------------------------------------------ */

check('one submission per cadet per form', () => {
  const proxy = detachment();
  const first = proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared', answers: { q1: 5 } });
  const second = proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared', answers: { q1: 1 } });
  if (!first.ok) throw new Error(first.error);
  if (second.ok) throw new Error('a second submission was accepted');
});

check('an anonymous form stores no respondent, whatever the client sends', () => {
  const proxy = detachment();
  proxy.post({
    action: 'submit', idToken: as('cadet'), requestId: 'req_shared',
    answers: { q1: 5 },
    respondent: { username: 'cadet', name: 'Cadet' },   // ignored on purpose
  });
  const stored = Object.entries(proxy.root.snapshot())
    .find(([k]) => k.startsWith('responses/req_shared/'))[1];
  if (stored.respondent !== null) throw new Error('a respondent was stored on an anonymous form');
  if (JSON.stringify(stored).includes('cadet')) throw new Error('the cadet is identifiable in the record');
});

check('an attributed form does store the respondent', () => {
  const proxy = detachment();
  proxy.root.put(['requests'], 'req_named.json', {
    id: 'req_named', formId: 'form_1', status: 'open', asClass: 'AS200',
    anonymous: false, space: 'shared', assignedUsernames: [],
  });
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_named', answers: { q1: 5 } });
  const stored = Object.entries(proxy.root.snapshot())
    .find(([k]) => k.startsWith('responses/req_named/'))[1];
  if (stored.respondent?.username !== 'cadet') throw new Error('no respondent recorded');
});

check('a closed request refuses submissions', () => {
  const proxy = detachment();
  proxy.root.put(['requests'], 'req_shut.json', {
    id: 'req_shut', formId: 'form_1', status: 'closed', asClass: 'AS200', space: 'shared',
  });
  const out = proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shut', answers: {} });
  if (out.ok) throw new Error('a closed request accepted a submission');
});

check('a cadet cannot answer a request addressed to someone else', () => {
  const proxy = detachment();
  proxy.root.put(['requests'], 'req_other.json', {
    id: 'req_other', formId: 'form_1', status: 'open', space: 'shared',
    assignedUsernames: ['somebody-else'],
  });
  const out = proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_other', answers: {} });
  if (out.ok) throw new Error('answered a request assigned to somebody else');
});

/* ------------------------------------------------------------------ *
 * ids that try to escape
 * ------------------------------------------------------------------ */

check('an id containing a path is refused', () => {
  const proxy = detachment();
  for (const bad of ['../users', 'a/b', '../../users/users', './x', 'x\\y']) {
    const out = proxy.post({ action: 'responses', idToken: as('admin'), requestId: bad });
    if (out.ok) throw new Error(`accepted the id ${JSON.stringify(bad)}`);
  }
});

check('a record id containing a path is refused', () => {
  const proxy = detachment();
  const out = proxy.post({
    action: 'saveForm', idToken: as('instructor'),
    form: { id: '../users/users', name: 'escape' },
  });
  if (out.ok) throw new Error('accepted a form id containing a path');
  const roster = proxy.root.read(['users'], 'users.json');
  if (!roster?.users?.length) throw new Error('the roster was overwritten');
});

check('an over-long id is refused', () => {
  const proxy = detachment();
  const out = proxy.post({ action: 'responses', idToken: as('admin'), requestId: 'a'.repeat(200) });
  if (out.ok) throw new Error('accepted a 200-character id');
});

/* ------------------------------------------------------------------ *
 * deletions and the audit trail
 * ------------------------------------------------------------------ */

check('deleting a response needs an administrator', () => {
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared', answers: { q1: 5 } });
  const id = Object.keys(proxy.root.snapshot())
    .find((k) => k.startsWith('responses/req_shared/')).split('/').pop().replace('.json', '');

  const out = proxy.post({
    action: 'deleteResponse', idToken: as('instructor'),
    requestId: 'req_shared', responseId: id, reason: 'tidying up',
  });
  if (out.ok) throw new Error('an instructor deleted a response');
});

check('deleting a response needs a recorded reason', () => {
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared', answers: { q1: 5 } });
  const id = Object.keys(proxy.root.snapshot())
    .find((k) => k.startsWith('responses/req_shared/')).split('/').pop().replace('.json', '');

  const out = proxy.post({
    action: 'deleteResponse', idToken: as('admin'),
    requestId: 'req_shared', responseId: id, reason: '',
  });
  if (out.ok) throw new Error('deleted without a reason');
  if (!/reason/i.test(out.error)) throw new Error(out.error);
});

check('a recorded deletion names the account that did it, from the token', () => {
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared', answers: { q1: 5 } });
  const id = Object.keys(proxy.root.snapshot())
    .find((k) => k.startsWith('responses/req_shared/')).split('/').pop().replace('.json', '');

  proxy.post({
    action: 'deleteResponse', idToken: as('admin'),
    requestId: 'req_shared', responseId: id, reason: 'duplicate submission',
  });
  const entry = Object.entries(proxy.root.snapshot()).find(([k]) => k.startsWith('audit/'))?.[1];
  if (!entry) throw new Error('nothing was written to the audit trail');
  if (entry.actor?.username !== 'admin') throw new Error(`actor recorded as ${entry.actor?.username}`);
  if (entry.reason !== 'duplicate submission') throw new Error('the reason was not recorded');
});

check('a client cannot forge the actor on an audit entry', () => {
  const proxy = detachment();
  proxy.post({
    action: 'recordAudit', idToken: as('instructor'),
    entry: { action: 'x', summary: 'y', actor: { username: 'somebody-else' } },
  });
  const entry = Object.entries(proxy.root.snapshot()).find(([k]) => k.startsWith('audit/'))[1];
  if (entry.actor.username !== 'instructor') {
    throw new Error(`actor recorded as ${entry.actor.username}`);
  }
});

check('deleting a request takes its responses and receipts with it', () => {
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared', answers: { q1: 5 } });
  proxy.post({ action: 'deleteRequest', idToken: as('instructor'), requestId: 'req_shared' });

  const left = Object.keys(proxy.root.snapshot());
  if (left.some((k) => k.startsWith('responses/req_shared/'))) throw new Error('responses survived');
  if (left.some((k) => k.startsWith('receipts/req_shared/'))) throw new Error('receipts survived');
  if (left.includes('requests/req_shared.json')) throw new Error('the request survived');
});

/* ------------------------------------------------------------------ *
 * the roster
 * ------------------------------------------------------------------ */

check('an account can be added, and duplicates refused', () => {
  const proxy = detachment();
  const first = proxy.post({
    action: 'accountCreate', idToken: as('admin'),
    account: { id: 'usr_new', username: 'new', email: 'New@X.edu', roles: ['student'] },
  });
  if (!first.ok) throw new Error(first.error);

  const again = proxy.post({
    action: 'accountCreate', idToken: as('admin'),
    account: { id: 'usr_other', username: 'other', email: 'new@x.edu', roles: ['student'] },
  });
  if (again.ok) throw new Error('the same address was added twice');
});

check('an email is stored lowercased so matching is stable', () => {
  const proxy = detachment();
  proxy.post({
    action: 'accountCreate', idToken: as('admin'),
    account: { id: 'usr_c', username: 'c', email: 'MiXeD@Case.EDU', roles: ['student'] },
  });
  const roster = proxy.root.read(['users'], 'users.json').users;
  const stored = roster.find((u) => u.id === 'usr_c');
  if (stored.email !== 'mixed@case.edu') throw new Error(`stored as ${stored.email}`);
});

check('at most two commanders', () => {
  const proxy = detachment([account('second', 'second@x.edu', ['commander'])]);
  const out = proxy.post({
    action: 'accountCreate', idToken: as('admin'),
    account: { id: 'usr_third', username: 'third', email: 'third@x.edu', roles: ['commander'] },
  });
  if (out.ok) throw new Error('a third commander was allowed');
  if (!/2 commanders/i.test(out.error)) throw new Error(out.error);
});

check('promoting a third person to commander is refused too', () => {
  const proxy = detachment([account('second', 'second@x.edu', ['commander'])]);
  const out = proxy.post({
    action: 'accountUpdate', idToken: as('admin'),
    id: 'usr_instructor', patch: { roles: ['commander'] },
  });
  if (out.ok) throw new Error('a third commander was promoted');
});

check('a deactivated commander does not count against the cap', () => {
  // Otherwise a departed commander would block their own replacement.
  const proxy = detachment([
    account('second', 'second@x.edu', ['commander'], { active: false }),
  ]);
  const out = proxy.post({
    action: 'accountCreate', idToken: as('admin'),
    account: { id: 'usr_third', username: 'third', email: 'third@x.edu', roles: ['commander'] },
  });
  if (!out.ok) throw new Error(out.error);
});

check('the rollover advances students and retires the top year', () => {
  const proxy = detachment([
    account('junior', 'junior@x.edu', ['student'], { asClass: 'AS100' }),
    account('senior', 'senior@x.edu', ['student'], { asClass: 'AS400' }),
  ]);
  const out = proxy.post({
    action: 'rollover', idToken: as('admin'),
    moves: { AS100: 'AS200', AS400: null }, deactivate: true,
  });
  if (!out.ok) throw new Error(out.error);

  const roster = proxy.root.read(['users'], 'users.json').users;
  const junior = roster.find((u) => u.username === 'junior');
  const senior = roster.find((u) => u.username === 'senior');
  if (junior.asClass !== 'AS200') throw new Error(`junior is ${junior.asClass}`);
  if (senior.active !== false) throw new Error('the graduating cadet was not deactivated');
  if (senior.asClass !== 'AS400') throw new Error('the graduating cadet lost their level');
});

check('the rollover leaves staff alone', () => {
  const proxy = detachment();
  proxy.post({
    action: 'rollover', idToken: as('admin'),
    moves: { AS200: 'AS300' }, deactivate: true,
  });
  const roster = proxy.root.read(['users'], 'users.json').users;
  const instructor = roster.find((u) => u.username === 'instructor');
  if (instructor.asClass !== 'AS200') throw new Error('an instructor was advanced');
});

/* ------------------------------------------------------------------ *
 * deletion means permanently anonymised
 *
 * Removing a roster entry alone would leave the person's name on every
 * attributed response and their username on every receipt — so "delete this
 * person" would mean "stop them signing in" and nothing more. And a backup
 * export would carry all of it out of the folder on a laptop.
 * ------------------------------------------------------------------ */

/** A detachment where the cadet has answered an attributed form. */
function withNamedAnswer() {
  const proxy = detachment();
  proxy.root.put(['requests'], 'req_named.json', {
    id: 'req_named', formId: 'form_1', status: 'open', asClass: 'AS200',
    anonymous: false, space: 'shared', assignedUsernames: [],
  });
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_named', answers: { q1: 5 } });
  return proxy;
}

check('deleting an account strips the respondent from their answers', () => {
  const proxy = withNamedAnswer();
  const before = Object.entries(proxy.root.snapshot())
    .find(([k]) => k.startsWith('responses/req_named/'))[1];
  if (before.respondent?.username !== 'cadet') throw new Error('the fixture is not attributed');

  const out = proxy.post({ action: 'accountDelete', idToken: as('admin'), id: 'usr_cadet' });
  if (!out.ok) throw new Error(out.error);

  const after = Object.entries(proxy.root.snapshot())
    .find(([k]) => k.startsWith('responses/req_named/'))[1];
  if (after.respondent !== null) throw new Error('the respondent survived');
  if (after.anonymous !== true) throw new Error('the response is not marked anonymous');
  if (!after.anonymisedAt) throw new Error('no record of when it was anonymised');
});

check('the answer itself is kept — this removes the person, not the feedback', () => {
  const proxy = withNamedAnswer();
  proxy.post({ action: 'accountDelete', idToken: as('admin'), id: 'usr_cadet' });
  const after = Object.entries(proxy.root.snapshot())
    .find(([k]) => k.startsWith('responses/req_named/'))[1];
  if (after.answers?.q1 !== 5) throw new Error('the feedback was destroyed');
});

check('the username survives nowhere in the folder afterwards', () => {
  const proxy = withNamedAnswer();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_commander', answers: { q1: 3 } });
  proxy.post({ action: 'accountDelete', idToken: as('admin'), id: 'usr_cadet' });

  const dump = proxy.root.snapshot();
  for (const [path, value] of Object.entries(dump)) {
    if (path.startsWith('audit/')) continue;   // the audit line records the removal on purpose
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (/\bcadet\b/.test(text)) throw new Error(`"cadet" still appears in ${path}`);
    if (text.includes('cadet@x.edu')) throw new Error(`their address still appears in ${path}`);
  }
});

check('receipts keep their count but lose the name', () => {
  // Completion tracking must still add up, or removing someone would silently
  // rewrite history about who took part.
  const proxy = withNamedAnswer();
  const before = Object.keys(proxy.root.snapshot()).filter((k) => k.startsWith('receipts/req_named/'));
  if (before.length !== 1) throw new Error(`expected one receipt, found ${before.length}`);

  proxy.post({ action: 'accountDelete', idToken: as('admin'), id: 'usr_cadet' });

  const after = Object.entries(proxy.root.snapshot())
    .filter(([k]) => k.startsWith('receipts/req_named/'));
  if (after.length !== 1) throw new Error(`receipt count changed to ${after.length}`);
  const [name, value] = after[0];
  if (/cadet/.test(name)) throw new Error(`the receipt is still named ${name}`);
  if (value.username !== null) throw new Error('the receipt still carries a username');
  if (value.removed !== true) throw new Error('the receipt is not marked removed');
});

check('records are anonymised in every space, not only reachable ones', () => {
  // An administrator cannot read the commander space, but a person deleted from
  // the roster must not survive in it.
  const proxy = detachment();
  proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_commander', answers: { q1: 8 } });
  proxy.root.put(['commander', 'responses', 'req_commander'], 'res_named.json', {
    id: 'res_named', requestId: 'req_commander', anonymous: false,
    respondent: { username: 'cadet', name: 'cadet' }, answers: { q1: 2 },
  });

  proxy.post({ action: 'accountDelete', idToken: as('admin'), id: 'usr_cadet' });

  const stored = proxy.root.read(['commander', 'responses', 'req_commander'], 'res_named.json');
  if (stored.respondent !== null) throw new Error('a commander-space response kept its respondent');
});

check('the deletion is recorded with what it anonymised', () => {
  const proxy = withNamedAnswer();
  proxy.post({ action: 'accountDelete', idToken: as('admin'), id: 'usr_cadet' });
  const entry = Object.entries(proxy.root.snapshot()).find(([k]) => k.startsWith('audit/'))[1];
  if (entry.actor.username !== 'admin') throw new Error('the wrong actor was recorded');
  if (!entry.detail || entry.detail.responsesAnonymised < 1) {
    throw new Error('the audit entry does not say what was anonymised');
  }
  if (entry.severe !== true) throw new Error('an irreversible deletion is not marked severe');
});

check('deleting a non-existent account is refused rather than silently succeeding', () => {
  const proxy = detachment();
  const out = proxy.post({ action: 'accountDelete', idToken: as('admin'), id: 'usr_nobody' });
  if (out.ok) throw new Error('accepted a deletion of nobody');
});

check('an instructor cannot delete an account', () => {
  const proxy = withNamedAnswer();
  const out = proxy.post({ action: 'accountDelete', idToken: as('instructor'), id: 'usr_cadet' });
  if (out.ok) throw new Error('an instructor deleted an account');
  const roster = proxy.root.read(['users'], 'users.json').users;
  if (!roster.some((u) => u.id === 'usr_cadet')) throw new Error('the account was removed anyway');
});

/* ------------------------------------------------------------------ *
 * failure modes
 * ------------------------------------------------------------------ */

check('an unconfigured deployment says so rather than throwing', () => {
  const proxy = createProxy({ configured: false });
  const out = proxy.post({ action: 'catalog', idToken: 'x' });
  if (out.ok) throw new Error('an unconfigured proxy served a request');
  if (!/not been configured/i.test(out.error)) throw new Error(out.error);
  const health = proxy.get();
  if (health.configured !== false) throw new Error('doGet claims it is configured');
});

check('a body that is not JSON is refused rather than throwing', () => {
  const proxy = detachment();
  for (const junk of ['not json at all', '{"unclosed":', '', '<html></html>']) {
    const out = proxy.postRaw(junk);
    if (out.ok) throw new Error(`accepted ${JSON.stringify(junk)}`);
    if (!/JSON|Empty/i.test(out.error)) throw new Error(`unhelpful message: ${out.error}`);
  }
});

check('an unexpected failure does not leak a stack trace', () => {
  // The endpoint is public; an internal error message is an information gift.
  const proxy = detachment();
  const out = proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared' });
  if (out.ok) return;                       // answers omitted is tolerated
  if (/\bat \w+ \(|Error:|\.gs:\d/.test(out.error)) {
    throw new Error(`a stack trace reached the caller: ${out.error}`);
  }
});

check('an oversized body is refused', () => {
  const proxy = detachment();
  const out = proxy.post({
    action: 'submit', idToken: as('cadet'), requestId: 'req_shared',
    answers: { q1: 'x'.repeat(200 * 1024) },
  });
  if (out.ok) throw new Error('accepted a body over the size limit');
  if (!/too large/i.test(out.error)) throw new Error(out.error);
});

check('lock contention is reported, not swallowed', () => {
  const proxy = detachment();
  proxy.holdLock();
  const out = proxy.post({ action: 'submit', idToken: as('cadet'), requestId: 'req_shared', answers: {} });
  proxy.releaseLock();
  if (out.ok) throw new Error('a submission proceeded while the lock was held');
  if (!/busy/i.test(out.error)) throw new Error(out.error);
});

console.log(failures ? `\n${failures} behaviour check(s) failed.` : '\nAll proxy behaviour checks passed.');
process.exit(failures ? 1 : 0);
