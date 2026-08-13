/**
 * Form template renderer + answer collection.
 *
 * A form template is data, not code, so cadre can add or reorder questions
 * without touching the app. Both the student fill-out screen and the cadre
 * preview/response viewer render through here.
 */

import { el, makeId, mount, remount } from './util.js';
import { SCALE_ANCHORS } from './config.js';

/**
 * Renders every section of `form` into a fragment.
 * @param {object} form
 * @param {{values?: object, readonly?: boolean, namespace?: string}} options
 */
export function renderForm(form, { values = {}, readonly = false, namespace = null } = {}) {
  const ns = namespace || makeId('form');
  const frag = document.createDocumentFragment();

  for (const section of form.sections || []) {
    const fieldset = el('fieldset', { class: 'formset' },
      el('legend', { class: 'formset__legend' }, section.title || ''),
      section.description && el('p', { class: 'formset__desc' }, section.description));

    for (const item of section.items || []) {
      mount(fieldset, renderQuestion(item, { value: values[item.id], readonly, ns }));
    }
    mount(frag, fieldset);
  }
  return frag;
}

function renderQuestion(item, { value, readonly, ns }) {
  const wrap = el('div', { class: 'q', dataset: { qid: item.id, qtype: item.type } });
  const labelId = `${ns}-${item.id}-label`;

  mount(wrap, 
    el('div', { class: 'q__label', id: labelId },
      item.label,
      item.required && !readonly && el('span', { class: 'field__req', 'aria-hidden': 'true' }, '*')),
    item.help && el('div', { class: 'q__help' }, item.help));

  const control = readonly
    ? renderAnswer(item, value)
    : buildControl(item, { value, ns, labelId });
  mount(wrap, control);

  const error = el('div', { class: 'field__error', hidden: true, dataset: { errorFor: item.id } });
  if (!readonly) mount(wrap, error);
  return wrap;
}

function buildControl(item, { value, ns, labelId }) {
  const name = `${ns}-${item.id}`;

  switch (item.type) {
    case 'scale': {
      const min = Number(item.min ?? 1);
      const max = Number(item.max ?? 5);
      // Anchors name the odd points. Each anchor is announced to screen readers
      // as part of the option's label, so the meaning is not carried by the
      // small print alone.
      const anchors = item.anchors || (max >= 9 ? SCALE_ANCHORS : {});
      const group = el('div', { class: 'scale scale--anchored', role: 'radiogroup', 'aria-labelledby': labelId });

      for (let n = min; n <= max; n++) {
        const id = `${name}-${n}`;
        const anchor = anchors[n] || anchors[String(n)];
        mount(group, el('label', {
          class: 'scale__opt', for: id, title: anchor || undefined,
        },
          el('input', {
            type: 'radio', id, name, value: String(n), checked: Number(value) === n,
            'aria-label': anchor ? `${n} — ${anchor}` : String(n),
          }),
          el('span', {}, String(n)),
          anchor && el('span', { class: 'scale__anchor' }, anchor)));
      }

      return el('div', {}, group,
        (item.minLabel || item.maxLabel) && el('div', { class: 'scale__ends' },
          el('span', {}, item.minLabel || ''), el('span', {}, item.maxLabel || '')));
    }

    case 'choice': {
      const group = el('div', { class: 'opts', role: 'radiogroup', 'aria-labelledby': labelId });
      for (const option of item.options || []) {
        const opt = typeof option === 'string' ? { value: option, label: option } : option;
        const id = `${name}-${slug(opt.value)}`;
        mount(group, el('label', { class: 'opt', for: id },
          el('input', { type: 'radio', id, name, value: opt.value, checked: value === opt.value }),
          el('span', {}, opt.label)));
      }
      return group;
    }

    case 'multi': {
      const group = el('div', { class: 'opts', role: 'group', 'aria-labelledby': labelId });
      const selected = Array.isArray(value) ? value : [];
      for (const option of item.options || []) {
        const opt = typeof option === 'string' ? { value: option, label: option } : option;
        const id = `${name}-${slug(opt.value)}`;
        mount(group, el('label', { class: 'opt', for: id },
          el('input', { type: 'checkbox', id, name, value: opt.value, checked: selected.includes(opt.value) }),
          el('span', {}, opt.label)));
      }
      return group;
    }

    case 'boolean': {
      const group = el('div', { class: 'opts', role: 'radiogroup', 'aria-labelledby': labelId });
      for (const opt of [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]) {
        const id = `${name}-${opt.value}`;
        mount(group, el('label', { class: 'opt', for: id },
          el('input', { type: 'radio', id, name, value: opt.value, checked: value === opt.value }),
          el('span', {}, opt.label)));
      }
      return group;
    }

    default: {
      const node = el('textarea', {
        class: 'textarea', name, rows: String(item.rows || 3),
        placeholder: item.placeholder || '',
        maxlength: item.maxLength ? String(item.maxLength) : null,
        'aria-labelledby': labelId,
      });
      node.value = value ?? '';
      return node;
    }
  }
}

