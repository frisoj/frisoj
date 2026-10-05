#!/usr/bin/env python3
"""Zet Ride a Sky Whale automatisch online via Roblox Open Cloud.

Wat het doet, in deze volgorde:
  1. Developer Products en Game Passes uit tools/store.json aanmaken als ze nog
     niet bestaan (op naam), met plaatje, prijs en "te koop".
  2. Hun ID's invullen in src/shared/Config.luau.
  3. Het placebestand bouwen (build.sh: Rojo + Lune).
  4. Het placebestand publiceren naar je bestaande game.

Nodig (als omgevingsvariabelen, nooit in de code of chat):
  ROBLOX_API_KEY      API-sleutel met universe-places (write),
                      developer-product (read+write) en game-pass (read+write)
  ROBLOX_UNIVERSE_ID  Creator Hub > ... bij je game > Copy Universe ID
  ROBLOX_PLACE_ID     het getal in de link van je place

Gebruik:
  python3 tools/deploy.py              alles
  python3 tools/deploy.py --dry-run    laat zien wat er zou gebeuren, verandert niets online
  python3 tools/deploy.py --skip-store alleen bouwen en publiceren
"""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = os.environ.get("ROBLOX_API_BASE", "https://apis.roblox.com")  # alleen aanpassen om te testen
CONFIG = ROOT / "src" / "shared" / "Config.luau"
PLACE_FILE = ROOT / "RideASkyWhale.rbxl"


def request(method, url, key, body=None, content_type=None):
    for attempt in range(4):
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("x-api-key", key)
        if content_type:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=180) as res:
                raw = res.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")
            if err.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            sys.exit(f"Fout: {method} {url} gaf HTTP {err.code}: {detail}")
        except urllib.error.URLError as err:
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            sys.exit(f"Fout: {method} {url} niet bereikbaar: {err.reason}")
    sys.exit("Fout: te veel mislukte pogingen")


def multipart(fields, files):
    boundary = uuid.uuid4().hex
    chunks = []
    for name, value in fields.items():
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    for name, (filename, data, ctype) in files.items():
        head = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode()
        chunks.append(head + data + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def list_all(url, key, field):
    items, token = [], None
    while True:
        page = f"{url}?pageSize=50" + (f"&pageToken={token}" if token else "")
        res = request("GET", page, key)
        items.extend(res.get(field) or [])
        token = res.get("nextPageToken")
        if not token:
            return items


def ensure_items(kind, universe, key, wanted, dry_run):
    if kind == "product":
        base = f"{API}/developer-products/v2/universes/{universe}/developer-products"
        field, id_field, label = "developerProducts", "productId", "Developer Product"
    else:
        base = f"{API}/game-passes/v1/universes/{universe}/game-passes"
        field, id_field, label = "gamePasses", "gamePassId", "Game Pass"

    existing = {} if dry_run and not key else {e.get("name"): e for e in list_all(f"{base}/creator", key, field)}
    ids = {}
    for item in wanted:
        found = existing.get(item["name"])
        if found:
            ids[item["key"]] = int(found[id_field])
            print(f"  {label} '{item['name']}' bestaat al (ID {ids[item['key']]})")
            continue
        if dry_run:
            print(f"  {label} '{item['name']}' zou worden aangemaakt voor {item['price']} Robux")
            continue
        image = ROOT / item["image"]
        body, ctype = multipart(
            {
                "name": item["name"],
                "description": item["description"],
                "price": str(item["price"]),
                "isForSale": "true",
            },
            {"imageFile": (image.name, image.read_bytes(), "image/png")},
        )
        res = request("POST", base, key, body, ctype)
        ids[item["key"]] = int(res[id_field])
        print(f"  {label} '{item['name']}' aangemaakt (ID {ids[item['key']]})")
    return ids


def write_ids(ids):
    text = CONFIG.read_text()
    for name, value in ids.items():
        pattern = re.compile(rf"(\n\t{re.escape(name)} = )\d+(,)")
        text, count = pattern.subn(rf"\g<1>{value}\g<2>", text)
        if count != 1:
            sys.exit(f"Fout: '{name}' niet gevonden in Config.luau")
    CONFIG.write_text(text)
    print(f"  {len(ids)} ID's ingevuld in src/shared/Config.luau")


def build():
    subprocess.run(["sh", "build.sh"], cwd=ROOT, check=True)


def publish(universe, place, key):
    url = f"{API}/universes/v1/{universe}/places/{place}/versions?versionType=Published"
    res = request("POST", url, key, PLACE_FILE.read_bytes(), "application/octet-stream")
    print(f"  Gepubliceerd: versie {res.get('versionNumber', '?')}")


def main():
    parser = argparse.ArgumentParser(description="Ride a Sky Whale automatisch online zetten")
    parser.add_argument("--dry-run", action="store_true", help="niets online veranderen")
    parser.add_argument("--skip-store", action="store_true", help="producten en passes overslaan")
    parser.add_argument("--skip-publish", action="store_true", help="niet publiceren")
    args = parser.parse_args()

    key = os.environ.get("ROBLOX_API_KEY", "").strip()
    universe = os.environ.get("ROBLOX_UNIVERSE_ID", "").strip()
    place = os.environ.get("ROBLOX_PLACE_ID", "").strip()
    if not args.dry_run:
        missing = [n for n, v in (("ROBLOX_API_KEY", key), ("ROBLOX_UNIVERSE_ID", universe), ("ROBLOX_PLACE_ID", place)) if not v]
        if missing:
            sys.exit("Ontbreekt: " + ", ".join(missing) + " (zie de uitleg bovenaan dit bestand)")

    store = json.loads((ROOT / "tools" / "store.json").read_text())
    if not args.skip_store:
        print("1. Producten en passes")
        ids = {}
        ids.update(ensure_items("product", universe, key, store["developerProducts"], args.dry_run))
        ids.update(ensure_items("pass", universe, key, store["gamePasses"], args.dry_run))
        if ids:
            write_ids(ids)

    print("2. Bouwen")
    build()

    if args.skip_publish or args.dry_run:
        print("3. Publiceren overgeslagen")
    else:
        print("3. Publiceren")
        publish(universe, place, key)
    print("Klaar.")


if __name__ == "__main__":
    main()
