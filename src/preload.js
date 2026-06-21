const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  readTree: (args) => ipcRenderer.invoke('tree:read', args),
  readFile: (args) => ipcRenderer.invoke('file:read', args),
  writeFile: (args) => ipcRenderer.invoke('file:write', args),
  move: (args) => ipcRenderer.invoke('fs:move', args),
  createFsItem: (args) => ipcRenderer.invoke('fs:create', args),
  renameFsItem: (args) => ipcRenderer.invoke('fs:rename', args),
  deleteFsItem: (args) => ipcRenderer.invoke('fs:delete', args),
  revealInExplorer: (args) => ipcRenderer.invoke('fs:reveal', args),
  copyExternal: (args) => ipcRenderer.invoke('fs:copyExternal', args),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  newWindow: (workspace) => ipcRenderer.invoke('window:new', workspace),
  terminalStart: (args) => ipcRenderer.send('terminal:start', args),
  terminalWrite: (data) => ipcRenderer.send('terminal:write', data),
  terminalResize: (size) => ipcRenderer.send('terminal:resize', size),
  onTerminalData: (cb) => ipcRenderer.on('terminal:data', (_event, data) => cb(data)),
  onWorkspaceChanged: (cb) => ipcRenderer.on('workspace:changed', (_event, data) => cb(data))
});
