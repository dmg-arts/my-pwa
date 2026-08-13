/**
 * Feedback Response and Analysis.
 *
 * Filters completed feedback by date range, class/event, AS level, and feedback
 * id, then shows who has responded, what they said, and the roll-up statistics.
 *
 * The deeper analysis (trends across terms, per-instructor baselines, outlier
 * flagging) is deliberately not here yet — this page establishes the filtering
 * and the response surface those will read from.
 */

import {
  el, icon, field, select, badge, notice, emptyState, spinner, toast,
  download, toCsv, fmtDate, fmtDateTime, pluralize, mean, median, stdev, round,
  modal, confirmDialog, fromDateInput, groupBy,
  mount, remount } from '../util.js';
import { AS_CLASSES, SEMESTERS, PRIVACY, schoolYears, nearestAnchor } from '../config.js';
import { db } from '../storage/index.js';
import { listStudents } from '../auth.js';
import { renderForm, formItems } from '../forms.js';
import { navigate } from '../router.js';

/**
 * The anchor set the responses in scope were answered on. Forms record their
 * own wording, so a range that mixes scales falls back to the first one found
 * rather than describing a score in words it was never rated with.
 */
function anchorsInScope(rows, formsById) {
  for (const response of rows) {
    const form = formsById?.get(response.formId);
    for (const item of formItems(form || {})) {
      if (item.type === 'scale' && item.anchors) return item.anchors;
    }
  }
  return undefined;
}

