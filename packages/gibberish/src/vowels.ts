export type VowelKind = "i" | "e" | "a" | "o" | "u";

/*
 * Grapheme-to-vowel-space map. It deliberately covers scripts, not languages:
 * nearby languages can share letters while still getting useful, distinct
 * formant motion. Unmarked abjads fall back to a neutral vowel.
 */
const GROUPS: Record<VowelKind, string> = {
    i: "iyíìîïĩīĭįıǐȉȋỉịιηίΐыийіїүいイきキしシちチにニひヒみミりリ기ㅣिीিীਿੀિીிீిీಿೀിീิี",
    e: "eéèêëēĕėęěȅȇẹẻẽếềểễệæœεέеёэєえエけケせセてテねネへヘめメれレ게ㅔेैেৈੇੈેૈெேைెేైೆೇೈെേൈเแ",
    a: "aáàâäãåāăąǎȁȃạảấầẩẫậắằẳẵặαάяаあアかカさサたタなナはハまマやヤらラわワ가ㅏअआाঅআাਅਆਾઅઆાஅஆாఅఆాಅಆಾഅആാะาำ",
    o: "oóòôöõōŏőǒȍȏọỏốồổỗộớờởỡợοωόώоおオこコそソとトのノほホもモよヨろロをヲ고ㅗोौোৌોૌொோௌొోౌೊೋೌൊോൌโ",
    u: "uúùûüũūŭůűųǔȕȗụủứừửữựυύΰуюうウくクすスつツぬヌふフむムゆユるル구ㅜुूুূੁੂુૂுூుూುೂുൂุู",
};

const LOOKUP = new Map<string, VowelKind>();
for (const [kind, characters] of Object.entries(GROUPS) as [VowelKind, string][]) {
    for (const character of characters) LOOKUP.set(character, kind);
}

// Arabic/Hebrew vowel marks, plus common vowel-bearing letters.
const MARKS: Array<[RegExp, VowelKind]> = [
    [/[ִٍِٖٗ]/u, "i"],
    [/[ֵֶ]/u, "e"],
    [/[ֲַָًَٰ]/u, "a"],
    [/[ֳֹ]/u, "o"],
    [/[ֻٌُ]/u, "u"],
    [/[ييیי]/u, "i"],
    [/[ااى]/u, "a"],
    [/[ووו]/u, "u"],
];

export function vowelKind(character: string): VowelKind | null {
    const normalized = character.normalize("NFC").toLowerCase();
    const direct = LOOKUP.get(normalized);
    if (direct) return direct;
    for (const [pattern, kind] of MARKS) if (pattern.test(normalized)) return kind;
    return null;
}

export interface VowelNucleus {
    kind: VowelKind;
    /** Position through the word, used to schedule the sound. */
    offset: number;
}

/** Extract vowel nuclei, coalescing adjacent letters into one syllable peak. */
export function vowelNuclei(text: string): VowelNucleus[] {
    const characters = Array.from(text.normalize("NFC"));
    const result: VowelNucleus[] = [];
    let previous = -2;
    let previousCharacter = "";
    characters.forEach((character, index) => {
        const kind = vowelKind(character);
        if (!kind) return;
        // Adjacent alphabetic vowel letters form one nucleus ("ea"). Kana
        // are already syllable-bearing glyphs, so adjacent kana stay separate.
        const alphabeticVowel = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
        if (
            index === previous + 1
            && result.length
            && alphabeticVowel.test(character)
            && alphabeticVowel.test(previousCharacter)
        ) result[result.length - 1].kind = kind;
        else result.push({ kind, offset: characters.length > 1 ? index / (characters.length - 1) : 0.5 });
        previous = index;
        previousCharacter = character;
    });
    // Abjads, numbers and vowelless abbreviations still need one voiced beat.
    return result.length ? result : [{ kind: "a", offset: 0.5 }];
}
