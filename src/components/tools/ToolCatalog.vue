<template>
  <div class="tools-grid">
    <div
      v-for="tool in tools"
      :key="tool.type"
      class="tool-card"
      @click="emit('select', tool.type)"
    >
      <div class="tool-icon">{{ tool.icon }}</div>
      <h3>{{ tool.cardTitle }}</h3>
      <p>{{ tool.description }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TOOL_DEFINITIONS } from '@/config/tools'
import type { ToolType } from '@/types/tools'
const emit = defineEmits<{ select: [type: ToolType] }>()
const tools = (Object.keys(TOOL_DEFINITIONS) as ToolType[]).map((type) => ({
  type,
  ...TOOL_DEFINITIONS[type],
}))
</script>

<style scoped>
.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: 40px;
}

.tool-card {
  background: var(--el-bg-color);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid var(--el-border-color-light);
}

.tool-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  border-color: var(--brand-500);
}

.tool-icon {
  font-size: 48px;
  text-align: center;
  margin-bottom: 16px;
}

.tool-card h3 {
  font-size: 18px;
  color: #2c3e50;
  margin-bottom: 8px;
  text-align: center;
}

.tool-card p {
  font-size: 14px;
  color: #7f8c8d;
  text-align: center;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .tools-grid {
    grid-template-columns: 1fr;
  }
}
</style>
