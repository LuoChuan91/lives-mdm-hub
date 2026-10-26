"""Build the ER diagram of the to-be solution from erd_spec.py.

    python docs/diagrams/build_erd.py

Writes erd.svg (render to PNG with render_png.py), erd.drawio (open and edit in diagrams.net) and
erd.mmd (Mermaid source for mermaid.live). Lines attach to the foreign-key row they stand for.
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from erd_spec import ENTITIES, GROUPS, RELATIONSHIPS  # noqa: E402
from kit import FONT_FAMILY, Box, Port, Router, esc, longest_segment, path_d, text_width  # noqa: E402

HEAD = {"settings": "#41504e", "workflow": "#0b6b66", "sap": "#1f4e8c", "demand": "#8a5a12"}
TINT = {"settings": "#f2f4f4", "workflow": "#ecf5f4", "sap": "#edf2f9", "demand": "#f9f4eb"}
INK, INK2, MUTED, LINE, RULE_C, KEY = "#14211f", "#43524f", "#7b8886", "#55625f", "#dfe6e4", "#8a5a12"
G = 8
HEADER, PAD, ROW = 32, 8, 16

# column of each zone and the vertical position of each entity (multiples of 8)
COLUMNS = [
    ("settings", ["BUSINESS_UNIT", "PERSON", "FIELD_DEFINITION", "APPROVAL_RULE"]),
    ("workflow", ["AUDIT_EVENT", "MDM_REQUEST", "REQUEST_FIELD_VALUE"]),
    ("workflow", ["IMPORT_BATCH", "APPROVAL_TASK"]),
    ("sap", ["BUSINESS_PARTNER", "ITEM", "COST_CENTRE"]),
    ("demand", ["DUPLICATE_PAIR", "INBOUND_MESSAGE", "PURCHASE_ORDER"]),
]
Y = {
    "BUSINESS_UNIT": 120, "PERSON": 280, "FIELD_DEFINITION": 472, "APPROVAL_RULE": 728,
    "AUDIT_EVENT": 120, "MDM_REQUEST": 312, "REQUEST_FIELD_VALUE": 640,
    "IMPORT_BATCH": 120, "APPROVAL_TASK": 432,
    "BUSINESS_PARTNER": 120, "ITEM": 384, "COST_CENTRE": 608,
    "DUPLICATE_PAIR": 120, "INBOUND_MESSAGE": 320, "PURCHASE_ORDER": 568,
}
GUTTER = 104
LEFT = 40


def up8(v):
    return int(math.ceil(v / G) * G)


def measure(entity):
    name, group, sap, attrs = entity
    key_w = 44
    attr_w = max(text_width(a, 11.5, 600 if "PK" in k else 400) for k, a, n in attrs)
    note_w = max((text_width(n, 10, 400) for k, a, n in attrs if n), default=0)
    head_w = text_width(name, 12.5, 700) + (text_width(f"SAP {sap}", 9.5, 500) + 10 if sap else 0)
    w = max(key_w + attr_w + 16 + note_w + 14, head_w + 28, 200)
    return up8(w), HEADER + PAD + ROW * len(attrs) + PAD


def layout():
    ents = {e[0]: e for e in ENTITIES}
    boxes, col_x = {}, []
    x = LEFT
    for group, names in COLUMNS:
        width = max(measure(ents[n])[0] for n in names)
        col_x.append((x, width, group))
        for n in names:
            w, h = measure(ents[n])
            boxes[n] = Box(x, Y[n], width, h)
        x += width + (GUTTER + 32 if group == "settings" else GUTTER)
    return boxes, col_x, x - GUTTER + LEFT


def row_y(box, i):
    return box.y + HEADER + PAD + ROW * i + ROW / 2


def build():
    ents = {e[0]: e for e in ENTITIES}
    boxes, col_x, width = layout()
    height = up8(max(b.y + b.h for b in boxes.values()) + 150)
    # zone titles are obstacles too, so no line strikes through them
    titles = []
    zx = {}
    for (x, w, group) in col_x:
        zx.setdefault(group, x)
    for gid, title, sub in GROUPS:
        tw = max(text_width(title, 12.5, 700), text_width(sub, 10.5)) + 16
        titles.append(Box(zx[gid] - 8, 76, tw, 40))
    router = Router(width, height, step=G, obstacles=list(boxes.values()) + titles, margin=8, stub=32,
                    bounds=(24, 76, width - 24, height - 112))
    taken = {n: set() for n in boxes}  # parent slots already used, as (side, coordinate)

    def fk_ports(entity, attr):
        b = boxes[entity]
        idx = next(i for i, (k, a, n) in enumerate(ents[entity][3]) if a == attr)
        y = row_y(b, idx)
        return [Port(b.x, y, "W"), Port(b.x + b.w, y, "E")]

    def parent_slots(entity):
        b = boxes[entity]
        rows = len(ents[entity][3])
        slots = []
        for i in range(rows):
            y = row_y(b, i)
            slots += [Port(b.x, y, "W"), Port(b.x + b.w, y, "E")]
        for xx in range(int(b.x) + 24, int(b.x + b.w) - 16, 16):
            slots += [Port(xx, b.y, "N"), Port(xx, b.y + b.h, "S")]
        free = []
        for p in slots:
            coord = p.y if p.side in "WE" else p.x
            if any(s == p.side and abs(c - coord) < 24 for s, c in taken[entity]):
                continue
            free.append(p)
        return free

    # shortest relationships first, so the long ones route around them
    def span(rel):
        a, b = boxes[rel[0]], boxes[rel[2]]
        return abs((a.x + a.w / 2) - (b.x + b.w / 2)) + abs((a.y + a.h / 2) - (b.y + b.h / 2))

    routes = []
    for rel in sorted(RELATIONSHIPS, key=span):
        ref, ref_end, fk_ent, fk_end, fk_attr, verb = rel
        best = None
        for start in fk_ports(fk_ent, fk_attr):
            r = router.route(start, parent_slots(ref))
            if r and (not best or r[0] < best[0]):
                best = (r[0], r[1], r[2], start)
        if not best:
            raise SystemExit(f"could not route {ref} - {fk_ent}")
        cost, pts, goal, start = best
        router.commit(pts)
        taken[ref].add((goal.side, goal.y if goal.side in "WE" else goal.x))
        taken[fk_ent].add((start.side, start.y))
        # pts runs from the foreign-key end to the referenced end
        routes.append(dict(rel=rel, pts=pts, fk_end=fk_end, ref_end=ref_end))
    return ents, boxes, col_x, width, height, routes


# ------------------------------------------------------------------------------------------- drawing
def marker(pts_end, kind):
    """Crow's foot at the end of a line. pts_end = (point on the entity, previous point)."""
    (x, y), (px, py) = pts_end
    dx, dy = x - px, y - py
    length = math.hypot(dx, dy) or 1
    ux, uy = dx / length, dy / length  # towards the entity
    nx, ny = -uy, ux

    def at(d, o=0.0):
        return x - ux * d + nx * o, y - uy * d + ny * o

    def bar(d):
        (a, b), (c, e) = at(d, -6), at(d, 6)
        return f'<line x1="{a:.1f}" y1="{b:.1f}" x2="{c:.1f}" y2="{e:.1f}"/>'

    def circle(d):
        cx, cy = at(d)
        return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="4.2" fill="#ffffff"/>'

    def crow():
        apex = at(13)
        return "".join(f'<line x1="{apex[0]:.1f}" y1="{apex[1]:.1f}" x2="{p[0]:.1f}" y2="{p[1]:.1f}"/>' for p in (at(0, -7), at(0, 0), at(0, 7)))

    if kind == "one":
        return bar(8) + bar(14)
    if kind == "zero_one":
        return bar(8) + circle(19)
    if kind == "many":
        return crow() + circle(20)
    return crow() + bar(17)  # one_many


