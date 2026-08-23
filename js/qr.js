/**
 * A QR encoder, written out rather than depended on.
 *
 * The app precaches every file it needs so it works with no signal, which rules
 * out a CDN script; and `js/` deliberately imports nothing from node_modules, so
 * vendoring a minified library would put fifteen kilobytes of unreadable code
 * into a codebase whose whole character is the opposite. So it is written here.
 *
 * WHAT IS IMPLEMENTED, AND WHAT IS NOT
 *
 * Only the slice this app needs: **byte mode**, **error correction level M**,
 * **versions 1 to 20**. That covers any join link by a wide margin and skips the
 * numeric, alphanumeric and Kanji modes, three of the four correction levels,
 * and half the version tables a general-purpose library carries.
 *
 * Level M tolerates roughly 15% of the code being obscured, which is the right
 * choice for something read off a projector or a held-up phone — a thumb over a
 * corner, a glare patch, a fold.
 *
 * ON GETTING THIS RIGHT
 *
 * The failure mode here is not a crash. It is a code that looks entirely correct
 * and does not scan, discovered in front of a room of cadets. So the unit tests
 * do not check that the output "looks like a QR code": they compare the module
 * matrix bit-for-bit against a reference encoder for a range of inputs. Identical
 * output to a known-good implementation is the only claim worth making.
 *
 * The specification is ISO/IEC 18004. It has not changed in decades, which is
 * why writing to it is a bounded job rather than an open-ended one.
 */

/* ------------------------------------------------------------------ *
 * tables — error correction level M only
 * ------------------------------------------------------------------ */

/**
 * Per version: [ec codewords per block, group 1 blocks, group 1 data codewords,
 * group 2 blocks, group 2 data codewords]. Index 0 is unused so the array can be
 * addressed by version number directly.
 */
const BLOCKS_M = [
  null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37], [26, 4, 43, 1, 44], [30, 1, 50, 4, 51], [22, 6, 36, 2, 37],
  [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46],
  [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
];

/** Row and column centres of the alignment patterns, by version. */
const ALIGNMENT = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
  [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
  [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
  [6, 34, 62, 90],
];

const MAX_VERSION = 20;

/** Level M's two-bit indicator, used in the format information. */
const EC_LEVEL_BITS = 0b00;

/* ------------------------------------------------------------------ *
 * GF(256) — the arithmetic Reed-Solomon runs on
 * ------------------------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // 0x11D is the primitive polynomial the QR specification fixes.
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}());

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Polynomial long division; the remainder is the error-correction block. */
function errorCorrection(data, ecCount) {
  const generator = generatorPoly(ecCount);
  const remainder = new Array(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i++) {
      remainder[i] ^= gfMul(generator[i + 1], factor);
    }
  }
  return remainder;
}

/* ------------------------------------------------------------------ *
 * encoding
 * ------------------------------------------------------------------ */

/** Total data codewords a version holds at level M. */
function dataCapacity(version) {
  const [, g1Blocks, g1Words, g2Blocks, g2Words] = BLOCKS_M[version];
  return g1Blocks * g1Words + g2Blocks * g2Words;
}

/** Byte mode uses an 8-bit length below version 10 and 16 bits from 10 up. */
const lengthBits = (version) => (version < 10 ? 8 : 16);

function chooseVersion(byteLength) {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const available = dataCapacity(version) * 8 - 4 - lengthBits(version);
    if (byteLength * 8 <= available) return version;
  }
  throw new Error(
    `That is too long for a QR code at this error-correction level (${byteLength} bytes).`);
}

