"""
PDF rendering of a chord chart (core/chord_chart.build_chart) for reading on paper.

One block per lyric line: the line, then its bars as boxes of beat cells (4 or 3 per
bar). A chord is printed in the cell where it is played; the first cell of a bar always
names the chord in force, so every bar can be read on its own. Held beats show a dot.
Instrumental passages are rows of bars with no line, marked with their timestamp.
"""

import datetime
import io
import os
from typing import Dict, List

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

_FONT_CANDIDATES = [
    ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
    ('C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'),
    ('/Library/Fonts/Arial.ttf', '/Library/Fonts/Arial Bold.ttf'),
]
_fonts = None


def _fonts_for_text():
    """(regular, bold) font names; a Unicode TTF when available, else Helvetica."""
    global _fonts
    if _fonts:
        return _fonts
    for regular, bold in _FONT_CANDIDATES:
        if os.path.exists(regular) and os.path.exists(bold):
            try:
                pdfmetrics.registerFont(TTFont('ChartSans', regular))
                pdfmetrics.registerFont(TTFont('ChartSans-Bold', bold))
                _fonts = ('ChartSans', 'ChartSans-Bold')
                return _fonts
            except Exception:
                pass
    _fonts = ('Helvetica', 'Helvetica-Bold')
    return _fonts


def _fmt_time(t: float) -> str:
    t = max(0, int(round(t)))
    return f"{t // 60}:{t % 60:02d}"


def _fit_font_size(c, text: str, font: str, size: float, max_width: float) -> float:
    while size > 5.5 and c.stringWidth(text, font, size) > max_width:
        size -= 0.5
    return size


