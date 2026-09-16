#!/usr/bin/env python3
"""
crop_cells.py — turn labelled whole-box photos into a per-flavor training set.

    python3 crop_cells.py Photos/  --out dataset/  [--qa qa/]

For each Training_Set_N folder it reads the training_label_N file, finds the
6x5 insert grid in every photo, and writes one crop per cell into
    dataset/<flavor-id>/<set>_<photo>_r<row>c<col>.jpg

How the grid is found
---------------------
Not from the box edge: the dark lid and its shadow sit right against the
insert in half the photos and fool any edge-based detector. Instead the
chocolates themselves are the landmarks. Saturated blobs -> centroids ->
fit a 6x5 lattice (homography) to them with RANSAC. Empty slots and the
few dark-brown pieces the colour mask misses don't matter: 15+ good
centroids pin the lattice, and every cell is derived from it.

A photo where the fit fails is reported and skipped, never silently
cropped wrong. Put 4 corner points for it in corners.json to override:
    {"IMG_3358.HEIC": [[x,y],[x,y],[x,y],[x,y]]}   # TL, TR, BR, BL, full-res px

Label file format (one line per slot, "row.col Name", blank lines ignored):
    1.1 Bananas Foster
    ...
    5.4 empty
Slots not listed are treated as empty. Duplicate slot numbers are an error.

Requires: pip install opencv-python-headless pillow pillow-heif numpy
"""
import argparse, json, re, sys, unicodedata
from pathlib import Path
import numpy as np, cv2
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()

ROWS, COLS = 5, 6
CELL = 256          # output crop size (px), square
INSET = 0.06        # trim this fraction from each cell edge (divider walls)
WORK_W = 1400       # detection runs at this width; the crop uses full res

# Display names as written by hand -> flavor id as used in src/data/flavors.json.
# Two flavors in the photos aren't in the catalog yet (orange, strawberry);
# they get ids in the same style so the catalog can be extended to match.
ALIASES = {
    'amaretto': 'amaretto',
    'bananas foster': 'bananas-foster', 'banana foster': 'bananas-foster',
    'brownie batter': 'brownie-batter',
    'caramel apple cider': 'caramel-apple-cider',
    'champagne': 'champagne',
    'cheesecake': 'cheesecake',
    'confetti cake': 'confetti-cake',
    'cookies & cream': 'cookies-cream', 'cookies and cream': 'cookies-cream',
    'creme brulee': 'creme-brulee',
    'dulce de leche': 'dulce-de-leche',
    'espresso martini': 'espresso-martini',
    'grey salt caramel': 'grey-salt-caramel', 'gray salt caramel': 'grey-salt-caramel',
    'key lime pie': 'key-lime-pie',
    'lemon': 'lemon',
    'manhattan': 'manhattan',
    'maple cream': 'maple-cream',
    'peanut butter caramel': 'peanut-butter-caramel',
    'pineapple moscato': 'pineapple-moscato',
    'pistachio': 'pistachio',
    'pumpkin spice latte': 'pumpkin-spice-latte',
    'raspberry': 'raspberry',
    "s'mores": 'smores', 'smores': 'smores',
    'salted caramel': 'salted-caramel',
    'tea & honey': 'tea-honey', 'tea and honey': 'tea-honey',
    'turtle': 'turtle',
    'orange': 'orange',
    'strawberry': 'strawberry', 'strawberry shortcake': 'strawberry',
    'empty': 'empty', 'none': 'empty', '-': 'empty',
}

