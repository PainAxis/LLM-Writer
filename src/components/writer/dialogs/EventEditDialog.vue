<template>
  <el-dialog v-model="visible" title="编辑事件" width="600px">
    <el-form :model="form" label-width="80px">
      <el-form-item label="事件标题">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="相关章节">
        <el-select v-model="form.chapter" placeholder="选择章节（决定事件在时间线中的位置）">
          <el-option
            v-for="(chapter, index) in chapters"
            :key="chapter.id"
            :label="`第${index + 1}章 ${chapter.title}`"
            :value="String(index + 1)"
          />
          <el-option label="未指定章节" value="" />
        </el-select>
      </el-form-item>
      <el-form-item label="关联角色">
        <el-select
          v-model="form.characterIds"
          multiple
          collapse-tags
          clearable
          placeholder="选择参与该事件的角色"
          style="width: 100%"
        >
          <el-option
            v-for="character in characters"
            :key="character.id"
            :label="character.name"
            :value="character.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="时间线">
        <el-input v-model="form.time" placeholder="如：第三天傍晚" />
      </el-form-item>
      <el-form-item label="重要程度">
        <el-radio-group v-model="form.importance">
          <el-radio label="low">次要</el-radio>
          <el-radio label="normal">一般</el-radio>
          <el-radio label="high">重要</el-radio>
          <el-radio label="critical">关键</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="事件描述">
        <el-input v-model="form.description" type="textarea" :rows="4" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="emit('save')">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { WriterChapter, WriterCharacter, WriterEventForm } from '@/types/writer'

defineProps<{
  chapters: readonly WriterChapter[]
  characters: readonly WriterCharacter[]
}>()

const visible = defineModel<boolean>({ required: true })
const form = defineModel<WriterEventForm>('form', { required: true })

const emit = defineEmits<{
  save: []
}>()
</script>
