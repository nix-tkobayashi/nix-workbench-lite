const term = new Terminal({ cursorBlink: true, fontFamily: 'Consolas, monospace', fontSize: 13 });
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit();

let config = null;
let selectedPath = null;
let editorDirty = false;
const expanded = new Set();
let contextNode = null;

const layout = document.getElementById('layout');
const rightPane = document.getElementById('rightPane');
const editor = document.getElementById('editor');
const saveBtn = document.getElementById('saveBtn');
const editorTitle = document.getElementById('editorTitle');
const dirtyMark = document.getElementById('dirtyMark');

function terminalResize() {
  fitAddon.fit();
  window.api.terminalResize({ cols: term.cols, rows: term.rows });
}
window.addEventListener('resize', terminalResize);
term.onData((data) => window.api.terminalWrite(data));
window.api.onTerminalData((data) => term.write(data));

function setDirty(value) {
  editorDirty = value;
  saveBtn.disabled = !selectedPath || !editorDirty;
  dirtyMark.textContent = editorDirty ? '● unsaved' : '';
}

async function loadFile(node) {
  selectedPath = node.path;
  editorTitle.textContent = node.path;
  try {
    editor.value = await window.api.readFile({ distro: config.distro, wslPath: node.path });
    editor.disabled = false;
    setDirty(false);
  } catch (error) {
    editor.value = String(error.message || error);
    editor.disabled = true;
    setDirty(false);
  }
}

editor.addEventListener('input', () => {
  if (selectedPath) setDirty(true);
});

saveBtn.addEventListener('click', async () => {
  if (!selectedPath) return;
  try {
    await window.api.writeFile({ distro: config.distro, wslPath: selectedPath, content: editor.value });
    setDirty(false);
  } catch (error) {
    alert(error.message || String(error));
  }
});

window.addEventListener('keydown', async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveBtn.click();
  }
});


function parentDirFor(node) {
  return node.type === 'directory' ? node.path : node.path.split('/').slice(0, -1).join('/') || '/';
}

function basenameFor(wslPath) {
  return wslPath.split('/').filter(Boolean).pop() || wslPath;
}

function clearEditorIfAffected(targetPath) {
  if (selectedPath === targetPath || selectedPath?.startsWith(targetPath + '/')) {
    selectedPath = null;
    editor.value = '';
    editorTitle.textContent = 'Editor';
    editor.disabled = false;
    setDirty(false);
  }
}

function showContextMenu(event, node) {
  event.preventDefault();
  event.stopPropagation();
  contextNode = node;
  document.querySelectorAll('.row.selected').forEach((el) => el.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  const menu = document.getElementById('contextMenu');
  menu.classList.remove('hidden');
  const x = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8);
  const y = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function hideContextMenu() {
  document.getElementById('contextMenu').classList.add('hidden');
}

async function handleContextAction(action) {
  if (!contextNode) return;
  const node = contextNode;
  try {
    if (action === 'new-file' || action === 'new-folder') {
      const parentDirPath = parentDirFor(node);
      const type = action === 'new-folder' ? 'directory' : 'file';
      const defaultName = type === 'directory' ? 'new-folder' : 'new-file.txt';
      const name = prompt(type === 'directory' ? 'New folder name:' : 'New file name:', defaultName);
      if (!name) return;
      await window.api.createFsItem({ distro: config.distro, parentDirPath, name, type });
      expanded.add(parentDirPath);
      await renderTree();
      return;
    }

    if (action === 'rename') {
      const currentName = basenameFor(node.path);
      const newName = prompt('New name:', currentName);
      if (!newName || newName === currentName) return;
      const result = await window.api.renameFsItem({ distro: config.distro, sourcePath: node.path, newName });
      if (selectedPath === node.path) {
        selectedPath = result.path;
        editorTitle.textContent = result.path;
      } else if (selectedPath?.startsWith(node.path + '/')) {
        selectedPath = result.path + selectedPath.slice(node.path.length);
        editorTitle.textContent = selectedPath;
      }
      await renderTree();
      return;
    }

    if (action === 'delete') {
      const label = node.type === 'directory' ? 'directory and all contents' : 'file';
      if (!confirm(`Delete this ${label}?\n\n${node.path}`)) return;
      await window.api.deleteFsItem({ distro: config.distro, targetPath: node.path });
      clearEditorIfAffected(node.path);
      await renderTree();
      return;
    }

    if (action === 'reveal') {
      await window.api.revealInExplorer({ distro: config.distro, targetPath: node.path });
      return;
    }

    if (action === 'open-new-window') {
      const workspacePath = node.type === 'directory' ? node.path : parentDirFor(node);
      await window.api.newWindow({ distro: config.distro, wslPath: workspacePath });
      return;
    }
  } catch (error) {
    alert(error.message || String(error));
  } finally {
    hideContextMenu();
  }
}

function rowFor(node) {
  const row = document.createElement('div');
  row.className = 'row';
  row.draggable = true;
  row.dataset.path = node.path;
  row.dataset.type = node.type;

  const twisty = document.createElement('span');
  twisty.className = 'twisty';
  twisty.textContent = node.type === 'directory' ? (expanded.has(node.path) ? '▾' : '▸') : '';

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = node.type === 'directory' ? '📁' : '📄';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = node.name;
  name.title = node.path;

  row.append(twisty, icon, name);

  row.addEventListener('click', async (event) => {
    event.stopPropagation();
    document.querySelectorAll('.row.selected').forEach((el) => el.classList.remove('selected'));
    row.classList.add('selected');
    if (node.type === 'directory') {
      toggle(node.path);
    } else {
      if (editorDirty && !confirm('Unsaved changes will be discarded. Continue?')) return;
      await loadFile(node);
    }
  });

  row.addEventListener('contextmenu', (event) => showContextMenu(event, node));

  twisty.addEventListener('click', (event) => {
    event.stopPropagation();
    if (node.type === 'directory') toggle(node.path);
  });

  row.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', node.path);
    event.dataTransfer.effectAllowed = 'move';
  });

  row.addEventListener('dragover', (event) => {
    if (node.type !== 'directory') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.files?.length ? 'copy' : 'move';
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', async (event) => {
    event.preventDefault();
    row.classList.remove('drag-over');
    if (node.type !== 'directory') return;

    const externalFiles = Array.from(event.dataTransfer.files || []);
    if (externalFiles.length > 0) {
      const sourcePaths = externalFiles
        .map((file) => window.api.getPathForFile(file))
        .filter(Boolean);
      if (sourcePaths.length === 0) return;
      try {
        await window.api.copyExternal({ distro: config.distro, sourcePaths, targetDirPath: node.path });
        expanded.add(node.path);
        await renderTree();
      } catch (error) {
        alert(error.message || String(error));
      }
      return;
    }

    const sourcePath = event.dataTransfer.getData('text/plain');
    if (!sourcePath || sourcePath === node.path) return;
    try {
      await window.api.move({ distro: config.distro, sourcePath, targetDirPath: node.path });
      expanded.add(node.path);
      if (selectedPath === sourcePath || selectedPath?.startsWith(sourcePath + '/')) {
        selectedPath = null;
        editor.value = '';
        editorTitle.textContent = 'Editor';
        setDirty(false);
      }
      await renderTree();
    } catch (error) {
      alert(error.message || String(error));
    }
  });

  return row;
}

