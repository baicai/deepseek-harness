# CNYU branding validation

This branch validates that the official DeepSeek Harness Desktop can be rebranded and packaged as a downstream Windows/macOS application.

Baseline: upstream `master` @ `1517a4dbca0a2789ff1d41ba439600f8547d23fa` (`dsh@0.2.1-alpha.5`).

Changed branding surfaces:

- `apps/desktop/resources/icon.png`
- `apps/desktop/resources/icon-macos.png`
- `apps/desktop/resources/icon-windows.png`
- `apps/desktop/resources/icon.svg`
- `apps/desktop/resources/icon-macos.svg`
- `apps/desktop/resources/icon-windows.svg`
- `apps/desktop/resources/tray-windows.ico`
- `apps/desktop/renderer/assets/welcome-brand.svg`

The source artwork is the CNYU brand identity image supplied by the repository owner in ChatGPT. The raster desktop icon is a reduced-color validation asset generated from that artwork; production distribution should use the original vector/master artwork.

This test deliberately does not rename `DeepSeek Harness`, the application ID, the `dsh://` protocol, signing/notarization identities, update feeds, or model/provider product copy.
