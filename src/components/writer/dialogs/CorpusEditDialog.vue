<template>
  <el-dialog v-model="visible" title="编辑语料" width="700px">
    <el-form :model="form" label-width="80px">
      <el-form-item label="标题">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="form.type">
          <el-option label="场景描述" value="description" />
          <el-option label="对话模板" value="dialogue" />
          <el-option label="情感表达" value="emotion" />
          <el-option label="动作描写" value="action" />
          <el-option label="心理描写" value="psychology" />
        </el-select>
      </el-form-item>
      <el-form-item label="分类">
        <el-select
          v-model="form.category"
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择或输入自定义分类"
          style="width: 100%"
        >
          <el-option v-for="category in categories" :key="category" :label="category" :value="category" />
        </el-select>
      </el-form-item>
      <el-form-item label="内容">
        <el-input v-model="form.content" type="textarea" :rows="8" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="emit('save')">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { WriterCorpusForm } from '@/types/writer'

defineProps<{
  categories: readonly string[]
}>()

const visible = defineModel<boolean>({ required: true })
const form = defineModel<WriterCorpusForm>('form', { required: true })

const emit = defineEmits<{
  save: []
}>()
</script>