def norm(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    s = s.lower().replace('’', "'").strip()
    s = re.sub(r'\s+', ' ', s)
    return s

def to_id(name):
    key = norm(name)
    if key in ALIASES: return ALIASES[key]
    raise ValueError(f'unknown flavor name {name!r} — add it to ALIASES')

# ------------------------------------------------------------------ labels

def parse_labels(path):
    """-> dict {(row, col): flavor_id}, rows/cols 1-based. Raises on duplicates."""
    grid, seen = {}, {}
    for ln, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = line.strip()
        if not line: continue
        m = re.match(r'^(\d)\.(\d)\s+(.+?)\s*$', line)
        if not m: raise ValueError(f'{path.name}:{ln}: cannot parse {line!r}')
        r, c, name = int(m[1]), int(m[2]), m[3]
        if not (1 <= r <= ROWS and 1 <= c <= COLS):
            raise ValueError(f'{path.name}:{ln}: slot {r}.{c} outside {ROWS}x{COLS}')
        if (r, c) in seen:
            raise ValueError(f'{path.name}:{ln}: slot {r}.{c} listed twice '
                             f'({seen[(r,c)]!r} and {name!r}) — fix the label file')
        seen[(r, c)] = name
        grid[(r, c)] = to_id(name)
    for r in range(1, ROWS+1):
        for c in range(1, COLS+1):
            grid.setdefault((r, c), 'empty')
    return grid

# ------------------------------------------------------------------ grid fit

def load_image(path):
    im = Image.open(path).convert('RGB')
    full = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    s = WORK_W / full.shape[1]
    work = cv2.resize(full, (WORK_W, int(full.shape[0]*s)), interpolation=cv2.INTER_AREA)
    return full, work, s

def piece_centroids(work):
    """Centroids of colourful blobs of roughly one-chocolate size."""
    hsv = cv2.cvtColor(work, cv2.COLOR_BGR2HSV)
    S, V = hsv[..., 1], hsv[..., 2]
    m = ((S > 58) & (V > 45)).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(m)
    area = work.shape[0] * work.shape[1]
    H, W = work.shape[:2]
    pts = []
    for i in range(1, n):
        a = stats[i, cv2.CC_STAT_AREA]
        w, h = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        if not (0.0015 * area < a < 0.02 * area): continue
        if not (0.5 < w / max(h, 1) < 2.0): continue     # roughly round-ish
        # A real piece sits in a black cell. A gold-rim glint or a lid highlight
        # does not: sample a ring just outside the blob and require dark, grey.
        # A piece against the rim has a ring that is mostly black with a gold
        # arc, so ask that a third of the ring be dark grey, not the median.
        cx, cy = cent[i]; r = 0.7 * max(w, h)
        ang = np.linspace(0, 2*np.pi, 36, endpoint=False)
        xs = np.clip((cx + r*np.cos(ang)).astype(int), 0, W-1)
        ys = np.clip((cy + r*np.sin(ang)).astype(int), 0, H-1)
        ring_v, ring_s = np.percentile(V[ys, xs], 35), np.percentile(S[ys, xs], 35)
        if ring_v > 110 or ring_s > 110: continue
        pts.append(cent[i])
    return np.array(pts, np.float32)

def ideal_centers():
    return np.array([[c + 0.5, r + 0.5] for r in range(ROWS) for c in range(COLS)], np.float32)

def _order_tl_tr_br_bl(q):
    s = q.sum(1); d = np.diff(q, axis=1).ravel()
    return np.array([q[np.argmin(s)], q[np.argmin(d)], q[np.argmax(s)], q[np.argmax(d)]], np.float32)

def _refine(H, pts, ideal, rounds=5):
    """Alternate nearest-cell assignment and RANSAC re-fit. Loose first, tight later."""
    inliers = 0
    for k in range(rounds):
        proj = cv2.perspectiveTransform(ideal.reshape(-1, 1, 2), H).reshape(-1, 2)
        j = np.linalg.norm(pts[:, None, :] - proj[None, :, :], axis=2).argmin(1)
        tol = (0.35 if k == 0 else 0.15) * cell_px(H)
        H2, mask = cv2.findHomography(ideal[j], pts, cv2.RANSAC, tol)
        if H2 is None: break
        H, inliers = H2, int(mask.sum())
    return H, inliers

def _shift(H, dx, dy):
    """Same lattice, re-indexed by (dx, dy) cells."""
    T = np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1]], np.float64)
    return H @ T

