import { computed, ref, watch } from 'vue'
import { StorageKeys, storageGet, storageSet } from '@/utils/storage'

export type ThemeMode = 'light' | 'dark' | 'system'

const themeMode = ref<ThemeMode>(storageGet<ThemeMode>(StorageKeys.theme, 'system'))

const systemPrefersDark =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

const resolvedTheme = computed<'light' | 'dark'>(() => {
  if (themeMode.value === 'system') {
    return systemPrefersDark?.matches ? 'dark' : 'light'
  }
  return themeMode.value
})

function applyTheme(): void {
  document.documentElement.classList.toggle('dark', resolvedTheme.value === 'dark')
}

function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
  storageSet(StorageKeys.theme, mode)
}

/** 循环切换：light → dark → system */
function cycleTheme(): ThemeMode {
  const order: ThemeMode[] = ['light', 'dark', 'system']
  const next = order[(order.indexOf(themeMode.value) + 1) % order.length]
  setThemeMode(next)
  return next
}

// 跟随系统：监听系统配色变化
systemPrefersDark?.addEventListener?.('change', () => {
  if (themeMode.value === 'system') applyTheme()
})

watch(resolvedTheme, applyTheme, { immediate: true })

/** 应用启动时尽早调用，避免首帧闪烁（FOUC） */
export function initTheme(): void {
  applyTheme()
}

export function useTheme() {
  return {
    themeMode,
    resolvedTheme,
    setThemeMode,
    cycleTheme,
  }
}
