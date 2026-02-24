import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import { getWebContainer } from '~/lib/webcontainer';
import type { ITerminal } from '~/types/terminal';
import { unreachable } from '~/utils/unreachable';
import { EditorStore } from './editor';
import { FilesStore, type FileMap } from './files';
import { PreviewsStore } from './previews';
import { TerminalStore } from './terminal';
import * as JSZip from 'jszip';
import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest';
import { path } from '~/utils/path';
import { extractRelativePath } from '~/utils/diff';
import { description } from '~/lib/persistence';
import Cookies from 'js-cookie';
import { createSampler } from '~/utils/sampler';
import type { ActionAlert, DeployAlert, SupabaseAlert } from '~/types/actions';

const { saveAs } = FileSaver;

export interface ArtifactState {
  id: string;
  title: string;
  type?: string;
  closed: boolean;
  runner: ActionRunner;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

export type WorkbenchViewType = 'code' | 'diff' | 'preview';

export class WorkbenchStore {
  // ⬇️ 서브 스토어: CSR 시점에서만 WebContainer 초기화되도록 변경
  #previewsStore = new PreviewsStore();
  #filesStore = new FilesStore(getWebContainer());
  #editorStore = new EditorStore(this.#filesStore);
  #terminalStore = new TerminalStore(getWebContainer());

  #reloadedMessages = new Set<string>();

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('code');
  unsavedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.unsavedFiles ?? atom(new Set<string>());
  actionAlert: WritableAtom<ActionAlert | undefined> =
    import.meta.hot?.data.actionAlert ?? atom<ActionAlert | undefined>(undefined);
  supabaseAlert: WritableAtom<SupabaseAlert | undefined> =
    import.meta.hot?.data.supabaseAlert ?? atom<SupabaseAlert | undefined>(undefined);
  deployAlert: WritableAtom<DeployAlert | undefined> =
    import.meta.hot?.data.deployAlert ?? atom<DeployAlert | undefined>(undefined);
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];
  #globalExecutionQueue = Promise.resolve();

  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
      import.meta.hot.data.actionAlert = this.actionAlert;
      import.meta.hot.data.supabaseAlert = this.supabaseAlert;
      import.meta.hot.data.deployAlert = this.deployAlert;

