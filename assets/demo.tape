# OCX Demo GIF
# Generate with isolated env (does not touch real config):
#   TMP=$(mktemp -d) && XDG_CONFIG_HOME="$TMP/config" HOME="$TMP/home" vhs assets/demo.tape && rm -rf "$TMP"
# Requires: brew install vhs

Output assets/demo.gif

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

# npm plugin (no registry needed)
Type "ocx add npm:oh-my-opencode"
Sleep 500ms
Enter
Sleep 3s

Enter

# Add component directly from registry URL
Type "ocx add kdco/workspace --from https://registry.kdco.dev"
Sleep 500ms
Enter
Sleep 3s

# Done
Sleep 1s
