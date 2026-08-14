/**
 * Language data for the text analysis.
 *
 * Everything here runs in the browser. Feedback never leaves the detachment's
 * own Drive, so no sentiment API, no cloud NLP, no telemetry — which rules out
 * a large model and makes a curated lexicon the honest choice. The trade is
 * accuracy: a lexicon reads words, not meaning. Treat every output as a
 * pointer to read the response yourself, never as a verdict.
 *
 * All three lists are meant to be edited by the people using them. A
 * detachment's vocabulary is its own.
 */

/* ------------------------------------------------------------------ *
 * Sentiment
 * ------------------------------------------------------------------ */

/**
 * Word -> valence, roughly -5 (worst) to +5 (best), in the AFINN tradition.
 * Weighted toward the vocabulary that actually appears in course and leadership
 * feedback rather than general web text.
 */
export const SENTIMENT = {
  // --- strong positive ---
  outstanding: 4, excellent: 4, exceptional: 4, superb: 4, brilliant: 4,
  fantastic: 4, phenomenal: 4, inspiring: 4, inspirational: 4, invaluable: 4,
  best: 3, great: 3, wonderful: 3, terrific: 3, impressive: 3, exemplary: 3,
  professional: 3, knowledgeable: 3, dedicated: 3, motivating: 3, engaging: 3,
  approachable: 3, supportive: 3, thorough: 3, organized: 3, organised: 3,
  prepared: 3, effective: 3, valuable: 3, respectful: 3, fair: 3, patient: 3,

  // --- moderate positive ---
  good: 2, strong: 2, solid: 2, clear: 2, helpful: 2, useful: 2, positive: 2,
  confident: 2, competent: 2, consistent: 2, thoughtful: 2, encouraging: 2,
  enjoyed: 2, enjoy: 2, appreciate: 2, appreciated: 2, improved: 2, improving: 2,
  benefit: 2, beneficial: 2, succeeded: 2, success: 2, successful: 2,
  recommend: 2, learned: 2, learning: 2, growth: 2, progress: 2, rewarding: 2,
  accessible: 2, responsive: 2, punctual: 2, disciplined: 2, capable: 2,

  // --- mild positive ---
  fine: 1, okay: 1, ok: 1, adequate: 1, decent: 1, reasonable: 1, satisfied: 1,
  satisfactory: 1, acceptable: 1, better: 1, nice: 1, like: 1, liked: 1,
  worked: 1, works: 1, willing: 1, open: 1, calm: 1, steady: 1, practical: 1,

  // --- mild negative ---
  slow: -1, dull: -1, dry: -1, bland: -1, lacking: -1, lacked: -1, limited: -1,
  minimal: -1, rushed: -1, late: -1, unclear: -1, vague: -1, repetitive: -1,
  boring: -2, bored: -2, confusing: -2, confused: -2, difficult: -2, hard: -2,
  frustrating: -2, frustrated: -2, disappointing: -2, disappointed: -2,
  unprepared: -2, disorganized: -2, disorganised: -2, inconsistent: -2,
  unhelpful: -2, dismissive: -2, distracted: -2, rigid: -2, tedious: -2,
  wasted: -2, waste: -2, pointless: -2, irrelevant: -2, outdated: -2,

  // --- moderate negative ---
  poor: -3, bad: -3, weak: -3, unfair: -3, biased: -3, unprofessional: -3,
  rude: -3, condescending: -3, belittling: -3, demeaning: -3, harsh: -3,
  hostile: -3, aggressive: -3, unapproachable: -3, unresponsive: -3,
  neglected: -3, ignored: -3, disrespectful: -3, incompetent: -3,
  useless: -3, failing: -3, failed: -3, struggled: -3, struggling: -3,
  stressful: -3, overwhelming: -3, overwhelmed: -3, exhausting: -3,

  // --- strong negative ---
  terrible: -4, awful: -4, horrible: -4, appalling: -4, abysmal: -4,
  worst: -4, unacceptable: -4, humiliating: -4, humiliated: -4, degrading: -4,
  abusive: -4, toxic: -4, hostile_environment: -4, discriminatory: -4,
  dangerous: -4, unsafe: -4, negligent: -4, reckless: -4,
};