def occupancy_score(H, pts, occupied):
    """+1 per piece landing in a labelled cell, -1 per piece in an empty or
    out-of-grid cell. A lattice shifted by a row scores badly here even though
    every piece still sits on a lattice point."""
    inv = np.linalg.inv(H)
    uv = cv2.perspectiveTransform(pts.reshape(-1, 1, 2), inv).reshape(-1, 2)
    score = 0
    for u, v in uv:
        c, r = int(np.floor(u)) + 1, int(np.floor(v)) + 1
        if 1 <= r <= ROWS and 1 <= c <= COLS and (r, c) in occupied: score += 1
        else: score -= 1
    return score

def pitch_ok(H, pts):
    """Every lattice edge must be about one piece-spacing long: rejects sheared fits."""
    nn = np.sort(np.linalg.norm(pts[:, None] - pts[None, :], axis=2), axis=1)[:, 1]
    pitch = float(np.median(nn))
    g = np.array([[[c, r]] for r in range(ROWS + 1) for c in range(COLS + 1)], np.float32)
    P = cv2.perspectiveTransform(g, H).reshape(ROWS + 1, COLS + 1, 2)
    dx = np.linalg.norm(P[:, 1:] - P[:, :-1], axis=2)
    dy = np.linalg.norm(P[1:, :] - P[:-1, :], axis=2)
    edges = np.concatenate([dx.ravel(), dy.ravel()])
    return bool(np.all(edges > 0.7 * pitch) and np.all(edges < 1.3 * pitch))

def fit_lattice(pts, occupied):
    """Homography H: unit-lattice coords -> work-image pixels. None if it can't.

    The box is rarely square to the frame, so the seed must carry its rotation:
    an axis-aligned bounding box puts the far cells most of a cell off and the
    refinement can't recover. Seed from the rotated min-area rectangle of the
    centroids (corners ~ corner-cell centres), keep the axis-aligned seed as a
    second candidate, and take whichever converges with more inliers."""
    if len(pts) < 12: return None, 0
    ideal = ideal_centers()
    src = np.array([[0.5, 0.5], [COLS-0.5, 0.5], [COLS-0.5, ROWS-0.5], [0.5, ROWS-0.5]], np.float32)

    seeds = []
    rect = cv2.minAreaRect(pts)
    seeds.append(_order_tl_tr_br_bl(cv2.boxPoints(rect).astype(np.float32)))
    x0, y0 = pts.min(0); x1, y1 = pts.max(0)
    seeds.append(np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float32))

    best = (None, -10**9, 0)
    for dst in seeds:
        H, inl = _refine(cv2.getPerspectiveTransform(src, dst), pts, ideal)
        if H is None: continue
        # the fit may have locked on one row or column over; try the neighbours
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                Hs = _shift(H, dx, dy)
                if not pitch_ok(Hs, pts): continue
                sc = occupancy_score(Hs, pts, occupied)
                if sc > best[1]: best = (Hs, sc, inl)
    H, sc, inl = best
    # demand near-total agreement with the label file before trusting a photo
    if H is None or sc < 0.85 * len(pts): return None, sc
    return H, inl

def cell_px(H):
    """Approx. size of one cell in work pixels under H."""
    p = cv2.perspectiveTransform(np.array([[[0, 0]], [[1, 0]], [[0, 1]]], np.float32), H).reshape(3, 2)
    return (np.linalg.norm(p[1]-p[0]) + np.linalg.norm(p[2]-p[0])) / 2

def lattice_from_corners(corners_full, s):
    """corners TL,TR,BR,BL in full-res px (outer edge of the cell grid) -> H in work px."""
    dst = np.array(corners_full, np.float32) * s
    src = np.array([[0, 0], [COLS, 0], [COLS, ROWS], [0, ROWS]], np.float32)
    return cv2.getPerspectiveTransform(src, dst)

def rectify(full, H_work, s):
    """Warp the full-res photo so the lattice becomes an axis-aligned COLS*CELL x ROWS*CELL image."""
    S = np.diag([1/s, 1/s, 1.0]).astype(np.float64)        # work px -> full px
    H_full = S @ H_work                                    # unit -> full px
    unit_to_out = np.diag([CELL, CELL, 1.0]).astype(np.float64)
    M = unit_to_out @ np.linalg.inv(H_full)                # full px -> out px
    return cv2.warpPerspective(full, M, (COLS*CELL, ROWS*CELL), flags=cv2.INTER_AREA)

