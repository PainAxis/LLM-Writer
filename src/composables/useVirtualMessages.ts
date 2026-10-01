import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { messageIndexAt, messageOffsets, messageWindow } from '@/utils/virtualMessages'

/** Virtualizes presentation only. The store continues to own every message. */
export function useVirtualMessages<T extends { id: string; content: string }>(
  items: Readonly<Ref<readonly T[]>>,
  conversationId: Readonly<Ref<number | null>>,
  container: Ref<HTMLElement | null>,
) {
  const heights = new Map<string, number>()
  const elements = new Map<string, HTMLElement>()
  const heightRevision = ref(0)
  const top = ref(0)
  const viewport = ref(500)
  const following = ref(true)
  let scrollRevision = 0
  let disposed = false
  let width = 0
  const offsets = computed(() => {
    void heightRevision.value
    return messageOffsets(items.value.map(item => item.id), heights)
  })
  const window = computed(() => messageWindow(offsets.value, top.value, viewport.value))
  const visibleItems = computed(() => items.value.slice(window.value.start, window.value.end))

  function syncTop() {
    if (container.value) top.value = container.value.scrollTop
  }
  function onScroll() {
    const node = container.value
    if (!node) return
    syncTop()
    following.value = node.scrollHeight - node.clientHeight - node.scrollTop < 48
  }
  function onScrollIntent() {
    following.value = false
    scrollRevision++
  }
  function onScrollKey(event: KeyboardEvent) {
    if (event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    if (event.key === 'End') void scrollToBottom()
    else {
      onScrollIntent()
      top.value = 0
      if (container.value) container.value.scrollTop = 0
    }
  }
  async function scrollToBottom(force = true) {
    if (force) following.value = true
    if (!following.value) return
    const revision = scrollRevision
    top.value = Math.max(0, offsets.value.at(-1)! - viewport.value)
    await nextTick()
    if (disposed || !container.value || !following.value || revision !== scrollRevision) return
    container.value.scrollTop = container.value.scrollHeight
    syncTop()
  }
  function preservePosition(change: () => void) {
    const anchor = messageIndexAt(offsets.value, top.value)
    const inset = top.value - offsets.value[anchor]
    change()
    heightRevision.value++
    if (following.value) void scrollToBottom(false)
    else {
      top.value = Math.max(0, (offsets.value[anchor] ?? 0) + inset)
      void nextTick(() => {
        if (!disposed && container.value) container.value.scrollTop = top.value
      })
    }
  }
  const rowsObserver = new ResizeObserver(entries => {
    if (disposed) return
    const changed = entries.flatMap(entry => {
      const node = entry.target as HTMLElement
      const id = node.dataset.messageId ?? ''
      const height = node.getBoundingClientRect().height
      return elements.get(id) === node && height > 0 && heights.get(id) !== height ? [[id, height] as const] : []
    })
    if (changed.length) preservePosition(() => {
      for (const [id, height] of changed) heights.set(id, height)
    })
  })
  const viewportObserver = new ResizeObserver(() => {
    const node = container.value
    if (disposed || !node) return
    viewport.value = node.clientHeight
    const changedWidth = width !== node.clientWidth
    width = node.clientWidth
    if (changedWidth) {
      // Offscreen measurements from the old width are no longer valid.
      preservePosition(() => {
        heights.clear()
        for (const [id, row] of elements) heights.set(id, row.getBoundingClientRect().height)
      })
    } else if (following.value) void scrollToBottom(false)
  })
  function measure(id: string, node: unknown) {
    const previous = elements.get(id)
    if (previous) rowsObserver.unobserve(previous)
    if (node instanceof HTMLElement) {
      node.dataset.messageId = String(id)
      elements.set(id, node)
      rowsObserver.observe(node)
    } else elements.delete(id)
  }
  watch(container, (node, previous) => {
    if (previous) viewportObserver.unobserve(previous)
    if (node) {
      viewport.value = node.clientHeight || 500
      viewportObserver.observe(node)
      if (following.value) void scrollToBottom(false)
    }
  }, { flush: 'post' })
  watch(conversationId, () => {
    rowsObserver.disconnect()
    elements.clear()
    heights.clear()
    heightRevision.value++
    void scrollToBottom()
  }, { immediate: true, flush: 'post' })
  watch(() => [items.value.length, items.value.at(-1)?.content], () => {
    if (!items.value.length) {
      heights.clear()
      heightRevision.value++
      following.value = true
    }
    if (following.value) void scrollToBottom(false)
  }, { flush: 'post' })
  onBeforeUnmount(() => {
    disposed = true
    rowsObserver.disconnect()
    viewportObserver.disconnect()
    elements.clear()
  })
  return { visibleItems, window, following, measure, onScroll, onScrollIntent, onScrollKey, scrollToBottom }
}
