/**
 * Unit checks for the QR encoder.
 *
 *     npm run test:unit
 *
 * A wrong QR code does not throw. It renders, it looks entirely correct, and no
 * phone will read it — which you find out standing in front of a room. So these
 * are not "does it look like a QR code" checks.
 *
 * Every vector below is a SHA-256 of the module matrix produced by
 * **python-qrcode**, a widely deployed independent implementation, for the same
 * input at the same forced mask. Ten inputs across versions 1 to 19, each at all
 * eight masks: 80 matrices that must match bit for bit. Between them they
 * exercise encoding, padding, Reed-Solomon over GF(256), block interleaving,
 * function pattern placement, the data zigzag, all eight mask functions, and the
 * format and version information.
 *
 * Masks are forced rather than chosen. Mask *selection* legitimately differs
 * between implementations — the specification leaves room over whether the
 * format bits are present while scoring — and that only changes which of eight
 * valid codes you get, never whether it scans. Pinning selection to one library
 * would test conformity to that library rather than correctness.
 *
 * Regenerate with tools/qr/reference.py if a vector ever needs to change, and
 * be suspicious if one does: this is a frozen 30-year-old standard.
 */

import { createHash } from 'node:crypto';
import { encodeQr } from '../../js/qr.js';

const VECTORS = [
  {
    text: "A",
    version: 1, size: 21,
    digests: ['3f594cfc1843904d', 'b13656d3f3aedff5', 'e7897faf8824acb3', '2092585037e9da56', '8e0f600c0a22ae37', '508b70347f197279', '59df51b0ccc995ff', '54c30e10497d65da'],
  },
  {
    text: "hello world",
    version: 1, size: 21,
    digests: ['ff11d03a5d4c7271', '3bec4e05833fef70', 'bbd25299f2a71918', '25d221ad5876bbf6', 'f042e0bd80d4a5c4', '1c29d348705db6b9', 'd2bddde80f3088bd', 'dc4b0e2d047c3e4b'],
  },
  {
    text: "https://example.org/",
    version: 2, size: 25,
    digests: ['703384ad7cc7b967', '477e98e614a6fca3', 'fcbe155b3e1bf4aa', '3a82fdf9d2bfa37c', 'e0dfad36fe2bf4c3', '08cc066942eb3c97', 'd68672704f51bab3', '31df5c5fe1e67db1'],
  },
  {
    text: "https://dmg-arts.github.io/9thirtyone/#/join?c=724504040762-rrq3q51dip6rib0g8lof5pq5r6da2g03&f=1Te9Pc7JgOSUluq3tc0FCK4IqbKm1MTIM&n=Det+025",
    version: 8, size: 49,
    digests: ['5aa5a63e565340ef', 'd92c82f988d8ca58', '76d85bed51528c34', '9d58aa8e81b8c62a', '10e8f2535d16443d', 'd7b32fa54a428e74', 'fb3a552197e04187', '6f9e30af86964aeb'],
  },
  {
    text: "Det 025 \u2014 Wilkes & Misericordia",
    version: 3, size: 29,
    digests: ['fdc6ee9e40edcd5c', 'df89a66181a4213e', '24d2f614971d51b4', 'b7006ef7295500fe', '39b82edc6ea34121', '0cafebbed8706501', 'de1d4f79ad0890a4', 'f157eefae87a7b36'],
  },
  {
    text: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    version: 6, size: 41,
    digests: ['3b1cbac996b5a950', 'b2fed17f60f379c4', 'afcc1699fad47e0e', '4b072c2a5685090e', '7dadc2326a0161ad', '93713b3b57e4ff37', '365e54874882211d', 'c735a07bd1f3611a'],
  },
  {
    text: "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    version: 13, size: 69,
    digests: ['95e60ee8955ccc08', 'f2d310650251a055', '4d5f936502b7e79f', '50593ce6eaa0835b', 'c40616d502245ba7', 'f8e88b9164e66a1d', 'cccec23eb0753219', 'b99c399ad57e3a63'],
  },
  {
    text: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    version: 19, size: 93,
    digests: ['3289d30865636f23', 'a84a1d59f5a7e55d', '6dbcd8069268226b', '91d9a252df446cd9', 'f041ca8fc5bf0c08', '45ad39334535a1b5', 'e73538cfc1261beb', 'bc63c846ef5c67d3'],
  },
  {
    text: "012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789",
    version: 7, size: 45,
    digests: ['7f8df8badb5e81ae', '240efdd56e167d3e', 'ed7b5fe5864d742a', '11267572ee7cbc42', '14702148d62ed2c2', '880820d41b67af6c', 'eabbffcc69a00ef8', '30092d9c7d80d76d'],
  },
  {
    text: "~!@#$%^&*()_+`-={}|[]\\:\";'<>?,./",
    version: 3, size: 29,
    digests: ['4a2b23f7818dec1c', '0f781511c11cf25d', 'a22960fdac21bbc8', '53c5f1ba189e6ac7', 'e56257bf69dd9996', '8ce54229a334432d', '48bacadefacbbb2c', 'c26d93f4367d9dc0'],
  },
];

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (err) { console.log(`  FAIL ${label}: ${err.message}`); failures++; }
};

