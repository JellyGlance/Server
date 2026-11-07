#!/usr/bin/env python3
"""Build Blobbo look assets from the locked art.

For every look this writes into public/blobbo/looks/:
  <id>.svg            full look (soft jelly v5 body + outfit)
  <id>-overlay.svg    outfit only, same viewBox, layered on the idle body
  <id>-thumb.png      128px picker thumbnail
  <id>-still.png      192px still (reduced motion)
  <id>-idle.webp      30-frame bouncy idle (every other v5 idle frame), outfit riding the body

Usage: build-blobbo-looks.py <art-dir> <idle-frames-dir>
Needs Pillow and a headless Chrome for SVG rasterising.
"""
import difflib, os, re, subprocess, sys, tempfile
import xml.dom.minidom
from PIL import Image, ImageChops

LOOKS = os.environ["ONLY"].split(",") if os.environ.get("ONLY") else ["base", "halloween", "winter", "hearts", "summer",
         "newyear", "easter", "pride", "birthday", "gaming", "stpatricks", "harvest",
         "cozy", "chef", "space", "music", "bookworm", "sports", "wizard", "movie"]
SEASONAL = {"base", "halloween", "winter", "hearts", "summer"}
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "blobbo", "looks")
SIZE = 384
PAD = 56
CHROME = os.environ.get("CHROME", "google-chrome")


def src_svg(art, look):
    kind = "season" if look in SEASONAL else "costume"
    return os.path.join(art, f"blobbo-{kind}-{look}.svg")


def render(svg_path, png_path):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as h:
        h.write(f"<html><body style='margin:0;background:transparent'><img src='file://{svg_path}' width={SIZE} height={SIZE}></body></html>")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
                    f"--window-size={SIZE},{SIZE}", f"--screenshot={png_path}", f"file://{h.name}"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.unlink(h.name)
    return Image.open(png_path).convert("RGBA")


def split(svg):
    return svg.replace("><", ">\n<").splitlines()


def overlay_svg(base, look):
    """Outfit-only SVG: the base header and defs plus every element the look adds."""
    b, l = split(base), split(look)
    added = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, b, l, autojunk=False).get_opcodes():
        if tag in ("insert", "replace"):
            added += l[j1:j2]
    head = []
    for line in l:
        head.append(line)
        if line.startswith("</defs>"):
            break
    # keep every defs block of the look so gradients/filters resolve
    defs = re.findall(r"<defs>.*?</defs>", look, re.S)
    root = re.match(r"<svg[^>]*>", look).group(0)
    body = "\n".join(x for x in added if not x.startswith("<defs") and not x.startswith("</defs"))
    out = root + "\n" + "\n".join(defs) + "\n" + body + "\n</svg>\n"
    xml.dom.minidom.parseString(out)  # must stay well-formed
    return out


def body_box(im):
    return im.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()


def main(art, frames_dir):
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp()
    base_svg = open(src_svg(art, "base")).read()
    frames = [Image.open(os.path.join(frames_dir, f)).convert("RGBA") for f in sorted(os.listdir(frames_dir)) if f.endswith(".png")]
    base_r = render(os.path.realpath(src_svg(art, "base")), os.path.join(tmp, "base.png"))
    # Body reference in the rendered SVG: dome top and width (ignore the floor shadow).
    bx0, by0, bx1, _ = body_box(base_r.crop((0, 0, SIZE, int(SIZE * 0.8))))
    for look in LOOKS:
        src = open(src_svg(art, look)).read()
        open(os.path.join(OUT, f"{look}.svg"), "w").write(src)
        full = render(os.path.realpath(src_svg(art, look)), os.path.join(tmp, f"{look}.png"))
        full.resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, f"{look}-thumb.png"), optimize=True)
        full.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, f"{look}-still.png"), optimize=True)
        if look == "base":
            overlay = Image.new("RGBA", (SIZE, SIZE))
        else:
            ov = overlay_svg(base_svg, src)
            p = os.path.join(OUT, f"{look}-overlay.svg")
            open(p, "w").write(ov)
            overlay = render(os.path.realpath(p), os.path.join(tmp, f"{look}-ov.png"))
        out = []
        for fr in frames[::2]:
            fx0, fy0, fx1, _ = body_box(fr)
            s = (fx1 - fx0) / (bx1 - bx0)
            o = overlay.resize((round(SIZE * s), round(SIZE * s)), Image.LANCZOS)
            dx = round((fx0 + fx1) / 2 - ((bx0 + bx1) / 2) * s)
            dy = round(fy0 - by0 * s)
            # Pad the canvas so tall hats and helmets never clip at the top.
            c = Image.new("RGBA", (SIZE + 2 * PAD, SIZE + 2 * PAD))
            c.alpha_composite(fr, (PAD, PAD + PAD // 2))
            dx, dy = dx + PAD, dy + PAD + PAD // 2
            c.alpha_composite(o, (max(dx, 0), max(dy, 0)), (max(-dx, 0), max(-dy, 0)))
            out.append(c.resize((192, 192), Image.LANCZOS))
        dur = 1000 // 15
        out[0].save(os.path.join(OUT, f"{look}-idle.webp"), save_all=True, append_images=out[1:], duration=dur, loop=0, lossless=False, quality=72, method=4)
        print("built", look)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
