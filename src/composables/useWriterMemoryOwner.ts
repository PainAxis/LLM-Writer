import { watch, type Ref } from 'vue'

interface WriterMemoryOwnerOptions {
  chapterVisible: Readonly<Ref<boolean>>
  continueVisible: Readonly<Ref<boolean>>
  optimizeVisible: Readonly<Ref<boolean>>
  /** True only inside the chapter controller's synchronous launch close. */
  isChapterLaunchClose(): boolean
  hasApprovedMemory(): boolean
  invalidateSupport(): void
  revoke(): void
}

/** A shared Writer memory capability belongs to one uninterrupted dialog owner. */
export function useWriterMemoryOwner(options: WriterMemoryOwnerOptions) {
  return watch(
    [options.chapterVisible, options.continueVisible, options.optimizeVisible],
    (opened, previous) => {
      // Launch intentionally closes the chapter dialog before acquiring its
      // approved memory lease. No manual close, selection wait, or later open
      // may reuse this exception, even while generation/commit remains busy.
      if (previous[0] && !previous[1] && !previous[2]
        && !opened.some(Boolean) && options.isChapterLaunchClose()
        && options.hasApprovedMemory()) {
        // Only the author-approved writing lease transfers. A support plan or
        // displayed model assessment never acquires a hidden dialog owner.
        options.invalidateSupport()
        return
      }
      options.revoke()
    },
    // Revoke before an already-resolved request can resume its await handler.
    { flush: 'sync' },
  )
}
