"""Revoke stale Apple Development certificates that previous cloud builds created.

Each CI run starts on a fresh Mac, so Xcode's automatic signing makes a new
"Created via API" development certificate every time, and Apple caps how many
an account can hold. This removes only those: DEVELOPMENT-type certificates
whose name contains "Created via API" and that are older than an hour.
Distribution certificates and certificates made on your own Mac are never touched.
"""
import os, sys, time, json, urllib.request, datetime
import jwt  # PyJWT

key_id, issuer = os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"]
private_key = open(os.environ["ASC_KEY_PATH"]).read()
token = jwt.encode({"iss": issuer, "iat": int(time.time()), "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"},
                   private_key, algorithm="ES256", headers={"kid": key_id, "typ": "JWT"})

def api(method, path):
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, method=method,
                                 headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req) as r:
        body = r.read()
        return json.loads(body) if body else None

# Apple's API occasionally hiccups; retry, and never fail the build over housekeeping.
certs = None
for attempt in range(4):
    try:
        certs = api("GET", "/v1/certificates?limit=200&fields[certificates]=name,displayName,certificateType,expirationDate")["data"]
        break
    except Exception as e:
        print(f"::warning::listing certificates failed (attempt {attempt + 1}): {e}")
        time.sleep(5 * (attempt + 1))
if certs is None:
    print("::warning::skipping certificate cleanup this run")
    sys.exit(0)
now = datetime.datetime.now(datetime.timezone.utc)
revoked = 0
for c in certs:
    a = c["attributes"]
    name = (a.get("name") or "") + " " + (a.get("displayName") or "")
    ctype = a.get("certificateType") or ""
    print(f"::notice::certificate {c['id']} type={ctype} name={name.strip()} expires={a.get('expirationDate')}")
    # Development certs last a year: an expiry less than ~1 year minus 1 hour away means it is older than an hour.
    exp = datetime.datetime.fromisoformat(a["expirationDate"].replace("Z", "+00:00")) if a.get("expirationDate") else None
    older_than_hour = exp is not None and (exp - now) < datetime.timedelta(days=365) - datetime.timedelta(hours=1)
    if ctype in ("DEVELOPMENT", "IOS_DEVELOPMENT") and "Created via API" in name and older_than_hour:
        try:
            api("DELETE", f"/v1/certificates/{c['id']}")
            revoked += 1
        except Exception as e:
            print(f"::warning::could not revoke {c['id']}: {e}")
print(f"::notice::revoked {revoked} stale cloud-build development certificates")
