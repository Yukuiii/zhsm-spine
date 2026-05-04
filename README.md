# zhsm-spine

Spine asset preview workspace for extracted assets from **战火使命** (`zhsmxb`).

The project includes a browser-based WebGL previewer for Spine 3.6 assets, including binary `.skel` files. It is intended for browsing, checking animations, and quickly isolating visible character parts from background/effect slots.

## Disclaimer

The extracted game assets in this repository are provided only for personal learning and technical exchange. Do not use them for commercial purposes or unauthorized redistribution.

## Features

- Preview Spine `.skel` and `.json` resources from `extracted/`
- Spine 3.6 binary `.skel` support via `preview/lib/spine-skeleton-binary-3.6.js`
- Animation selector, loop toggle, speed control, scale control, and background toggle
- Drag the current Spine asset within the preview
- Optional "character only" mode that hides likely background/effect slots
- Premultiplied alpha rendering enabled to match these assets and avoid dark edge artifacts

## Layout

```text
extracted/      Exported preview-ready Spine assets: .skel/.json, .atlas, .png
preview/        Browser preview app and manifest
spine_main/     Original extracted Spine-related asset files
tools/          Local extraction tooling
```

## Run

From the repository root:

```powershell
python -m http.server 8001
```

Then open:

```text
http://localhost:8001/preview/
```

If port `8001` is already used, choose another port:

```powershell
python -m http.server 8010
```

and open `http://localhost:8010/preview/`.

## Manifest

The previewer reads:

```text
preview/manifest.json
```

If resources are added or removed, regenerate the manifest with:

```bash
bash preview/generate_manifest.sh
```

## Notes

- The runtime is based on Spine WebGL 3.6.
- `spine-ts` 3.6 did not include binary `.skel` loading, so this repo adds a 3.6-compatible `SkeletonBinary` shim.
- The binary parser is version-specific and is meant for Spine 3.6 data, not 3.8/4.x exports.
- The "character only" option is heuristic. It hides slots with names that look like shadows, backgrounds, UI boards, glow, and effects; some assets may need rule tuning.
