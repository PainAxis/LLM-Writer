import { inject, provide, type InjectionKey } from 'vue'
import type { useBookAnalysisWorkspace } from './useBookAnalysisWorkspace'

type Workspace = ReturnType<typeof useBookAnalysisWorkspace>
const key: InjectionKey<Workspace> = Symbol('book-analysis-workspace')

/** The page owns the request/editor lifetimes; children share its typed refs. */
export function provideBookAnalysisWorkspace(workspace: Workspace) { provide(key, workspace) }
export function useBookAnalysisWorkspaceContext(): Workspace {
  const workspace = inject(key)
  if (!workspace) throw new Error('BookAnalysis component requires its workspace provider')
  return workspace
}
