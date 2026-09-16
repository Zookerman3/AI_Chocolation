# Bonbon crop dataset

Labeled training crops of Cocoa Dolce bonbons, shot and built by our team on
2026-09-15/16. Everything here was produced after the prompts unlocked.

## What's in it

| | |
|---|---|
| Classes | 27 flavors + `empty` |
| Images | **1920** — exactly 64 per flavor, 192 `empty` |
| Format | 256×256 JPEG, square, cropped from full-resolution photos |
| Archives | `dataset-part1-amaretto-to-lemon.zip` (15.3 MB), `dataset-part2-manhattan-to-turtle.zip` (14.2 MB) |

Split across two zips only to keep each file small. Unzip both into the same
place — they share one `dataset/` root and do not overlap.

```
dataset/
  amaretto/            64 images
  bananas-foster/      64
  brownie-batter/      64
  ...
  empty/              192
```

Folder names are flavor ids in the same style as `src/data/flavors.json`, so a
model trained on these emits class names that map to the catalog with no fuzzy
matching. That is what `src/features/camera/applyDetections.ts` expects.

## File naming

```
dataset/amaretto/3_IMG_3369_r4c4.jpg
                 │ │        │  └── column in the 6-wide insert
                 │ │        └───── row in the 5-tall insert
                 │ └────────────── source photo
                 └──────────────── training set (1–4)
```

Every crop traces back to its source photo and slot, so a suspect image can be
checked against the original.

## How it was made

Four training sets. Each is ~11 top-down photos of a 5×6 insert tray loaded
with a known arrangement of pieces, plus a `training_label_N` file listing what
sits in each slot (`4.1 Amaretto`). Sets were re-arranged between shoots so no
flavor is tied to one slot position.

`crop_cells.py` turns those into the per-flavor folders:

```
pip install opencv-python-headless pillow pillow-heif numpy
python3 crop_cells.py Photos/ --out dataset/ --qa qa/
```

The grid is found from **the chocolates themselves**, not the box edge — the
dark lid and its shadow sit against the insert in half the photos and defeat
edge detection. Saturated blobs → centroids → a 5×6 lattice fit by RANSAC
homography. Empty slots and dark pieces the color mask misses don't matter;
15+ good centroids pin the lattice and every cell is derived from it.

A photo whose fit fails is **reported and skipped, never silently cropped
wrong**. Override it by putting four corner points in `corners.json`.

## Known limits

- **Two classes aren't in the app catalog.** `orange` and `strawberry` are in
  the photos but not in `src/data/flavors.json` (25 flavors). Either extend the
  catalog or drop those two classes before training, or detections will come
  back with ids the app can't resolve.
- **One session, one tray, one camera.** All four sets were shot the same night
  on the same phone against the same insert. Lighting varies less than a real
  counter will. A new batch, a glaze change, or a different tray is untested.
- **Two physical pieces per flavor**, photographed repeatedly. 64 crops per
  class is 64 *views*, not 64 distinct chocolates — less variety than the
  number suggests.
- **`empty` is over-represented** (192 vs 64) because unused slots appear in
  every photo. Weight it down or subsample when training.
- **Seasonal flavors we couldn't buy are absent entirely.**
- **No held-out split is pre-made.** Hold out whole *photos* (by the `IMG_xxxx`
  in the filename), never individual crops — crops from one photo are near
  duplicates, and splitting them across train/test inflates accuracy.

## Using it

Any folders-per-class trainer reads this layout as-is: Ultralytics
`yolo classify`, a torchvision `ImageFolder`, Teachable Machine, or an
embedding + k-NN pass with a frozen backbone.

Report **top-1 and top-3**, and a per-class confusion matrix. The brown
copper-splatter group — Manhattan, Espresso Martini, S'Mores, Peanut Butter
Caramel, Amaretto, Champagne, Crème Brûlée, Turtle — is where accuracy will
fall, and that block in the matrix is the honest-limits figure for the video.
