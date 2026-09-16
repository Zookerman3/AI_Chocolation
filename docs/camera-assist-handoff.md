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
| Training dataset (1,920 labelled crops) | Built and verified; lives on Stephen's Mac, **not in the repo** |
| Crash-proofing patch (error boundary, seconds-per-box stat) | Applied and merged Wed afternoon (`Zookerman3/crash-proofing`) |
| MobileNetV2 upgrade (fixes lighting/camera robustness) | **Ported** on `Zookerman3/mobilenet` (Wed afternoon): int8 model at 160 px, fused gallery, blur guard, colour fallback; see README Known limits for the measured table |
| Grid-finder (box only roughly on the outline; tilt OK) | **Ported** on `Zookerman3/grid-finder` (Wed evening): `gridFinder.ts`, measured in README |
| Vercel deploy + iPad test over HTTPS | Not done |
| Thursday timing (10+ real boxes per method) | Not done |
| README robustness table | In README Known limits, re-measured through the shipped code |

Local branches on Stephen's Mac at hand-off: `main` (HEAD), `Zookerman3/camera-assist`,
`Zookerman3/dataset`, `pr-13`, `pr13-fix`. The repo root also holds an **untracked** `dataset/`
folder and a stray `dataset_1.zip` (29 MB). Never `git add -A`; add paths by name.

## 2. What shipped: how the camera assist works

The prompt gives no training data, so Roboflow-style detection was replaced with something we
could build and measure ourselves in two days. The cashier lines the open box up with an outline
drawn on the live preview; the app knows the insert geometry, so it does not need to find pieces —
it crops every slot at a fixed place and asks "which flavor does this crop look most like?"

Pipeline, all in `src/features/camera/`:

1. `grid.ts` — `GRID_BY_SIZE = {6: 2×3, 10: 2×5, 16: 4×4, 30: 5×6}`; 50 → `null` (tap-only).
   `outlineRect(grid, W, H)` draws the outline at 88 % of the frame with square cells, centred.
   `cells(grid, outline)` yields cells in the training label order (left→right, then down) with a
   6 % inset (`read` rect) so divider walls stay out of the crop.
2. `features.ts` — `resizeToCrop` (area average to 96×96), then `featureFromCrop` → 392-d
   fingerprint: HSV histogram 12×4×4 over a disk r=36 (weight 3.0), LAB 8×8 thumbnail with L
   mean-centred (weight 1.0), Sobel-magnitude 8-bin histogram over the disk (weight 2.5),
   L2-normalised. HSV/LAB follow OpenCV conventions; Sobel uses reflect-101 borders.
   `FEATURE_VERSION = 'v1-hsv12x4x4-lab8-tex8'`, `FEATURE_DIM = 392`.
3. `gallery.ts` — `public/models/gallery.{json,bin}` (735 KB): every training crop's fingerprint
   quantised to uint8 per dimension (`lo`/`hi` arrays in the meta). `inflateGallery` refuses a
   gallery whose `featureVersion` or byte count doesn't match. `classify(feature, gallery, k=5)`
   = cosine kNN with similarity-weighted votes → ranked `{label, share}`. `LABEL_EMPTY = 'empty'`.
4. `localDetector.ts` — `createLocalDetector({grid, outline?, gallery?, thumbnails?})`
   implements the existing `FlavorDetector` interface. `detectOnBitmap` draws the frame to a
   canvas, reads each cell, classifies, and emits `Detection[]` with `cell: {row, col}` and a JPEG
   `thumbnail`. A confident `empty` (share ≥ threshold) is skipped; an unsure empty goes to review
   with the best real flavor at `threshold − 0.01` so it's never auto-added.
5. `config.ts` — `detectorKind` is `'roboflow'` only when `VITE_ROBOFLOW_API_KEY` and
   `VITE_ROBOFLOW_MODEL_ID` are set, otherwise `'local'`. `getDetector(grid)`.
6. `CameraScreen.tsx` — `useCameraPreview` (getUserMedia, environment camera, 1920×1440),
   `GridOutline` overlay, Capture draws video → canvas → blob → detector; falls back to a file
   input (`aria-label="Take a photo of the box"`) when the preview isn't available (http dev
   server on a phone, denied permission). Gallery is preloaded on mount when the detector is local.
