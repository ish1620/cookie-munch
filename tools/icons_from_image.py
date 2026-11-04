"""Make every Cookie Munch icon from one artwork image.

    python3 -I tools/icons_from_image.py art/cookie-munch.png            # write the real icons
    python3 -I tools/icons_from_image.py art/cookie-munch.png --preview DIR   # write previews to DIR only

The artwork is a square PNG. If it has no transparency but a painted-in checkerboard
(what image generators often produce for "transparent background"), the checkerboard
is cut away first. The toolbar button (16 and 32 px) uses a crop of the face, because the
full artwork is too busy to read at that size.

Pure Python, no image libraries (convert other formats first: sips -s format png in.webp --out in.png).
"""
import struct
import sys
import zlib
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT_ICONS = ROOT / "extension" / "icons"
APP_ICONS = ROOT / "xcode" / "Cookie Munch" / "Shared (App)" / "Assets.xcassets" / "AppIcon.appiconset"
WINDOW_ICON = ROOT / "xcode" / "Cookie Munch" / "Shared (App)" / "Resources" / "Icon.png"
LARGE_ICON = ROOT / "xcode" / "Cookie Munch" / "Shared (App)" / "Assets.xcassets" / "LargeIcon.imageset" / "icon-256.png"

# Stray decorations to remove, as boxes in fractions of the original image (left, top,
# right, bottom). Any piece that is cut off from the monster and sits inside a box goes.
ERASE_PIECES = [(0.385, 0.125, 0.42, 0.195)]   # the "1" above the head, and the square over it
# Boxes cleared outright, for decorations that touch something else (same units).
CLEAR_BOXES = [(0.695, 0.236, 0.7205, 0.302)]  # the "1" by the right eye, which touches a flame

# Face crop for the toolbar button, as fractions of the cleaned, square artwork: left, top, size.
FACE = (0.24, 0.10, 0.52)


class Image:
    """RGBA image: width, height, and a flat bytearray of RGBA pixels."""

    def __init__(self, width, height, pixels=None):
        self.width, self.height = width, height
        self.pixels = pixels if pixels is not None else bytearray(width * height * 4)

    def get(self, x, y):
        i = (y * self.width + x) * 4
        return self.pixels[i:i + 4]

    def crop(self, left, top, size):
        out = Image(size, size)
        for y in range(size):
            sy = top + y
            if not 0 <= sy < self.height:
                continue
            x0, x1 = max(0, left), min(self.width, left + size)
            if x0 >= x1:
                continue
            src = (sy * self.width + x0) * 4
            dst = (y * size + (x0 - left)) * 4
            out.pixels[dst:dst + (x1 - x0) * 4] = self.pixels[src:src + (x1 - x0) * 4]
        return out


# ---------------------------------------------------------------------------
# PNG reading and writing
# ---------------------------------------------------------------------------
def read_png(path):
    data = Path(path).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG file"
    pos, idat, width = 8, b"", None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and color_type in (2, 6) and interlace == 0, "need an 8-bit RGB or RGBA PNG"
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    channels = 4 if color_type == 6 else 3
    raw = zlib.decompress(idat)
    stride = width * channels
    out = bytearray(width * height * 4)
    prev = bytearray(stride)
    for y in range(height):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        for x in range(width):
            o = (y * width + x) * 4
            out[o:o + 3] = line[x * channels:x * channels + 3]
            out[o + 3] = line[x * channels + 3] if channels == 4 else 255
        prev = line
    return Image(width, height, out)


def write_png(path, img, opaque=False):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    rows = []
    for y in range(img.height):
        line = img.pixels[y * img.width * 4:(y + 1) * img.width * 4]
        if opaque:
            line = bytes(b for i, b in enumerate(line) if i % 4 != 3)
        rows.append(b"\0" + bytes(line))
    header = struct.pack(">IIBBBBB", img.width, img.height, 8, 2 if opaque else 6, 0, 0, 0)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) +
                           chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


# ---------------------------------------------------------------------------
# Background removal
# ---------------------------------------------------------------------------
def _is_backdrop(r, g, b):
    """White, or the light gray of a painted checkerboard (or the sticker's white border)."""
    # Any pale, colorless gray counts: compression blurs the squares' edges into
    # in-between grays. The artwork's black outline is what stops the fill.
    return max(r, g, b) - min(r, g, b) <= 14 and (r + g + b) / 3 >= 180