def entity_svg(name, ents, box):
    _, group, sap, attrs = ents[name]
    x, y, w, h = box.x, box.y, box.w, box.h
    out = [f'<g data-entity="{esc(name)}">',
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="#ffffff" stroke="#a9b7b5"/>',
           f'<path d="M{x} {y + HEADER}V{y + 6}a6 6 0 0 1 6 -6H{x + w - 6}a6 6 0 0 1 6 6V{y + HEADER}Z" fill="{HEAD[group]}"/>',
           f'<text x="{x + 12}" y="{y + 21}" font-size="12.5" font-weight="700" fill="#ffffff">{esc(name)}'
           + (f'<tspan dx="8" font-size="9.5" font-weight="500" fill="#dbe6f3">SAP {esc(sap)}</tspan>' if sap else "") + "</text>"]
    note_x = x + 44 + max(text_width(a, 11.5, 600 if "PK" in k else 400) for k, a, n in attrs) + 16
    for i, (k, a, n) in enumerate(attrs):
        ry = row_y(box, i)
        if k:
            out.append(f'<text x="{x + 12}" y="{ry + 3.5}" font-size="9" font-weight="700" fill="{KEY}">{esc(k)}</text>')
        wt = 600 if "PK" in k else 400
        out.append(f'<text x="{x + 44}" y="{ry + 4}" font-size="11.5" font-weight="{wt}" fill="{INK}">{esc(a)}</text>')
        if n:
            out.append(f'<text x="{note_x:.1f}" y="{ry + 3.5}" font-size="10" fill="{MUTED}">{esc(n)}</text>')
        if i < len(attrs) - 1 and "PK" in k and "PK" not in attrs[i + 1][0]:
            out.append(f'<line x1="{x + 8}" y1="{ry + 8}" x2="{x + w - 8}" y2="{ry + 8}" stroke="{RULE_C}"/>')
    out.append("</g>")
    return "".join(out)