/** Multipliers applied to the next scored word. */
export const INTENSIFIERS = {
  very: 1.5, extremely: 2, incredibly: 2, really: 1.4, so: 1.3, quite: 1.2,
  particularly: 1.4, especially: 1.4, absolutely: 1.8, completely: 1.7,
  totally: 1.6, highly: 1.5, deeply: 1.6, truly: 1.4, remarkably: 1.7,
  slightly: 0.5, somewhat: 0.6, marginally: 0.5, barely: 0.4, mildly: 0.5,
  occasionally: 0.6, sometimes: 0.7, mostly: 1.1, fairly: 0.8, rather: 0.9,
};

/** Flip the sign of a following score, within a short window. */
export const NEGATORS = new Set([
  'not', 'no', 'never', 'none', 'nobody', 'nothing', 'neither', 'nor',
  'cannot', 'cant', 'wont', 'wouldnt', 'shouldnt', 'couldnt', 'didnt',
  'doesnt', 'dont', 'isnt', 'wasnt', 'arent', 'werent', 'hardly', 'rarely',
  'seldom', 'without', 'lack', 'lacks', 'lacking',
]);

/** Words after which a negation stops applying. */
export const CLAUSE_BREAKS = new Set(['but', 'however', 'although', 'though', 'yet', 'except']);

/* ------------------------------------------------------------------ *
 * Stopwords
 * ------------------------------------------------------------------ */

/**
 * Dropped from the word cloud. Includes the usual function words plus the
 * filler that dominates course feedback and says nothing — "class", "course"
 * and "instructor" appear in almost every response, so leaving them in buries
 * the words that actually differ.
 */
export const STOPWORDS = new Set(`
a about above after again against all am an and any are as at be because been
before being below between both but by can cannot could did do does doing down
during each few for from further had has have having he her here hers herself
him himself his how i if in into is it its itself just me more most my myself
no nor not of off on once only or other our ours ourselves out over own same
she should so some such than that the their theirs them themselves then there
these they this those through to too under until up very was we were what when
where which while who whom why will with would you your yours yourself
yourselves im ive id ill youre youve well get got go going one two also really
much many lot lots thing things stuff way ways time times make makes made
maybe perhaps overall general generally something anything everything nothing
class classes course courses instructor instructors cadet cadets feedback
semester lab labs session sessions block blocks
`.trim().split(/\s+/));

/* ------------------------------------------------------------------ *
 * Safety and security screening
 * ------------------------------------------------------------------ */

/**
 * Phrases that should be read by a human quickly.
 *
 * This is a SCREEN, not a judgement. It finds words; it cannot find meaning,
 * context, sarcasm, quotation, or a cadet describing something that happened to
 * someone else. Every match needs a person to read the surrounding response and
 * decide. Equally, it will miss disclosures phrased in ways no list anticipates
 * — an empty result is not evidence that nothing was reported.
 *
 * `terms` match on word boundaries. `patterns` are regular expressions for
 * phrasings that a single word cannot capture.
 */