def remove_checkerboard(img):
    """Make the painted-in background transparent: flood-fill from the edges across
    white and light-gray pixels, stopping at the artwork's outline."""
    w, h, px = img.width, img.height, img.pixels
    background = bytearray(w * h)
    queue = deque()
    for x in range(w):
        queue.extend(((x, 0), (x, h - 1)))
    for y in range(h):
        queue.extend(((0, y), (w - 1, y)))
    while queue:
        x, y = queue.popleft()
        i = y * w + x
        if background[i]:
            continue
        o = i * 4
        if not _is_backdrop(px[o], px[o + 1], px[o + 2]):
            continue
        background[i] = 1
        if x > 0: queue.append((x - 1, y))
        if x < w - 1: queue.append((x + 1, y))
        if y > 0: queue.append((x, y - 1))
        if y < h - 1: queue.append((x, y + 1))

    # Soft edge: pale gray pixels touching the background are the outline fading into
    # white. Turn that fade into transparency instead of a white fringe.
    for y in range(h):
        for x in range(w):
            i = y * w + x
            o = i * 4
            if background[i]:
                px[o:o + 4] = b"\0\0\0\0"
                continue
            near = any(0 <= x + dx < w and 0 <= y + dy < h and background[(y + dy) * w + x + dx]
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)))
            r, g, b = px[o], px[o + 1], px[o + 2]
            if near and max(r, g, b) - min(r, g, b) <= 30:
                lum = (r + g + b) / 3
                alpha = max(0.0, min(1.0, (255 - lum) / (255 - 25)))
                px[o:o + 4] = bytes((25, 22, 35, round(alpha * 255)))
    return img



def drop_specks(img, min_area=0.00012):
    """Remove isolated bits smaller than min_area of the image (stray glitch pixels,
    tiny digits). Crumbs and everything bigger stay."""
    w, h, px = img.width, img.height, img.pixels
    limit = max(8, round(min_area * w * h))
    seen = bytearray(w * h)
    for start in range(w * h):
        if seen[start] or px[start * 4 + 3] <= 16:
            continue
        component, queue = [], deque([start])
        seen[start] = 1
        while queue:
            i = queue.popleft()
            component.append(i)
            x, y = i % w, i // w
            for j in ((i - 1) if x > 0 else -1, (i + 1) if x < w - 1 else -1,
                      (i - w) if y > 0 else -1, (i + w) if y < h - 1 else -1):
                if j >= 0 and not seen[j] and px[j * 4 + 3] > 16:
                    seen[j] = 1
                    queue.append(j)
        if len(component) < limit:
            for i in component:
                px[i * 4:i * 4 + 4] = b"\0\0\0\0"
    return img