def render_pdf(chart: Dict, bars_per_row: int = 4) -> bytes:
    regular, bold = _fonts_for_text()
    buf = io.BytesIO()
    page_w, page_h = A4
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"{chart.get('title', '')} - chord chart")

    margin_x, margin_top, margin_bottom = 14 * mm, 16 * mm, 14 * mm
    time_col = 11 * mm                     # timestamp column left of the lines
    content_w = page_w - 2 * margin_x - time_col
    bar_gap = 2 * mm
    bar_w = (content_w - bar_gap * (bars_per_row - 1)) / bars_per_row
    bar_h = 8.2 * mm
    line_font, chord_font, small_font = 10, 9.5, 6
    beats_per_bar = max(2, int(chart.get('beats_per_bar') or 4))

    page = [1]

    def header():
        c.setFont(bold, 14)
        title = chart.get('title') or ''
        size = _fit_font_size(c, title, bold, 14, page_w - 2 * margin_x)
        c.setFont(bold, size)
        c.drawString(margin_x, page_h - margin_top, title)
        bits = []
        if chart.get('key'):
            bits.append(f"Key {chart['key']}")
        if chart.get('bpm'):
            bits.append(f"{round(float(chart['bpm']))} BPM")
        bits.append(f"{beats_per_bar}/4")
        bits.append('detailed chords' if chart.get('detail') == 'detailed' else 'simple chords')
        if chart.get('transpose'):
            bits.append(f"transposed {chart['transpose']:+d} st")
        bits.append(datetime.date.today().isoformat())
        c.setFont(regular, 8.5)
        c.setFillGray(0.35)
        c.drawString(margin_x, page_h - margin_top - 5 * mm, ' · '.join(bits))
        c.setFillGray(0)
        return page_h - margin_top - 12 * mm

    def footer():
        c.setFont(regular, 7.5)
        c.setFillGray(0.5)
        c.drawRightString(page_w - margin_x, margin_bottom - 6 * mm, f"StemTube · {chart.get('title', '')[:60]} · {page[0]}")
        c.setFillGray(0)

    def new_page():
        footer()
        c.showPage()
        page[0] += 1
        return header()

    def draw_bar(x, y_top, bar):
        """One bar box at (x, y_top); returns nothing."""
        cells = bar.get('cells') or []
        n = max(1, len(cells))
        cell_w = bar_w / n
        c.setLineWidth(0.9)
        c.setStrokeGray(0.25)
        c.rect(x, y_top - bar_h, bar_w, bar_h, stroke=1, fill=0)
        c.setLineWidth(0.4)
        c.setStrokeGray(0.7)
        for i in range(1, n):
            c.line(x + i * cell_w, y_top - bar_h, x + i * cell_w, y_top)
        # bar number
        c.setFont(regular, small_font)
        c.setFillGray(0.5)
        c.drawString(x + 1.2 * mm, y_top - 2.6 * mm, str(bar.get('number', '')))
        c.setFillGray(0)
        text_y = y_top - bar_h + 3.1 * mm
        for i, cell in enumerate(cells):
            cx = x + i * cell_w + cell_w / 2
            name = cell.get('chord') or ''
            if name and (cell.get('change') or i == 0):
                font = bold if cell.get('change') else regular
                size = _fit_font_size(c, name, font, chord_font, cell_w - 1.5 * mm)
                c.setFont(font, size)
                c.setFillGray(0 if cell.get('change') else 0.45)
                c.drawCentredString(cx, text_y, name)
                c.setFillGray(0)
            else:
                c.setFillGray(0.6)
                c.circle(cx, text_y + 1.2 * mm, 0.55 * mm, stroke=0, fill=1)
                c.setFillGray(0)

    y = header()
    x0 = margin_x + time_col

    # ── Summary page(s): the form, then each part's chord loop ──
    summary = chart.get('summary') or {}
    if summary.get('parts'):
        c.setFont(bold, 11)
        c.drawString(margin_x, y, 'Form')
        form_txt = '  ·  '.join(f"{f['label']}" + (f" ×{f['count']}" if f['count'] > 1 else '') + f"  ({f['bars']} bars)"
                                for f in summary['form'])
        c.setFont(regular, 9.5)
        # wrap the form line
        words = form_txt.split('  ·  ')
        line, y_text = '', y - 6 * mm
        for w in words:
            candidate = (line + '  ·  ' + w) if line else w
            if c.stringWidth(candidate, regular, 9.5) > page_w - 2 * margin_x - 16 * mm:
                c.drawString(margin_x + 16 * mm, y_text, line)
                y_text -= 5 * mm
                line = w
            else:
                line = candidate
        c.drawString(margin_x + 16 * mm, y_text, line)
        y = y_text - 9 * mm

        for part in summary['parts']:
            unit = part.get('unit') or []
            rows = [unit[i:i + bars_per_row] for i in range(0, len(unit), bars_per_row)]
            needed = 7 * mm + len(rows) * (bar_h + 1.5 * mm)
            if y - needed < margin_bottom:
                y = new_page()
            c.setFont(bold, 12)
            c.drawString(margin_x, y - 4 * mm, part['label'])
            c.setFont(regular, 8.5)
            c.setFillGray(0.35)
            bits = []
            if part.get('repeat', 1) > 1:
                bits.append(f"play {len(unit)} bars ×{part['repeat']}")
            else:
                bits.append(f"{len(unit)} bars")
            if part.get('occurrences', 1) > 1:
                bits.append(f"{part['occurrences']} times in the song")
            if part.get('instrumental'):
                bits.append('instrumental')
            bits.append(_fmt_time(part.get('start') or 0))
            c.drawString(margin_x + 9 * mm, y - 4 * mm, ' · '.join(bits))
            c.setFillGray(0)
            y -= 7 * mm
            for row in rows:
                for k, bar in enumerate(row):
                    draw_bar(x0 + k * (bar_w + bar_gap), y, bar)
                if part.get('repeat', 1) > 1 and row is rows[-1]:
                    c.setFont(bold, 11)
                    c.drawString(x0 + len(row) * (bar_w + bar_gap) - bar_gap + 1.5 * mm, y - bar_h + 2.6 * mm, f"×{part['repeat']}")
                y -= bar_h + 1.5 * mm
            y -= 3 * mm
        y = new_page()

    for block in chart.get('blocks') or []:
        bars: List[Dict] = block.get('bars') or []
        rows = [bars[i:i + bars_per_row] for i in range(0, len(bars), bars_per_row)] or [[]]
        text = block.get('text') or ''
        is_line = block.get('kind') == 'line'
        text_h = (line_font + 2) if (is_line or not bars) else 0
        first_h = text_h + (bar_h + 2 * mm if rows[0] else 0) + 3 * mm
        if y - first_h < margin_bottom:
            y = new_page()

        # timestamp + lyric line (or instrumental label)
        c.setFont(regular, 7)
        c.setFillGray(0.5)
        c.drawRightString(x0 - 2.5 * mm, y - line_font + 2, _fmt_time(block.get('start') or 0))
        c.setFillGray(0)
        if is_line:
            size = _fit_font_size(c, text, regular, line_font, content_w)
            c.setFont(regular, size)
            c.drawString(x0, y - line_font + 2, text)
            y -= text_h
        elif not bars:
            y -= text_h
        else:
            c.setFont(regular, 7.5)
            c.setFillGray(0.5)
            c.drawString(x0, y - 7, 'instrumental')
            c.setFillGray(0)
            y -= 8

        for row in rows:
            if not row:
                continue
            if y - bar_h < margin_bottom:
                y = new_page()
            for k, bar in enumerate(row):
                draw_bar(x0 + k * (bar_w + bar_gap), y, bar)
            y -= bar_h + 1.5 * mm
        y -= 2 * mm

    footer()
    c.save()
    return buf.getvalue()
