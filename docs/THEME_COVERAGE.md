# Theme verification

Flowmate provides Forest, Ocean, Plum and Slate palettes. The document-level `data-theme` attribute and the versioned `flowmate.appearance.v1` browser preference drive palette selection. The preference is device/browser scoped and does not change workspace records or account data.

## Verified behavior

- Automated checks cover palette selection, startup fallback, denied storage, cross-tab updates and semantic color contrast.
- The source checker classifies known semantic and user-data color exceptions; it is a heuristic and does not prove that every component is theme-complete.
- Chromium release checks switch all four palettes across desktop, tablet and mobile layouts and verify that dashboard borders follow the selected palette.
- The graph uses live SVG theme tokens so palette changes do not require rebuilding its force simulation.

## Preserved color meaning

User-assigned event and subject colors remain data. Warning and error states retain their meaning. Theme choice must not rely on color alone; labels, shapes and text remain available where color carries status.

The automated suite does not substitute for manual keyboard, screen-reader or every-route review. Provider-backed behavior is outside theme verification.
