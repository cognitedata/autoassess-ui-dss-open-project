"""Generate UML-style sequence diagrams (SVG) for the AutoAssess mission flow."""
from html import escape

W = 1160
PARTS = [  # key, label, sublabel, x, kind
    ("insp", "Inspector", "web user", 90, "actor"),
    ("web", "Web app", "Fusion · Flows", 320, "box"),
    ("cdf", "CDF", "autoassess space", 560, "cdf"),
    ("gs", "autoassess_bridge", "ROS node", 810, "gs"),
    ("drone", "Robot", "gbplanner + sensors", 1060, "drone"),
]
X = {p[0]: p[3] for p in PARTS}
ROW = 30
TOP = 96

STYLE = """
<style>
  .sq text { font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; fill: var(--ink, #13212b); }
  .sq .lbl { font-size: 14px; paint-order: stroke; stroke: var(--paper, #f2f4f3); stroke-width: 5px; stroke-linejoin: round; }
  .sq .lbl code, .sq .mono { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; }
  .sq .head { fill: var(--panel, #fff); stroke: var(--ink, #13212b); stroke-width: 1.5; }
  .sq .head.cdf { stroke: var(--data, #2f6fd6); stroke-width: 2.5; }
  .sq .head.gs { stroke: var(--hazard, #e3b21c); stroke-width: 2.5; }
  .sq .htitle { font-family: "Archivo", "Helvetica Neue", Arial, sans-serif; font-weight: 700; font-size: 16px; }
  .sq .hsub { font-size: 11.5px; fill: var(--steel, #5c6f7a); letter-spacing: .04em; }
  .sq .life { stroke: var(--steel, #5c6f7a); stroke-width: 1; stroke-dasharray: 4 4; }
  .sq .act { fill: var(--hazard, #e3b21c); fill-opacity: .28; stroke: var(--ink, #13212b); stroke-width: 1; }
  .sq .msg { stroke: var(--ink, #13212b); stroke-width: 1.6; fill: none; }
  .sq .ret { stroke: var(--ink, #13212b); stroke-width: 1.4; fill: none; stroke-dasharray: 7 5; }
  .sq .headfill { fill: var(--ink, #13212b); }
  .sq .frame { fill: none; stroke: var(--data, #2f6fd6); stroke-width: 1.5; }
  .sq .frame.loop { stroke: var(--ok, #1f8a4c); }
  .sq .frame.inner { stroke-opacity: .75; }
  .sq .tag { fill: var(--panel, #fff); stroke: inherit; }
  .sq .tagtxt { font-size: 12.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .sq .guard { font-size: 13px; font-style: italic; fill: var(--steel, #5c6f7a); paint-order: stroke; stroke: var(--paper, #f2f4f3); stroke-width: 5px; stroke-linejoin: round; }
  .sq .sep { stroke: var(--data, #2f6fd6); stroke-width: 1.3; stroke-dasharray: 8 6; }
  .sq .num { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 12px; fill: var(--steel, #5c6f7a); }
</style>
"""


def header():
    out = []
    for key, label, sub, x, kind in PARTS:
        if kind == "actor":
            out.append(
                f'<g stroke="var(--ink, #13212b)" stroke-width="1.8" fill="none">'
                f'<circle cx="{x}" cy="16" r="9"/><line x1="{x}" y1="25" x2="{x}" y2="46"/>'
                f'<line x1="{x-14}" y1="33" x2="{x+14}" y2="33"/>'
                f'<line x1="{x}" y1="46" x2="{x-11}" y2="60"/><line x1="{x}" y1="46" x2="{x+11}" y2="60"/></g>'
                f'<text class="htitle" x="{x}" y="78" text-anchor="middle">{label}</text>'
            )
        else:
            cls = {"cdf": "head cdf", "gs": "head gs"}.get(kind, "head")
            out.append(
                f'<rect class="{cls}" x="{x-92}" y="6" width="184" height="58" rx="3"/>'
                f'<text class="htitle" x="{x}" y="31" text-anchor="middle">{label}</text>'
                f'<text class="hsub" x="{x}" y="51" text-anchor="middle">{sub}</text>'
            )
    return out


