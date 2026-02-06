# OCX Profiles Demo GIF
# Generate via repository workflow script:
#   ./scripts/record-vhs-demos.sh
# Requires: brew install vhs
#
# Note: The workflow script sets OCX_DEMO_FILTER_NOISE=1 to suppress
# known wrangler asset-server 404 noise that appears during recording
# but doesn't affect functionality. This filtering is demo-only and
# doesn't modify product runtime behavior.

Output assets/profiles-demo.gif

Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Width 800
Set Height 500
Set Padding 20

# Initialize global profile system
Type "ocx init --global"
Sleep 500ms
Enter
Sleep 2s

# Install profile directly from registry URL
Type "ocx profile add ws --source kit/ws --from https://ocx-kit.kdco.dev --global"
Sleep 500ms
Enter
Sleep 3s

Enter

# Launch OpenCode with profile
Type "ocx oc -p ws"
Sleep 500ms
Enter
Sleep 2s

# Done
Sleep 1s