export async function renderAnalysis(host) {
  remount(host, spinner('Gathering feedback…'));

  let requests;
  let responses;
  let forms;
  let students;
  try {
    [requests, responses, forms, students] = await Promise.all([
      db.listRequests(), db.listAllResponses(), db.listForms(), listStudents(),
    ]);
  } catch (err) {
    remount(host, notice('danger', 'Could not load feedback', el('p', {}, err.message)));
    return;
  }

  const formsById = new Map(forms.map((f) => [f.id, f]));
  const requestsById = new Map(requests.map((r) => [r.id, r]));

  const state = {
    from: '', to: '', asClass: '', schoolYear: '', semester: '', feedbackId: '', search: '',
  };

  const results = el('div', { class: 'stack-lg' });
  const years = schoolYears();

  remount(host, 
    el('div', { class: 'row row--between row--wrap', style: { marginBottom: 'var(--sp-4)' } },
      el('h2', { class: 'section-title', style: { margin: '0' } }, 'Feedback Response and Analysis'),
      el('div', { class: 'row row--wrap' },
        el('button', { type: 'button', class: 'btn btn--sm', onclick: exportRows }, icon('download'), 'Export CSV'),
        el('button', { type: 'button', class: 'btn btn--sm', onclick: () => window.print() }, icon('external'), 'Print'))),

    el('div', { class: 'card', style: { padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)' } },
      el('div', { class: 'filters' },
        field('From', el('input', {
          class: 'input', type: 'date',
          onchange: (e) => { state.from = e.target.value; draw(); },
        }), { hint: 'Submission date' }),
        field('To', el('input', {
          class: 'input', type: 'date',
          onchange: (e) => { state.to = e.target.value; draw(); },
        })),
        field('AS level', select(
          [{ value: '', label: 'All levels' }, ...AS_CLASSES.map((c) => ({ value: c.code, label: c.code }))],
          { onchange: (e) => { state.asClass = e.target.value; draw(); } })),
        field('School year', select(
          [{ value: '', label: 'All years' }, ...years.map((y) => ({ value: y, label: y }))],
          { onchange: (e) => { state.schoolYear = e.target.value; draw(); } })),
        field('Semester', select(
          [{ value: '', label: 'All' }, ...SEMESTERS.map((s) => ({ value: s, label: s }))],
          { onchange: (e) => { state.semester = e.target.value; draw(); } })),
        field('Feedback ID', select(
          [{ value: '', label: 'All feedback' },
            ...requests.filter((r) => r.feedbackId)
              .map((r) => ({ value: r.feedbackId, label: `${r.feedbackId} — ${r.title}` }))],
          { onchange: (e) => { state.feedbackId = e.target.value; draw(); } })),
        field('Class / event', el('input', {
          class: 'input', type: 'search', placeholder: 'Name contains…',
          oninput: (e) => { state.search = e.target.value; draw(); },
        }))),
      el('div', { class: 'row row--end', style: { marginTop: 'var(--sp-3)' } },
        el('button', {
          type: 'button', class: 'btn btn--sm btn--ghost',
          onclick: () => { navigate('/instructor?tab=analysis'); },
        }, icon('refresh'), 'Reset filters'))),

    results);

  function matchingRequests() {
    return requests.filter((request) => {
      if (state.feedbackId && request.feedbackId !== state.feedbackId) return false;
      if (state.asClass && request.asClass !== state.asClass) return false;
      if (state.schoolYear && request.schoolYear !== state.schoolYear) return false;
      if (state.semester && request.semester !== state.semester) return false;
      if (state.search && !`${request.title} ${request.eventName || ''}`.toLowerCase()
        .includes(state.search.toLowerCase())) return false;
      return true;
    });
  }

  function filtered() {
    const allowed = new Set(matchingRequests().map((r) => r.id));
    const fromTime = state.from ? new Date(fromDateInput(state.from)).getTime() : null;
    const toTime = state.to ? new Date(fromDateInput(state.to, true)).getTime() : null;

    return responses.filter((response) => {
      if (!allowed.has(response.requestId)) return false;
      const at = new Date(response.submittedAt).getTime();
      if (fromTime && at < fromTime) return false;
      if (toTime && at > toTime) return false;
      return true;
    });
  }

  /**
   * Splits the filtered responses into what may be shown and what must not.
   *
   * The threshold is applied *per form*, not to the total, because that is the
   * unit an author can be identified within — receipts are per form. Pooling a
   * thin form into a larger total would not protect it either, since the
   * feedback-ID filter can isolate it again in one click.
   */
  function partition(rows) {
    const countByRequest = new Map();
    for (const response of rows) {
      countByRequest.set(response.requestId, (countByRequest.get(response.requestId) || 0) + 1);
    }

    const withheld = [];
    const blocked = new Set();
    for (const [requestId, count] of countByRequest) {
      const request = requestsById.get(requestId);
      // Attributed feedback carries names already; withholding buys nothing.
      if (!request?.anonymous) continue;
      if (count >= PRIVACY.minResponsesToShow) continue;
      blocked.add(requestId);
      withheld.push({ request, count });
    }

    return {
      visible: rows.filter((r) => !blocked.has(r.requestId)),
      withheld: withheld.sort((a, b) => b.count - a.count),
    };
  }

  function draw() {
    const all = filtered();
    const inScope = matchingRequests();
    const { visible, withheld } = partition(all);
    remount(results);

    if (!requests.length) {
      mount(results, emptyState({
        iconName: 'chart',
        title: 'No feedback has been created yet',
        message: 'Use Create Feedback to issue your first form.',
        action: el('button', { type: 'button', class: 'btn btn--primary', onclick: () => navigate('/instructor/create/new') },
          icon('plus'), 'Create feedback'),
      }));
      return;
    }

    if (withheld.length) mount(results, withheldNotice(withheld));

    mount(results, summary(visible));

    if (!visible.length) {
      mount(results, emptyState({
        iconName: withheld.length ? 'lock' : 'filter',
        title: withheld.length ? 'Nothing can be shown yet' : 'No responses in this range',
        message: withheld.length
          ? `Anonymous feedback stays hidden until ${PRIVACY.minResponsesToShow} people have responded.`
          : 'Widen the filters, or check the completion table below.',
      }));
    } else {
      mount(results, scaleStats(visible));
      mount(results, comments(visible));
      mount(results, responseList(visible));
    }
    mount(results, completion(inScope));
  }

  /** Names what is being held back and exactly what would release it. */
  function withheldNotice(withheld) {
    const rows = el('div', { class: 'stack-sm' });
    for (const { request, count } of withheld) {
      const needed = PRIVACY.minResponsesToShow - count;
      mount(rows, el('div', { class: 'row row--between row--wrap' },
        el('div', {},
          el('div', { style: { fontWeight: '550' } },
            request.feedbackId ? `${request.feedbackId} — ${request.title}` : request.title),
          el('div', { class: 'muted' },
            `${pluralize(count, 'response')} so far · ${needed} more ${needed === 1 ? 'releases' : 'release'} the results`)),
        badge('Withheld', 'warn', 'lock')));
    }

    return notice('warn', `Results withheld for ${pluralize(withheld.length, 'form')}`,
      el('p', {}, 'With this few responses, a single answer can be traced back to its author by '
        + 'elimination against the completion list. These forms are excluded from the statistics, '
        + 'comments and individual responses below — the counts stay visible so you can still chase '
        + 'the people who owe feedback.'),
      el('div', { style: { marginTop: 'var(--sp-3)' } }, rows));
  }

  /* ---------------- panels ---------------- */

  function summary(rows) {
    const scopeAnchors = anchorsInScope(rows, formsById);
    // Count the forms actually represented here, not everything the filters
    // matched — withheld forms contribute nothing to these numbers, so
    // including them in the caption would overstate what is being shown.
    const formsShown = new Set(rows.map((r) => r.requestId)).size;
    const values = rows.flatMap((r) => Object.values(r.answers || {}).filter((v) => typeof v === 'number'));
    const stat = (label, value, note) => el('div', { class: 'stat' },
      el('div', { class: 'stat__label' }, label),
      el('div', { class: 'stat__value' }, value),
      note && el('div', { class: 'stat__note' }, note));

    return el('section', {},
      el('h3', { class: 'section-title' }, 'Overview'),
      el('div', { class: 'grid grid--3' },
        stat('Responses', String(rows.length), `across ${pluralize(formsShown, 'form')}`),
        stat('Mean score', values.length ? String(round(mean(values), 2)) : '—',
          values.length ? `closest to "${nearestAnchor(mean(values), scopeAnchors)}"` : 'all rated questions'),
        stat('Median', values.length ? String(round(median(values), 2)) : '—',
          values.length ? `closest to "${nearestAnchor(median(values), scopeAnchors)}"` : ''),
        stat('Spread', values.length > 1 ? `±${round(stdev(values), 2)}` : '—', 'standard deviation')));
  }

  function scaleStats(rows) {
    const buckets = new Map();
    for (const response of rows) {
      const form = formsById.get(response.formId);
      if (!form) continue;
      for (const item of formItems(form)) {
        if (item.type !== 'scale') continue;
        const value = response.answers?.[item.id];
        if (!Number.isFinite(value)) continue;
        const key = `${form.id}::${item.id}`;
        if (!buckets.has(key)) buckets.set(key, { item, form, values: [] });
        buckets.get(key).values.push(value);
      }
    }
    if (!buckets.size) return el('section', {});

    const bars = el('div', { class: 'bars' });
    const body = el('tbody');
    for (const { item, form, values } of buckets.values()) {
      const avg = mean(values);
      const max = Number(item.max ?? 9);
      const word = nearestAnchor(avg, item.anchors);
      mount(bars, el('div', { class: 'bar-row' },
        el('div', { class: 'truncate', title: item.label }, item.label),
        el('div', { class: 'bar-row__track' },
          el('div', { class: 'bar-row__fill', style: { width: `${(avg / max) * 100}%` } })),
        el('div', { class: 'bar-row__val' },
          word ? `${round(avg, 2)} · ${word}` : `${round(avg, 2)} / ${max}`)));
      mount(body, el('tr', {},
        el('td', {}, item.label),
        el('td', { class: 'muted' }, form.name),
        el('td', { class: 'num' }, String(values.length)),
        el('td', { class: 'num' }, String(round(avg, 2))),
        el('td', {}, word || '—'),
        el('td', { class: 'num' }, String(round(median(values), 2))),
        el('td', { class: 'num' }, values.length > 1 ? String(round(stdev(values), 2)) : '—')));
    }

    return el('section', {},
      el('h3', { class: 'section-title' }, 'Rated questions'),
      el('div', { class: 'card stack' }, bars,
        el('div', { class: 'table-wrap', style: { marginTop: 'var(--sp-4)' } },
          el('table', { class: 'table' },
            el('thead', {}, el('tr', {},
              el('th', {}, 'Question'), el('th', {}, 'Form'),
              el('th', { class: 'num' }, 'n'), el('th', { class: 'num' }, 'Mean'),
              el('th', {}, 'Reads as'),
              el('th', { class: 'num' }, 'Median'), el('th', { class: 'num' }, 'Std dev'))),
            body))));
  }

  function comments(rows) {
    const found = [];
    for (const response of rows) {
      const form = formsById.get(response.formId);
      if (!form) continue;
      for (const item of formItems(form)) {
        if (item.type !== 'text') continue;
        const value = response.answers?.[item.id];
        if (value) {
          found.push({
            question: item.label, text: value,
            when: response.submittedAt,
            request: requestsById.get(response.requestId)?.title || '—',
          });
        }
      }
    }
    const section = el('section', {}, el('h3', { class: 'section-title' }, `Written feedback (${found.length})`));
    if (!found.length) {
      mount(section, el('p', { class: 'muted' }, 'No written answers in this range.'));
      return section;
    }
    const list = el('div', { class: 'stack' });
    for (const [question, group] of groupBy(found, (c) => c.question)) {
      const card = el('div', { class: 'card stack-sm' }, el('div', { class: 'eyebrow' }, question));
      for (const comment of group) {
        mount(card, el('blockquote', { class: 'quote' }, comment.text,
          el('footer', {}, `${fmtDate(comment.when)} · ${comment.request}`)));
      }
      mount(list, card);
    }
    mount(section, list);
    return section;
  }

  function responseList(rows) {
    const list = el('div', { class: 'list' });
    for (const response of [...rows].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))) {
      const request = requestsById.get(response.requestId);
      mount(list, el('button', {
        type: 'button', class: 'list__item',
        onclick: () => openResponse(response, request),
      },
        el('span', { class: 'list__main' },
          el('span', { class: 'list__title', style: { display: 'block' } },
            request?.title || 'Deleted form'),
          el('span', { class: 'list__meta', style: { display: 'block' } },
            request?.feedbackId ? `${request.feedbackId} · ` : '',
            response.anonymous ? 'Anonymous' : (response.respondent?.name || 'Unnamed'),
            ' · ', fmtDateTime(response.submittedAt))),
        icon('chevronRight', { cls: 'list__chev' })));
    }
    return el('section', {},
      el('h3', { class: 'section-title' }, `Individual responses (${rows.length})`), list);
  }

  /** Who has and has not submitted — from receipts, never from the answers. */
  function completion(inScope) {
    const section = el('section', {},
      el('h3', { class: 'section-title' }, 'Completion'),
      el('p', { class: 'muted' },
        'Built from submission receipts, which are stored separately from the answers — '
        + 'so this works even for anonymous feedback.'));

    const host2 = el('div', {}, spinner('Checking receipts…'));
    mount(section, host2);

    (async () => {
      const cards = el('div', { class: 'stack' });
      for (const request of inScope.slice(0, 25)) {
        const receipts = await db.listReceipts(request.id);
        const submitted = new Set(receipts.map((r) => r.username));
        const targeted = request.assignedUsernames?.length
          ? students.filter((s) => request.assignedUsernames.includes(s.username))
          : students.filter((s) => !request.asClass || !s.asClass || s.asClass === request.asClass);
        const outstanding = targeted.filter((s) => !submitted.has(s.username));
        const pct = targeted.length ? Math.round((submitted.size / targeted.length) * 100) : 0;

        const held = request.anonymous && submitted.size > 0
          && submitted.size < PRIVACY.minResponsesToShow;

        mount(cards, el('div', { class: 'card stack-sm' },
          el('div', { class: 'row row--between row--wrap' },
            el('div', {},
              el('div', { style: { fontWeight: '570' } },
                request.feedbackId ? `${request.feedbackId} — ${request.title}` : request.title),
              el('div', { class: 'muted' },
                `${submitted.size} of ${targeted.length} submitted`)),
            el('div', { class: 'row row--wrap' },
              held && badge('Results withheld', 'warn', 'lock'),
              badge(`${pct}%`, pct >= 80 ? 'ok' : pct >= 40 ? 'warn' : 'danger',
                pct >= 80 ? 'checkCircle' : 'clock'))),
          el('div', { class: 'meter' }, el('div', { class: 'meter__fill', style: { width: `${pct}%` } })),
          outstanding.length
            ? el('details', {},
              el('summary', { class: 'muted' }, `${pluralize(outstanding.length, 'student')} outstanding`),
              el('div', { class: 'row row--wrap', style: { marginTop: 'var(--sp-2)' } },
                ...outstanding.map((s) => el('span', { class: 'chip' }, s.name,
                  el('span', { class: 'mono faint' }, s.username)))))
            : el('div', { class: 'muted' }, 'Everyone targeted has responded.')));
      }
      remount(host2, cards.childNodes.length ? cards
        : el('p', { class: 'muted' }, 'No forms match these filters.'));
    })();

    return section;
  }

  async function openResponse(response, request) {
    const form = formsById.get(response.formId);
    const choice = await modal({
      title: request?.title || 'Response',
      body: el('div', { class: 'stack' },
        el('div', { class: 'row row--wrap' },
          request?.feedbackId && badge(request.feedbackId, 'info'),
          badge(response.anonymous ? 'Anonymous' : (response.respondent?.name || 'Unnamed'),
            response.anonymous ? 'neutral' : 'info', response.anonymous ? 'eye' : 'users'),
          badge(fmtDateTime(response.submittedAt), 'neutral', 'clock')),
        form
          ? renderForm(form, { values: response.answers, readonly: true, namespace: `v-${response.id}` })
          : notice('warn', 'Form definition missing',
            el('pre', { class: 'tree' }, JSON.stringify(response.answers, null, 2)))),
      actions: [
        { label: 'Delete', value: 'delete', variant: 'danger' },
        { label: 'Close', value: 'close', autofocus: true },
      ],
    });
    if (choice !== 'delete') return;
    if (!(await confirmDialog('Delete this response?', 'This cannot be undone.',
      { confirmLabel: 'Delete', danger: true }))) return;
    await db.deleteResponse(response.requestId, response.id);
    toast('Response deleted.', 'ok');
    navigate('/instructor?tab=analysis');
  }

  function exportRows() {
    // Export is a disclosure too — it obeys the same threshold, otherwise it
    // would simply be the way around it.
    const { visible: rows, withheld } = partition(filtered());
    if (withheld.length) {
      toast(`${pluralize(withheld.length, 'form')} withheld from the export — too few responses.`,
        'warn', 6000);
    }
    if (!rows.length) return toast('Nothing to export.', 'warn');
    const questionIds = new Set();
    rows.forEach((r) => Object.keys(r.answers || {}).forEach((k) => questionIds.add(k)));

    const itemFor = (id) => {
      for (const form of forms) {
        const item = formItems(form).find((q) => q.id === id);
        if (item) return item;
      }
      return null;
    };
    const labelFor = (id) => itemFor(id)?.label || id;

    download(`feedback-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, [
      { key: 'feedbackId', label: 'Feedback ID', get: (r) => requestsById.get(r.requestId)?.feedbackId || '' },
      { key: 'event', label: 'Class / event', get: (r) => requestsById.get(r.requestId)?.title || '' },
      { key: 'asClass', label: 'AS level', get: (r) => r.asClass || '' },
      { key: 'submittedAt', label: 'Submitted', get: (r) => r.submittedAt },
      { key: 'who', label: 'Respondent', get: (r) => (r.anonymous ? 'anonymous' : r.respondent?.name || '') },
      // Both columns: the number for a spreadsheet, the word for a human.
      ...[...questionIds].flatMap((id) => {
        const item = itemFor(id);
        const base = {
          key: id, label: labelFor(id),
          get: (r) => (Array.isArray(r.answers?.[id]) ? r.answers[id].join('; ') : r.answers?.[id] ?? ''),
        };
        if (item?.type !== 'scale' || !item.anchors) return [base];
        return [base, {
          key: `${id}__word`, label: `${labelFor(id)} (rating)`,
          get: (r) => {
            const v = r.answers?.[id];
            return v == null ? '' : (item.anchors[v] ?? item.anchors[String(v)] ?? '');
          },
        }];
      }),
    ]), 'text/csv');
    return toast('CSV exported.', 'ok');
  }

  draw();
}
