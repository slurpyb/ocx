# OCX Components Demo GIF
# Generate with: vhs assets/components-demo.tape
# Requires: brew install vhs

Output assets/components-demo.gif

Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Width 800
Set Height 500
Set Padding 20

# Initialize local project
Type "ocx init"
Sleep 500ms
Enter
Sleep 2s

Enter

# Add registry
Type "ocx registry add https://registry.kdco.dev --name kdco"
Sleep 500ms
Enter
Sleep 2s

Enter

# Add component from registry
Type "ocx add kdco/workspace"
Sleep 500ms
Enter
Sleep 3s

# Done
Sleep 1s
