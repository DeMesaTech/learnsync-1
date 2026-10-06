"""Authenticated checks against an API running on a restored copy (port 8003). Exit 1 on any failure."""
import argparse
import sys

import httpx

parser = argparse.ArgumentParser()
parser.add_argument("--offering", required=True)
parser.add_argument("--faculty", required=True)
parser.add_argument("--password", required=True)
args = parser.parse_args()
HEADERS = {"Origin": "http://127.0.0.1:5175"}
failures = []


def check(label, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + label + (f" - {detail}" if detail else ""))
    if not ok:
        failures.append(label)


client = httpx.Client(base_url="http://127.0.0.1:8003", headers=HEADERS, timeout=30)
check("health", client.get("/api/health").status_code == 200)
stale = httpx.Client(base_url="http://127.0.0.1:8003", headers=HEADERS)
stale.cookies.set("learnsync_v2_session", "a-session-token-from-before-the-backup")
check("a session from before the backup is not honoured", stale.get("/api/auth/session").json().get("user") is None)
csrf = client.get("/api/auth/session").json()["csrf"]
login = client.post("/api/auth/login", json={"email": args.faculty, "password": args.password}, headers={"X-CSRF-Token": csrf})
check("sign-in works on the restored copy", login.status_code == 200, str(login.status_code))
base = f"/api/teach/offerings/{args.offering}"
items = client.get(f"{base}/items").json()
published = [i for i in items if i["published"]]
check("published teaching content is present", len(published) > 0, f"{len(published)} published items")
files = [i["published"]["file"] for i in items if i["kind"] == "file" and i["published"] and i["published"]["file"]]
for f in files:
    d = client.get(f"/api/files/{f['id']}/download")
    check(f"file {f['name']} downloads with its original size", d.status_code == 200 and len(d.content) == f["size"],
          f"{d.status_code}, {len(d.content)} of {f['size']} bytes")
book = client.get(f"{base}/gradebook").json()
releases = [(r["display_name"], k, v["release_number"]) for r in book["rows"] for k, v in r["published"].items()]
check("published grade releases are present", len(releases) > 0, str(releases))
for period in ("midterm", "finals"):
    out = client.get(f"{base}/exports/grades", params={"format": "xlsx", "period": period, "basis": "published"})
    check(f"{period} export opens", out.status_code == 200 and out.content[:2] == b"PK", str(out.status_code))
sys.exit(1 if failures else 0)
