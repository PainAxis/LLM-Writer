<template>
  <div class="api-config-page">
    <div class="page-header">
      <div class="header-content">
        <h1>API 配置</h1>
        <p>管理AI模型接口配置和参数设置，支持官方API与自定义OpenAI兼容接口</p>
      </div>
    </div>

    <ApiConfig />
  </div>
</template>

<script setup>
import ApiConfig from '@/components/ApiConfig.vue'
</script>

<style scoped>
.api-config-page {
  padding: 0;
}

.page-header {
  margin-bottom: 20px;
}

.header-content h1 {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 600;
}

.header-content p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
</style>
