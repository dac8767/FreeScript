# Privacy Policy

**Last updated: 2026-08-24**

## Overview

ScriptCraft is a screenwriting application for macOS, Windows, Linux, iOS,
iPadOS and Android, published by **Coalition Studios, LLC**. It is a
local-first app: your screenplays live on your device, and the app works fully
offline for writing. Some optional features connect to the internet; this
policy lists every one of them, and whether it happens automatically or only
when you choose to use it.

## Where your work is stored

Your screenplays, settings and customizations are stored **locally on your
device**, in the app's data folder:

- **macOS:** `~/Library/Application Support/com.freedraft.app/`
- **Windows:** `%APPDATA%\com.freedraft.app\`
- **Linux:** `~/.local/share/com.freedraft.app/`
- **iOS / iPadOS:** the app's private sandbox (visible in the Files app)
- **Android:** app-private storage

(The folder keeps the legacy `com.freedraft.app` identifier on purpose —
renaming it would orphan existing users' data.)

Your scripts never leave your device unless you explicitly export, sync, or
share them, or submit a screenshot with feedback (see below).

## Network connections

ScriptCraft has **no analytics, advertising, tracking, or crash-reporting
SDKs**. It does not build a profile of you. The connections it can make are:

### Automatic

- **Update check.** On launch (and periodically after), the app fetches a
  small version file from GitHub
  (`raw.githubusercontent.com/dac8767/ScriptCraft-releases`) to see whether a
  newer version exists. This is a plain download; it sends no personal data,
  but like any web request it reveals your IP address and the fact that the app
  was launched. It never downloads or installs anything on its own — it only
  tells you an update is available.
- **Fonts.** If a screenplay or the interface uses a Google-hosted font, the
  font is loaded from Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`),
  which reveals your IP address to Google. The default screenplay font (Courier
  Prime) ships inside the app and needs no connection.

### Only when you choose to

- **Feedback.** If you use Help ▸ Feedback, the name, email and message you
  enter — and any screenshot you attach — are sent to our feedback backend
  (hosted on Supabase). A screenshot may show whatever was on your screen,
  including unreleased work, so attach one only when you mean to. Nothing is
  sent unless you press Submit.
- **Spelling dictionaries.** Choosing a spell-check language that isn't already
  bundled downloads that dictionary once (from `cdn.jsdelivr.net` or the
  LibreOffice dictionary repository on GitHub) and caches it on your device.
- **Link previews.** In the Beat Board, a preview for a link is fetched only
  when you click "Load preview" for that link — never automatically. The app
  refuses to fetch previews from private or local network addresses.
- **Cloud storage (Google Drive / OneDrive).** If you connect a cloud drive in
  Save Locations, the app signs in with Google or Microsoft (OAuth) and uploads
  the scripts you save there. Google Drive access is limited to files ScriptCraft
  creates or opens; OneDrive access is what the platform requires to save into
  the folders you choose. You can disconnect at any time.
- **ScriptCraft Cloud / collaboration.** Off by default. If you configure a
  cloud server URL, the app sends your sign-in details and a device identifier
  to that server to authenticate, and syncs the scripts you choose. If you never
  set a server, none of this runs.
- **Embedded video and external links.** Pasting a YouTube or Vimeo link into
  Script Notes can embed a player from those services (which see your IP). The
  "Donate" link and other outbound links open in your normal web browser.

## Children's privacy

ScriptCraft is not directed at children and does not knowingly collect data
from them. The optional features above are the same for all users.

## Your choices

- Writing, saving locally, printing and exporting need no network at all.
- Feedback, dictionary downloads, link previews and cloud storage are each
  opt-in.
- You can remove all local data by deleting the app's data folder (paths above).

## Changes to this policy

If this policy changes, the revised version will be posted here with a new date.

## Contact

Questions about this policy: **contact@scriptcraft.org**
(project: [github.com/dac8767/ScriptCraft](https://github.com/dac8767/ScriptCraft)).
