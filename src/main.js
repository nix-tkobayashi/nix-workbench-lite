const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');

const DEFAULT_DISTRO = process.env.NWL_DISTRO || process.env.CWL_DISTRO || 'Ubuntu';
const DEFAULT_WSL_PATH = process.env.NWL_WSL_PATH || process.env.CWL_WSL_PATH || `/home/${os.userInfo().username}/projects`;
const DEFAULT_WSL_HOME_PATH = process.env.NWL_WSL_HOME_PATH || process.env.CWL_WSL_HOME_PATH || `/home/${os.userInfo().username}`;

const windowState = new Map();

function defaultWorkspace() {
  return { distro: DEFAULT_DISTRO, wslPath: DEFAULT_WSL_PATH };
}

const WORKSPACE_EXTENSIONS = new Set(['.nwl-workspace', '.json']);

function isWorkspaceFile(filePath) {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (!WORKSPACE_EXTENSIONS.has(ext)) return false;
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function readWorkspaceFile(filePath, fallback = defaultWorkspace()) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  return normalizeWorkspace(data, fallback);
}

function findWorkspaceArg(argv = process.argv) {
  return argv.find((arg) => isWorkspaceFile(arg));
}

function normalizeWorkspace(next = {}, fallback = defaultWorkspace()) {
  return {
    distro: next.distro || fallback.distro || DEFAULT_DISTRO,
    wslPath: next.wslPath || fallback.wslPath || DEFAULT_WSL_PATH
  };
}

function getStateForWebContents(webContents) {
  const win = BrowserWindow.fromWebContents(webContents);
  if (!win) throw new Error('Window not found.');
  const state = windowState.get(win.id);
  if (!state) throw new Error('Window state not found.');
  return { win, state };
}

function getFocusedWindowAndState() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return { win: null, state: null };
  return { win, state: windowState.get(win.id) };
}

function getCurrentWorkspaceForWindow(win) {
  const state = windowState.get(win.id);
  return normalizeWorkspace(state?.workspace);
}

function getDefaultOpenWorkspacePath(distro = DEFAULT_DISTRO) {
  // Prefer the WSL user home in the Windows directory picker.
  // Example: \\wsl.localhost\Ubuntu\home\skype
  return wslPathToWindowsFsPath(distro, DEFAULT_WSL_HOME_PATH);
}

function setCurrentWorkspaceForWindow(win, next) {
  const state = windowState.get(win.id);
  if (!state) return;
  state.workspace = normalizeWorkspace(next, state.workspace);
  if (!win.isDestroyed()) {
    win.webContents.send('workspace:changed', { ...state.workspace });
  }
}

function wslToUnc(distro, wslPath) {
  const clean = wslPath.replace(/^\/+/, '').replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distro}\\${clean}`;
}

function wslPathToWindowsFsPath(distro, wslPath) {
  // Native WSL path -> \\wsl.localhost\Distro\...
  // Windows-mounted path (/mnt/c/...) -> C:\...
  // Some Windows versions cannot reliably traverse /mnt/c via the WSL UNC provider.
  const match = String(wslPath || '').match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = (match[2] || '').replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }
  return wslToUnc(distro, wslPath);
}

function windowsDrivePathToWsl(windowsPath) {
  // Convert C:\Users\name\project -> /mnt/c/Users/name/project
  const match = windowsPath.match(/^([a-zA-Z]):\\?(.*)$/);
  if (!match) return null;
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/').replace(/^\/+/, '');
  return `/mnt/${drive}${rest ? `/${rest}` : ''}`;
}

function uncToWsl(distro, inputPath) {
  if (!inputPath) return inputPath;

  // Already a WSL/Linux path.
  if (inputPath.startsWith('/')) return inputPath;

  // WSL UNC path: \\wsl.localhost\Ubuntu\home\... or \\wsl$\Ubuntu\home\...
  const normalized = inputPath.replace(/\\/g, '/');
  const candidates = [
    `//wsl.localhost/${distro}`.toLowerCase(),
    `//wsl$/${distro}`.toLowerCase()
  ];
  const lower = normalized.toLowerCase();
  for (const prefix of candidates) {
    if (lower.startsWith(prefix)) {
      const rest = normalized.slice(prefix.length);
      return rest.startsWith('/') ? rest : `/${rest}`;
    }
  }

  // Native Windows path selected from the Open Directory dialog.
  // Use WSL's automatic /mnt/<drive> mount so both tree and terminal use the same directory.
  const drivePath = windowsDrivePathToWsl(inputPath);
  if (drivePath) return drivePath;

  return inputPath;
}