def cell_crop(rect, r, c):
    y, x = (r-1)*CELL, (c-1)*CELL
    k = int(CELL * INSET)
    return rect[y+k:y+CELL-k, x+k:x+CELL-k]

# ------------------------------------------------------------------ main

def qa_tile(rect, grid, label):
    vis = rect.copy()
    for r in range(ROWS+1): cv2.line(vis, (0, r*CELL), (COLS*CELL, r*CELL), (0, 255, 0), 3)
    for c in range(COLS+1): cv2.line(vis, (c*CELL, 0), (c*CELL, ROWS*CELL), (0, 255, 0), 3)
    for (r, c), fid in grid.items():
        cv2.putText(vis, fid[:12], ((c-1)*CELL+8, (r-1)*CELL+CELL-10), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
    cv2.putText(vis, label, (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 0, 255), 3)
    return vis

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photos', type=Path, help='folder containing Training_Set_* subfolders')
    ap.add_argument('--out', type=Path, default=Path('dataset'))
    ap.add_argument('--qa', type=Path, default=None, help='write one rectified, gridded QA image per photo here')
    ap.add_argument('--min-inliers', type=int, default=14)
    args = ap.parse_args()

    sets = sorted(p for p in args.photos.iterdir() if p.is_dir() and p.name.lower().startswith('training_set'))
    if not sets: sys.exit(f'no Training_Set_* folders under {args.photos}')
    args.out.mkdir(parents=True, exist_ok=True)
    if args.qa: args.qa.mkdir(parents=True, exist_ok=True)

    total, failed, per_class = 0, [], {}
    for sd in sets:
        labels = [p for p in sd.iterdir() if p.name.lower().startswith('training_label')]
        if len(labels) != 1: sys.exit(f'{sd.name}: expected one training_label file, found {len(labels)}')
        grid = parse_labels(labels[0])
        corners = {}
        cj = sd / 'corners.json'
        if cj.exists(): corners = json.loads(cj.read_text())
        photos = sorted(p for p in sd.iterdir() if p.suffix.lower() in ('.heic', '.jpg', '.jpeg', '.png'))
        tag = re.sub(r'\D', '', sd.name) or sd.name
        print(f'\n{sd.name}: {len(photos)} photos, {sum(v!="empty" for v in grid.values())} labelled slots')

        for ph in photos:
            full, work, s = load_image(ph)
            if ph.name in corners:
                H, inl = lattice_from_corners(corners[ph.name], s), 99
                how = 'corners.json'
            else:
                pts = piece_centroids(work)
                occupied = {rc for rc, fid in grid.items() if fid != 'empty'}
                H, inl = fit_lattice(pts, occupied)
                how = f'{inl} of {len(pts)} pieces'
            if H is None or inl < args.min_inliers:
                print(f'  {ph.name}: FAILED ({how}) — add it to {sd.name}/corners.json')
                failed.append(f'{sd.name}/{ph.name}')
                continue
            rect = rectify(full, H, s)
            stem = f'{tag}_{ph.stem}'
            for (r, c), fid in grid.items():
                d = args.out / fid; d.mkdir(exist_ok=True)
                cv2.imwrite(str(d / f'{stem}_r{r}c{c}.jpg'), cell_crop(rect, r, c), [cv2.IMWRITE_JPEG_QUALITY, 93])
                per_class[fid] = per_class.get(fid, 0) + 1
                total += 1
            if args.qa:
                cv2.imwrite(str(args.qa / f'{stem}.jpg'), qa_tile(rect, grid, f'{sd.name} {ph.name} ({how})'), [cv2.IMWRITE_JPEG_QUALITY, 80])
            print(f'  {ph.name}: ok ({how})')

    print(f'\n{total} crops written to {args.out}/')
    for fid, n in sorted(per_class.items()): print(f'  {fid:<24}{n}')
    if failed:
        print(f'\n{len(failed)} photo(s) need manual corners:'); [print('  ' + f) for f in failed]
        sys.exit(1)

if __name__ == '__main__':
    main()