def render(events, title, start=0):
    body = []
    y = TOP + 14
    frames = []  # stack: (kind, x1, x2, ytop, depth)
    n = start
    for ev in events:
        t = ev[0]
        if t in ("msg", "ret"):
            _, a, b, label, *rest = ev
            numbered = not (rest and rest[0] == "nonum")
            y += ROW
            xa, xb = X[a], X[b]
            d = 1 if xb > xa else -1
            x1, x2 = xa + 6 * d, xb - 6 * d
            cls = "msg" if t == "msg" else "ret"
            body.append(f'<line class="{cls}" x1="{x1}" y1="{y}" x2="{x2 - 9*d}" y2="{y}"/>')
            if t == "msg":
                body.append(f'<path class="headfill" d="M{x2},{y} l{-11*d},-5.5 v11 z"/>')
            else:
                body.append(f'<path class="ret" style="stroke-dasharray:none" d="M{x2 - 11*d},{y-6} L{x2},{y} L{x2 - 11*d},{y+6}"/>')
            mid = (xa + xb) / 2
            if numbered:
                n += 1
                label = f'<tspan class="num">{n}  </tspan>{label}'
            body.append(f'<text class="lbl" x="{mid}" y="{y-8}" text-anchor="middle">{label}</text>')
        elif t == "self":
            _, a, label = ev
            y += ROW + 4
            x = X[a]
            body.append(f'<path class="msg" d="M{x+6},{y-10} h30 v18 h-20"/>')
            body.append(f'<path class="headfill" d="M{x+6},{y+8} l11,-5.5 v11 z"/>')
            n += 1
            body.append(f'<text class="lbl" x="{x-14}" y="{y+3}" text-anchor="end"><tspan class="num">{n}  </tspan>{label}</text>')
            y += 6
        elif t in ("alt", "loop"):
            _, a, b, guard = ev
            depth = len(frames)
            pad = 150 - depth * 22
            x1, x2 = X[a] - pad, X[b] + pad - 40 + depth * 10
            x1 = max(x1, 8 + depth * 14)
            x2 = min(x2, W - 8 - depth * 14)
            y += 22
            frames.append((t, x1, x2, y, depth))
            y += 16
            body.append(f'<text class="guard" x="{x1 + 76}" y="{y - 22 + 17}">{guard}</text>')
        elif t == "else":
            kind, x1, x2, ytop, depth = frames[-1]
            y += 22
            body.append(f'<line class="sep" x1="{x1}" y1="{y}" x2="{x2}" y2="{y}"/>')
            body.append(f'<text class="guard" x="{x1 + 10}" y="{y + 17}">{ev[1]}</text>')
            y += 12
        elif t == "end":
            kind, x1, x2, ytop, depth = frames.pop()
            y += 16
            cls = "frame loop" if kind == "loop" else "frame"
            if depth:
                cls += " inner"
            tagw = 58
            body.insert(0, f'<rect class="{cls}" x="{x1}" y="{ytop}" width="{x2 - x1}" height="{y - ytop}"/>')
            body.append(
                f'<g class="{cls}"><path style="fill:var(--panel, #fff)" d="M{x1},{ytop} h{tagw} v12 l-8,9 h{-tagw+8} z"/></g>'
                f'<text class="tagtxt" x="{x1 + 8}" y="{ytop + 15}">{kind}</text>'
            )
        elif t == "gap":
            y += ev[1]
    y_end = y + 26
    life = []
    for key, *_ in PARTS:
        x = X[key]
        top = 84 if key == "insp" else 64
        life.append(f'<line class="life" x1="{x}" y1="{top}" x2="{x}" y2="{y_end}"/>')
        life.append(f'<rect class="act" x="{x-5}" y="{TOP}" width="10" height="{y_end - TOP - 8}"/>')
    h = y_end + 6
    return (
        f'<svg class="sq" viewBox="0 0 {W} {h}" role="img" aria-label="{escape(title)}" '
        f'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMin meet">'
        f'<title>{escape(title)}</title>{STYLE}' + "".join(life) + "".join(header()) + "".join(body) + "</svg>"
    )


C = lambda s: f'<tspan class="mono">{s}</tspan>'

PART1 = [
    ("msg", "insp", "web", "Create plan, pick reference map"),
    ("msg", "web", "cdf", f"InspectionPlan {C('Draft')} + tasks"),
    ("msg", "insp", "web", f"Mark {C('Ready')}"),
    ("msg", "web", "cdf", f"plan.status = {C('Ready')}"),
    ("gap", 10),
    ("msg", "gs", "cdf", "poll: newest Ready plan (automatic)"),
    ("ret", "cdf", "gs", f"{C('plan.json')} + reference map"),
    ("self", "gs", "set gbplanner global bound"),
    ("msg", "gs", "drone", f"{C('/autoassess/plan')}, {C('/autoassess/inspection_targets')}"),
    ("msg", "gs", "drone", f"{C('/ballast_tank/pointcloud')} (latched map)"),
]

PART2 = [
    ("loop", "gs", "drone", "[mission: gbplanner explores and inspects]"),
    ("msg", "drone", "gs", f"{C('/gbplanner_path')}, odometry, homing"),
    ("msg", "drone", "gs", f"{C('/autoassess/findings')} (detections, JSON)"),
    ("end",),
    ("self", "gs", "mission end detected (homing + quiet + still)"),
    ("msg", "gs", "drone", f"{C('generate_mesh')} → save map PLY"),
    ("msg", "gs", "cdf", "upload mesh + files (CogniteFiles)"),
    ("msg", "gs", "cdf", f"create campaign → {C('Complete')}"),
    ("msg", "gs", "cdf", f"create findings plan ({C('Draft')})"),
    ("gap", 8),
    ("msg", "gs", "cdf", "dss worker (ROS-launched): build 3D models"),
    ("gap", 8),
    ("msg", "insp", "web", "Review campaign + findings plan"),
    ("msg", "web", "cdf", "stream 3D model; edit campaign/plan"),
    ("msg", "insp", "web", f"Findings plan → {C('Ready')}: next mission"),
]

if __name__ == "__main__":
    import sys
    out = sys.argv[1]
    for name, ev, title, start in [
        ("part1", PART1, "Mission sequence, part 1: plan and hand-over", 0),
        ("part2", PART2, "Mission sequence, part 2: fly, upload and review", 9),
    ]:
        open(f"{out}/seq-{name}.svg", "w").write(render(ev, title, start))
    print("ok")
