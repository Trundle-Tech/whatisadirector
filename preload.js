const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const dependency of ['chrome', 'node', 'electron']) {
    replaceText(`${dependency}-version`, process.versions[dependency]);
  }
});

// Securely bridge Vertex AI and Vector Graph APIs to the Renderer
contextBridge.exposeInMainWorld('vertex', {
  generateEmbedding: (text) => ipcRenderer.invoke('vertex:embed', text),
  getSimilarity: (vecA, vecB) => ipcRenderer.invoke('vector:similarity', { vecA, vecB }),
  getVectorGraph: (documents) => ipcRenderer.invoke('graph:build', documents),
  chat: (messages, options = {}) => ipcRenderer.invoke('vertex:chat', { messages, ...options })
});