function safeStat(fullPath) {
  try { return fs.statSync(fullPath); } catch { return null; }
}

const SKIP_EXTERNAL_NAMES = new Set([
  'NTUSER.DAT',
  'ntuser.dat',
  'ntuser.ini',
  'UsrClass.dat',
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys'
]);

function shouldSkipExternalPath(source) {
  const base = path.basename(source);
  if (SKIP_EXTERNAL_NAMES.has(base)) return true;
  if (/^ntuser\.dat/i.test(base)) return true;
  if (/^UsrClass\.dat/i.test(base)) return true;
  return false;
}

function copyRecursiveSafeSync(source, destination, result) {
  if (shouldSkipExternalPath(source)) {
    result.skipped.push({ source, reason: 'system profile file' });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(source);
  } catch (error) {
    result.skipped.push({ source, reason: error.code || error.message });
    return;
  }

  if (safeStat(destination)) {
    result.skipped.push({ source, reason: 'destination exists' });
    return;
  }

  if (stat.isDirectory()) {
    try {
      fs.mkdirSync(destination, { recursive: false });
    } catch (error) {
      result.skipped.push({ source, reason: error.code || error.message });
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(source, { withFileTypes: true });
    } catch (error) {
      result.skipped.push({ source, reason: error.code || error.message });
      return;
    }

    for (const entry of entries) {
      const childSource = path.join(source, entry.name);
      const childDestination = path.join(destination, entry.name);
      copyRecursiveSafeSync(childSource, childDestination, result);
    }
    result.copied.push(destination);
    return;
  }

  if (stat.isFile()) {
    try {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      result.copied.push(destination);
    } catch (error) {
      result.skipped.push({ source, reason: error.code || error.message });
    }
    return;
  }

  result.skipped.push({ source, reason: 'not a regular file or directory' });
}

function readDirTree({ distro = DEFAULT_DISTRO, wslPath = DEFAULT_WSL_PATH }) {
  const fullPath = wslPathToWindowsFsPath(distro, wslPath);
  const stat = safeStat(fullPath);
  if (!stat) throw new Error(`Path not found: ${fullPath}`);
  const entries = fs.readdirSync(fullPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.git'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((entry) => {
      const childWslPath = path.posix.join(wslPath, entry.name);
      return {
        name: entry.name,
        path: childWslPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        hasChildren: entry.isDirectory()
      };
    });
  return { name: path.posix.basename(wslPath) || '/', path: wslPath, type: 'directory', children: entries };
}

