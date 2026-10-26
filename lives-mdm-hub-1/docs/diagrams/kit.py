"""Shared helpers for the diagrams: text measuring, an orthogonal edge router and SVG/draw.io writers."""
from __future__ import annotations

import heapq
import html
from dataclasses import dataclass, field

from PIL import ImageFont

FONT_FAMILY = "Inter"
FONT_FILES = {
    400: "/usr/share/fonts/opentype/inter/Inter-Regular.otf",
    500: "/usr/share/fonts/opentype/inter/Inter-Medium.otf",
    600: "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
    700: "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
}
_fonts: dict = {}


def text_width(text: str, size: float, weight: int = 400) -> float:
    key = (round(size * 4), weight)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(FONT_FILES[weight], size=key[0])  # 4x size for sub-pixel accuracy
    return _fonts[key].getlength(text) / 4


def esc(s: str) -> str:
    return html.escape(str(s), quote=True)


# ----------------------------------------------------------------------------------------------- router
DIRS = {"E": (1, 0), "W": (-1, 0), "S": (0, 1), "N": (0, -1)}
OPPOSITE = {"E": "W", "W": "E", "N": "S", "S": "N"}


@dataclass
class Box:
    x: float
    y: float
    w: float
    h: float

    def contains(self, px, py, margin=0):
        return self.x - margin < px < self.x + self.w + margin and self.y - margin < py < self.y + self.h + margin


@dataclass
class Port:
    x: float  # point on the box edge
    y: float
    side: str  # "W", "E", "N", "S": the side of the box the line leaves from


@dataclass
class Router:
    width: int
    height: int
    step: int = 8
    obstacles: list = field(default_factory=list)
    margin: int = 8
    stub: int = 32
    bend_cost: float = 7.0
    cross_cost: float = 14.0
    overlap_cost: float = 400.0
    near_cost: float = 2.5
    bounds: tuple = None  # (x0, y0, x1, y1) lines must stay inside

    def __post_init__(self):
        self.cols = self.width // self.step + 1
        self.rows = self.height // self.step + 1
        self.used: dict = {}  # (cx, cy) -> set of "H"/"V"

    def blocked(self, cx, cy):
        px, py = cx * self.step, cy * self.step
        if cx < 1 or cy < 1 or cx >= self.cols - 1 or cy >= self.rows - 1:
            return True
        if self.bounds and not (self.bounds[0] <= px <= self.bounds[2] and self.bounds[1] <= py <= self.bounds[3]):
            return True
        return any(b.contains(px, py, self.margin) for b in self.obstacles)

    def stub_end(self, port: Port):
        dx, dy = DIRS[port.side]
        return round((port.x + dx * self.stub) / self.step), round((port.y + dy * self.stub) / self.step)

    def route(self, start: Port, goals: list[Port]):
        """Cheapest orthogonal path from start's stub to any goal's stub. Returns (cost, points, goal)."""
        sx, sy = self.stub_end(start)
        goal_cells = {}
        for g in goals:
            gx, gy = self.stub_end(g)
            goal_cells.setdefault((gx, gy), []).append(g)
        h0 = min(abs(sx - gx) + abs(sy - gy) for gx, gy in goal_cells)
        frontier = [(h0, 0.0, sx, sy, start.side)]
        best = {(sx, sy, start.side): 0.0}
        prev = {}
        found = None
        while frontier:
            f, cost, cx, cy, d = heapq.heappop(frontier)
            if best.get((cx, cy, d), 1e18) < cost:
                continue
            if (cx, cy) in goal_cells:
                g = goal_cells[(cx, cy)][0]
                inward = OPPOSITE[g.side]
                extra = 0 if d == inward else (self.bend_cost if d != g.side else 1e9)
                if extra < 1e8:
                    found = (cost + extra, cx, cy, d, g)
                    break
            for nd, (dx, dy) in DIRS.items():
                if nd == OPPOSITE[d]:
                    continue
                nx, ny = cx + dx, cy + dy
                if self.blocked(nx, ny) and (nx, ny) not in goal_cells:
                    continue
                c = 1.0 + (self.bend_cost if nd != d else 0)
                orient = "H" if nd in "EW" else "V"
                u = self.used.get((nx, ny))
                if u:
                    c += self.overlap_cost if orient in u else self.cross_cost
                for ox, oy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    uu = self.used.get((nx + ox, ny + oy))
                    if uu and orient in uu:
                        c += self.near_cost
                nc = cost + c
                if nc < best.get((nx, ny, nd), 1e18):
                    best[(nx, ny, nd)] = nc
                    prev[(nx, ny, nd)] = (cx, cy, d)
                    hh = min(abs(nx - gx) + abs(ny - gy) for gx, gy in goal_cells)
                    heapq.heappush(frontier, (nc + hh, nc, nx, ny, nd))
        if not found:
            return None
        cost, cx, cy, d, g = found
        cells = [(cx, cy)]
        key = (cx, cy, d)
        while key in prev:
            key = prev[key]
            cells.append((key[0], key[1]))
        cells.reverse()
        pts = [(start.x, start.y)] + [(x * self.step, y * self.step) for x, y in cells] + [(g.x, g.y)]
        return cost, simplify(pts), g

    def commit(self, pts):
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            orient = "H" if y1 == y2 else "V"
            n = int(max(abs(x2 - x1), abs(y2 - y1)) // self.step)
            for i in range(n + 1):
                cx = round((x1 + (x2 - x1) * i / max(n, 1)) / self.step)
                cy = round((y1 + (y2 - y1) * i / max(n, 1)) / self.step)
                self.used.setdefault((cx, cy), set()).add(orient)


def simplify(pts):
    """Drop repeated and collinear points (ports and grid cells are aligned, so segments stay orthogonal)."""
    out = [pts[0]]
    for p in pts[1:]:
        if p != out[-1]:
            out.append(p)
    res = [out[0]]
    for i in range(1, len(out) - 1):
        (ax, ay), (bx, by), (cx, cy) = res[-1], out[i], out[i + 1]
        if (ax == bx == cx) or (ay == by == cy):
            continue
        res.append(out[i])
    res.append(out[-1])
    return res


def path_d(pts):
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)


def longest_segment(pts):
    best = None
    for a, b in zip(pts, pts[1:]):
        length = abs(b[0] - a[0]) + abs(b[1] - a[1])
        if not best or length > best[0]:
            best = (length, a, b)
    return best
