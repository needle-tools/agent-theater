import { vowelNuclei, type VowelKind } from "./vowels.js";

export type Stress = 0 | 1 | 2;

export interface VowelPhone {
    type: "vowel";
    symbol: string;
    kind: VowelKind;
    /** Diphthongs move toward this second formant target without adding a syllable. */
    glide?: VowelKind;
    stress: Stress;
}

export type ConsonantManner = "stop" | "fricative" | "affricate" | "nasal" | "liquid";

export interface ConsonantPhone {
    type: "consonant";
    symbol: string;
    manner: ConsonantManner;
    voiced: boolean;
}

export type SpeechPhone = VowelPhone | ConsonantPhone;

export interface Pronunciation {
    phones: SpeechPhone[];
    source: "lexicon" | "rules" | "script";
}

/*
 * Compact ARPAbet exception lexicon for frequent English words whose spelling
 * rules are especially misleading. A full CMUdict payload is several MB and
 * unnecessary for this deliberately speech-like (not intelligible) synth.
 */
const LEXICON: Readonly<Record<string, string>> = Object.freeze({
    a: "AH0", again: "AH0 G EH1 N", all: "AO1 L", am: "AE1 M", an: "AE1 N", and: "AE1 N D",
    any: "EH1 N IY0", are: "AA1 R", as: "AE1 Z", be: "B IY1", been: "B IH1 N", being: "B IY1 IH0 NG",
    both: "B OW1 TH", but: "B AH1 T", by: "B AY1", can: "K AE1 N", come: "K AH1 M", could: "K UH1 D",
    do: "D UW1", does: "D AH1 Z", done: "D AH1 N", each: "IY1 CH", every: "EH1 V R IY0",
    for: "F AO1 R", from: "F R AH1 M", give: "G IH1 V", go: "G OW1", good: "G UH1 D", have: "HH AE1 V",
    he: "HH IY1", hello: "HH AH0 L OW1", here: "HH IH1 R", how: "HH AW1", i: "AY1", if: "IH1 F",
    in: "IH0 N", is: "IH1 Z", it: "IH1 T", just: "JH AH1 S T", know: "N OW1", like: "L AY1 K",
    little: "L IH1 T AH0 L", make: "M EY1 K", me: "M IY1", more: "M AO1 R", my: "M AY1", new: "N UW1",
    no: "N OW1", now: "N AW1", of: "AH1 V", one: "W AH1 N", only: "OW1 N L IY0", or: "AO1 R",
    our: "AW1 R", out: "AW1 T", people: "P IY1 P AH0 L", play: "P L EY1", recipe: "R EH1 S AH0 P IY0",
    right: "R AY1 T", said: "S EH1 D", say: "S EY1", see: "S IY1", should: "SH UH1 D", some: "S AH1 M",
    talk: "T AO1 K", than: "DH AE1 N", that: "DH AE1 T", the: "DH AH0", their: "DH EH1 R",
    them: "DH EH1 M", then: "DH EH1 N", there: "DH EH1 R", these: "DH IY1 Z", they: "DH EY1",
    thing: "TH IH1 NG", think: "TH IH1 NG K", this: "DH IH1 S", those: "DH OW1 Z", though: "DH OW1",
    through: "TH R UW1", time: "T AY1 M", to: "T UW0", two: "T UW1", up: "AH1 P", very: "V EH1 R IY0",
    want: "W AA1 N T", was: "W AH1 Z", way: "W EY1", we: "W IY1", well: "W EH1 L", were: "W ER1",
    what: "W AH1 T", when: "W EH1 N", where: "W EH1 R", which: "W IH1 CH", who: "HH UW1",
    why: "W AY1", will: "W IH1 L", with: "W IH1 TH", word: "W ER1 D", world: "W ER1 L D",
    would: "W UH1 D", you: "Y UW1", your: "Y AO1 R",
    "can't": "K AE1 N T", "don't": "D OW1 N T", "doesn't": "D AH1 Z AH0 N T", "i'm": "AY1 M",
    "isn't": "IH1 Z AH0 N T", "it's": "IH1 T S", "that's": "DH AE1 T S", "there's": "DH EH1 R Z",
    "they're": "DH EH1 R", "we're": "W IH1 R", "what's": "W AH1 T S", "won't": "W OW1 N T",
    "you're": "Y UH1 R",
});

const VOWELS: Readonly<Record<string, readonly [VowelKind, VowelKind?]>> = Object.freeze({
    AA: ["a"], AE: ["a"], AH: ["a"], AO: ["o"], AW: ["a", "u"], AY: ["a", "i"],
    EH: ["e"], ER: ["e"], EY: ["e", "i"], IH: ["i"], IY: ["i"],
    OW: ["o", "u"], OY: ["o", "i"], UH: ["u"], UW: ["u"],
});

const CONSONANTS: Readonly<Record<string, readonly [ConsonantManner, boolean]>> = Object.freeze({
    B: ["stop", true], CH: ["affricate", false], D: ["stop", true], DH: ["fricative", true],
    F: ["fricative", false], G: ["stop", true], HH: ["fricative", false], JH: ["affricate", true],
    K: ["stop", false], L: ["liquid", true], M: ["nasal", true], N: ["nasal", true],
    NG: ["nasal", true], P: ["stop", false], R: ["liquid", true], S: ["fricative", false],
    SH: ["fricative", false], T: ["stop", false], TH: ["fricative", false], V: ["fricative", true],
    W: ["liquid", true], Y: ["liquid", true], Z: ["fricative", true], ZH: ["fricative", true],
});