async function buildNode(node, depth = 0) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node';
  wrapper.appendChild(rowFor(node));

  if (node.type === 'directory') {
    const children = document.createElement('div');
    children.className = `children ${expanded.has(node.path) ? 'open' : ''}`;
    if (expanded.has(node.path)) {
      try {
        const tree = await window.api.readTree({ distro: config.distro, wslPath: node.path });
        for (const child of tree.children) children.appendChild(await buildNode(child, depth + 1));
      } catch (error) {
        const err = document.createElement('div');
        err.className = 'row';
        err.textContent = error.message || String(error);
        children.appendChild(err);
      }
    }
    wrapper.appendChild(children);
  }
  return wrapper;
}

async function renderTree() {
  const root = await window.api.readTree(config);
  const tree = document.getElementById('tree');
  tree.innerHTML = '';
  expanded.add(root.path);
  tree.appendChild(await buildNode(root));
  document.getElementById('cwd').textContent = `${config.distro}:${config.wslPath}`;
}

async function toggle(wslPath) {
  if (expanded.has(wslPath)) expanded.delete(wslPath); else expanded.add(wslPath);
  await renderTree();
}

async function applyWorkspace(nextConfig) {
  if (editorDirty && !confirm('Unsaved changes will be discarded. Continue?')) return;
  config = nextConfig;
  selectedPath = null;
  editor.value = '';
  editorTitle.textContent = 'Editor';
  setDirty(false);
  expanded.clear();
  expanded.add(config.wslPath);
  await renderTree();
  window.api.terminalStart({ ...config, command: '' });
  setTimeout(terminalResize, 300);
}

function initResizers() {
  const vertical = document.getElementById('verticalResizer');
  const horizontal = document.getElementById('horizontalResizer');

  vertical.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const onMove = (moveEvent) => {
      const width = Math.max(180, Math.min(700, moveEvent.clientX));
      layout.style.gridTemplateColumns = `${width}px 5px 1fr`;
      terminalResize();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  horizontal.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const onMove = (moveEvent) => {
      const rect = rightPane.getBoundingClientRect();
      const topHeight = Math.max(120, Math.min(rect.height - 140, moveEvent.clientY - rect.top));
      rightPane.style.gridTemplateRows = `${topHeight}px 5px 1fr`;
      terminalResize();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}


document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideContextMenu(); });
document.getElementById('contextMenu').addEventListener('click', async (event) => {
  event.stopPropagation();
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  await handleContextAction(button.dataset.action);
});

document.getElementById('refreshBtn').addEventListener('click', renderTree);
window.api.onWorkspaceChanged(async (nextConfig) => {
  await applyWorkspace(nextConfig);
});

document.getElementById('claudeBtn').addEventListener('click', () => {
  window.api.terminalStart({ ...config, command: 'claude' });
  setTimeout(terminalResize, 300);
});

(async function init() {
  config = await window.api.getConfig();
  expanded.add(config.wslPath);
  initResizers();
  await renderTree();
  window.api.terminalStart({ ...config, command: '' });
  setTimeout(terminalResize, 300);
})();
