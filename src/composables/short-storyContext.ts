import { inject, provide, type InjectionKey } from 'vue'
import type { useShortStoryWorkspace } from './useShortStoryWorkspace'

type Workspace = ReturnType<typeof useShortStoryWorkspace>
const key: InjectionKey<Workspace> = Symbol('short-story-workspace')

/** The page owns the request/editor lifetimes; children share its typed refs. */
export function provideShortStoryWorkspace(workspace: Workspace) { provide(key, workspace) }
export function useShortStoryWorkspaceContext(): Workspace {
  const workspace = inject(key)
  if (!workspace) throw new Error('ShortStory component requires its workspace provider')
  return workspace
}
