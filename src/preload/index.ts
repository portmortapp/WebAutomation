import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/types'

const electronAPI: ElectronAPI = {
  getScenarios: () => ipcRenderer.invoke('scenarios:list'),
  saveScenario: input => ipcRenderer.invoke('scenarios:save', input),
  deleteScenario: id => ipcRenderer.invoke('scenarios:delete', id),
  enqueueRun: (id, request) => ipcRenderer.invoke('scenarios:enqueue', id, request),
  getRun: id => ipcRenderer.invoke('runs:get', id),
  cancelRun: id => ipcRenderer.invoke('runs:cancel', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  apiStatus: () => ipcRenderer.invoke('api:status'),
  apiTest: () => ipcRenderer.invoke('api:test'),
  apiCall: request => ipcRenderer.invoke('api:call', request),
  recordCodegen: url => ipcRenderer.invoke('codegen:record', url),
  openInspector: (url, profileId) => ipcRenderer.invoke('inspector:open', url, profileId),
  openDeveloper: () => ipcRenderer.invoke('app:open-developer'),
  openDonate: () => ipcRenderer.invoke('app:open-donate'),
  dbGet: () => ipcRenderer.invoke('db:get'),
  dbTest: (config: unknown) => ipcRenderer.invoke('db:test', config),
  dbSave: (config: unknown) => ipcRenderer.invoke('db:save', config),
  closeInspector: () => ipcRenderer.invoke('inspector:close'),
  pickElement: request => ipcRenderer.invoke('inspector:pick', request),
  cancelPick: () => ipcRenderer.invoke('inspector:cancel-pick'),
  previewStep: (steps, input) => ipcRenderer.invoke('inspector:preview', steps, input),
  onPreviewProgress: callback => {
    const listener = (_event: unknown, result: Parameters<typeof callback>[0]) => callback(result)
    ipcRenderer.on('inspector:progress', listener)
    return () => { ipcRenderer.removeListener('inspector:progress', listener) }
  },
  listRuns: (scenarioId, limit) => ipcRenderer.invoke('runs:list', scenarioId, limit),
  getArtifact: (runId, name) => ipcRenderer.invoke('runs:artifact', runId, name),
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  deleteProfile: id => ipcRenderer.invoke('profiles:delete', id),
  captureProfile: (name, existingId) => ipcRenderer.invoke('profiles:capture', name, existingId),
  listSecrets: () => ipcRenderer.invoke('secrets:list'),
  saveSecret: (name, value) => ipcRenderer.invoke('secrets:save', name, value),
  deleteSecret: name => ipcRenderer.invoke('secrets:delete', name)
}
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
