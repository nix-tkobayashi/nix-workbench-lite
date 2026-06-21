# Nix Workbench Lite

Lightweight Windows Electron app:

- Left: WSL file explorer tree
- Upper right: simple text editor with save
- Lower right: WSL terminal for Claude Code
- Directory toggle open/close
- Drag and drop files/directories inside the tree to move them
- Drag and drop files/directories from Windows Explorer into the tree to copy them
- Resizable left/right panes and editor/terminal panes

## Run

```powershell
npm install
npm start
```

## Build EXE on Windows

```powershell
npm install
npm run dist
```

Output examples:

```text
dist/Nix Workbench Lite Setup 0.3.9.exe
dist/Nix Workbench Lite 0.3.9.exe
```

## Defaults

```text
Distro: Ubuntu
Path: /home/<user>/projects
```

Override:

```powershell
$env:NWL_DISTRO="Ubuntu"
$env:NWL_WSL_PATH="/home/<user>/projects/my-repo"
npm start
```

The old `CWL_DISTRO` and `CWL_WSL_PATH` environment variables are still accepted for compatibility.

## Notes

Internal tree drag and drop performs move/rename via Windows UNC path:

```text
\\wsl.localhost\Ubuntu\...
```

The editor is intentionally minimal. Test file editing and drag/drop operations in a throwaway directory before using it on important repositories.

## v0.3.0

- Renamed app to Nix Workbench Lite.
- Added editable file viewer and Save button.
- Added Ctrl+S support.
- Added resizable panes.
- Kept Electron `^42.4.1` and electron-builder `^26.15.3`.
- Renderer remains hardened with `contextIsolation: true` and `nodeIntegration: false`.

## v0.3.1

- Added Windows Explorer drag-and-drop support.
- Dropping Explorer files/directories onto a tree directory copies them into WSL.
- Internal tree drag-and-drop still moves files/directories.
- Existing destination names are not overwritten.


## v0.3.7

- Explorer drag-and-drop now skips locked Windows profile/system files such as `NTUSER.DAT`.
- Copy errors for individual files are skipped instead of aborting the whole drop operation.
- Existing destination names are still not overwritten.


## v0.3.7

- Added right-click context menu in the file tree.
- New File / New Folder.
- Rename.
- Delete file or directory recursively after confirmation.

- Right-click menu includes Reveal in Explorer.


## v0.3.7

- Fixed blank screen after adding the context menu by loading renderer after the menu DOM exists.


## v0.3.7

- Added Workspace menu.
- Open Workspace selects a folder and changes the current WSL working directory.
- Save Workspace writes the current distro and WSL path to a JSON file.



## v0.3.7

- Added multi-window support.
- Workspace > New Window opens another independent window.
- Tree context menu > Open in New Window opens the selected directory as a new workspace.
- Each window has its own WSL terminal session and workspace root.


## v0.3.11

- Fixed Open Workspace and New Window path handling for native Windows paths such as `C:\Users\...`.
- Windows paths are now converted to WSL paths such as `/mnt/c/Users/...` before loading the tree and starting the terminal.


## v0.3.11

- Fixed workspace paths selected from Windows Open Directory dialog.
- `/mnt/c/...` workspaces now use the native `C:\...` path for the file tree/editor while the terminal still starts in `/mnt/c/...` inside WSL.


## v0.3.11

- Changed the default starting location for Open Workspace to the WSL user home such as \\wsl.localhost\Ubuntu\home\<user>.
- Added NWL_WSL_HOME_PATH so the initial Open Workspace location can be overridden.

## Workspace files

- `Workspace > Save Workspace...` saves the current workspace as `*.nwl-workspace`.
- `Workspace > Open Workspace File...` loads a saved workspace and switches the current window to that directory.
- When the NSIS installer build is installed, `*.nwl-workspace` is registered as a Nix Workbench Lite workspace file. Double-clicking it starts the app with that workspace.
- Portable builds may not register the file association automatically; use `Open Workspace File...` in that case.