export const SAFETY_CATEGORIES = [
  {
    id: 'hazing',
    label: 'Hazing and abuse of authority',
    severity: 'critical',
    note: 'Conduct that degrades or endangers a cadet, or misuse of position.',
    terms: [
      'hazing', 'hazed', 'haze', 'initiation', 'brutalized', 'brutalised',
      'humiliated', 'humiliating', 'humiliation', 'degrading', 'degraded',
      'demeaning', 'belittled', 'belittling', 'tormented', 'ridiculed',
      'singled out', 'made an example', 'punishment detail', 'smoked',
      'abuse of power', 'abused authority', 'retaliation', 'retaliated',
      'blacklisted', 'targeted me', 'picked on',
    ],
    patterns: [
      /\bforced\s+(?:me|us|him|her|them)\s+to\b/i,
      /\bmade\s+(?:me|us|him|her|them)\s+(?:do|stand|hold|run|eat|drink)\b/i,
      /\b(?:physical|verbal)\s+(?:abuse|punishment)\b/i,
    ],
  },
  {
    id: 'sexual',
    label: 'Sexual harassment or assault',
    severity: 'critical',
    note: 'Unwelcome sexual conduct, comments, or contact.',
    terms: [
      'sexual harassment', 'sexually harassed', 'sexual assault', 'assaulted',
      'groped', 'grabbed me', 'touched me', 'inappropriate touching',
      'unwanted advances', 'came on to me', 'propositioned', 'sexual comments',
      'sexual jokes', 'sexually explicit', 'catcalled', 'catcalling',
      'objectified', 'creepy', 'stalking', 'stalked', 'sexted', 'nudes',
      'rape', 'raped', 'molested', 'consent', 'nonconsensual',
    ],
    patterns: [
      /\b(?:made|makes)\s+(?:me|her|him|them)\s+(?:feel\s+)?uncomfortable\b/i,
      /\basked\s+(?:me|her|him)\s+out\s+(?:repeatedly|again)\b/i,
      /\bcomments?\s+about\s+my\s+(?:body|appearance|looks)\b/i,
    ],
  },
  {
    id: 'discrimination',
    label: 'Racism and discrimination',
    severity: 'critical',
    note: 'Bias or hostility based on race, religion, sex, orientation or origin.',
    terms: [
      'racist', 'racism', 'racial slur', 'slur', 'bigot', 'bigoted', 'bigotry',
      'discrimination', 'discriminated', 'discriminatory', 'prejudice',
      'prejudiced', 'segregated', 'xenophobic', 'antisemitic', 'islamophobic',
      'homophobic', 'transphobic', 'sexist', 'sexism', 'misogyny', 'misogynist',
      'ableist', 'stereotyped', 'stereotyping', 'profiling',
      'because of my race', 'because of my religion', 'because i am a woman',
      'because i am gay', 'ethnic', 'skin color', 'skin colour',
    ],
    patterns: [
      /\b(?:treated|treats)\s+(?:me|us|them)\s+differently\s+because\b/i,
      /\bonly\s+(?:the\s+)?(?:white|black|male|female|men|women)\s+cadets\b/i,
      /\bmade\s+(?:a\s+)?(?:joke|comment)s?\s+about\s+my\s+(?:race|religion|accent|country)\b/i,
    ],
  },
  {
    id: 'violence',
    label: 'Violence or threats',
    severity: 'critical',
    note: 'Threatened or actual physical harm, or weapons.',
    terms: [
      'threatened', 'threatening', 'threat', 'violence', 'violent', 'assault',
      'punched', 'hit me', 'shoved', 'pushed me', 'choked', 'strangled',
      'weapon', 'gun', 'knife', 'shoot', 'kill', 'beat me up', 'jumped me',
      'intimidated', 'intimidation',
    ],
    patterns: [
      /\bgoing\s+to\s+(?:hurt|kill|beat|shoot)\b/i,
      /\bafraid\s+(?:for\s+my\s+safety|of\s+(?:him|her|them))\b/i,
    ],
  },
  {
    id: 'selfharm',
    label: 'Self-harm or crisis',
    severity: 'critical',
    note: 'Possible risk to a cadet\'s own safety. Act immediately.',
    terms: [
      'suicide', 'suicidal', 'kill myself', 'end my life', 'self harm',
      'self-harm', 'cutting myself', 'hurt myself', 'want to die',
      'no reason to live', 'hopeless', 'worthless', 'cant go on',
      'breaking point', 'mental breakdown', 'panic attacks', 'depressed',
      'depression', 'anxiety attacks',
    ],
    patterns: [
      /\b(?:dont|do\s+not)\s+want\s+to\s+(?:be\s+here|live|wake\s+up)\b/i,
    ],
  },
  {
    id: 'substance',
    label: 'Substance concerns',
    severity: 'elevated',
    note: 'Alcohol or drug use raised in feedback.',
    terms: [
      'drunk', 'intoxicated', 'alcohol', 'drinking', 'binge', 'hungover',
      'drugs', 'weed', 'marijuana', 'cocaine', 'pills', 'adderall',
      'under the influence', 'dui', 'substance abuse',
    ],
    patterns: [],
  },
  {
    id: 'integrity',
    label: 'Integrity and security',
    severity: 'elevated',
    note: 'Cheating, falsified records, or handling of protected information.',
    terms: [
      'cheating', 'cheated', 'plagiarism', 'plagiarized', 'falsified',
      'falsifying', 'forged', 'lied on', 'covered up', 'cover up',
      'classified', 'opsec', 'operational security', 'leaked', 'unauthorized',
      'fraud', 'stolen', 'theft',
    ],
    patterns: [],
  },
];

export const SEVERITY_ORDER = { critical: 0, elevated: 1 };