def svg(ents, boxes, col_x, width, height, routes):
    zones = []
    seen = {}
    for (x, w, group) in col_x:
        if group in seen:
            seen[group] = (seen[group][0], x + w - seen[group][0])
        else:
            seen[group] = (x, w)
    zone_top = 72
    for gid, title, sub in GROUPS:
        x, w = seen[gid]
        bottom = max(b.y + b.h for n, b in boxes.items() if ents[n][1] == gid) + 24
        zones.append(
            f'<rect x="{x - 20}" y="{zone_top}" width="{w + 40}" height="{bottom - zone_top}" rx="12" fill="{TINT[gid]}"/>'
            f'<text x="{x - 4}" y="{zone_top + 22}" font-size="12.5" font-weight="700" fill="{HEAD[gid]}">{esc(title)}</text>'
            f'<text x="{x - 4}" y="{zone_top + 38}" font-size="10.5" fill="{INK2}">{esc(sub)}</text>')
    lines, marks, labels = [], [], []
    placed = []
    for r in routes:
        pts = r["pts"]
        lines.append(f'<path d="{path_d(pts)}" fill="none"/>')
        marks.append(marker((pts[0], pts[1]), r["fk_end"]))
        marks.append(marker((pts[-1], pts[-2]), r["ref_end"]))
        verb = r["rel"][5]
        tw = text_width(verb, 9.5, 500)
        seg = longest_segment(pts[1:-1] if len(pts) > 3 else pts)
        if seg and seg[0] >= tw + 56:
            (ax, ay), (bx, by) = seg[1], seg[2]
            mx, my = (ax + bx) / 2, (ay + by) / 2
            if ay == by:
                lx, ly = mx - tw / 2, my - 4
                rect = (lx - 3, ly - 9, tw + 6, 12)
            else:
                lx, ly = mx + 5, my + 3
                rect = (lx - 3, ly - 9, tw + 6, 12)
            clash = any(b.contains(rect[0] + rect[2] / 2, rect[1] + rect[3] / 2, 6) for b in boxes.values()) or any(
                not (rect[0] + rect[2] < p[0] or p[0] + p[2] < rect[0] or rect[1] + rect[3] < p[1] or p[1] + p[3] < rect[1]) for p in placed)
            if not clash:
                placed.append(rect)
                labels.append(f'<rect x="{rect[0]:.1f}" y="{rect[1]:.1f}" width="{rect[2]:.1f}" height="{rect[3]:.1f}" fill="#ffffff" opacity="0.92"/>'
                              f'<text x="{lx:.1f}" y="{ly:.1f}" font-size="9.5" font-weight="500" font-style="italic" fill="{INK2}">{esc(verb)}</text>')
    legend_y = height - 64
    lx = LEFT
    legend = [f'<text x="{lx}" y="{legend_y}" font-size="11" font-weight="700" fill="{INK}">How to read the lines</text>']
    items = [("one", "exactly one"), ("zero_one", "zero or one"), ("many", "zero or many"), ("one_many", "one or many")]
    cx = lx
    for kind, label in items:
        y0 = legend_y + 26
        legend.append(f'<g stroke="{LINE}" stroke-width="1.25" fill="none"><path d="M{cx} {y0}H{cx + 44}"/>{marker(((cx + 44, y0), (cx, y0)), kind)}</g>')
        legend.append(f'<text x="{cx + 52}" y="{y0 + 4}" font-size="11" fill="{INK2}">{esc(label)}</text>')
        cx += 52 + text_width(label, 11) + 36
    legend.append(f'<text x="{cx + 12}" y="{legend_y + 30}" font-size="11" fill="{INK2}">'
                  f'<tspan font-weight="700" fill="{KEY}">PK</tspan> primary key   '
                  f'<tspan font-weight="700" fill="{KEY}">FK</tspan> foreign key; each line starts at the foreign-key row it stands for</text>')
    title = (f'<text x="{LEFT - 20}" y="34" font-size="20" font-weight="700" fill="{INK}">MDM request hub: entity-relationship diagram (to-be)</text>'
             f'<text x="{LEFT - 20}" y="56" font-size="12" fill="{INK2}">Requests, approvals and settings live in SharePoint lists; approved records are loaded into SAP Business One, whose orders feed the regional view.</text>')
    body = "".join(zones) + f'<g stroke="{LINE}" stroke-width="1.25" fill="none">' + "".join(lines) + "</g>" \
        + "".join(entity_svg(n, ents, b) for n, b in boxes.items()) \
        + f'<g stroke="{LINE}" stroke-width="1.25" fill="none">' + "".join(marks) + "</g>" + "".join(labels) + title + "".join(legend)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
            f'font-family="{FONT_FAMILY}, \'IBM Plex Sans\', Arial, sans-serif" role="img" aria-label="Entity-relationship diagram of the MDM request hub">'
            f'<rect width="{width}" height="{height}" fill="#ffffff"/>{body}</svg>')


