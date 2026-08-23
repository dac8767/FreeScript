# Apple Developer ID — enrolment to a notarized `.dmg`

**Why this is the top release blocker.** macOS refuses to open a downloaded app
that is not signed by a known developer and notarized by Apple. The message it
shows is *"ScriptCraft is damaged and can't be opened. You should move it to the
Bin"* — which is a lie about the file, and a writer who sees it will delete the
app and never mention it. There is no workaround you can ask a customer to
perform. Nothing else on the release list matters until this is done.

There are three separate things here and they are easy to conflate:

| | answers | needed for |
|---|---|---|
| **Developer ID certificate** | who built this | Gatekeeper letting it open |
| **Notarization** | has Apple scanned it | Gatekeeper letting it open |
| **Tauri signing key** (already done) | is this really our update | the in-app updater |

The first two are Apple's; the third is unrelated and already in place.

Budget: **$99/year**, plus 1–2 days of waiting on Apple.

---

## Part 1 — Enrol in the Apple Developer Program

### Choose the account type first — it is hard to change later

|  | Individual / Sole Proprietor | Organization |
|---|---|---|
| Shows as developer | **your personal legal name** | the company name |
| Needs a D-U-N-S number | no | yes — free, but can take days |
| Needs a legal entity | no | yes |
| Time to approve | usually 24–48h | often 1–2 weeks |

The developer name is **publicly visible** — in Gatekeeper's first-run dialog and
in the certificate. If you would rather customers see "ScriptCraft" or a company
than your own name, that decision has to happen here, not later.

### Steps

1. Sign in at **https://developer.apple.com** with the Apple ID you intend to
   keep. Two-factor authentication must be enabled on it — Apple will not enrol
   an account without it.
2. Go to **https://developer.apple.com/programs/enroll/**
3. Choose Individual or Organization per the table above.
4. Fill in the legal details. For Organization you will be asked for the D-U-N-S
   number; get one first at
   https://developer.apple.com/enroll/duns-lookup/ (free).
5. Pay the $99. It renews annually — **if it lapses, your certificate stops
   working and already-downloaded apps keep working but new builds cannot be
   signed.**
6. Wait for the approval email.

---

## Part 2 — Create the Developer ID Application certificate

A certificate is useless without the private key generated alongside it, and
that key only ever exists on the machine that made the request. Do this on the
Mac you will build from.

### 2a. Generate the signing request

1. Open **Keychain Access** (⌘-Space, "Keychain Access")
2. Menu bar → **Keychain Access → Certificate Assistant → Request a Certificate
   From a Certificate Authority…**
3. Fill in:
   - **User Email Address**: your Apple ID email
   - **Common Name**: anything recognisable, e.g. `Derek Carl Developer ID`
   - **CA Email Address**: leave **blank**
   - Select **Saved to disk**
   - Tick **Let me specify key pair information**
4. Continue → save `CertificateSigningRequest.certSigningRequest` somewhere you
   can find it
5. Key Size **2048 bits**, Algorithm **RSA** → Continue

This has just created a private key in your login keychain. **That key is the
thing that matters** — the certificate Apple sends back is only useful in
combination with it.

### 2b. Ask Apple for the certificate

1. Go to **https://developer.apple.com/account/resources/certificates/list**
2. Click the **+** beside "Certificates"
3. Under **Software**, choose **Developer ID Application**

   Not *Mac Development* (that only works on registered test machines), and not
   *Developer ID Installer* (that signs `.pkg` installers — ScriptCraft ships a
   `.dmg`, so it is not needed).
4. If asked which profile type, choose the **G2 Sub-CA** / current option.
5. Upload the `.certSigningRequest` from 2a → Continue
6. **Download** the resulting `.cer`
7. Double-click the downloaded file. It installs into Keychain Access and pairs
   itself with the private key from 2a.

> Developer ID certificates are limited in number per account. Do not create
> spares "just in case" — you can revoke and re-issue, but each one you leave
> active counts against the limit.

### 2c. Confirm it is really usable

```bash
security find-identity -v -p codesigning
```

You want a line like:

```
1) A1B2C3... "Developer ID Application: Your Name (AB12CD34EF)"
```

If it appears under `-v` (valid identities) then the certificate **and** its
private key are both present. If you see the certificate in Keychain Access but
it does not appear here, the private key is missing — the CSR was made on a
different Mac, or a different login keychain.

**Copy that quoted string exactly.** It is what goes into `.env` — including the
`Developer ID Application: ` prefix and the parenthesised Team ID.

### 2d. Back the certificate up

Losing the private key means re-issuing the certificate. Export both halves now:

1. Keychain Access → **My Certificates** → find `Developer ID Application: …`
2. Right-click → **Export "Developer ID Application: …"**
3. Format **Personal Information Exchange (.p12)**
4. Set a strong password and record it — you will need it again in Part 5
5. Store the `.p12` and its password somewhere off this Mac

---

## Part 3 — Notarization credentials

Signing says who built it. **Notarization** is a separate step: the `.dmg` is
uploaded to Apple, scanned automatically for malware, and a "ticket" is issued
and stapled into the file. Gatekeeper checks for that ticket. Both are required.

