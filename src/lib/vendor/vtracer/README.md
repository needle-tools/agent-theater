# vtracer (vendored)

`@visioncortex/vtracer` 1.0.0-alpha.4, from the VisionCortex project, licensed
**MIT OR Apache-2.0** as declared in that package's `package.json`. The npm
package ships no licence text of its own, so the MIT text is reproduced in
`LICENSE` beside this file — redistributing the build without it is the one
thing that licence actually asks for. Upstream is
<https://github.com/visioncortex/vtracer>.

## Why it is vendored rather than installed

Upstream publishes this build for **Node**: the last four lines of the
wasm-bindgen glue read the `.wasm` off disk with `require('fs')` at import time.
Everything else in the file is target-agnostic, so a browser cannot use the
package as published for the sake of four lines.

The npm package `vtracer-wasm` is a browser build, and was tried first. It is
VTracer **0.1.0**, and its colour clustering collapses any photographic image to
a single flat region — one path, one colour, whatever the settings. Reproduced
on gradients and confirmed against upstream, which needs the `poster` preset to
do this properly, and that preset does not exist in 0.1.0.

## What was changed

Two mechanical edits to `pkg/vtracer_wasm.js`, and nothing else:

1. `exports.vectorize_bytes = …` / `exports.vectorize_rgba = …` became an ES
   module `export`.
2. The four-line Node tail became an exported `init(bytes)` that instantiates
   from bytes handed in, so the module can be code-split and the 650 kB of
   WebAssembly fetched only when something is actually traced.

`vtracer.wasm` is upstream's `vtracer_wasm_bg.wasm`, byte for byte.

## Upgrading

`npm pack @visioncortex/vtracer`, then re-apply the two edits above. If upstream
ever ships a `--target web` build, delete this directory and depend on it.