      // Ensure binary files are properly preserved across hot reloads
      const filesMap = this.files.get();
      for (const [path, dirent] of Object.entries(filesMap)) {
        if (dirent?.type === 'file' && dirent.isBinary && dirent.content) {
          // Make sure binary content is preserved
          this.files.setKey(path, { ...dirent });
        }
      }
    }
  }

  addToExecutionQueue(callback: () => Promise<void>) {
    this.#globalExecutionQueue = this.#globalExecutionQueue.then(() => callback());
  }

  get previews() {
    return this.#previewsStore.previews;
  }

  get files() {
    return this.#filesStore.files;
  }

  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this.#editorStore.currentDocument;
  }

  get selectedFile(): ReadableAtom<string | undefined> {
    return this.#editorStore.selectedFile;
  }

  get firstArtifact(): ArtifactState | undefined {
    return this.#getArtifact(this.artifactIdList[0]);
  }

  get filesCount(): number {
    return this.#filesStore.filesCount;
  }

  get showTerminal() {
    return this.#terminalStore.showTerminal;
  }
  get boltTerminal() {
    return this.#terminalStore.boltTerminal;
  }
  get alert() {
    return this.actionAlert;
  }
  clearAlert() {
    this.actionAlert.set(undefined);
  }

  get SupabaseAlert() {
    return this.supabaseAlert;
  }
  clearSupabaseAlert() {
    this.supabaseAlert.set(undefined);
  }

  get DeployAlert() {
    return this.deployAlert;
  }
  clearDeployAlert() {
    this.deployAlert.set(undefined);
  }

  toggleTerminal(value?: boolean) {
    this.#terminalStore.toggleTerminal(value);
  }

  attachTerminal(terminal: ITerminal) {
    this.#terminalStore.attachTerminal(terminal);
  }
  attachBoltTerminal(terminal: ITerminal) {
    this.#terminalStore.attachBoltTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    this.#terminalStore.onTerminalResize(cols, rows);
  }

  setDocuments(files: FileMap) {
    this.#editorStore.setDocuments(files);

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          this.setSelectedFile(filePath);
          break;
        }
      }
    }
  }

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  setCurrentDocumentContent(newContent: string) {
    const filePath = this.currentDocument.get()?.filePath;
    if (!filePath) return;

    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    const currentDocument = this.currentDocument.get();
    if (currentDocument) {
      const previousUnsavedFiles = this.unsavedFiles.get();
      if (unsavedChanges && previousUnsavedFiles.has(currentDocument.filePath)) return;

      const newUnsavedFiles = new Set(previousUnsavedFiles);
      if (unsavedChanges) newUnsavedFiles.add(currentDocument.filePath);
      else newUnsavedFiles.delete(currentDocument.filePath);

      this.unsavedFiles.set(newUnsavedFiles);
    }
  }

  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();
    if (!editorDocument) return;
    const { filePath } = editorDocument;
    this.#editorStore.updateScrollPosition(filePath, position);
  }

  setSelectedFile(filePath: string | undefined) {
    this.#editorStore.setSelectedFile(filePath);
  }

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];
    if (document === undefined) return;

    await this.#filesStore.saveFile(filePath, document.value);

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);
    this.unsavedFiles.set(newUnsavedFiles);
  }

  async saveCurrentDocument() {
    const currentDocument = this.currentDocument.get();
    if (currentDocument === undefined) return;
    await this.saveFile(currentDocument.filePath);
  }

  resetCurrentDocument() {
    const currentDocument = this.currentDocument.get();
    if (currentDocument === undefined) return;

    const { filePath } = currentDocument;
    const file = this.#filesStore.getFile(filePath);
    if (!file) return;

    this.setCurrentDocumentContent(file.content);
  }

  async saveAllFiles() {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath);
    }
  }

  getFileModifcations() {
    return this.#filesStore.getFileModifications();
  }

  getModifiedFiles() {
    return this.#filesStore.getModifiedFiles();
  }

  resetAllFileModifications() {
    this.#filesStore.resetFileModifications();
  }

  lockFile(filePath: string) {
    return this.#filesStore.lockFile(filePath);
  }
  lockFolder(folderPath: string) {
    return this.#filesStore.lockFolder(folderPath);
  }
  unlockFile(filePath: string) {
    return this.#filesStore.unlockFile(filePath);
  }
  unlockFolder(folderPath: string) {
    return this.#filesStore.unlockFolder(folderPath);
  }
  isFileLocked(filePath: string) {
    return this.#filesStore.isFileLocked(filePath);
  }
  isFolderLocked(folderPath: string) {
    return this.#filesStore.isFolderLocked(folderPath);
  }

  async createFile(filePath: string, content: string | Uint8Array = '') {
    try {
      const success = await this.#filesStore.createFile(filePath, content);
      if (success) {
        this.setSelectedFile(filePath);
        if (typeof content === 'string' && content === '') {
          const newUnsavedFiles = new Set(this.unsavedFiles.get());
          newUnsavedFiles.delete(filePath);
          this.unsavedFiles.set(newUnsavedFiles);
        }
      }
      return success;
    } catch (error) {
      console.error('Failed to create file:', error);
      throw error;
    }
  }

  async createFolder(folderPath: string) {
    try {
      return await this.#filesStore.createFolder(folderPath);
    } catch (error) {
      console.error('Failed to create folder:', error);
      throw error;
    }
  }

  async deleteFile(filePath: string) {
    try {
      const currentDocument = this.currentDocument.get();
      const isCurrentFile = currentDocument?.filePath === filePath;

      const success = await this.#filesStore.deleteFile(filePath);
      if (success) {
        const newUnsavedFiles = new Set(this.unsavedFiles.get());
        if (newUnsavedFiles.has(filePath)) {
          newUnsavedFiles.delete(filePath);
          this.unsavedFiles.set(newUnsavedFiles);
        }

        if (isCurrentFile) {
          const files = this.files.get();
          let nextFile: string | undefined = undefined;
          for (const [path, dirent] of Object.entries(files)) {
            if (dirent?.type === 'file') {
              nextFile = path;
              break;
            }
          }
          this.setSelectedFile(nextFile);
        }
      }
      return success;
    } catch (error) {
      console.error('Failed to delete file:', error);
      throw error;
    }
  }

  async deleteFolder(folderPath: string) {
    try {
      const currentDocument = this.currentDocument.get();
      const isInCurrentFolder = currentDocument?.filePath?.startsWith(folderPath + '/');

      const success = await this.#filesStore.deleteFolder(folderPath);
      if (success) {
        const unsavedFiles = this.unsavedFiles.get();
        const newUnsavedFiles = new Set<string>();
        for (const file of unsavedFiles) {
          if (!file.startsWith(folderPath + '/')) newUnsavedFiles.add(file);
        }
        if (newUnsavedFiles.size !== unsavedFiles.size) {
          this.unsavedFiles.set(newUnsavedFiles);
        }

        if (isInCurrentFolder) {
          const files = this.files.get();
          let nextFile: string | undefined = undefined;
          for (const [path, dirent] of Object.entries(files)) {
            if (dirent?.type === 'file') {
              nextFile = path;
              break;
            }
          }
          this.setSelectedFile(nextFile);
        }
      }
      return success;
    } catch (error) {
      console.error('Failed to delete folder:', error);
      throw error;
    }
  }

  abortAllActions() {
    // TODO: what do we wanna do and how do we wanna recover from this?
  }

  setReloadedMessages(messages: string[]) {
    this.#reloadedMessages = new Set(messages);
  }

  addArtifact({ messageId, title, id, type }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(messageId);
    if (artifact) return;

    if (!this.artifactIdList.includes(messageId)) {
      this.artifactIdList.push(messageId);
    }

    this.artifacts.setKey(messageId, {
      id,
      title,
      closed: false,
      type,
      runner: new ActionRunner(
        getWebContainer(),                        // ✅ 지연 초기화 프로미스
        () => this.boltTerminal,
        (alert) => {
          if (this.#reloadedMessages.has(messageId)) return;
          this.actionAlert.set(alert);
        },
        (alert) => {
          if (this.#reloadedMessages.has(messageId)) return;
          this.supabaseAlert.set(alert);
        },
        (alert) => {
          if (this.#reloadedMessages.has(messageId)) return;
          this.deployAlert.set(alert);
        },
      ),
    });
  }

  updateArtifact({ messageId }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    const artifact = this.#getArtifact(messageId);
    if (!artifact) return;
    this.artifacts.setKey(messageId, { ...artifact, ...state });
  }

  addAction(data: ActionCallbackData) {
    this.addToExecutionQueue(() => this._addAction(data));
  }
  async _addAction(data: ActionCallbackData) {
    const { messageId } = data;
    const artifact = this.#getArtifact(messageId);
    if (!artifact) unreachable('Artifact not found');
    return artifact.runner.addAction(data);
  }

  runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    if (isStreaming) {
      this.actionStreamSampler(data, isStreaming);
    } else {
      this.addToExecutionQueue(() => this._runAction(data, isStreaming));
    }
  }

  async _runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { messageId } = data;
    const artifact = this.#getArtifact(messageId);
    if (!artifact) unreachable('Artifact not found');

    const action = artifact.runner.actions.get()[data.actionId];
    if (!action || action.executed) return;

    if (data.action.type === 'file') {
      const wc = await getWebContainer();                    // ✅ 사용 시점에서만 초기화
      const fullPath = path.join(wc.workdir, data.action.filePath);

      if (this.selectedFile.value !== fullPath) {
        this.setSelectedFile(fullPath);
      }
      if (this.currentView.value !== 'code') {
        this.currentView.set('code');
      }

      const doc = this.#editorStore.documents.get()[fullPath];
      if (!doc) {
        await artifact.runner.runAction(data, isStreaming);
      }

      this.#editorStore.updateFile(fullPath, data.action.content);

      if (!isStreaming && data.action.content) {
        await this.saveFile(fullPath);
      }
      if (!isStreaming) {
        await artifact.runner.runAction(data);
        this.resetAllFileModifications();
      }
    } else {
      await artifact.runner.runAction(data);
    }
  }

  actionStreamSampler = createSampler(async (data: ActionCallbackData, isStreaming: boolean = false) => {
    return await this._runAction(data, isStreaming);
  }, 100);

  #getArtifact(id: string) {
    const artifacts = this.artifacts.get();
    return artifacts[id];
  }

  async downloadZip() {
    const zip = new JSZip();
    const files = this.files.get();

    const projectName = (description.value ?? 'project').toLocaleLowerCase().split(' ').join('_');
    const timestampHash = Date.now().toString(36).slice(-6);
    const uniqueProjectName = `${projectName}_${timestampHash}`;

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);
        const pathSegments = relativePath.split('/');

        if (pathSegments.length > 1) {
          let currentFolder = zip;
          for (let i = 0; i < pathSegments.length - 1; i++) {
            currentFolder = currentFolder.folder(pathSegments[i])!;
          }
          currentFolder.file(pathSegments[pathSegments.length - 1], dirent.content);
        } else {
          zip.file(relativePath, dirent.content);
        }
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
if (typeof window !== 'undefined') {
  const mod = await import('file-saver');
  const saveAs = (mod as any).saveAs ?? (mod as any).default?.saveAs ?? (mod as any);
  saveAs(content, `${uniqueProjectName}.zip`);
  }

  syncFiles = async (targetHandle: FileSystemDirectoryHandle) => {
  const files = this.files.get();
  const syncedFiles: string[] = [];

  for (const [filePath, dirent] of Object.entries(files)) {
    if (dirent?.type === 'file' && !dirent.isBinary) {
      const relativePath = extractRelativePath(filePath);
      const pathSegments = relativePath.split('/');

      let currentHandle = targetHandle;
      for (let i = 0; i < pathSegments.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i], { create: true });
      }

      const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1], { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(dirent.content);
      await writable.close();

      syncedFiles.push(relativePath);
    }
  }

  return syncedFiles;
};

  async pushToGitHub(
    repoName: string,
    commitMessage?: string,
    githubUsername?: string,
    ghToken?: string,
    isPrivate: boolean = false,
  ) {
    try {
      const githubToken = ghToken || Cookies.get('githubToken');
      const owner = githubUsername || Cookies.get('githubUsername');
      if (!githubToken || !owner) {
        throw new Error('GitHub token or username is not set in cookies or provided.');
      }

      console.log(`pushToGitHub called with isPrivate=${isPrivate}`);
      const octokit = new Octokit({ auth: githubToken });

      let repo: RestEndpointMethodTypes['repos']['get']['response']['data'];
      let visibilityJustChanged = false;

      try {
        const resp = await octokit.repos.get({ owner, repo: repoName });
        repo = resp.data;

        if (repo.private !== isPrivate) {
          try {
            const { data: updatedRepo } = await octokit.repos.update({
              owner,
              repo: repoName,
              private: isPrivate,
            });
            repo = updatedRepo;
            visibilityJustChanged = true;
            await new Promise((resolve) => setTimeout(resolve, 3000));
          } catch (visibilityError) {
            console.error('Failed to update repository visibility:', visibilityError);
          }
        }
      } catch (error) {
        if (error instanceof Error && 'status' in error && (error as any).status === 404) {
          const { data: newRepo } = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: isPrivate,
            auto_init: true,
          });
          repo = newRepo;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          console.error('Cannot create repo:', error);
          throw error;
        }
      }

      const files = this.files.get();
      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files found to push');
      }

      const pushFilesToRepo = async (attempt = 1): Promise<string> => {
        const maxAttempts = 3;

        try {
          const blobs = await Promise.all(
            Object.entries(files).map(async ([filePath, dirent]) => {
              if (dirent?.type === 'file' && dirent.content) {
                const { data: blob } = await octokit.git.createBlob({
                  owner: repo.owner.login,
                  repo: repo.name,
                  content: Buffer.from(dirent.content).toString('base64'),
                  encoding: 'base64',
                });
                return { path: extractRelativePath(filePath), sha: blob.sha };
              }
              return null;
            }),
          );

          const validBlobs = blobs.filter(Boolean) as { path: string; sha: string }[];
          if (validBlobs.length === 0) throw new Error('No valid files to push');

          const repoRefresh = await octokit.repos.get({ owner, repo: repoName });
          repo = repoRefresh.data;

          const { data: ref } = await octokit.git.getRef({
            owner: repo.owner.login,
            repo: repo.name,
            ref: `heads/${repo.default_branch || 'main'}`,
          });
          const latestCommitSha = ref.object.sha;

          const { data: newTree } = await octokit.git.createTree({
            owner: repo.owner.login,
            repo: repo.name,
            base_tree: latestCommitSha,
            tree: validBlobs.map((blob) => ({
              path: blob.path,
              mode: '100644',
              type: 'blob',
              sha: blob.sha,
            })),
          });

          const { data: newCommit } = await octokit.git.createCommit({
            owner: repo.owner.login,
            repo: repo.name,
            message: commitMessage || 'Initial commit from your app',
            tree: newTree.sha,
            parents: [latestCommitSha],
          });

          await octokit.git.updateRef({
            owner: repo.owner.login,
            repo: repo.name,
            ref: `heads/${repo.default_branch || 'main'}`,
            sha: newCommit.sha,
          });

          return repo.html_url;
        } catch (error) {
          console.error(`Error during push attempt ${attempt}:`, error);
          if ((visibilityJustChanged || attempt === 1) && attempt < maxAttempts) {
            const delayMs = attempt * 2000;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return pushFilesToRepo(attempt + 1);
          }
          throw error;
        }
      };

      const repoUrl = await pushFilesToRepo();
      return repoUrl;
    } catch (error) {
      console.error('Error pushing to GitHub:', error);
      throw error;
    }
  }
}

// SSR-safe lazy singleton export
let _workbenchStore: WorkbenchStore | null = null;

export const workbenchStore: WorkbenchStore =
  typeof window === 'undefined'
    // SSR: 최소 shape만 가진 안전 placeholder (서버에서 메서드 호출 금지) 
 ? ({} as unknown as WorkbenchStore)
    : (_workbenchStore ??= new WorkbenchStore());
  