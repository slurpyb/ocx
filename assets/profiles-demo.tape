# OCX Profiles Demo GIF
# Generate with: vhs assets/profiles-demo.tape
# Requires: brew install vhs

Output assets/profiles-demo.gif

Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Width 800
Set Height 500
Set Padding 20

# Initialize global profiles
Type "ocx init --global"
Sleep 500ms
Enter
Sleep 2s

Enter

# Create a profile
Type "ocx profile add work"
Sleep 500ms
Enter
Sleep 1.5s

Enter

# Add npm plugin to profile
Type "ocx add npm:oh-my-opencode -p work"
Sleep 500ms
Enter
Sleep 3s

Enter

# Launch OpenCode with profile
Type "ocx oc -p work"
Sleep 500ms
Enter
Sleep 2s

# Done
Sleep 1s