function createWindow(initialWorkspace = defaultWorkspace()) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  windowState.set(win.id, {
    workspace: normalizeWorkspace(initialWorkspace),
    shellPty: null
  });

  win.on('closed', () => {
    const state = windowState.get(win.id);
    if (state?.shellPty) {
      try { state.shellPty.kill(); } catch {}
    }
    windowState.delete(win.id);
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  buildAppMenu();
  return win;
}

function buildAppMenu() {
  const template = [
    {
      label: 'Workspace',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const { state } = getFocusedWindowAndState();
            createWindow(state?.workspace || defaultWorkspace());
          }
        },
        {
          label: 'Open Workspace...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { win, state } = getFocusedWindowAndState();
            if (!win || !state) return;
            const result = await dialog.showOpenDialog(win, {
              title: 'Open Workspace',
              defaultPath: getDefaultOpenWorkspacePath(state.workspace.distro),
              properties: ['openDirectory']
            });
            if (result.canceled || !result.filePaths[0]) return;
            const selected = result.filePaths[0];
            setCurrentWorkspaceForWindow(win, {
              distro: state.workspace.distro,
              wslPath: uncToWsl(state.workspace.distro, selected)
            });
          }
        },
        {
          label: 'Open Workspace File...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const { win, state } = getFocusedWindowAndState();
            if (!win || !state) return;
            const result = await dialog.showOpenDialog(win, {
              title: 'Open Workspace File',
              properties: ['openFile'],
              filters: [
                { name: 'Nix Workbench Workspace', extensions: ['nwl-workspace', 'json'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            });
            if (result.canceled || !result.filePaths[0]) return;
            try {
              setCurrentWorkspaceForWindow(win, readWorkspaceFile(result.filePaths[0], state.workspace));
            } catch (error) {
              dialog.showErrorBox('Open Workspace File failed', error.message || String(error));
            }
          }
        },
        {
          label: 'Save Workspace...',
          accelerator: 'CmdOrCtrl+S',
          click: async () => {
            const { win, state } = getFocusedWindowAndState();
            if (!win || !state) return;
            const result = await dialog.showSaveDialog(win, {
              title: 'Save Workspace',
              defaultPath: 'nix-workbench-lite.nwl-workspace',
              filters: [
                { name: 'Nix Workbench Workspace', extensions: ['nwl-workspace', 'json'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            });
            if (result.canceled || !result.filePath) return;
            fs.writeFileSync(result.filePath, JSON.stringify({ ...state.workspace, app: 'Nix Workbench Lite', version: 1 }, null, 2), 'utf8');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  const workspaceFile = findWorkspaceArg(process.argv);
  if (workspaceFile) {
    try {
      createWindow(readWorkspaceFile(workspaceFile));
      return;
    } catch (error) {
      dialog.showErrorBox('Open Workspace File failed', error.message || String(error));
    }
  }
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('window:new', (_event, workspace) => {
  createWindow(normalizeWorkspace(workspace));
  return { ok: true };
});

ipcMain.handle('config:get', (event) => {
  const { win } = getStateForWebContents(event.sender);
  return getCurrentWorkspaceForWindow(win);
});

ipcMain.handle('tree:read', (_event, args) => readDirTree(args));

ipcMain.handle('file:read', (_event, { distro = DEFAULT_DISTRO, wslPath }) => {
  const fullPath = wslPathToWindowsFsPath(distro, wslPath);
  const stat = safeStat(fullPath);
  if (!stat || !stat.isFile()) return '';
  if (stat.size > 1024 * 1024) return '[File is larger than 1MB. Editor skipped.]';
  return fs.readFileSync(fullPath, 'utf8');
});

ipcMain.handle('file:write', (_event, { distro = DEFAULT_DISTRO, wslPath, content }) => {
  if (!wslPath) throw new Error('wslPath is required.');
  const fullPath = wslPathToWindowsFsPath(distro, wslPath);
  const stat = safeStat(fullPath);
  if (!stat || !stat.isFile()) throw new Error(`File not found: ${wslPath}`);
  fs.writeFileSync(fullPath, content ?? '', 'utf8');
  return { ok: true };
});

ipcMain.handle('fs:move', (_event, { distro = DEFAULT_DISTRO, sourcePath, targetDirPath }) => {
  if (!sourcePath || !targetDirPath) throw new Error('sourcePath and targetDirPath are required.');
  if (sourcePath === targetDirPath || targetDirPath.startsWith(sourcePath + '/')) {
    throw new Error('Cannot move a directory into itself.');
  }
  const src = wslPathToWindowsFsPath(distro, sourcePath);
  const dst = wslPathToWindowsFsPath(distro, path.posix.join(targetDirPath, path.posix.basename(sourcePath)));
  if (!safeStat(src)) throw new Error(`Source not found: ${sourcePath}`);
  if (safeStat(dst)) throw new Error(`Destination already exists: ${path.posix.basename(dst)}`);
  fs.renameSync(src, dst);
  return { ok: true };
});

ipcMain.handle('fs:create', (_event, { distro = DEFAULT_DISTRO, parentDirPath, name, type = 'file' }) => {
  if (!parentDirPath || !name) throw new Error('parentDirPath and name are required.');
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Invalid name.');
  const target = wslPathToWindowsFsPath(distro, path.posix.join(parentDirPath, name));
  if (safeStat(target)) throw new Error(`Already exists: ${name}`);
  if (type === 'directory') {
    fs.mkdirSync(target);
  } else {
    fs.writeFileSync(target, '', { flag: 'wx' });
  }
  return { ok: true };
});

ipcMain.handle('fs:rename', (_event, { distro = DEFAULT_DISTRO, sourcePath, newName }) => {
  if (!sourcePath || !newName) throw new Error('sourcePath and newName are required.');
  if (newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') throw new Error('Invalid name.');
  const src = wslPathToWindowsFsPath(distro, sourcePath);
  const dstPath = path.posix.join(path.posix.dirname(sourcePath), newName);
  const dst = wslPathToWindowsFsPath(distro, dstPath);
  if (!safeStat(src)) throw new Error(`Source not found: ${sourcePath}`);
  if (safeStat(dst)) throw new Error(`Already exists: ${newName}`);
  fs.renameSync(src, dst);
  return { ok: true, path: dstPath };
});

ipcMain.handle('fs:delete', (_event, { distro = DEFAULT_DISTRO, targetPath }) => {
  if (!targetPath) throw new Error('targetPath is required.');
  const target = wslPathToWindowsFsPath(distro, targetPath);
  if (!safeStat(target)) throw new Error(`Target not found: ${targetPath}`);
  fs.rmSync(target, { recursive: true, force: false });
  return { ok: true };
});

ipcMain.handle('fs:reveal', async (_event, { distro = DEFAULT_DISTRO, targetPath }) => {
  if (!targetPath) throw new Error('targetPath is required.');
  const target = wslPathToWindowsFsPath(distro, targetPath);
  if (!safeStat(target)) throw new Error(`Target not found: ${targetPath}`);
  shell.showItemInFolder(target);
  return { ok: true };
});

ipcMain.handle('fs:copyExternal', (_event, { distro = DEFAULT_DISTRO, sourcePaths = [], targetDirPath }) => {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) throw new Error('sourcePaths are required.');
  if (!targetDirPath) throw new Error('targetDirPath is required.');
  const targetDir = wslPathToWindowsFsPath(distro, targetDirPath);
  const targetStat = safeStat(targetDir);
  if (!targetStat || !targetStat.isDirectory()) throw new Error(`Target directory not found: ${targetDirPath}`);

  const result = { copied: [], skipped: [] };
  for (const sourcePath of sourcePaths) {
    const sourceStat = safeStat(sourcePath);
    if (!sourceStat) {
      result.skipped.push({ source: sourcePath, reason: 'source not found' });
      continue;
    }
    const destination = path.join(targetDir, path.basename(sourcePath));
    copyRecursiveSafeSync(sourcePath, destination, result);
  }

  if (result.copied.length === 0 && result.skipped.length > 0) {
    const first = result.skipped[0];
    throw new Error(`No files were copied. First skipped item: ${first.source} (${first.reason})`);
  }

  return { ok: true, copied: result.copied, skipped: result.skipped };
});

ipcMain.handle('folder:pick', async (event) => {
  const { win, state } = getStateForWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Workspace',
    defaultPath: getDefaultOpenWorkspacePath(state.workspace.distro),
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = result.filePaths[0];
  return { windowsPath: selected, wslPath: uncToWsl(state.workspace.distro, selected) };
});

ipcMain.on('terminal:start', (event, { distro, wslPath, command = '' }) => {
  const { win, state } = getStateForWebContents(event.sender);
  const workspace = normalizeWorkspace({ distro, wslPath }, state.workspace);
  state.workspace = workspace;
  if (state.shellPty) {
    try { state.shellPty.kill(); } catch {}
  }
  const args = ['-d', workspace.distro, '--cd', workspace.wslPath, '--exec', 'bash', '-lc', command ? `${command}; exec bash` : 'exec bash'];
  state.shellPty = pty.spawn('wsl.exe', args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: os.homedir(),
    env: process.env
  });
  state.shellPty.onData((data) => {
    if (!win.isDestroyed()) win.webContents.send('terminal:data', data);
  });
  state.shellPty.onExit(() => {
    if (!win.isDestroyed()) win.webContents.send('terminal:data', '\r\n[terminal exited]\r\n');
  });
});

ipcMain.on('terminal:write', (event, data) => {
  const { state } = getStateForWebContents(event.sender);
  if (state.shellPty) state.shellPty.write(data);
});

ipcMain.on('terminal:resize', (event, { cols, rows }) => {
  const { state } = getStateForWebContents(event.sender);
  if (state.shellPty) state.shellPty.resize(cols, rows);
});
