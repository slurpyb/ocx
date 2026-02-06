# OCX Profiles Demo GIF
# Generate with isolated env (does not touch real config):
#   TMP=$(mktemp -d) && XDG_CONFIG_HOME="$TMP/config" HOME="$TMP/home" vhs assets/profiles-demo.tape && rm -rf "$TMP"
# Requires: brew install vhs

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
