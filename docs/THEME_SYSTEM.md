# Application appearance contract

Forest is the default. Ocean, Plum and Slate change the complete dark palette while preserving density, fonts, small radii and flush shell. `styles/forest.css` is the single color authority (historical filename retained). Semantic tokens cover surfaces, text, borders, accent/focus, graph, charts and status. Legacy Tailwind neutral/accent names are compatibility aliases through `@theme inline`; new code should prefer semantic tokens. Do not introduce fixed brand colors.

## Runtime API

`services/theme.ts`: `applyTheme(id)`, `getTheme()`, `useTheme()`, `themeColor('--token')`. The document `data-theme` attribute updates synchronously. React consumers subscribe without remounting application state. Portals inherit root tokens. D3 GraphView uses live SVG paint variables; changing the palette does not rebuild the simulation or reset zoom. Filtered entity/relationship inputs are memoized to avoid the pre-existing render/rebuild loop. Live voice reads resolved tokens in its animation frame without reconnecting its session. Confetti redraws with current palette. Theme swatches use the same CSS ramps, not copied hex values.

`public/theme-init.js` is a small blocking same-origin script before CSS/app execution. It validates the versioned local preference and applies the attribute before first paint. No inline script/CSP weakening. Offline service-worker precache includes this script. Invalid values and unavailable storage fall back to Forest. Storage failure allows a live preview with a Settings warning. Other tabs follow storage events.

## Presentation preference policy

The key `flowmate.appearance.v1` contains only a preset identifier. It is intentionally device/browser scoped: demo entry/exit, sign-in/out and account switches do not change it. It is never stored in entity data, demo snapshots or cloud account settings. Shared-device users share this explicitly labelled presentation preference; no account-private information is stored. Switching does not write application data or remount forms/chat. Resetting browser storage restores Forest.

## Scope and verification

The repository includes automated palette-selection, startup-fallback, denied-storage, cross-tab and semantic-color checks, plus Chromium coverage for palette changes across desktop, tablet and mobile layouts. These checks do not establish accessibility of every route or overlay. User-assigned calendar colors and warning/error status colors retain their meaning across palettes.