const digestOf = (modules) => createHash('sha256')
  .update(modules.map((row) => row.map((v) => (v ? '1' : '0')).join('')).join(''))
  .digest('hex')
  .slice(0, 16);

const label = (text) => (text.length > 26 ? `${text.slice(0, 23)}…` : text);

/* ---------- the reference comparison ---------- */

for (const vector of VECTORS) {
  check(`v${vector.version} matches the reference at all 8 masks — ${label(vector.text)}`, () => {
    for (let mask = 0; mask < 8; mask++) {
      const result = encodeQr(vector.text, { mask });
      if (result.version !== vector.version) {
        throw new Error(`mask ${mask}: version ${result.version}, expected ${vector.version}`);
      }
      if (result.size !== vector.size) {
        throw new Error(`mask ${mask}: size ${result.size}, expected ${vector.size}`);
      }
      const got = digestOf(result.modules);
      if (got !== vector.digests[mask]) {
        throw new Error(`mask ${mask}: digest ${got}, expected ${vector.digests[mask]}`);
      }
    }
  });
}

/* ---------- structural invariants a scanner depends on ---------- */

check('the three finder patterns are present and correctly formed', () => {
  const { modules, size } = encodeQr('https://example.org/');
  // 1:1:3:1:1 — a dark 7x7 ring with a dark 3x3 core, separated by light.
  const finderAt = (top, left) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (modules[top + r][left + c] !== (ring || core)) return false;
      }
    }
    return true;
  };
  if (!finderAt(0, 0)) throw new Error('top-left finder is malformed');
  if (!finderAt(0, size - 7)) throw new Error('top-right finder is malformed');
  if (!finderAt(size - 7, 0)) throw new Error('bottom-left finder is malformed');
});

check('the timing patterns alternate', () => {
  const { modules, size } = encodeQr('https://example.org/');
  for (let i = 8; i < size - 8; i++) {
    if (modules[6][i] !== (i % 2 === 0)) throw new Error(`horizontal timing breaks at ${i}`);
    if (modules[i][6] !== (i % 2 === 0)) throw new Error(`vertical timing breaks at ${i}`);
  }
});

check('the always-dark module is dark', () => {
  const { modules, size } = encodeQr('hello world');
  if (!modules[size - 8][8]) throw new Error('the dark module is light');
});

check('size follows the version', () => {
  for (const text of ['A', 'x'.repeat(100), 'z'.repeat(600)]) {
    const { size, version } = encodeQr(text);
    if (size !== version * 4 + 17) throw new Error(`v${version} produced ${size}`);
  }
});

/* ---------- selection and refusals ---------- */

check('an unforced encode picks a mask in range', () => {
  const { mask } = encodeQr('https://example.org/');
  if (!(mask >= 0 && mask <= 7)) throw new Error(`chose mask ${mask}`);
});

check('mask selection is deterministic', () => {
  // Same input must always produce the same code; an unstable choice would mean
  // a reprinted invitation silently differs from the one on the wall.
  const first = encodeQr('https://example.org/').mask;
  for (let i = 0; i < 5; i++) {
    if (encodeQr('https://example.org/').mask !== first) throw new Error('selection varies');
  }
});

check('multi-byte characters are encoded as UTF-8, not dropped', () => {
  const plain = encodeQr('Det 025 - Wilkes', { mask: 0 });
  const accented = encodeQr('Det 025 — Wilkes', { mask: 0 });
  if (digestOf(plain.modules) === digestOf(accented.modules)) {
    throw new Error('an em dash produced an identical code');
  }
});

check('empty input is refused rather than encoded as nothing', () => {
  let message = 'NO ERROR';
  try { encodeQr(''); } catch (e) { message = e.message; }
  if (!/nothing to encode/i.test(message)) throw new Error(`message was: ${message}`);
});

check('input beyond the supported versions is refused with the length', () => {
  let message = 'NO ERROR';
  try { encodeQr('x'.repeat(5000)); } catch (e) { message = e.message; }
  if (!/too long/i.test(message)) throw new Error(`message was: ${message}`);
});

check('a real join link fits well inside the supported range', () => {
  const link = 'https://dmg-arts.github.io/9thirtyone/#/join'
    + '?c=724504040762-rrq3q51dip6rib0g8lof5pq5r6da2g03'
    + '&f=1Te9Pc7JgOSUluq3tc0FCK4IqbKm1MTIM'
    + '&p=AKfycbwEXAMPLEdeploymentid0123456789&n=Det+025';
  const { version } = encodeQr(link);
  // Past about v12 the modules get too fine to scan comfortably off a projector.
  if (version > 12) throw new Error(`a join link needs v${version}`);
});

console.log(failures ? `\n${failures} QR check(s) failed.` : '\nAll QR checks passed.');
process.exit(failures ? 1 : 0);
