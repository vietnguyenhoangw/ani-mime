# Plugins

First-party Ani-Mime plugins. Each subfolder is one self-contained plugin
(a `manifest.json` + web assets) that runs in its own WebView via the
`window.ani` SDK. Plugins are **not** bundled into the app — users install them
from a `.zip`, so this folder has no effect on the shipped binary size.

> This is the in-repo home for plugins for now. If a public plugin ecosystem
> grows, these would move to a dedicated `ani-mime-plugins` repo (see the
> plugin-system design spec).

## Layout

```
plugins/
└── <id>/
    ├── manifest.json   # id, name, version, capabilities, window config, hotkey
    ├── index.html      # entry point (declared by manifest.entry)
    └── …               # any bundled JS/CSS/assets
```

## Available plugins

| Plugin | What it does |
|--------|--------------|
| [`clipboard`](./clipboard) | System clipboard history — your last 20 copies, ready to paste back |

## Authoring a plugin

1. Create `plugins/<id>/manifest.json` declaring `id` (`[a-z][a-z0-9-]*`),
   `version` (semver), `entry`, `capabilities` (subset of `window`, `hotkey`,
   `storage`), and a `window` size.
2. Build the UI in the `entry` HTML; talk to the host through `window.ani`
   (`window.*`, `storage.*`). All assets must be bundled — remote `<script>`s
   are blocked.
3. Install for testing: copy the folder to `~/.ani-mime/plugins/<id>/`, or zip
   it and use Settings → Plugins → **Install…**.

See [`clipboard/README.md`](./clipboard/README.md) for a worked example.
