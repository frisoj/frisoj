"""Build the CSV that Pinterest's "Bulk create Pins" screen reads.

Pinterest can create and schedule up to 200 pins from one CSV. The columns it
expects are board_name, title, description, link, image_url and published_at
(YYYY-MM-DD HH:MM). image_url has to be publicly reachable, which is why the pin
artwork is uploaded to Shopify Files first (see marketing/pin-urls.json).

Sources, so nothing is retyped or invented:
  marketing/08-pins-uploadlijst.md  -> number, file, title, board, target link
  marketing/02-pinterest.md         -> description per pin
  marketing/pin-urls.json           -> public image URL per file

The schedule spreads the 30 pins over four weeks instead of dumping them in one
day: Pinterest rewards a steady rhythm, and its scheduler only looks about 30
days ahead. Pins are interleaved across the five products so a single day never
hits the same board twice.

Run: python3 pinterest_csv.py [startdatum YYYY-MM-DD]
Out: marketing/pinterest-bulk-upload.csv
"""
import csv
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MARKETING = f"{ROOT}/marketing"

ROW = re.compile(
    r"^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|\s*$")
URL_TAIL = re.compile(r"\s*https?://\S+\s*$")

# Evening slots do best for planning content in NL/BE; the second slot is only
# used on the two days that carry an extra pin.
SLOT_1 = "19:30"
SLOT_2 = "12:30"
DOUBLE_DAYS = {4, 11}          # days that get a second pin, to fit 30 in 28 days
DAYS = 28


def read_uploadlijst():
    """number -> {file, title, board, link} from the upload list table."""
    pins = {}
    with open(f"{MARKETING}/08-pins-uploadlijst.md", encoding="utf-8") as fh:
        for line in fh:
            m = ROW.match(line)
            if m:
                n, fname, title, board, link = m.groups()
                pins[int(n)] = {"file": fname, "title": title, "board": board, "link": link}
    return pins


def read_beschrijvingen():
    """number -> description, from the pin plan."""
    out, current = {}, None
    with open(f"{MARKETING}/02-pinterest.md", encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r"^\*\*Pin (\d+)\*\*", line)
            if m:
                current = int(m.group(1))
            elif current and line.startswith("- Beschrijving:"):
                text = line.split(":", 1)[1].strip()
                # the plan appends the target URL; it belongs in the link column
                out[current] = URL_TAIL.sub("", text)
                current = None
    return out


def read_urls():
    path = f"{MARKETING}/pin-urls.json"
    with open(path, encoding="utf-8") as fh:
        return {row["bestand"]: row["url"] for row in json.load(fh)}


def volgorde(numbers):
    """Round-robin across the five product blocks of six pins each."""
    blocks = [[n for n in numbers if (n - 1) // 6 == b] for b in range(5)]
    out = []
    for i in range(6):
        for block in blocks:
            if i < len(block):
                out.append(block[i])
    return out


def planning(start):
    """(date, time) for each of the 30 pins, one a day plus two doubled days."""
    slots = []
    for day in range(1, DAYS + 1):
        slots.append((start + dt.timedelta(days=day - 1), SLOT_1))
        if day in DOUBLE_DAYS:
            slots.append((start + dt.timedelta(days=day - 1), SLOT_2))
    return slots


def main():
    start = (dt.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1
             else dt.date.today() + dt.timedelta(days=1))

    pins = read_uploadlijst()
    beschrijvingen = read_beschrijvingen()
    urls = read_urls()

    order = volgorde(sorted(pins))
    slots = planning(start)
    if len(order) > len(slots):
        raise SystemExit(f"{len(order)} pins maar {len(slots)} momenten in de planning")

    out = f"{MARKETING}/pinterest-bulk-upload.csv"
    missing = []
    with open(out, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["board_name", "title", "description", "link", "image_url", "published_at"])
        for n, (date, time) in zip(order, slots):
            pin = pins[n]
            url = urls.get(pin["file"])
            if not url:
                missing.append(pin["file"])
                continue
            w.writerow([pin["board"], pin["title"], beschrijvingen.get(n, ""),
                        pin["link"], url, f"{date.isoformat()} {time}"])

    if missing:
        raise SystemExit("geen URL voor: " + ", ".join(missing))
    print(f"{out}\n{len(order)} pins, van {slots[0][0]} tot {slots[len(order) - 1][0]}")


if __name__ == "__main__":
    main()
