# 3D assets — buying and installing the KayKit pack

myCCtown draws your Clever Cloud organisations as a medieval hex city. Every model in
that city (tiles, buildings, trees, units) comes from the **KayKit Medieval Hexagon
Pack** by **[Kay Lousberg](https://www.kaylousberg.com)**. **These assets are not
included in this repository.** To run the city you buy the pack on itch.io and install
it with one command.

This guide covers buying the pack, installing it, checking the install, production,
the optional music and portraits, and troubleshooting.

---

## Why the assets are not bundled

The myCCtown code is open source (AGPL-3.0). The art is not ours. Kay Lousberg
releases KayKit under CC0, which would technically allow redistribution. We still
choose **not** to redistribute the files: the paid *Source Files* edition is how Kay
funds this work, and the city owes its whole look to it. Buying the pack costs a few
dollars and is the only requirement for running myCCtown.

> The AGPL-3.0 license of this repository covers the myCCtown code only. It does
> **not** cover the KayKit assets, the ambient music or the mayor portraits.

---

## 1. Buy and download the pack

You need the **Source Files** edition. The installer checks for it and rejects other
editions.

| Pack | Store page | Archive to download |
|---|---|---|
| KayKit Medieval Hexagon Pack | <https://kaylousberg.itch.io/kaykit-medieval-hexagon> | `KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip` |

1. Open the store page and click **Buy Now**.
2. Pick the **Source Files** option (at the time of writing, $8) and complete the
   payment.
3. On the download page itch.io shows after purchase (also available later under
   *My Library* on itch.io), download `KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip`.
4. Leave it in your **Downloads** folder. The installer looks there first.

> Do not unzip the archive yourself. The installer reads the `.zip` directly and
> extracts only the files it needs (about 23 MB out of the 65 MB archive).

---

## 2. Install

### Prerequisites

- **Node.js 20+** (already required to build the frontend).
- **`unzip`**, or **`tar`** with zip support:
  - macOS: both are preinstalled.
  - Debian/Ubuntu: `sudo apt install unzip`. Fedora: `sudo dnf install unzip`.
  - Windows 10+: the built-in `tar.exe` (bsdtar) handles zip, so nothing to install.
    WSL works like Linux.

### Run the installer

```bash
cd frontend
npm install            # if not done yet
npm run assets:install
```

The installer:

1. **Finds the archive.** It looks in `~/Downloads`, then the repository root, then the
   current directory, by its exact file name.
2. **Checks that it is the SOURCE edition.** The expected top-level folder and the
   Blender source file (`SOURCE/Medieval_Hexagons_SOURCE.blend`) must be present.
3. **Compares the SHA-256** with the known 1.0 release. A mismatch only prints a
   warning: a re-zipped or newer archive is accepted if its content is complete.
4. **Extracts only `Assets/gltf/`** to a temporary directory. Archives that contain
   unsafe paths (absolute paths or `..`) are rejected.
5. **Copies the files into `frontend/public/assets/gltf/{buildings,decoration,tiles,units}/`**,
   replacing any previous install. Vite serves them at `/assets/gltf/…` in dev and
   copies them into `dist/` at build time.
6. **Verifies the result.** Every model listed in the asset catalog
   (`src/data/assetCatalog.ts`) must be present, along with every `.bin` buffer and
   texture each model references and the shared texture atlas.

Expected output:

```text
[assets] KayKit Medieval Hexagon Pack (SOURCE)
         ← /Users/you/Downloads/KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip
[assets] ✓ installed 829 files (23.4 MB) → public/assets/gltf

[assets] All set. Next: `npm run dev` (or `npm run build`).
```

### Options

```bash
# Archive stored somewhere else
npm run assets:install -- --zip ~/stuff/KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip

# Reinstall even if everything is already in place
npm run assets:install -- --force
```

Running the installer again is safe. If the assets are already complete, it does
nothing unless you pass `--force` or `--zip`.

The installed files live in `frontend/public/assets/gltf/`, which is **git-ignored**.
Never commit them to a public repository.

---

## 3. Check the install

```bash
npm run assets:check
```

```text
[assets] ✓ KayKit Medieval Hexagon Pack (SOURCE)
```

The same check runs automatically before `npm run dev` and `npm run build`
(`predev` / `prebuild`). If the assets are missing, the command stops with a message
that points back to this guide, so you never get an empty, model-less city by
accident.

Then start the app (see [`SELF_HOSTING.md`](SELF_HOSTING.md) §4), open an
organisation and check that the hex tiles and buildings render. The browser console
should show no `404` or glTF parse error for `.gltf`, `.bin` or `.png` files.

---

## 4. Production

`npm run build` copies `public/` into `frontend/dist/`, and `frontend/server.mjs`
serves the models from there with cache headers tuned for them. **The assets must be
present on the machine that runs the build.**

- **Build on your own machine, a VM or in CI**: run `npm run assets:install` before
  `npm run build`. In CI, keep the archive as a **private** artifact or secret file,
  never in a public place.
- **Platforms that build from your git repository** (Clever Cloud, Heroku,
  Render…) never see the git-ignored `public/assets/gltf/`, so the build stops at
  the `prebuild` check. Pick one of these:
  - deploy from a **private** fork or branch where you force-add the installed
    assets (`git add -f frontend/public/assets/gltf`). That is how the reference
    instance runs. Never push that branch to a public remote;
  - or build locally (or in CI) and deploy the built artifact.

Licensing note: serving the files to your users at runtime is normal use of the
pack. Do not offer the raw archive or a browsable dump of the files for download.

---

## 5. Optional: ambient music and mayor portraits

The ambient music and the mayor portraits used on the hosted instance are **not**
part of the open-source release. Without them the app still works:

- the **Music** button in the top bar hides itself once no track can be loaded;
- the mayor's speech bubble shows an emoji instead of a portrait.

To add your own:

- **Music**: put MP3s with these exact names in the repository's `music/` folder
  (`npm run dev` / `build` copy them to `frontend/public/music/`), or host them on
  a public bucket and set `VITE_MUSIC_BASE_URL` at build time. The track list lives
  in `frontend/src/hooks/useAmbientMusic.ts`:
  `Castle Ember.mp3`, `Castle Ember2.mp3`, `Cobblestone Noon.mp3`,
  `Cobblestone Noon2.mp3`, `First Village.mp3`, `First Village2.mp3`.
- **Portraits**: `frontend/public/mayor/mayor_{neutral,happy,alarmed}.png`.

All these paths are git-ignored.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `… not found (looked in ~/Downloads, the repo root and the current directory)` | The archive has a different name or location. Pass its path with `--zip <path>`. |
| `this is not the SOURCE edition of the pack` | You downloaded the free or another edition. Get the **Source Files** archive from your itch.io library. |
| `does not look like KayKit_Medieval_Hexagon_Pack_1.0_SOURCE.zip` | Wrong archive, or a re-packed archive with a different top-level folder. Use the original download. |
| `! checksum differs from the known 1.0 SOURCE archive` | Warning only. The archive was re-zipped or is a newer release. The install goes on, and the file check that follows decides. |
| `N required file(s) still missing after install` | A newer pack version renamed or removed models used by the catalog. Open an issue with the missing path. |
| `neither unzip nor tar is available` | Install `unzip` (see prerequisites). |
| `npm run dev` / `build` stops with `[assets] ✗ …` | Assets not installed: run `npm run assets:install`. |
| City stays empty, console shows `404 …gltf` or a glTF/JSON parse error | The build ran without the assets, or a proxy in front of `server.mjs` rewrites `/assets/gltf/…`. Reinstall, rebuild and redeploy. |
| Models load but are untextured | The shared atlas `assets/gltf/tiles/base/hexagons_medieval.png` is missing or served with a wrong content type. Re-run with `--force`. |