`build-desktop.sh` uses the app-specific-password method, so:

1. Go to **https://appleid.apple.com** and sign in
2. **Sign-In and Security → App-Specific Passwords**
3. **+**, name it `ScriptCraft notarization`
4. Copy the password — formatted `abcd-efgh-ijkl-mnop`. **It is shown once.**

You also need your **Team ID**: the ten characters in brackets from 2c, or from
**https://developer.apple.com/account** → Membership details.

> There is a second method — an App Store Connect API key (`.p8`) — which is
> better for CI because it does not break when you change your Apple ID
> password. Tauri supports both. Start with the app-specific password; moving
> later is a change of three environment variables.

---

## Part 4 — Build and notarize locally

### 4a. Create `.env` in the project root

`/Users/dcarl/ScriptCraft/.env` — this file is already in `.gitignore`
(verified), so it will not be committed:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (AB12CD34EF)"
APPLE_ID="you@example.com"
APPLE_PASSWORD="abcd-efgh-ijkl-mnop"
APPLE_TEAM_ID="AB12CD34EF"
```

`APPLE_SIGNING_IDENTITY` must match `security find-identity` **character for
character**. A mismatch fails with "no identity found", which reads like a
missing certificate rather than a typo.

> v7.79 removed a hardcoded `APPLE_SIGNING_IDENTITY` from `build-desktop.sh:51`
> — it named Proteus's certificate, inherited from upstream, whose private key
> this project has never had. The script now reads the value from `.env` and
> stops with an explicit message if it is missing.

### 4b. Build

```bash
cd /Users/dcarl/ScriptCraft
./build-desktop.sh
```

Compiling takes a while. **Notarization adds 5–20 minutes** during which the
script appears to be doing nothing — Apple's queue is the slow part, and it is
occasionally much slower. That is normal.

### 4c. Verify all three properties, not just one

```bash
APP="src-tauri/target/release/bundle/macos/ScriptCraft.app"
DMG=$(find src-tauri/target/release/bundle/dmg -name '*.dmg' | head -1)

# 1. the signature is valid and covers everything inside
codesign --verify --deep --strict --verbose=2 "$APP"

# 2. Gatekeeper itself would accept it
spctl -a -vvv -t install "$APP"

# 3. the notarization ticket is actually stapled into the file
xcrun stapler validate "$DMG"
```

The second is the one that matters: `spctl` should say **`accepted`** and
`source=Notarized Developer ID`. "accepted / source=Unnotarized Developer ID"
means it is signed but not notarized — Gatekeeper will still refuse it on
another Mac.

### 4d. The only test that really counts

Signing verifies locally even when the download experience is broken, because
your own Mac never applied the quarantine flag. So test it the way a customer
would: **upload the `.dmg` somewhere, download it in a browser on a Mac that has
never seen this code, and double-click it.** It should open with no warning at
all — not "unidentified developer", not "damaged".

---

## Part 5 — Signing in CI

Local signing uses the certificate in your keychain. A GitHub runner starts with
an empty keychain, so the certificate has to be shipped to it.

### 5a. Encode the `.p12` from 2d

```bash
base64 -i /path/to/ScriptCraft-DeveloperID.p12 | pbcopy
```

### 5b. Add six secrets

At **https://github.com/dac8767/ScriptCraft/settings/secrets/actions**, alongside
the three already there:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | the base64 blob from 5a |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password from 2d |
| `APPLE_SIGNING_IDENTITY` | the same quoted string as `.env` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password from Part 3 |
| `APPLE_TEAM_ID` | your ten-character Team ID |

The Publish Update workflow imports the certificate into a temporary keychain
when `APPLE_CERTIFICATE` is present, and builds unsigned when it is not — so
adding these six is the entire switch. Nothing else needs editing.

> v7.79 added that import step. Before it, the workflow passed
> `APPLE_SIGNING_IDENTITY` to a runner whose keychain was empty, so the identity
> resolved to nothing and the build would have failed at the very end, after
> twenty minutes of compiling. `release.yml` never hit this because
> `tauri-action` does the import itself.

---

## Things that will trip you up

**"The Mac App Store is now possible."** It is not.
`src-tauri/Cargo.toml` enables `macos-private-api`, which the App Store rejects.
That is a deliberate trade for the `.dmg` route and unrelated to Developer ID —
notarization does not care about private APIs, App Review does.

**`src-tauri/entitlements/app.entitlements` is stale.** It still carries
Proteus's team (`335RGMFDB6`) and the old bundle id `com.proteus.opendraft`,
neither of which matches this app. It is only read by `release.yml`'s Mac App
Store job, which is ruled out by the line above, so it is harmless — but do not
copy it into the Developer ID path expecting it to work.

**Renewal.** The membership lapses annually. Apps already downloaded keep
working — signatures do not expire retroactively — but you cannot sign or
notarize anything new until it is renewed.

**Certificate expiry.** Developer ID certificates last five years. Builds signed
before expiry stay valid; put the date in a calendar anyway.

**Notarization can reject you.** The usual cause is a nested binary that is
unsigned or lacks the hardened runtime. `codesign --verify --deep --strict` in
4c catches most of it before Apple does. If Apple rejects, fetch the reason:

```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD"
```
