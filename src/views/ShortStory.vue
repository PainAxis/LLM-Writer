<template>
  <div class="short-story-page">
    <!-- 顶部标签栏 -->
    <div class="page-tabs">
      <el-tabs v-model="activeTab" @tab-click="handleTabClick">
        <el-tab-pane label="📝 短文写作" name="article"></el-tab-pane>
        <el-tab-pane label="📖 短篇小说" name="story"></el-tab-pane>
      </el-tabs>
    </div>

    <!-- 主要内容区域 -->
    <div class="page-content">
      <!-- 短文写作模块 -->
      <ShortArticleWorkspace />

      <!-- 文风管理弹窗 -->
      <WritingStyleDialog />

      <!-- 短篇小说模块 -->
      <ShortFictionWorkspace />
    </div>

    <!-- 对话框 -->
    <!-- 短文提示词选择对话框 -->
    <ShortStoryPromptSelector class="short-story-dialog"
      v-model="showArticlePromptSelector"
      title="选择短文提示词模板"
      empty-message="暂无短文提示词模板"
      :prompts="availablePrompts"
      @select="selectArticlePrompt"
      @create="createPrompt"
    />
    <ShortStoryPromptSelector class="short-story-dialog"
      v-model="showStoryPromptSelector"
      title="选择短篇小说提示词模板"
      empty-message="暂无短篇小说提示词模板"
      :prompts="availablePrompts"
      @select="selectStoryPrompt"
      @create="createPrompt"
    />

    <!-- 续写对话框 -->
    <StoryContinueDialog />

    <!-- 选段优化对话框 -->
    <StoryOptimizeDialog />

    <!-- 配置管理对话框 -->
    <StoryConfigDialog />
  </div>
</template>

<script setup lang="ts">
import { useShortStoryWorkspace } from '@/composables/useShortStoryWorkspace'
import { provideShortStoryWorkspace } from '@/composables/short-storyContext'
import ShortArticleWorkspace from '@/components/short-story/ShortArticleWorkspace.vue'
import WritingStyleDialog from '@/components/short-story/WritingStyleDialog.vue'
import ShortFictionWorkspace from '@/components/short-story/ShortFictionWorkspace.vue'
import StoryContinueDialog from '@/components/short-story/StoryContinueDialog.vue'
import StoryOptimizeDialog from '@/components/short-story/StoryOptimizeDialog.vue'
import StoryConfigDialog from '@/components/short-story/StoryConfigDialog.vue'
import ShortStoryPromptSelector from '@/components/short-story/ShortStoryPromptSelector.vue'
import '@wangeditor/editor/dist/css/style.css'
import '@/components/short-story/short-story.css'
const workspace = useShortStoryWorkspace()
provideShortStoryWorkspace(workspace)
const { activeTab, showArticlePromptSelector, availablePrompts, showStoryPromptSelector, handleTabClick, selectArticlePrompt, selectStoryPrompt, createPrompt } = workspace
</script>