/** Builds the padded, interleaved codeword stream for `bytes`. */
function encodeCodewords(bytes, version) {
  const bits = [];
  const push = (value, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                       // byte mode
  push(bytes.length, lengthBits(version));
  for (const byte of bytes) push(byte, 8);

  const capacityBits = dataCapacity(version) * 8;
  // Terminator: up to four zeros, fewer if the stream is nearly full.
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  }
  // The specification names these two pad bytes explicitly; they alternate.
  const PADS = [0xEC, 0x11];
  while (codewords.length < dataCapacity(version)) {
    codewords.push(PADS[(codewords.length - bits.length / 8) % 2]);
  }

  // --- split into blocks, correct each, then interleave ----------------
  const [ecCount, g1Blocks, g1Words, g2Blocks, g2Words] = BLOCKS_M[version];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;

  for (let i = 0; i < g1Blocks + g2Blocks; i++) {
    const size = i < g1Blocks ? g1Words : g2Words;
    const block = codewords.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(errorCorrection(block, ecCount));
  }

  // Interleaving is what makes the error correction useful: a scratch across
  // the code damages one codeword in many blocks rather than destroying one.
  const out = [];
  const longest = Math.max(g1Words, g2Words || 0);
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecCount; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * BCH bits for the format and version information
 * ------------------------------------------------------------------ */

function bchRemainder(value, generator, degree) {
  let result = value;
  const generatorBits = generator.toString(2).length;
  while (result.toString(2).length > degree) {
    result ^= generator << (result.toString(2).length - generatorBits);
  }
  return result;
}

function formatBits(mask) {
  const data = (EC_LEVEL_BITS << 3) | mask;
  const bch = bchRemainder(data << 10, 0b10100110111, 10);
  return ((data << 10) | bch) ^ 0b101010000010010;
}

function versionBits(version) {
  const bch = bchRemainder(version << 12, 0b1111100100101, 12);
  return (version << 12) | bch;
}

/* ------------------------------------------------------------------ *
 * the matrix
 * ------------------------------------------------------------------ */

/** Remainder bits appended after the codeword stream, by version. */
function remainderBits(version) {
  if (version === 1) return 0;
  if (version <= 6) return 7;
  if (version <= 13) return 0;
  return 3;   // versions 14-20; the higher bands are not supported here
}

function blankGrid(size, value) {
  return Array.from({ length: size }, () => new Array(size).fill(value));
}

/**
 * Lays out one version's function patterns, data, mask and format bits.
 *
 * @returns {{size: number, modules: boolean[][]}}
 */
function buildMatrix(codewords, version, forcedMask = null) {
  const size = version * 4 + 17;
  const modules = blankGrid(size, false);
  const reserved = blankGrid(size, false);

  const set = (row, col, dark) => {
    modules[row][col] = dark;
    reserved[row][col] = true;
  };

  // --- finder patterns and their separators ---------------------------
  const finder = (top, left) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(row, col, inRing || inCore);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // --- timing patterns -------------------------------------------------
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // --- alignment patterns ----------------------------------------------
  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const col of centres) {
      // Skipped where they would collide with a finder pattern.
      if ((row <= 8 && col <= 8)
        || (row <= 8 && col >= size - 9)
        || (row >= size - 9 && col <= 8)) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          set(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }

  // --- the module that is always dark, and the reserved format areas ---
  set(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const row = Math.floor(i / 3);
      const col = size - 11 + (i % 3);
      reserved[row][col] = true;
      reserved[col][row] = true;
    }
  }

  // --- the data, in an upward-then-downward zigzag ---------------------
  const bits = [];
  for (const word of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((word >> i) & 1);
  }
  for (let i = 0; i < remainderBits(version); i++) bits.push(0);

  let index = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;      // the vertical timing pattern is not a data column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        modules[row][c] = index < bits.length ? bits[index] === 1 : false;
        index++;
      }
    }
    upward = !upward;
  }

  // --- choose the mask that scans best ---------------------------------
  // The specification leaves room here, and implementations differ over whether
  // the format bits are present while scoring. That only shifts which of eight
  // valid masks is chosen, never whether the result scans — so the tests pin
  // every mask explicitly rather than asserting one particular choice.
  const candidates = forcedMask === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forcedMask];
  let best = null;
  for (const mask of candidates) {
    const candidate = applyMask(modules, reserved, size, mask);
    writeFormat(candidate, size, mask);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, modules: candidate, mask };
  }

  return { size, modules: best.modules, mask: best.mask, version };
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(modules, reserved, size, mask) {
  const out = modules.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (MASKS[mask](r, c)) out[r][c] = !out[r][c];
    }
  }
  return out;
}