7. `applyDetections.ts` (pre-existing) — auto-adds pieces with confidence ≥ 0.8, routes the rest
   to a confirm/fix list. `PendingRow` shows the thumbnail and "Row r, slot c".

Other touches in that merge: `types.ts` (`cell?`, `thumbnail?` on `Detection`), `BoxScreen.tsx`
("Use camera" disabled when `gridFor(size)` is null), `vite.config.ts` (`bin`/`jpg`/`json` added to
the PWA precache glob), `package.json` (devDep `jpeg-js` for the Node gallery builder), `index.css`
(`.camera-*`, `.pending-thumb`), tests `features.test.ts`, `grid.test.ts`, `gallery.test.ts`,
and README "Known limits" + CLAUDE.md Phase 2 rewritten with measured numbers.

### Rebuilding the gallery

```
node scripts/build-gallery.ts path/to/dataset      # Node 22.18+ (runs .ts directly)
```

It reads `dataset/<label>/<session>_<photo>_r<row>c<col>.jpg`, prints leave-one-session-out
accuracy (each session scored against the other three, so no crop is ever scored against its own
shoot), then writes `public/models/gallery.{json,bin}`. It uses the browser's own `features.ts`, so
the tablet and the gallery cannot disagree. **Any change to `features.ts` must bump
`FEATURE_VERSION` and rebuild**, or the app will refuse the stale gallery at load.

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

## 4. What was measured (colour/texture matcher, as merged)

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

| Condition | colour only (shipped) | MobileNetV2 + colour (0.7/0.3) |
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

## 6. Not yet applied: `crash-proofing.patch`

On Stephen's Mac at `~/Downloads/crash-proofing.patch` (30.8 KB, `git am` format, branch name
`Zookerman3/crash-proofing`). It adds `src/app/ErrorBoundary.tsx` (a `.crash` card instead of a
white screen), `src/app/id.ts` (`newId()`, used by `boxSession.ts` — a fallback for `crypto.randomUUID`,
which is unavailable on plain http and older Safari), `flavorOrPlaceholder` guards in BoxScreen / RecordsScreen /
StatsScreen / FlavorGrid / `csv.ts` (a record with a retired flavor id no longer throws),
`App.tsx` screens wrapped in `<ErrorBoundary>`, and `stats.ts` `secondsPerBox(records)` (median /
fastest / slowest / count per box size, 4 tests) shown as a "Seconds per box" card on StatsScreen.
Apply with `git checkout -b Zookerman3/crash-proofing main && git am ~/Downloads/crash-proofing.patch && npm run check`.
`git am` needs `user.name`/`user.email` set and no leftover `.git/rebase-apply`.

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

The scoring harnesses (whole-frame e2e run, the 27-condition perturbation generator, the
MobileNet feature extractor, the product-photo lattice fit) lived in the Cowork container and are
gone. What remains reproducible from this repo: `scripts/build-gallery.ts` (held-out numbers),
`scripts/crop_cells.py` (dataset), and the recipe in section 5. Re-creating the sweep is ~1 h:
perturb the rectified session-4 frames with OpenCV, run them through
`cells() → resizeToCrop → featureFromCrop → classify` exactly as `localDetector.ts` does, and score
against `training_label_4`.

## 10. Critical path to Saturday

1. ~~Decide MobileNet port vs freeze~~ Done, merged. Grid-finder done (`gridFinder.ts`): the box only
   has to be roughly inside the outline; measured limits in README. Open check: six real angled photos
   of the 30-box (20°/35°/50°) through `scripts/crop_cells.py` + the recogniser, to confirm the
   synthetic tilt numbers hold for real piece sides.
2. ~~Apply `crash-proofing.patch`~~ Done, merged.
3. Deploy to Vercel — the live camera preview needs **HTTPS** (`getUserMedia`), so the iPad test
   only works on the deployed link.
4. iPad capture test on a real 16 and 30 box; confirm the 6 and 10 inserts are 2×3 / 2×5 (one
   number in `grid.ts` if not).
5. Thursday: time 10+ boxes per method (tap vs camera), seconds per box and corrections; those
   numbers go in the video and README.
6. Video ≤ 3 min + what-to-click-first note. Demo mode exists for judges without chocolates.
7. Housekeeping: delete the stray `dataset_1.zip` from the repo root before anyone commits it.
