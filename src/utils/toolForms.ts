import type { ToolDefinition, ToolForm } from '@/types/tools'

export function isToolFormComplete(tool: Partial<ToolDefinition>, form: ToolForm): boolean {
  if (!tool.fields) return false
  return tool.fields
    .filter((field) => field.required)
    .every((field) => {
      const value = form[field.key]
      if (!value) return false
      if (field.type === 'chapter-select') return Array.isArray(value) && value.length > 0
      return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value)
    })
}
