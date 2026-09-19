# Camera assist — session handoff (Sep 14–16, 2026)

Written for the next Claude (or human) picking this up. Everything below was done in one
Cowork session with Stephen (`Zookerman3`). It records what shipped, what was measured, what
was tried and dropped, what is still pending, and the process traps that cost us time. Read
`CLAUDE.md` first for the team rules; this document assumes them.

Submission is **Saturday Sep 19, 1:00–2:00 PM CDT, in person**: live link, ≤3 min video,
what-to-click-first note.

## 1. State of play

| Thing | Status |
|---|---|
| Camera assist (on-device nearest-neighbour matcher) | **Merged to `main`** (squash of `Zookerman3/camera-assist`) |
| Orange + Strawberry flavors | Merged (`src/data/flavors.local.json`) |
| Training dataset (1,920 labelled crops) | Built and verified; committed under `dataset/` (#15) |
| Crash-proofing patch (error boundary, seconds-per-box stat) | Applied and merged Wed afternoon (`Zookerman3/crash-proofing`) |
| MobileNetV2 upgrade (fixes lighting/camera robustness) | **Ported** on `Zookerman3/mobilenet` (Wed afternoon): int8 model at 160 px, fused gallery, blur guard, colour fallback; see README Known limits for the measured table |
| Grid-finder (box only roughly on the outline; tilt OK) | **Ported** on `Zookerman3/grid-finder` (Wed evening): `gridFinder.ts`, measured in README |
| Vercel deploy + iPad test over HTTPS | Deployed Sep 17: https://ai-chocolation.vercel.app (redeploy steps in DEPLOY.md). iPad capture test over HTTPS still to do |
| Thursday timing (10+ real boxes per method) | Not done |
| README robustness table | In README Known limits, re-measured through the shipped code |

Everything above is merged to `main`; feature branches were squash-merged on GitHub and deleted.
`dataset/` is tracked now (#15) and there is no stray `dataset_1.zip` in the repo, but the rule
stands: never `git add -A`; add paths by name (`.env.local` and `.vercel/` are git-ignored, not absent).

## 2. What shipped: how the camera assist works (as of the `grid-finder` merge)

The prompt gives no training data, so Roboflow-style detection was replaced with something we
could build and measure ourselves in two days. The insert is a fixed grid, so the app never has to
learn what a chocolate looks like in order to find one: it finds the grid, cuts out every slot, and
asks "which flavor does this crop look most like?" against a gallery of our own labelled crops.

Pipeline, all in `src/features/camera/`, in the order a photo goes through it:

1. `CameraScreen.tsx` — live rear-camera preview (`useCameraPreview`, getUserMedia 1920×1440) with
   the `GridOutline` overlay; Capture draws video → canvas → blob → `getDetector(grid).detect`. Falls
   back to a file input (`aria-label="Take a photo of the box"`) where the preview isn't available.
   Preloads the recognizer on mount (`preloadRecognizer`, progress veil with MB counts), shows a
   "basic colour matching" banner if the network failed to load, and the "please confirm" list
   (`PendingRow`: thumbnail, "Row r, slot c", flavor dropdown).
2. `config.ts` — `detectorKind` is `'roboflow'` only when both `VITE_ROBOFLOW_*` vars are set,
   otherwise `'local'`. `preloadRecognizer()` lazy-imports `recognizer.ts` so the WebAssembly runtime
   stays out of the main bundle (it's a separate chunk), caches the promise, and **if that import
   rejects, falls back to a colour-only recognizer built from `gallery-color`** — which is in the
   main bundle and needs no WebAssembly — so a device that can't run the network still gets a
   working camera (measured with the chunk blocked: 24/27 auto-added, 0 wrong, 3 confirms, 0.6 s).
   Before that fallback existed, a failed chunk import left Capture permanently disabled. That is
   what the "failure to import module" report from an iPhone on Sep 17 hit.
3. `recognizer.ts` — loads `public/models/mobilenetv2.onnx` (2.5 MB) with `onnxruntime-web/wasm`
   (one thread, `.wasm` served from the app via a `?url` import, no CDN, no WebGPU because it crashes
   iOS Safari) and the fused gallery; on any failure falls back to the colour gallery and returns
   `{ kind: 'color', reason }`. One cached promise per page load.
4. `grid.ts` — `GRID_BY_SIZE = {6: 2×3, 10: 2×5, 16: 4×4, 30: 5×6}`; 50 → `null` (tap-only).
   `outlineRect` (88 % of the frame, square cells, centred), `cells` (reading order = label order,
   6 % inset).
5. `gridFinder.ts` — `findGrid(rgba, W, H, grid, outline)`: downscale to 480 px; piece candidates =
   saturated blobs (S>58, V>45) of plausible area/aspect with a dark ring around them; 750 similarity
   seeds around the outline (offset ±1 cell, scale 0.6–1.3, turn ±20°) × 3 rounds of nearest-node
   assignment + affine least squares; best by inliers, ties toward the outline; then homography
   refinement from the best fit and each of its ±1-cell shifts (a tilted box compresses the far rows
   and an affine fit locks on one row off); plausibility gate (pitch 0.5–1.6× outline, centre within
   1.6 cells, ≥ 40 % of landmarks and ≥ max(4, 30 % of slots) inliers) else `null`. `warpCell`
   samples a slot through the homography (bilinear). ~60 ms to find, ~200 ms to cut a 30-box.
6. `localDetector.ts` — `readCells` (canvas → full-frame RGBA) → `cutCells` (grid-finder or the
   outline as drawn, each slot at 96 px for colour and 160 px for the network) → `assertSharp`
   (refuses a frame whose sharpest cell scores under 15 mean-squared-Laplacian: blur is the one
   thing the network gets confidently wrong) → `classifyCells` (pure; fused or colour-only path).
   A confident `empty` is skipped; an unsure empty goes to review with the best real flavor at
   `threshold − 0.01` so it's never auto-added. Emits `Detection[]` with `cell` and a JPEG thumbnail.
7. `features.ts` — 392-d colour/texture fingerprint from the 96 px crop (HSV hist 12×4×4 over a
   disk, weight 3.0; LAB 8×8 thumbnail with L mean-centred, 1.0; Sobel-magnitude 8-bin hist, 2.5;
   L2-normalised). `FEATURE_VERSION = 'v1-hsv12x4x4-lab8-tex8'`. Also `sharpness()`.
8. `embed.ts` — pure: 160 px RGBA crops → ImageNet-normalised NCHW tensor → the network's
   GlobalAveragePool output (tensor `'464'`, 1280-d) → unit vectors. `EMBED_VERSION =
   'mobilenetv2-12-gap464-int8-160'`. Running the network is the caller's job (browser: recognizer;
   Node: the gallery builder) so both produce identical numbers.
9. `fused.ts` — `fuse(color, embedding)` = concat(√0.7·colour, √0.3·embedding), so cosine of two
   fused vectors = 0.7·cos(colour) + 0.3·cos(embedding). Defines the two gallery kinds:
   `gallery-fused` (1672-d, 3.1 MB) and `gallery-color` (392-d, 735 KB).
10. `gallery.ts` — uint8-per-dimension quantised rows + labels; `inflateGallery(meta, bytes, kind)`
    refuses a version/shape mismatch; `classify` = cosine kNN, k=5, similarity-weighted vote →
    ranked `{label, share}`; `loadGallery(kind)` cached per kind. `LABEL_EMPTY = 'empty'`.
11. `applyDetections.ts` — auto-adds `confidence ≥ 0.8`, routes the rest to review;
    `confirmDetection` for the cashier's pick.

Also: `roboflowDetector.ts` (opt-in override), `stubDetector.ts` (sees nothing; tests/demos),
`types.ts` (`Detection`, `FlavorDetector`). Tests sit next to each file; `gridFinder.test.ts` draws
synthetic frames, `localDetector.test.ts` uses a fake embedder and toy galleries, `embed.test.ts`
checks the tensor layout and the fusion arithmetic. `vite.config.ts` precaches only the shell and the
colour fallback (1.2 MB) and runtime-caches the big three (wasm, onnx, `gallery-fused.bin`)
cache-first under `camera-recognizer`; `.gitattributes` marks `*.onnx` and `*.bin` binary.

### Rebuilding the galleries

```
node scripts/build-gallery.ts path/to/dataset [--holdout N] [--out dir]   # Node 22.18+
```

It reads `dataset/<label>/<session>_<photo>_r<row>c<col>.jpg`, embeds every crop through the same
ONNX runtime the tablet uses, prints leave-one-session-out accuracy for colour-only, embedding-only
and fused, and writes `public/models/gallery-fused.{json,bin}` and `gallery-color.{json,bin}`.
`--holdout N` leaves session N out of the written galleries (that is how every number in README was
scored); `--out` for a scratch directory. **Any change to `features.ts`, `embed.ts`, `fused.ts` or
the model file must rebuild both galleries**; the version strings are baked in and a stale gallery is
refused at load.

The model file was made from ONNX model zoo `mobilenetv2-12.onnx`
(`https://media.githubusercontent.com/media/onnx/models/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx`):
extract the subgraph `input` → `'464'` (`onnx.utils.extract_model`), make H/W dynamic, convert to
opset 13 (`onnx.version_converter`; opset 12 lacks per-channel DequantizeLinear), then
`onnxruntime.quantization.quantize_static` (QDQ, per-channel int8 weights, uint8 activations,
MinMax calibration on ~170 stratified crops at 160 px). 160 px scored 98.2 % held-out alone vs
97.8 % at 224 and runs twice as fast.

### Flavors

`src/data/flavors.local.json` adds **Orange** and **Strawberry** (sold in-store, absent from the
public feed). `src/data/flavors.ts` merges them: `FLAVORS = [...raw.flavors, ...local.flavors]`
sorted by name, plus `findFlavor`, `placeholderFlavor`, `flavorOrPlaceholder`. Their allergen list
is empty meaning "not recorded". Tile images are `public/flavors/{orange,strawberry}.jpg`.

## 3. The dataset and how it was built

Stephen shot **64 photos** of one 30-slot (5×6) box across **four sessions**
(`Training_Set_1..4` under `~/Master/Cocoa_Dulce_Hackathon/Photos/` on his Mac, HEIC from an
iPhone), with the 27 flavors + Orange + Strawberry spread across slots differently each session
and some slots left empty. Each session folder has a `training_label_N` text file, one line per
slot: `row.col Flavor Name` (e.g. `2.6 Brownie Batter`), unlisted slots = empty. We shot whole
mixed boxes rather than one flavor at a time because one photo then yields up to 30 labelled
crops, and the empty-slot examples come free.

Label corrections made in place in set 1: `2.5 Brownie Batter → 2.6`, `4.5 Key Lime Pie → 4.6`
(duplicate slot numbers; the cropper now errors on duplicates).

`scripts/crop_cells.py` (added on this branch; requires
`pip install opencv-python-headless pillow pillow-heif numpy`) turns those into crops:

```
python3 scripts/crop_cells.py path/to/Photos --out dataset --qa qa
```

It does **not** look for the box edge (the dark lid and its shadow sit against the insert in half
the photos). Instead the chocolates are the landmarks: saturated blobs (S>58, V>45, area
0.15–2 % of frame, aspect 0.5–2, with a "black ring" test at 0.7·max(w,h) using the 35th percentile
of V and S ≤ 110) → centroids → a 6×5 lattice fitted by homography with RANSAC, seeded from both
`minAreaRect` and the bounding box, refined over 5 rounds, scored by *occupancy against the label
file* (which defeats the periodic ±1-cell shifts a pure inlier count accepts), with a pitch sanity
check (0.7–1.3× median nearest-neighbour distance) and a requirement of ≥ 85 % of points on the
lattice. Then it rectifies the insert and slices each cell with a 6 % inset. A photo whose fit
fails is reported and skipped; `corners.json` can override with four full-res corner points.
`--qa` writes contact sheets per flavor and per grid so a human can eyeball every crop in minutes.
`ALIASES` maps label spellings (`orange`, `strawberry`, `banana foster`, `cookies and cream`…) to
flavor ids.

Result: **1,920 verified crops** at 226×226, 27+2 flavors + `empty`, named
`<set>_<IMG>_r<row>c<col>.jpg`. On Stephen's Mac: `Photos/dataset-part1-amaretto-to-lemon.zip`,
`Photos/dataset-part2-manhattan-to-turtle.zip` (split because the Cowork file bridge caps 20 MB per
file), `qa-flavor-sheets.zip`, `qa-grids-sets-1-2.zip`, `qa-grids-sets-3-4.zip`. Consider a GitHub
Release for the zips rather than committing 28 MB of JPEGs.

## 4. What was measured (colour/texture matcher — now the fallback; the shipped fused numbers are in §5)

Leave-one-session-out on the 1,920 crops (`scripts/build-gallery.ts` prints this): **92.2 %
top-1, 96.8 % top-3** (checkpoint was 80 / 95). Through the tablet's whole-frame path on session 4
with a gallery built from sessions 1–3 only: 93.6 % top-1, 97.7 % top-3, 87 % of cells auto-filled
at 0.8 with 1.9 % of those wrong, all 54 empty slots recognised, 0 false pieces — about two confirm
taps and one wrong auto-fill per three 16-piece boxes. Calibration at threshold 0.8: ~89 %
auto-fill at ~97 % precision.

Worst confusions: Maple Cream ↔ Turtle (tan domes; most misses), Grey Salt Caramel ↔ Crème
Brûlée / Brownie Batter (dark squares on black plastic).

Then a **perturbation sweep** on the session-4 frames (27 conditions: brightness ×0.4–×1.8,
warm/cool light, low contrast, noise σ 10–35, blur σ 3–10 px, JPEG q35, box shifted 10–35 % of a
cell, box at 90 %/112 % of the outline, rotated 3°/7°/12°, pieces turned 90°/180°, glare, a finger
across a row) and a **cross-camera test** on a professional 4×4 product photo Stephen supplied
(same flavors, different camera, studio light, each piece's splatter individually different).

Finding: matched conditions pass, everything else doesn't. Brightness ×0.6 → 37 %; cool light →
55 %; box 20 % of a cell off the outline → 28 %; rotated 7° → 36 %; product photo **8/16 right with
4 wrong auto-fills**. Colour-normalisation rescues were tried and dropped: black-tray reference
made the product photo 0/16 (tray clips to black), gray-world over the pieces got 9/16.

## 5. The MobileNetV2 upgrade (measured, then shipped on `Zookerman3/mobilenet`)

Swapping the hand-made fingerprint for a pretrained CNN embedding fixes the robustness problem.
Recipe, verified against the saved features:

- Model: ONNX model zoo `mobilenetv2-12.onnx` (fetched via
  `https://media.githubusercontent.com/media/onnx/models/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx`,
  14 MB fp32). Take the **GlobalAveragePool output, tensor name `'464'`** (1280-d), not the
  1000-class logits.
- Input: the cell crop resized to **224×224, bilinear**, RGB /255, ImageNet mean
  `[0.485, 0.456, 0.406]` / std `[0.229, 0.224, 0.225]`, NCHW. L2-normalise the 1280-d output.
- Same kNN (k=5, similarity-weighted vote, threshold 0.8) over the same 1,920 crops.
- Fusion: score = 0.7 · cos(colour) + 0.3 · cos(MobileNet), i.e. the concatenation of the two
  unit vectors scaled by √0.7 and √0.3.

| Condition | colour only (fallback) | MobileNetV2 + colour (0.7/0.3, shipped) |
|---|---|---|
| held-out top-1 (leave-one-session-out) | 92.2 % | **98.4 %** (MobileNet alone 97.9 %) |
| brightness ×0.6 | 37 % | 100 % |
| cool light (−10 % R, +15 % B) | 55 % | 100 % |
| box shifted 20 % of a cell | 28 % | 99 % |
| box rotated 7° | 36 % | 97 % |
| 4×4 product photo, other camera | 8/16, **4 wrong auto-fills** | 10/16 top-1, 13/16 top-3, **0 wrong auto-fills** |
| heavy blur (σ 10 px) | 86 % | 68 % |

The only regression is heavy blur. On the product photo the fused model asks the cashier instead of
guessing wrong, which is the behaviour the prompt's "honest about limits" line rewards.

### How it was ported (the plan below was followed; differences noted)

1. `npm i onnxruntime-web` (say why in the PR: on-device inference, no server). **WASM backend
   only** — WebGPU crashes on iOS Safari. Serve the `.wasm` from the app (`?url` import from
   `onnxruntime-web/dist/` or copy to `public/ort/`) and set `ort.env.wasm.wasmPaths`; never rely
   on the jsDelivr CDN default.
2. Model in `public/models/`. Try static int8 quantisation first (`onnxruntime.quantization`,
   calibrate on the crops; expect ~4 MB) and re-check held-out accuracy; ship fp32 (14 MB) if it
   drops. Raise Workbox `maximumFileSizeToCacheInBytes` in `vite.config.ts` (default 2 MiB) or
   cache the model at runtime instead of precaching.
3. New `embed.ts`: lazy session, batch all cells of a frame in one `run`, output `'464'`.
   Bump `FEATURE_VERSION` to a v2 that carries both blocks (`dim = 392 + 1280`), with block
   weights in the gallery meta so `classify` stays generic.
4. Gallery builder: run the same ONNX runtime in Node (`onnxruntime-web` works in Node ≥ 18;
   `onnxruntime-node`'s postinstall needs nuget, which some networks block) so the numbers
   transfer exactly. Gallery grows to ~3.2 MB uint8.
5. `CameraScreen`: download-progress veil for the model (fetch with a ReadableStream, then
   `InferenceSession.create(buffer)`). If the model fails to load, **fall back to the colour-only
   v1 gallery** — keep shipping it.
6. Re-run the sweep against the built bundle and put the table above in README Known limits.

What actually shipped: the feature-only subgraph (`input` → `'464'`) converted to opset 13 and
quantised static int8 QDQ with MinMax calibration on 168 crops (`onnxruntime.quantization`), 2.5 MB;
input **160 px** (98.2% held-out alone vs 97.8 at 224, twice as fast); `onnxruntime-web/wasm` entry
with the `.wasm` imported via `?url` and `ort.env.wasm.wasmPaths = { wasm }`, one thread; the
recognizer chunk is lazy-loaded; galleries are `gallery-fused` (3.1 MB) and `gallery-color` (735 KB);
`localDetector.ts` refuses frames whose sharpest cell scores under 15 (mean squared Laplacian on the
96 px crop); PWA precache raised to 20 MB. Fused held-out: 99.2 / 99.9. Browser end-to-end on three
held-out photos: 27/27 each, ~2.5 s. Perturbation sweep re-run through the shipped code: see README.

## 6. Crash-proofing (applied and merged Wed afternoon)

Branch `Zookerman3/crash-proofing`, from `~/Downloads/crash-proofing.patch`. It added `src/app/ErrorBoundary.tsx` (a `.crash` card instead of a
white screen), `src/app/id.ts` (`newId()`, used by `boxSession.ts` — a fallback for `crypto.randomUUID`,
which is unavailable on plain http and older Safari), `flavorOrPlaceholder` guards in BoxScreen / RecordsScreen /
StatsScreen / FlavorGrid / `csv.ts` (a record with a retired flavor id no longer throws),
`App.tsx` screens wrapped in `<ErrorBoundary>`, and `stats.ts` `secondsPerBox(records)` (median /
fastest / slowest / count per box size, 4 tests) shown as a "Seconds per box" card on StatsScreen.
It was applied by writing the files into the working tree and committing from Terminal (see
section 7 for why), not with `git am`.

## 7. Process traps (each of these cost real time)

- The repo is private and a Cowork session has **no GitHub credentials** and cannot run `gh`. Its
  shell on the Mac also **cannot delete files**, so any git command that takes a lock
  (`add`, `commit`, `checkout`, `am`, even a plain `status` refresh) can leave `.git/index.lock`
  behind and then fail. Rule adopted: Claude only runs read-only git (`git --no-optional-locks status`,
  `log`, `branch`); **the human runs every write in Terminal**. If a command dies with
  "index.lock: File exists", `rm -f .git/index.lock` and retry.
- Always chain multi-step shell instructions with `&&`. An unchained `git push` once pushed an
  empty branch after the commit step had failed.
- PR #13 (Agustín's Manus-AI redesign) showed a conflict that was a squash artifact: `origin/main`
  `952d27e` and `origin/Agustin` `6fcf714` had **identical trees**. Resolved with
  `git merge -s ours`. The redesign is the same look as the Claude artifact Stephen had asked to
  adopt, so the separate re-skin was dropped.
- Delivering files through the bridge caps at 20 MB per file (hence the split dataset zips), and
  a file sent to chat while the Mac link is down never lands on the Mac.
- `npm run check` (lint + typecheck + test + build) is the only gate; there is no CI and `main` is
  unprotected. Vitest mocks of `config.ts` must include `detectorKind`; `FlavorGrid.test.tsx`
  indexes `FLAVORS[1 + layout.cols]` so adding flavors doesn't break arrow-key tests.
- TS gotchas met: `new ImageData(Uint8ClampedArray)` overloads → use `ctx.createImageData` +
  `img.data.set`; a narrowed literal union made `detectorKind !== 'stub'` a no-overlap error → cast
  `as DetectorKind`.

## 8. Why Roboflow was skipped (for the record)

Public plan: free, 15 credits/month, 2 seats, **data and models public on Universe**; Core is
$79/month; 1 credit ≈ 30 min training or 1,000 inferences or 1,000 auto-labels
(docs.roboflow.com/platform/billing-and-plans/plans, roboflow.com/pricing, roboflow.com/credits).
A hosted detector needs a network call per box and can't be measured against held-out sessions
without paying for inferences, and the nearest-neighbour approach cleared the checkpoint on its
own. `roboflowDetector.ts` stays as the opt-in override in `.env.example`.

## 9. What does not survive the session

The scoring harnesses (the 27-condition perturbation generator and the synthetic tilt generator in
OpenCV, the Node scripts that run frames through `cutCells → classifyCells` with the `--holdout 4`
galleries, the Playwright script that drives the built app in headless Chromium and checks the box
tally against `training_label_4`, the quantisation script) lived in the Cowork container and are
gone. What remains reproducible from this repo: `scripts/build-gallery.ts` (held-out numbers, and
`--holdout` for honest scoring), `scripts/crop_cells.py` (dataset), and the recipes in sections 2
and 5. Re-creating the sweep is ~1 h: perturb the rectified session-4 frames with OpenCV, import
`cutCells`/`classifyCells` from `localDetector.ts` in a Node script (the module has no DOM
dependency below `readCells`; feed jpeg-js RGBA), and score against `training_label_4`.

## 10. Critical path to Saturday

1. ~~Decide MobileNet port vs freeze~~ Done, merged. Grid-finder done (`gridFinder.ts`): the box only
   has to be roughly inside the outline; measured limits in README. Open check: six real angled photos
   of the 30-box (20°/35°/50°) through `scripts/crop_cells.py` + the recogniser, to confirm the
   synthetic tilt numbers hold for real piece sides.
2. ~~Apply `crash-proofing.patch`~~ Done, merged.
3. ~~Deploy to Vercel~~ Done Sep 17: https://ai-chocolation.vercel.app, redeploy steps in DEPLOY.md.
   The live camera preview needs **HTTPS** (`getUserMedia`), so the iPad test in item 4 runs on that link.
4. iPad capture test on a real 16 and 30 box; confirm the 6 and 10 inserts are 2×3 / 2×5 (one
   number in `grid.ts` if not).
5. Thursday: time 10+ boxes per method (tap vs camera), seconds per box and corrections; those
   numbers go in the video and README.
6. Video ≤ 3 min + what-to-click-first note. The tablet's demo toggle and the dashboard's sample
   data are gone (Sep 18): judges see real saved boxes only, so save some before Saturday.
7. ~~Housekeeping: delete the stray `dataset_1.zip`~~ Moot: it was never committed, and the dataset
   lives in `dataset/` (#15).
