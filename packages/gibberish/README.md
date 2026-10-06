# @needle-tools/gibberish

Lightweight, dependency-free gibberish voice synthesis for the browser. It turns text into speech-like character sounds with the Web Audio API. It does not produce intelligible spoken words.

```sh
npm install @needle-tools/gibberish
```

```ts
import { playGibberish, recordGibberish } from "@needle-tools/gibberish";

// Call from a user gesture so the browser can start audio.
const playback = await playGibberish("Hello there!", {
  pitch: 0.3,
  speed: 1.4,
  articulation: "word",
});
await playback.finished;

const recording = await recordGibberish("Hello there!");
const url = URL.createObjectURL(recording.blob);
```

The package exports `DEFAULT_GIBBERISH_VOICE`, `ARTICULATIONS`, `normalizeGibberishVoice`, playback and recording types, and text timing helpers from its main entry point. Advanced synthesis, phoneme, vowel, and timing helpers are available through `/synth`, `/phonemes`, `/vowels`, and `/timing` subpaths.

Audio playback and recording require a browser with Web Audio support. Playback must be initiated after a user gesture under normal browser autoplay rules.

## Development in this repository

Run `npm run build:gibberish` from the repository root before building the app. The package is an npm workspace and the app consumes the same package entry point that is published.