/** Read-only rendering of a stored answer, used by the response viewer. */
function renderAnswer(item, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) {
    return el('div', { class: 'faint' }, 'No answer');
  }
  if (item.type === 'scale') {
    const max = Number(item.max ?? 5);
    const anchors = item.anchors || (max >= 9 ? SCALE_ANCHORS : {});
    const anchor = anchors[value] || anchors[String(value)];
    return el('div', { class: 'row row--wrap' },
      el('strong', {}, `${value}`), el('span', { class: 'muted' }, `/ ${max}`),
      anchor && el('span', { class: 'chip' }, anchor),
      el('div', { class: 'meter', style: { flex: '1', minWidth: '6rem', maxWidth: '10rem' } },
        el('div', { class: 'meter__fill', style: { width: `${(Number(value) / max) * 100}%` } })));
  }
  if (item.type === 'multi') return el('div', {}, value.join(', '));
  if (item.type === 'boolean') return el('div', {}, value === 'yes' ? 'Yes' : 'No');
  return el('div', { style: { whiteSpace: 'pre-wrap' } }, String(value));
}

/**
 * Pulls answers back out of a rendered form.
 * @returns {{values: object, missing: string[]}}
 */
export function collectAnswers(form, container) {
  const values = {};
  const missing = [];

  for (const section of form.sections || []) {
    for (const item of section.items || []) {
      const scope = container.querySelector(`[data-qid="${cssEscape(item.id)}"]`);
      if (!scope) continue;
      let value;

      if (item.type === 'multi') {
        value = Array.from(scope.querySelectorAll('input:checked')).map((i) => i.value);
        if (!value.length) value = undefined;
      } else if (item.type === 'text') {
        value = scope.querySelector('textarea')?.value.trim() || undefined;
      } else {
        value = scope.querySelector('input:checked')?.value;
        if (value !== undefined && item.type === 'scale') value = Number(value);
      }

      if (value === undefined) {
        if (item.required) missing.push(item.id);
      } else {
        values[item.id] = value;
      }
    }
  }
  return { values, missing };
}

/** Shows/clears inline "required" messages and focuses the first offender. */
export function showMissing(container, missing) {
  for (const node of container.querySelectorAll('[data-error-for]')) {
    node.hidden = true;
    node.textContent = '';
  }
  for (const id of missing) {
    const node = container.querySelector(`[data-error-for="${cssEscape(id)}"]`);
    if (node) {
      node.textContent = 'This question is required.';
      node.hidden = false;
    }
  }
  if (missing.length) {
    const first = container.querySelector(`[data-qid="${cssEscape(missing[0])}"]`);
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.querySelector('input, textarea')?.focus({ preventScroll: true });
  }
}

/** Flattens a form's questions into a single ordered list. */
export function formItems(form) {
  return (form?.sections || []).flatMap((section) =>
    (section.items || []).map((item) => ({ ...item, sectionTitle: section.title })));
}

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const cssEscape = (value) => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));