function phone(symbolWithStress: string): SpeechPhone | null {
    const match = /^([A-Z]+)([012])?$/.exec(symbolWithStress);
    if (!match) return null;
    const symbol = match[1];
    const vowel = VOWELS[symbol];
    if (vowel) return {
        type: "vowel",
        symbol,
        kind: vowel[0],
        glide: vowel[1],
        stress: Number(match[2] ?? 0) as Stress,
    };
    const consonant = CONSONANTS[symbol];
    return consonant ? { type: "consonant", symbol, manner: consonant[0], voiced: consonant[1] } : null;
}

function parseArpabet(value: string): SpeechPhone[] {
    return value.split(" ").map(phone).filter((value): value is SpeechPhone => value !== null);
}

const BASIC_CONSONANTS: Readonly<Record<string, string>> = Object.freeze({
    b: "B", c: "K", d: "D", f: "F", g: "G", h: "HH", j: "JH", k: "K", l: "L", m: "M",
    n: "N", p: "P", q: "K", r: "R", s: "S", t: "T", v: "V", w: "W", x: "K S", y: "Y", z: "Z",
});

const VOWEL_TEAMS: Readonly<Record<string, string>> = Object.freeze({
    air: "EH1 R", ear: "IH1 R", eer: "IH1 R", igh: "AY1", ai: "EY1", ay: "EY1", au: "AO1", aw: "AO1",
    ea: "IY1", ee: "IY1", ei: "IY1", ey: "EY1", ie: "IY1", oa: "OW1", oi: "OY1", oy: "OY1",
    oo: "UW1", ou: "AW1", ow: "AW1", ue: "UW1", er: "ER0", ir: "ER1", ur: "ER1",
});

const CONSONANT_TEAMS: Readonly<Record<string, string>> = Object.freeze({
    ch: "CH", ck: "K", dg: "JH", gh: "G", ng: "NG", ph: "F", qu: "K W", sh: "SH", th: "TH", wh: "W",
});

/** Small, deterministic English G2P fallback inspired by scored context-rule systems. */
function rulePronunciation(word: string): SpeechPhone[] {
    const output: SpeechPhone[] = [];
    const emit = (symbols: string) => output.push(...parseArpabet(symbols));
    const silentFinalE = word.length > 2 && /[^aeiou]e$/.test(word) ? word.length - 1 : -1;
    let index = 0;
    while (index < word.length) {
        if (index === silentFinalE) { index++; continue; }
        const rest = word.slice(index);
        if (rest.startsWith("tion")) { emit("SH AH0 N"); index += 4; continue; }
        if (rest.startsWith("sion")) { emit("ZH AH0 N"); index += 4; continue; }

        const team = [rest.slice(0, 3), rest.slice(0, 2)].find(value => VOWEL_TEAMS[value]);
        if (team) { emit(VOWEL_TEAMS[team]); index += team.length; continue; }
        const consonantTeam = CONSONANT_TEAMS[rest.slice(0, 2)];
        if (consonantTeam) { emit(consonantTeam); index += 2; continue; }

        const character = word[index];
        if (index + 2 === silentFinalE && /[aeiou]/.test(character)) {
            emit(({ a: "EY1", e: "IY1", i: "AY1", o: "OW1", u: "UW1" } as const)[character]);
        } else if (character === "y" && index === word.length - 1) emit("IY0");
        else if (character === "a") emit("AE1");
        else if (character === "e") emit("EH1");
        else if (character === "i" || character === "y") emit("IH1");
        else if (character === "o") emit("AA1");
        else if (character === "u") emit("AH1");
        else if (character === "c") emit(/[eiy]/.test(word[index + 1] ?? "") ? "S" : "K");
        else if (character === "g") emit(/[eiy]/.test(word[index + 1] ?? "") ? "JH" : "G");
        else if (BASIC_CONSONANTS[character]) emit(BASIC_CONSONANTS[character]);
        index++;
    }
    return output;
}

export function pronounceToken(token: string): Pronunciation {
    const bare = token.normalize("NFC").toLowerCase().replaceAll("’", "'")
        .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    // A single written vowel is used as a direct formant probe in the voice
    // workbench. Do not reinterpret `o` as English /AA/ or `u` as /AH/ here:
    // both of those intentionally map into the open `a` region.
    if (/^[aeiou]$/.test(bare)) return {
        phones: [{ type: "vowel", symbol: bare.toUpperCase(), kind: bare as VowelKind, stress: 1 }],
        source: "rules",
    };
    const contraction = LEXICON[bare];
    if (contraction) return { phones: parseArpabet(contraction), source: "lexicon" };
    const possessiveFree = bare.replace(/[’']s$/u, "");
    if (/^[a-z]+$/.test(possessiveFree)) {
        const known = LEXICON[possessiveFree];
        const phones = known ? parseArpabet(known) : rulePronunciation(possessiveFree);
        if (!phones.some(value => value.type === "vowel")) phones.push(...parseArpabet("AH0"));
        return { phones, source: known ? "lexicon" : "rules" };
    }
    const fallback = vowelNuclei(bare).map(({ kind }): VowelPhone => ({
        type: "vowel", symbol: kind.toUpperCase(), kind, stress: 1,
    }));
    return { phones: fallback, source: "script" };
}

export function pronunciationVowels(token: string): VowelPhone[] {
    return pronounceToken(token).phones.filter((value): value is VowelPhone => value.type === "vowel");
}