# -------------------------------------------------------------------------------------------- draw.io
DRAWIO_END = {"one": "ERmandOne", "zero_one": "ERzeroToOne", "many": "ERzeroToMany", "one_many": "ERoneToMany"}


def drawio(ents, boxes, col_x, width, height, routes):
    cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
    seen = {}
    for (x, w, group) in col_x:
        seen[group] = (seen[group][0], x + w - seen[group][0]) if group in seen else (x, w)
    for gid, title, sub in GROUPS:
        x, w = seen[gid]
        bottom = max(b.y + b.h for n, b in boxes.items() if ents[n][1] == gid) + 24
        label = f'<b>{title}</b><br><span style="font-size:10px;color:{INK2}">{sub}</span>'
        cells.append(f'<mxCell id="zone_{gid}" value="{esc(label)}" style="rounded=1;arcSize=2;html=1;whiteSpace=wrap;fillColor={TINT[gid]};strokeColor=none;align=left;verticalAlign=top;spacingLeft=14;spacingTop=6;fontSize=12;fontColor={HEAD[gid]};fontFamily={FONT_FAMILY};" vertex="1" parent="1">'
                     f'<mxGeometry x="{x - 20}" y="72" width="{w + 40}" height="{bottom - 72}" as="geometry"/></mxCell>')
    for name, b in boxes.items():
        _, group, sap, attrs = ents[name]
        title = name + (f"  (SAP {sap})" if sap else "")
        cells.append(f'<mxCell id="{name}" value="{esc(title)}" style="swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize={HEADER};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;html=1;fillColor={HEAD[group]};fontColor=#ffffff;strokeColor=#a9b7b5;swimlaneFillColor=#ffffff;rounded=1;arcSize=4;align=left;spacingLeft=10;fontSize=12;fontFamily={FONT_FAMILY};" vertex="1" parent="1">'
                     f'<mxGeometry x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" as="geometry"/></mxCell>')
        cells.append(f'<mxCell id="{name}_pad" value="" style="text;strokeColor=none;fillColor=none;" vertex="1" parent="{name}"><mxGeometry y="{HEADER}" width="{b.w}" height="{PAD}" as="geometry"/></mxCell>')
        for i, (k, a, n) in enumerate(attrs):
            label = (f'<span style="color:{KEY};font-size:9px;font-weight:bold;display:inline-block;width:32px">{esc(k)}</span>'
                     f'<span style="{"font-weight:bold;" if "PK" in k else ""}">{esc(a)}</span>'
                     + (f'&nbsp;&nbsp;<span style="color:{MUTED};font-size:10px">{esc(n)}</span>' if n else ""))
            cells.append(f'<mxCell id="{name}_r{i}" value="{esc(label)}" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=10;fontSize=11;fontFamily={FONT_FAMILY};fontColor={INK};" vertex="1" parent="{name}">'
                         f'<mxGeometry y="{HEADER + PAD + ROW * i}" width="{b.w}" height="{ROW}" as="geometry"/></mxCell>')
        cells.append(f'<mxCell id="{name}_pad2" value="" style="text;strokeColor=none;fillColor=none;" vertex="1" parent="{name}"><mxGeometry y="{HEADER + PAD + ROW * len(attrs)}" width="{b.w}" height="{PAD}" as="geometry"/></mxCell>')
    for i, r in enumerate(routes):
        ref, ref_end, fk_ent, fk_end, fk_attr, verb = r["rel"]
        pts = r["pts"]
        sb, tb = boxes[fk_ent], boxes[ref]
        (sx, sy), (tx, ty) = pts[0], pts[-1]
        exit_x, exit_y = (sx - sb.x) / sb.w, (sy - sb.y) / sb.h
        entry_x, entry_y = (tx - tb.x) / tb.w, (ty - tb.y) / tb.h
        way = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts[1:-1])
        cells.append(f'<mxCell id="rel{i}" value="{esc(verb)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=9;fontStyle=2;fontColor={INK2};fontFamily={FONT_FAMILY};strokeColor={LINE};labelBackgroundColor=#ffffff;'
                     f'startArrow={DRAWIO_END[fk_end]};endArrow={DRAWIO_END[ref_end]};startFill=0;endFill=0;startSize=10;endSize=10;'
                     f'exitX={exit_x:.4f};exitY={exit_y:.4f};exitDx=0;exitDy=0;entryX={entry_x:.4f};entryY={entry_y:.4f};entryDx=0;entryDy=0;" edge="1" parent="1" source="{fk_ent}" target="{ref}">'
                     f'<mxGeometry relative="1" as="geometry"><Array as="points">{way}</Array></mxGeometry></mxCell>')
    return ('<mxfile host="app.diagrams.net"><diagram name="ER diagram" id="erd">'
            f'<mxGraphModel grid="1" gridSize="8" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{width}" pageHeight="{height}" math="0" shadow="0">'
            "<root>" + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>")


# -------------------------------------------------------------------------------------------- mermaid
MERMAID_REF = {"one": "||", "zero_one": "|o", "many": "}o", "one_many": "}|"}
MERMAID_FK = {"one": "||", "zero_one": "o|", "many": "o{", "one_many": "|{"}


def mermaid():
    lines = ["erDiagram"]
    for ref, ref_end, fk_ent, fk_end, fk_attr, verb in RELATIONSHIPS:
        lines.append(f'  {ref} {MERMAID_REF[ref_end]}--{MERMAID_FK[fk_end]} {fk_ent} : "{verb}"')
    for name, group, sap, attrs in ENTITIES:
        lines.append(f"  {name} {{")
        for key, attr, note in attrs:
            ident = re.sub(r"[^A-Za-z0-9_]+", "_", attr).strip("_")
            k = {"PK": " PK", "FK": " FK", "PK, FK": " PK, FK"}.get(key, "")
            lines.append(f"    string {ident}{k}" + (f' "{note}"' if note else ""))
        lines.append("  }")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    data = build()
    (HERE / "erd.svg").write_text(svg(*data))
    (HERE / "erd.drawio").write_text(drawio(*data))
    (HERE / "erd.mmd").write_text(mermaid())
    print("wrote erd.svg, erd.drawio, erd.mmd", data[3], "x", data[4])
