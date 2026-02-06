# OCX Components Demo GIF
# Generate via repository workflow script:
#   ./scripts/record-vhs-demos.sh
# Requires: brew install vhs
#
# Note: The workflow script sets OCX_DEMO_FILTER_NOISE=1 to suppress
# known wrangler asset-server 404 noise that appears during recording
# but doesn't affect functionality. This filtering is demo-only and
# doesn't modify product runtime behavior.

Output assets/components-demo.gif

Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Width 800
Set Height 500
Set Padding 20

# Initialize local config (required before adding components)
Type "ocx init"
Sleep 500ms
Enter
Sleep 2s

# Add component directly from registry URL
Type "ocx add kdco/workspace --from https://registry.kdco.dev"
Sleep 500ms
Enter
Sleep 3s

# Done
Sleep 1s
