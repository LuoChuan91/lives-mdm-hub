"""Build the to-be process flow (BPMN-style swimlanes) for a master data request.

    python docs/diagrams/build_flow.py

Writes to_be_flow.svg (render to PNG with render_png.py) and to_be_flow.drawio (edit in diagrams.net).
Positions are set by lane and column below; the lines are routed automatically around the shapes.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from kit import FONT_FAMILY, Box, Port, Router, esc, path_d, text_width  # noqa: E402

INK, INK2, MUTED, EDGE = "#14211f", "#43524f", "#7b8886", "#4d5b58"
TEAL, TEAL_TINT, BLUE, BLUE_TINT = "#0b6b66", "#e4f2f0", "#1f4e8c", "#e8eff8"
LANE_HEAD_W = 156
LEFT = 16
CW = 144  # column width
TW, TH = 120, 64  # task size

LANES = [  # id, title, subtitle lines, height
    ("R", "Requestor", ["Amy, Marcus, Nurul", "and other staff"], 144),
    ("H", "Request hub", ["Power Apps and", "Power Automate"], 144),
    ("A", "Approvers", ["BU head, Finance,", "QA/RA, Business", "Support"], 176),
    ("M", "MDM team", ["Priya"], 144),
    ("S", "SAP Business One", ["and Power BI"], 128),
]
TOP = 88

# id, lane, column, kind, label lines; kinds: start, end, task, xor, and, store
NODES = [
    ("start_r", "R", 0, "start", ["Needs a new", "record"]),
    ("form", "R", 1, "task", ["Fill in the", "request form"]),
    ("dup_end", "R", 3, "end", ["Uses or extends", "the existing record"]),
    ("answer", "R", 6, "task", ["Answer the", "question inside", "the request"]),
    ("fix", "R", 9, "task", ["Fix and", "resubmit"]),
    ("live_end", "R", 11, "end", ["Record live;", "can transact"]),
    ("start_h", "H", 0, "start", ["Email to the", "shared mailbox"]),
    ("sort", "H", 1, "task", ["AI sorts the email;", "setup requests get", "the form link"]),
    ("check", "H", 2, "task", ["Check required", "fields and", "duplicates live"]),
    ("gw_dup", "H", 3, "xor", ["Likely", "duplicate?"]),
    ("route", "H", 4, "task", ["Route by rules;", "notify approvers", "at the same time"]),
    ("notify", "H", 11, "task", ["Tell the", "requestor; log", "every step"]),
    ("review", "A", 5, "task", ["Review the card", "in Teams or", "Outlook"]),
    ("gw_dec", "A", 6, "xor", ["Decision?"]),
    ("rej_end", "A", 6, "end", ["Rejected; requestor", "told why"]),
    ("gw_all", "A", 7, "and", ["All approved"]),
    ("store", "M", 4, "store", ["Settings: fields,", "rules, business units"]),
    ("final", "M", 8, "task", ["Final check:", "duplicates and", "completeness"]),
    ("gw_pass", "M", 9, "xor", ["Passes?"]),
    ("assign", "M", 10, "task", ["Assign SAP code;", "add to import file"]),
    ("load", "M", 11, "task", ["Load the file with", "Data Transfer", "Workbench"]),
    ("created", "S", 11, "task", ["Master record", "created in", "SAP B1"]),
    ("regional", "S", 12, "task", ["Orders feed the", "regional view", "(Power BI)"]),
]
NCOLS = 13
LABEL_RIGHT = {"dup_end", "live_end", "rej_end"}  # events whose label sits to the right (a line uses their bottom)

# source, side, target, side, label, kind (flow | assoc)
EDGES = [
    ("start_r", "E", "form", "W", "", "flow"),
    ("start_h", "E", "sort", "W", "", "flow"),
    ("sort", "N", "form", "S", "setup request", "flow"),
    ("form", "E", "check", "N", "submit", "flow"),
    ("check", "E", "gw_dup", "W", "", "flow"),
    ("gw_dup", "N", "dup_end", "S", "yes", "flow"),
    ("gw_dup", "E", "route", "W", "no", "flow"),
    ("route", "E", "review", "N", "", "flow"),
    ("review", "E", "gw_dec", "W", "", "flow"),
    ("gw_dec", "E", "gw_all", "W", "approve", "flow"),
    ("gw_dec", "N", "answer", "S", "needs info", "flow"),
    ("answer", "W", "review", "N", "", "flow"),
    ("gw_dec", "S", "rej_end", "N", "reject", "flow"),
    ("gw_all", "E", "final", "N", "", "flow"),
    ("final", "E", "gw_pass", "W", "", "flow"),
    ("gw_pass", "E", "assign", "W", "yes", "flow"),
    ("gw_pass", "N", "fix", "S", "no", "flow"),
    ("fix", "W", "final", "N", "", "flow"),
    ("assign", "E", "load", "W", "", "flow"),
    ("load", "N", "notify", "S", "", "flow"),
    ("load", "S", "created", "N", "", "flow"),
    ("notify", "N", "live_end", "S", "", "flow"),
    ("created", "E", "regional", "W", "", "flow"),
    ("store", "N", "route", "S", "rules", "assoc"),
]


def lane_geometry():
    out, y = {}, TOP
    for lid, title, sub, h in LANES:
        out[lid] = (y, h)
        y += h
    return out, y


def col_x(c):
    return LEFT + LANE_HEAD_W + c * CW + CW // 2


def node_boxes():
    lanes, _ = lane_geometry()
    boxes = {}
    for nid, lane, col, kind, label in NODES:
        y0, h = lanes[lane]
        cx = col_x(col)
        cy = y0 + 64 if lane == "A" else y0 + h // 2
        if nid == "rej_end":
            cy = y0 + h - 44
        if kind == "task":
            boxes[nid] = Box(cx - TW // 2, cy - TH // 2, TW, TH)
        elif kind in ("xor", "and"):
            boxes[nid] = Box(cx - 24, cy - 24, 48, 48)
        elif kind == "store":
            boxes[nid] = Box(cx - 32, cy - 36, 64, 48)
        else:
            boxes[nid] = Box(cx - 16, cy - 16, 32, 32)
    return boxes


def ports(box, side, kind):
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    if kind == "task":
        offs = [0, -24, 24] if side in "NS" else [0, -12, 12]
    else:
        offs = [0]
    out = []
    for o in offs:
        if side == "N":
            out.append(Port(cx + o, box.y, "N"))
        elif side == "S":
            out.append(Port(cx + o, box.y + box.h, "S"))
        elif side == "W":
            out.append(Port(box.x, cy + o, "W"))
        else:
            out.append(Port(box.x + box.w, cy + o, "E"))
    return out


def build():
    kinds = {n[0]: n[3] for n in NODES}
    boxes = node_boxes()
    lanes, bottom = lane_geometry()
    width = LEFT + LANE_HEAD_W + NCOLS * CW + 16
    height = bottom + 132
    # label areas under events, stores and gateways are obstacles too
    extra = []
    for nid, lane, col, kind, label in NODES:
        b = boxes[nid]
        if kind in ("start", "end", "store"):
            tw = max(text_width(t, 10.5) for t in label)
            if nid in LABEL_RIGHT:
                extra.append(Box(b.x + b.w + 4, b.y - 2, tw + 8, 30))
            else:
                extra.append(Box(b.x + b.w / 2 - tw / 2 - 4, b.y + b.h + 2, tw + 8, 14 * len(label) + 4))
    router = Router(width, height, step=4, obstacles=list(boxes.values()) + extra, margin=6, stub=12,
                    bend_cost=10, cross_cost=30, overlap_cost=600, near_cost=1.5,
                    bounds=(LEFT + LANE_HEAD_W + 8, TOP + 4, width - 8, bottom - 4))
    taken = set()
    routes = []
    for src, sside, tgt, tside, label, ekind in EDGES:
        best = None
        for sp in ports(boxes[src], sside, kinds[src]):
            if (src, round(sp.x), round(sp.y)) in taken:
                continue
            goals = [p for p in ports(boxes[tgt], tside, kinds[tgt]) if (tgt, round(p.x), round(p.y)) not in taken]
            r = router.route(sp, goals)
            if r and (not best or r[0] < best[0]):
                best = (r[0], r[1], r[2], sp)
        if not best:
            raise SystemExit(f"could not route {src} -> {tgt}")
        cost, pts, goal, sp = best
        router.commit(pts)
        taken.add((src, round(sp.x), round(sp.y)))
        taken.add((tgt, round(goal.x), round(goal.y)))
        routes.append(dict(src=src, tgt=tgt, pts=pts, label=label, kind=ekind, sside=sside))
    return boxes, lanes, bottom, width, height, routes


# -------------------------------------------------------------------------------------------- SVG
def wrap_text(cx, cy, lines, size=11, weight=400, fill=INK, line_h=14):
    top = cy - (len(lines) - 1) * line_h / 2
    return "".join(f'<text x="{cx:.1f}" y="{top + i * line_h + size * 0.35:.1f}" text-anchor="middle" font-size="{size}" font-weight="{weight}" fill="{fill}">{esc(t)}</text>' for i, t in enumerate(lines))


def node_svg(nid, lane, kind, label, b):
    cx, cy = b.x + b.w / 2, b.y + b.h / 2
    if kind == "task":
        fill, stroke = (TEAL_TINT, TEAL) if lane == "H" else (BLUE_TINT, BLUE) if lane == "S" else ("#ffffff", "#8c9b99")
        s = f'<rect x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" rx="9" fill="{fill}" stroke="{stroke}" stroke-width="1.3"/>'
        s += wrap_text(cx, cy, label, 11, 500)
        if nid == "review":  # parallel multi-instance marker
            s += "".join(f'<line x1="{cx + dx}" y1="{b.y + b.h - 13}" x2="{cx + dx}" y2="{b.y + b.h - 4}" stroke="{INK}" stroke-width="1.6"/>' for dx in (-5, 0, 5))
            s = s.replace(wrap_text(cx, cy, label, 11, 500), wrap_text(cx, cy - 5, label, 11, 500))
        return s
    if kind in ("xor", "and"):
        d = f"M{cx} {b.y}L{b.x + b.w} {cy}L{cx} {b.y + b.h}L{b.x} {cy}Z"
        s = f'<path d="{d}" fill="#fff8e6" stroke="#a87512" stroke-width="1.4"/>'
        if kind == "xor":
            s += f'<path d="M{cx - 7} {cy - 7}L{cx + 7} {cy + 7}M{cx + 7} {cy - 7}L{cx - 7} {cy + 7}" stroke="#7a540c" stroke-width="2.4" stroke-linecap="round"/>'
        else:
            s += f'<path d="M{cx} {cy - 9}V{cy + 9}M{cx - 9} {cy}H{cx + 9}" stroke="#7a540c" stroke-width="2.4" stroke-linecap="round"/>'
        # question label placed where no line leaves
        if nid == "gw_dec":
            s += "".join(f'<text x="{b.x - 6}" y="{b.y - 4 + i * 13}" text-anchor="end" font-size="10.5" font-weight="600" fill="{INK2}">{esc(t)}</text>' for i, t in enumerate(label))
        else:
            s += "".join(f'<text x="{cx}" y="{b.y + b.h + 14 + i * 13}" text-anchor="middle" font-size="10.5" font-weight="600" fill="{INK2}">{esc(t)}</text>' for i, t in enumerate(label))
        return s
    if kind == "store":
        x, y, w, h = b.x, b.y, b.w, b.h
        s = (f'<path d="M{x} {y + 7}V{y + h - 7}a{w / 2} 7 0 0 0 {w} 0V{y + 7}" fill="#f4f1fb" stroke="#5d4ea6" stroke-width="1.3"/>'
             f'<ellipse cx="{x + w / 2}" cy="{y + 7}" rx="{w / 2}" ry="7" fill="#f4f1fb" stroke="#5d4ea6" stroke-width="1.3"/>')
        s += "".join(f'<text x="{cx}" y="{b.y + b.h + 14 + i * 13}" text-anchor="middle" font-size="10.5" fill="{INK2}">{esc(t)}</text>' for i, t in enumerate(label))
        return s
    r = 16
    if kind == "start":
        s = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#ecf6ef" stroke="#2e7d4f" stroke-width="1.6"/>'
    else:
        s = f'<circle cx="{cx}" cy="{cy}" r="{r - 1.5}" fill="#fbeeee" stroke="#9c2f2f" stroke-width="3.2"/>'
    if nid in LABEL_RIGHT:
        s += "".join(f'<text x="{b.x + b.w + 8}" y="{cy - 3 + i * 13}" font-size="10.5" fill="{INK2}">{esc(t)}</text>' for i, t in enumerate(label))
    else:
        s += "".join(f'<text x="{cx}" y="{b.y + b.h + 14 + i * 13}" text-anchor="middle" font-size="10.5" fill="{INK2}">{esc(t)}</text>' for i, t in enumerate(label))
    return s


def arrow_head(pts):
    (x, y), (px, py) = pts[-1], pts[-2]
    if x == px:
        s = 1 if y > py else -1
        return f'<path d="M{x} {y}L{x - 4.5} {y - 9 * s}L{x + 4.5} {y - 9 * s}Z" fill="{EDGE}"/>'
    s = 1 if x > px else -1
    return f'<path d="M{x} {y}L{x - 9 * s} {y - 4.5}L{x - 9 * s} {y + 4.5}Z" fill="{EDGE}"/>'


def edge_label(r):
    if not r["label"]:
        return ""
    (x0, y0), (x1, y1) = r["pts"][0], r["pts"][1]
    tw = text_width(r["label"], 10, 500)
    if r["sside"] in "NS":
        lx, ly, anchor = x0 + 6, y0 + (-10 if r["sside"] == "N" else 16), "start"
    else:
        lx, ly, anchor = x0 + 8, y0 - 6, "start"
    return (f'<rect x="{lx - 2:.1f}" y="{ly - 10:.1f}" width="{tw + 4:.1f}" height="13" fill="#ffffff" opacity="0.85"/>'
            f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="{anchor}" font-size="10" font-weight="500" font-style="italic" fill="{INK2}">{esc(r["label"])}</text>')


def timer_and_note(boxes):
    b = boxes["review"]
    tx, ty = b.x + b.w - 22, b.y + b.h
    clock = (f'<circle cx="{tx}" cy="{ty}" r="11" fill="#ffffff" stroke="{INK2}" stroke-width="1.2" stroke-dasharray="3 2"/>'
             f'<circle cx="{tx}" cy="{ty}" r="8" fill="#ffffff" stroke="{INK2}" stroke-width="1" stroke-dasharray="3 2"/>'
             f'<path d="M{tx} {ty - 5}V{ty}L{tx + 4} {ty + 2}" stroke="{INK}" stroke-width="1.2" fill="none"/>')
    nx, ny, nw = b.x - 20, b.y + b.h + 26, 196
    note_lines = ["Not answered in 2 working days:", "reminder; one day later,", "escalation to BU head and MDM"]
    note = (f'<path d="M{tx} {ty + 11}V{ny}" stroke="{MUTED}" stroke-dasharray="2 3" fill="none"/>'
            f'<path d="M{nx + 8} {ny}H{nx}V{ny + 44}H{nx + 8}" stroke="{MUTED}" fill="none"/>'
            + "".join(f'<text x="{nx + 6}" y="{ny + 12 + i * 13}" font-size="10" fill="{INK2}">{esc(t)}</text>' for i, t in enumerate(note_lines)))
    return clock, note


def svg(boxes, lanes, bottom, width, height, routes):
    out = [f'<rect width="{width}" height="{height}" fill="#ffffff"/>']
    out.append(f'<text x="{LEFT}" y="34" font-size="20" font-weight="700" fill="{INK}">To-be process: a master data request, from form to SAP Business One</text>')
    out.append(f'<text x="{LEFT}" y="58" font-size="12" fill="{INK2}">Built on Microsoft 365 and SAP Business One. Approvals run in parallel; nothing reaches an approver incomplete or duplicated.</text>')
    for i, (lid, title, sub, h) in enumerate(LANES):
        y0, _ = lanes[lid]
        fill = "#f7f9f9" if i % 2 == 0 else "#ffffff"
        out.append(f'<rect x="{LEFT}" y="{y0}" width="{width - LEFT - 8}" height="{h}" fill="{fill}" stroke="#d5dedc"/>')
        out.append(f'<rect x="{LEFT}" y="{y0}" width="{LANE_HEAD_W}" height="{h}" fill="#eef2f1" stroke="#d5dedc"/>')
        ty = y0 + h / 2 - (len(sub) * 13) / 2
        out.append(f'<text x="{LEFT + 14}" y="{ty:.1f}" font-size="13" font-weight="700" fill="{INK}">{esc(title)}</text>')
        out += [f'<text x="{LEFT + 14}" y="{ty + 17 + k * 13:.1f}" font-size="10.5" fill="{INK2}">{esc(t)}</text>' for k, t in enumerate(sub)]
    clock, note = timer_and_note(boxes)
    out.append(note)
    edges = []
    for r in routes:
        if r["kind"] == "assoc":
            edges.append(f'<path d="{path_d(r["pts"])}" fill="none" stroke="#5d4ea6" stroke-width="1.2" stroke-dasharray="4 3"/>')
        else:
            edges.append(f'<path d="{path_d(r["pts"])}" fill="none" stroke="{EDGE}" stroke-width="1.4"/>' + arrow_head(r["pts"]))
    out += edges
    kinds = {n[0]: (n[1], n[3], n[4]) for n in NODES}
    for nid, b in boxes.items():
        lane, kind, label = kinds[nid]
        out.append(node_svg(nid, lane, kind, label, b))
    out.append(clock)
    out += [edge_label(r) for r in routes]
    # legend
    ly = bottom + 36
    x = LEFT
    out.append(f'<text x="{x}" y="{ly - 8}" font-size="11" font-weight="700" fill="{INK}">Key</text>')
    items = []
    items.append((f'<circle cx="12" cy="{ly + 14}" r="9" fill="#ecf6ef" stroke="#2e7d4f" stroke-width="1.6"/>', "Start"))
    items.append((f'<circle cx="12" cy="{ly + 14}" r="8" fill="#fbeeee" stroke="#9c2f2f" stroke-width="3"/>', "End"))
    items.append((f'<rect x="0" y="{ly + 4}" width="34" height="20" rx="5" fill="{TEAL_TINT}" stroke="{TEAL}" stroke-width="1.2"/>', "Automated by the hub"))
    items.append((f'<rect x="0" y="{ly + 4}" width="34" height="20" rx="5" fill="#ffffff" stroke="#8c9b99" stroke-width="1.2"/>', "Done by a person"))
    items.append((f'<path d="M12 {ly + 2}L24 {ly + 14}L12 {ly + 26}L0 {ly + 14}Z" fill="#fff8e6" stroke="#a87512" stroke-width="1.3"/><path d="M8 {ly + 10}L16 {ly + 18}M16 {ly + 10}L8 {ly + 18}" stroke="#7a540c" stroke-width="2"/>', "One path is taken"))
    items.append((f'<path d="M12 {ly + 2}L24 {ly + 14}L12 {ly + 26}L0 {ly + 14}Z" fill="#fff8e6" stroke="#a87512" stroke-width="1.3"/><path d="M12 {ly + 8}V{ly + 20}M6 {ly + 14}H18" stroke="#7a540c" stroke-width="2"/>', "Waits for all paths"))
    items.append((f'<g stroke="{INK}" stroke-width="1.6"><line x1="12" y1="{ly + 7}" x2="12" y2="{ly + 21}"/><line x1="17" y1="{ly + 7}" x2="17" y2="{ly + 21}"/><line x1="22" y1="{ly + 7}" x2="22" y2="{ly + 21}"/></g>', "One card per approver, in parallel"))
    items.append((f'<circle cx="12" cy="{ly + 14}" r="10" fill="#fff" stroke="{INK2}" stroke-dasharray="3 2"/><path d="M12 {ly + 9}V{ly + 14}L16 {ly + 16}" stroke="{INK}" fill="none"/>', "Timer"))
    cur = x
    for shape, label in items:
        out.append(f'<g transform="translate({cur},0)">{shape}</g>')
        cur += 40
        out.append(f'<text x="{cur}" y="{ly + 18}" font-size="11" fill="{INK2}">{esc(label)}</text>')
        cur += text_width(label, 11) + 28
    out.append(f'<text x="{LEFT}" y="{ly + 56}" font-size="11" fill="{INK2}">Every step is written to the audit log and shown on the request tracker. Orders and enquiries in the shared mailbox go to the order desk and sales; only setup requests enter this process.</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
            f'font-family="{FONT_FAMILY}, \'IBM Plex Sans\', Arial, sans-serif" role="img" aria-label="To-be process flow for a master data request">'
            + "".join(out) + "</svg>")


# -------------------------------------------------------------------------------------------- draw.io
def drawio(boxes, lanes, bottom, width, height, routes):
    cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
    cells.append(f'<mxCell id="title" value="{esc("<b>To-be process: a master data request, from form to SAP Business One</b>")}" style="text;html=1;fontSize=18;fontFamily={FONT_FAMILY};align=left;" vertex="1" parent="1"><mxGeometry x="{LEFT}" y="12" width="1000" height="30" as="geometry"/></mxCell>')
    for i, (lid, title, sub, h) in enumerate(LANES):
        y0, _ = lanes[lid]
        label = f"<b>{title}</b><br><span style='font-size:10px'>{'<br>'.join(sub)}</span>"
        cells.append(f'<mxCell id="lane_{lid}" value="{esc(label)}" style="swimlane;horizontal=0;html=1;startSize={LANE_HEAD_W};fillColor=#eef2f1;swimlaneFillColor={"#f7f9f9" if i % 2 == 0 else "#ffffff"};strokeColor=#d5dedc;fontFamily={FONT_FAMILY};fontSize=12;align=center;" vertex="1" parent="1">'
                     f'<mxGeometry x="{LEFT}" y="{y0}" width="{width - LEFT - 8}" height="{h}" as="geometry"/></mxCell>')
    kinds = {n[0]: (n[1], n[3], n[4]) for n in NODES}
    for nid, b in boxes.items():
        lane, kind, label = kinds[nid]
        text = "<br>".join(label)
        if kind == "task":
            fill, stroke = (TEAL_TINT, TEAL) if lane == "H" else (BLUE_TINT, BLUE) if lane == "S" else ("#ffffff", "#8c9b99")
            style = f"rounded=1;arcSize=14;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontSize=11;fontFamily={FONT_FAMILY};"
            if nid == "review":
                text += "<br>|||"
        elif kind in ("xor", "and"):
            text = "X" if kind == "xor" else "+"
            style = f"rhombus;whiteSpace=wrap;html=1;fillColor=#fff8e6;strokeColor=#a87512;fontSize=16;fontStyle=1;fontColor=#7a540c;fontFamily={FONT_FAMILY};"
        elif kind == "store":
            text = ""
            style = f"shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=7;fillColor=#f4f1fb;strokeColor=#5d4ea6;fontFamily={FONT_FAMILY};"
        elif kind == "start":
            text = ""
            style = "ellipse;html=1;fillColor=#ecf6ef;strokeColor=#2e7d4f;strokeWidth=1.6;"
        else:
            text = ""
            style = "ellipse;html=1;fillColor=#fbeeee;strokeColor=#9c2f2f;strokeWidth=3;"
        cells.append(f'<mxCell id="{nid}" value="{esc(text)}" style="{style}" vertex="1" parent="1"><mxGeometry x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" as="geometry"/></mxCell>')
        if kind in ("xor", "and", "store", "start", "end"):
            cap = "<br>".join(label)
            if nid in LABEL_RIGHT:
                gx, gy, gw = b.x + b.w + 4, b.y, 140
                align = "left"
            elif nid == "gw_dec":
                gx, gy, gw = b.x - 92, b.y - 16, 88
                align = "right"
            else:
                gx, gy, gw = b.x + b.w / 2 - 70, b.y + b.h + 2, 140
                align = "center"
            cells.append(f'<mxCell id="{nid}_label" value="{esc(cap)}" style="text;html=1;align={align};verticalAlign=top;fontSize=10;fontColor={INK2};fontFamily={FONT_FAMILY};" vertex="1" parent="1"><mxGeometry x="{gx}" y="{gy}" width="{gw}" height="30" as="geometry"/></mxCell>')
    b = boxes["review"]
    cells.append(f'<mxCell id="timer" value="" style="shape=doubleEllipse;dashed=1;html=1;fillColor=#ffffff;strokeColor={INK2};" vertex="1" parent="1"><mxGeometry x="{b.x + b.w - 33}" y="{b.y + b.h - 11}" width="22" height="22" as="geometry"/></mxCell>')
    note = "Not answered in 2 working days: reminder; one day later, escalation to BU head and MDM"
    cells.append(f'<mxCell id="timer_note" value="{esc(note)}" style="shape=partialRectangle;right=0;html=1;whiteSpace=wrap;fillColor=none;strokeColor={MUTED};align=left;spacingLeft=6;fontSize=10;fontColor={INK2};fontFamily={FONT_FAMILY};" vertex="1" parent="1"><mxGeometry x="{b.x - 20}" y="{b.y + b.h + 26}" width="200" height="44" as="geometry"/></mxCell>')
    cells.append(f'<mxCell id="timer_link" style="endArrow=none;dashed=1;html=1;strokeColor={MUTED};" edge="1" parent="1" source="timer" target="timer_note"><mxGeometry relative="1" as="geometry"/></mxCell>')
    for i, r in enumerate(routes):
        sb, tb = boxes[r["src"]], boxes[r["tgt"]]
        (sx, sy), (tx, ty) = r["pts"][0], r["pts"][-1]
        way = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in r["pts"][1:-1])
        if r["kind"] == "assoc":
            style = "dashed=1;endArrow=none;strokeColor=#5d4ea6;"
        else:
            style = f"endArrow=block;endFill=1;endSize=7;strokeColor={EDGE};strokeWidth=1.4;"
        cells.append(f'<mxCell id="e{i}" value="{esc(r["label"])}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;{style}fontSize=10;fontStyle=2;fontColor={INK2};fontFamily={FONT_FAMILY};labelBackgroundColor=#ffffff;'
                     f'exitX={(sx - sb.x) / sb.w:.4f};exitY={(sy - sb.y) / sb.h:.4f};exitDx=0;exitDy=0;entryX={(tx - tb.x) / tb.w:.4f};entryY={(ty - tb.y) / tb.h:.4f};entryDx=0;entryDy=0;" edge="1" parent="1" source="{r["src"]}" target="{r["tgt"]}">'
                     f'<mxGeometry relative="1" as="geometry"><Array as="points">{way}</Array></mxGeometry></mxCell>')
    return ('<mxfile host="app.diagrams.net"><diagram name="To-be process" id="to-be">'
            f'<mxGraphModel grid="1" gridSize="4" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{width}" pageHeight="{height}" math="0" shadow="0">'
            "<root>" + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>")


if __name__ == "__main__":
    data = build()
    (HERE / "to_be_flow.svg").write_text(svg(*data))
    (HERE / "to_be_flow.drawio").write_text(drawio(*data))
    print("wrote to_be_flow.svg, to_be_flow.drawio", data[3], "x", data[4])