def erase_pieces(img, boxes=ERASE_PIECES, clear=CLEAR_BOXES):
    """Remove pieces that are cut off from the rest of the artwork and lie (mostly)
    inside one of the boxes, and everything inside the clear boxes."""
    w, h, px = img.width, img.height, img.pixels
    for a, b, c, d in clear:
        for y in range(round(b * h), round(d * h)):
            for x in range(round(a * w), round(c * w)):
                px[(y * w + x) * 4:(y * w + x) * 4 + 4] = b"\0\0\0\0"
    rects = [(round(a * w), round(b * h), round(c * w), round(d * h)) for a, b, c, d in boxes]
    in_box = lambda x, y: any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in rects)
    seen = bytearray(w * h)
    for x0, y0, x1, y1 in rects:
        for y in range(y0, y1):
            for x in range(x0, x1):
                start = y * w + x
                if seen[start] or px[start * 4 + 3] <= 16:
                    continue
                piece, queue = [], deque([start])
                seen[start] = 1
                while queue:
                    i = queue.popleft()
                    piece.append(i)
                    cx, cy = i % w, i // w
                    for j in ((i - 1) if cx > 0 else -1, (i + 1) if cx < w - 1 else -1,
                              (i - w) if cy > 0 else -1, (i + w) if cy < h - 1 else -1):
                        if j >= 0 and not seen[j] and px[j * 4 + 3] > 16:
                            seen[j] = 1
                            queue.append(j)
                if sum(1 for i in piece if in_box(i % w, i // w)) >= 0.8 * len(piece):
                    for i in piece:
                        px[i * 4:i * 4 + 4] = b"\0\0\0\0"
    return img


def content_square(img, pad=0.02):
    """Crop to the visible artwork, centered in a square with a little padding."""
    w, h, px = img.width, img.height, img.pixels
    xs, ys = [], []
    for y in range(h):
        row = px[y * w * 4 + 3:(y + 1) * w * 4:4]
        visible = [x for x, a in enumerate(row) if a > 16]
        if visible:
            ys.append(y)
            xs.extend((visible[0], visible[-1]))
    left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
    size = round(max(right - left, bottom - top) * (1 + 2 * pad))
    cx, cy = (left + right) // 2, (top + bottom) // 2
    return img.crop(cx - size // 2, cy - size // 2, size)


# ---------------------------------------------------------------------------
# Sizes and app tiles
# ---------------------------------------------------------------------------
import subprocess
import tempfile

TILE_TOP = (52, 36, 92)       # midnight purple, so the blue monster stands out
TILE_BOTTOM = (20, 13, 40)


def resized(img, size, workdir):
    """img scaled to size×size, using macOS's sips (good quality, keeps transparency)."""
    src, dst = Path(workdir) / "resize-in.png", Path(workdir) / "resize-out.png"
    write_png(src, img)
    subprocess.run(["sips", "-z", str(size), str(size), str(src), "--out", str(dst)],
                   check=True, capture_output=True)
    return read_png(dst)


def tile(size, margin, radius):
    """A dark gradient tile: a rounded square (macOS) or, with margin=0, a full square (iOS)."""
    img = Image(size, size)
    lo, hi = margin * size, size - margin * size
    r = radius * size
    for y in range(size):
        t = y / (size - 1)
        color = bytes(round(a + (b - a) * t) for a, b in zip(TILE_TOP, TILE_BOTTOM))
        for x in range(size):
            if margin:
                px, py = x + 0.5, y + 0.5
                if not (lo <= px <= hi and lo <= py <= hi):
                    continue
                cx, cy = min(max(px, lo + r), hi - r), min(max(py, lo + r), hi - r)
                if (px - cx) ** 2 + (py - cy) ** 2 > r * r:
                    continue
            o = (y * size + x) * 4
            img.pixels[o:o + 4] = color + b"\xff"
    return img


def paste(base, art, scale, workdir):
    """Draw art, scaled to `scale` of the base's width, centered on base (alpha blended)."""
    art = resized(art, round(base.width * scale), workdir)
    off = (base.width - art.width) // 2
    for y in range(art.height):
        for x in range(art.width):
            s = (y * art.width + x) * 4
            a = art.pixels[s + 3]
            if not a:
                continue
            d = ((y + off) * base.width + x + off) * 4
            if base.pixels[d + 3] == 0:
                continue  # outside the tile
            k = a / 255
            for c in range(3):
                base.pixels[d + c] = round(art.pixels[s + c] * k + base.pixels[d + c] * (1 - k))
    return base


def build(source, out_dir=None):
    """Write every icon. With out_dir, write previews there instead of into the project."""
    art = read_png(source)
    if all(art.pixels[i] == 255 for i in range(3, len(art.pixels), 4 * 97)):
        art = drop_specks(remove_checkerboard(art))   # no real transparency: cut the painted background
    art = content_square(erase_pieces(art))
    fx, fy, fs = FACE
    face = art.crop(round(fx * art.width), round(fy * art.width), round(fs * art.width))

    def target(real_path, preview_name):
        return Path(out_dir) / preview_name if out_dir else real_path

    with tempfile.TemporaryDirectory() as work:
        # Extension: the face for small sizes, the whole artwork from 96 px up.
        for size in (16, 32):
            write_png(target(EXT_ICONS / f"toolbar-{size}.png", f"toolbar-{size}.png"), resized(face, size, work))
        write_png(target(EXT_ICONS / "icon-48.png", "icon-48.png"), resized(face, 48, work))
        for size in (96, 128, 256, 512):
            write_png(target(EXT_ICONS / f"icon-{size}.png", f"icon-{size}.png"), resized(art, size, work))

        # Mac app icon: rounded tile, Apple's icon grid (824 of 1024 px). Face below 128 px.
        mac_full = paste(tile(1024, 100 / 1024, 185 / 1024), art, 0.74, work)
        mac_face = paste(tile(1024, 100 / 1024, 185 / 1024), face, 824 / 1024, work)  # fills the tile
        for points in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                size = points * scale
                img = mac_full if size >= 128 else mac_face
                img = img if size == 1024 else resized(img, size, work)
                write_png(target(APP_ICONS / f"mac-icon-{points}@{scale}x.png", f"mac-icon-{points}@{scale}x.png"), img)

        # iPhone app icon: full square, opaque, the face filling all of it (home screen icons are small).
        ios = paste(tile(1024, 0, 0), face, 1.0, work)
        write_png(target(APP_ICONS / "universal-icon-1024@1x.png", "universal-icon-1024@1x.png"), ios, opaque=True)

        # The app's own window shows the whole artwork.
        write_png(target(WINDOW_ICON, "window-icon-512.png"), resized(art, 512, work))
        write_png(target(LARGE_ICON, "large-icon-256.png"), resized(art, 256, work))
        write_png(target(ROOT / "art" / "cookie-munch-clean.png", "clean.png"), art)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        sys.exit(__doc__)
    preview = args[args.index("--preview") + 1] if "--preview" in args else None
    if preview:
        Path(preview).mkdir(parents=True, exist_ok=True)
    else:
        (ROOT / "art").mkdir(exist_ok=True)
    build(args[0], preview)
    print("wrote previews to", preview) if preview else print("wrote all icons")