/**
 * Writes the 15 format bits into their two copies.
 *
 * Bit 0 is the least significant, and it goes at the *top* of the vertical strip
 * beside the top-left finder — not at the start of the horizontal one. Getting
 * that backwards writes a valid-looking format field in reverse, which is
 * exactly the kind of error that produces a code no scanner will read.
 */
function writeFormat(modules, size, mask) {
  const bits = formatBits(mask);
  const bit = (i) => ((bits >> i) & 1) === 1;

  // First copy: down the column beside the top-left finder, then left along the row.
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) modules[8][14 - i] = bit(i);

  // Second copy: along the bottom of the top-right finder, then up beside the
  // bottom-left one.
  for (let i = 0; i <= 7; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) modules[size - 15 + i][8] = bit(i);
}

function writeVersion(modules, size, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = size - 11 + (i % 3);
    modules[row][col] = dark;
    modules[col][row] = dark;
  }
}

/**
 * The four penalty rules, which decide which mask is used.
 *
 * They exist to avoid patterns a scanner might mistake for a finder pattern, and
 * to keep light and dark roughly balanced. Lower is better.
 */
function penalty(modules, size) {
  let score = 0;

  // Rule 1 — runs of five or more of the same colour.
  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };
  for (let i = 0; i < size; i++) {
    score += runScore(modules[i]);
    score += runScore(modules.map((row) => row[i]));
  }

  // Rule 2 — every 2x2 block of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (modules[r][c + 1] === v && modules[r + 1][c] === v && modules[r + 1][c + 1] === v) {
        score += 3;
      }
    }
  }

  // Rule 3 — the finder-like sequence, in either orientation.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line, at, pattern) => pattern.every((v, i) => line[at + i] === v);
  for (let i = 0; i < size; i++) {
    const row = modules[i];
    const col = modules.map((r) => r[i]);
    for (let j = 0; j + 11 <= size; j++) {
      if (matches(row, j, A) || matches(row, j, B)) score += 40;
      if (matches(col, j, A) || matches(col, j, B)) score += 40;
    }
  }

  // Rule 4 — imbalance between light and dark.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ------------------------------------------------------------------ *
 * public API
 * ------------------------------------------------------------------ */

/**
 * Encodes text as a QR matrix.
 *
 * @param {string} text
 * @param {{mask?: number}} [options] force a mask instead of choosing one; used
 *        by the tests to compare every mask against a reference encoder.
 * @returns {{size: number, modules: boolean[][], version: number, mask: number}}
 *          `modules[row][col]` is true where the module is dark.
 */
export function encodeQr(text, { mask = null } = {}) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  if (!bytes.length) throw new Error('There is nothing to encode.');

  const version = chooseVersion(bytes.length);
  const codewords = encodeCodewords(bytes, version);
  const result = buildMatrix(codewords, version, mask);
  writeVersion(result.modules, result.size, version);
  return result;
}

/**
 * Renders text as an SVG QR code.
 *
 * SVG rather than canvas so it stays sharp at any size — the same code has to
 * fill a phone held up across a desk and a projector at the back of a room.
 *
 * The four-module quiet zone is not decoration: scanners use it to find the
 * code's edges, and codes fail to scan without it far more often than anything
 * else. Colours are absolute black and white rather than theme tokens for the
 * same reason — contrast is a scanning requirement, so a dark-mode QR code would
 * be a broken one.
 *
 * @param {string} text
 * @param {{title?: string}} [options]
 * @returns {SVGElement}
 */
export function renderQrSvg(text, { title = 'QR code' } = {}) {
  const { size, modules } = encodeQr(text);
  const QUIET = 4;
  const total = size + QUIET * 2;
  const NS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-label', title);

  const background = document.createElementNS(NS, 'rect');
  background.setAttribute('width', String(total));
  background.setAttribute('height', String(total));
  background.setAttribute('fill', '#ffffff');
  svg.append(background);

  // One path for every dark module rather than thousands of rects: fewer nodes,
  // and it renders without hairline seams between neighbours.
  const parts = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) parts.push(`M${c + QUIET} ${r + QUIET}h1v1h-1z`);
    }
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', parts.join(''));
  path.setAttribute('fill', '#000000');
  svg.append(path);

  return svg;
}
