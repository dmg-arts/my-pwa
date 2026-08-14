/**
 * Word cloud, drawn as inline SVG.
 *
 * A cloud is a weak chart — area is hard to compare and position carries no
 * meaning — so it is paired with a ranked table that holds the real numbers.
 * The cloud is for spotting the shape of a term set at a glance; the table is
 * for reading it. Both come from the same data, and the table is what a screen
 * reader gets.
 */

import { el, mount } from '../util.js';

const WIDTH = 720;
const HEIGHT = 380;

/**
 * @param {Array<{term, count, responses}>} terms
 * @param {{onSelect?: (term) => void}} options
 */
export function renderWordCloud(terms, { onSelect = null } = {}) {
  if (!terms.length) return null;

  const max = Math.max(...terms.map((t) => t.responses));
  const min = Math.min(...terms.map((t) => t.responses));
  const span = Math.max(1, max - min);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('class', 'cloud');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Word cloud of ${terms.length} terms. The ranked table below carries the same data.`);

  const placed = [];
  const measure = document.createElementNS('http://www.w3.org/2000/svg', 'text');

  for (const [rank, term] of terms.entries()) {
    // Size by how many people used the word, not how often it appears, so one
    // person repeating themselves cannot dominate.
    const weight = (term.responses - min) / span;
    const size = Math.round(13 + weight * 34);
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    node.textContent = term.term;
    node.setAttribute('font-size', String(size));
    node.setAttribute('font-weight', String(weight > 0.6 ? 650 : 520));
    // Four tiers rather than a continuous ramp: a reader can tell four levels
    // apart, and a continuous scale just looks noisy.
    node.setAttribute('class', `cloud__word cloud__word--t${Math.min(3, Math.floor(weight * 4))}`);
    node.setAttribute('text-anchor', 'middle');
    if (onSelect) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.style.cursor = 'pointer';
      node.addEventListener('click', () => onSelect(term));
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(term); }
      });
    }
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${term.term} — in ${term.responses} response${term.responses === 1 ? '' : 's'}, ${term.count} use${term.count === 1 ? '' : 's'}`;
    node.append(title);

    // Estimate the box: measuring properly needs the node in the document, and
    // 0.58em per character is close enough for a layout with this much slack.
    const width = term.term.length * size * 0.58;
    const height = size * 1.1;
    const spot = findSpot(placed, width, height, rank);
    if (!spot) continue;

    node.setAttribute('x', String(spot.x));
    node.setAttribute('y', String(spot.y + height * 0.32));
    placed.push({ x: spot.x - width / 2, y: spot.y - height / 2, w: width, h: height });
    svg.append(node);
  }
  measure.remove();
  return svg;
}

/** Archimedean spiral out from the centre until the box stops colliding. */
function findSpot(placed, width, height, rank) {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  if (rank === 0) return { x: cx, y: cy };

  for (let step = 0; step < 4000; step++) {
    const angle = step * 0.28;
    const radius = 4 + angle * 2.1;
    const x = cx + radius * Math.cos(angle) * 1.55;   // wider than tall, to fill the box
    const y = cy + radius * Math.sin(angle);
    const box = { x: x - width / 2, y: y - height / 2, w: width, h: height };

    if (box.x < 4 || box.y < 4 || box.x + box.w > WIDTH - 4 || box.y + box.h > HEIGHT - 4) continue;
    if (!placed.some((other) => overlaps(box, other))) return { x, y };
  }
  return null;
}

function overlaps(a, b) {
  const pad = 3;
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x
    || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}

/** The same data as a ranked table — the accessible and precise version. */
export function renderTermTable(terms, { onSelect = null, limit = 25 } = {}) {
  const body = el('tbody');
  for (const term of terms.slice(0, limit)) {
    const label = onSelect
      ? el('button', { type: 'button', class: 'link-btn', onclick: () => onSelect(term) }, term.term)
      : term.term;
    mount(body, el('tr', {},
      el('td', {}, label),
      el('td', { class: 'num' }, String(term.responses)),
      el('td', { class: 'num' }, String(term.count))));
  }
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Term'),
        el('th', { class: 'num' }, 'Responses'),
        el('th', { class: 'num' }, 'Uses'))),
      body));
}
