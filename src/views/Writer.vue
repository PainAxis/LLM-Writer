<template>
  <div class="writer-container">
    <!-- 顶部标题栏 -->
    <div class="title-bar">
      <div class="title-left">
        <el-button @click="goBack" size="small">
          <el-icon><ArrowLeft /></el-icon>
          返回列表
        </el-button>
        <span class="novel-title">{{ currentNovel?.title || '小说编辑' }}</span>
      </div>
    </div>

    <!-- 标签栏 -->
    <div class="tabs-bar">
      <el-tabs v-model="activeTab" class="main-tabs">
        <el-tab-pane label="📝 编辑" name="editor"></el-tab-pane>
        <el-tab-pane label="👥 人物" name="characters"></el-tab-pane>
        <el-tab-pane label="🌍 世界观" name="worldview"></el-tab-pane>
        <el-tab-pane label="📚 语料库" name="corpus"></el-tab-pane>
        <el-tab-pane label="📊 事件线" name="events"></el-tab-pane>
      </el-tabs>
    </div>

    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 左侧面板 -->
      <div class="left-panel">
        <!-- 章节列表面板 -->
        <div v-show="activeTab === 'editor'" class="panel-content">
          <el-card shadow="never" class="chapters-card">
            <template #header>
              <div class="card-header">
                <span>📝 章节列表</span>
                <el-dropdown @command="handleChapterCommand">
                  <el-button size="small" type="primary">
                    <el-icon><Plus /></el-icon>
                    新增章节 <el-icon><ArrowDown /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="manual">手动创建</el-dropdown-item>
                      <el-dropdown-item command="ai-single">AI生成单章</el-dropdown-item>
                      <el-dropdown-item command="ai-batch">AI批量生成</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
            
            <div class="chapters-list">
              <div 
                v-for="(chapter, index) in chapters" 
                :key="chapter.id"
                class="chapter-item"
                :class="{ active: currentChapter?.id === chapter.id }"
                @click="selectChapter(chapter)"
              >
                <div class="chapter-info">
                  <h4>第{{ index + 1 }}章</h4>
                  <p>{{ chapter.title }}</p>
                  <div class="chapter-meta">
                    <span>{{ chapter.wordCount || 0 }}字</span>
                    <el-tag v-if="chapter.status" :type="getChapterStatusType(chapter.status)" size="small">
                      {{ getChapterStatusText(chapter.status) }}
                    </el-tag>
                  </div>
                  <el-tooltip 
                    v-if="chapter.description" 
                    :content="chapter.description" 
                    placement="top-start"
                    :disabled="chapter.description.length <= 50"
                    effect="light"
                    :show-after="300"
                  >
                    <p class="chapter-desc chapter-desc-truncated">
                      {{ chapter.description.length > 50 ? chapter.description.substring(0, 50) + '...' : chapter.description }}
                    </p>
                  </el-tooltip>
                </div>
                <div class="chapter-actions">
                  <el-dropdown @command="(cmd) => handleChapterAction(cmd, chapter)">
                    <el-button size="small" type="text">
                      <el-icon><MoreFilled /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="edit">编辑信息</el-dropdown-item>
                        <el-dropdown-item command="generate">AI生成正文</el-dropdown-item>
                        <el-dropdown-item divided command="delete">删除</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
              
              <div v-if="chapters.length === 0" class="empty-chapters">
                <p>暂无章节</p>
                <el-button size="small" type="primary" @click="addNewChapter">
                  创建第一章
                </el-button>
              </div>
            </div>
          </el-card>
        </div>



        <!-- 人物管理面板 -->
        <div v-show="activeTab === 'characters'" class="panel-content">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span>👥 人物角色</span>
                <div class="character-actions">
                  <el-button size="small" type="primary" @click="addCharacter">
                    <el-icon><Plus /></el-icon>
                    新增
                  </el-button>
                  <el-button size="small" type="success" @click="showBatchGenerateDialog">
                    🤖 AI批量生成
                  </el-button>
                </div>
              </div>
            </template>
            
            <div class="characters-list">
              <div v-for="character in characters" :key="character.id" class="character-item">
                <div class="character-content" @click="editCharacter(character)">
                  <div class="character-avatar">
                    <img v-if="character.avatar" :src="character.avatar" />
                    <div v-else class="default-avatar">{{ character.name?.charAt(0) || '？' }}</div>
                  </div>
                  <div class="character-info">
                    <h4>{{ character.name }}</h4>
                    <div class="character-meta">
                      <el-tag :type="getRoleType(character.role)" size="small">{{ getRoleText(character.role) }}</el-tag>
                      <el-tag v-if="character.gender" type="info" size="small">{{ getGenderText(character.gender) }}</el-tag>
                      <span v-if="character.age" class="age-text">{{ character.age }}岁</span>
                    </div>
                    <el-tooltip 
                      v-if="character.personality" 
                      :content="character.personality" 
                      placement="right"
                      :disabled="character.personality.length <= 60"
                      effect="light"
                      :show-after="300"
                    >
                      <p class="character-desc character-desc-truncated">
                        {{ character.personality.length > 60 ? character.personality.substring(0, 60) + '...' : character.personality }}
                      </p>
                    </el-tooltip>
                    <div class="character-tags" v-if="character.tags && character.tags.length">
                      <el-tag v-for="tag in character.tags" :key="tag" size="small">{{ tag }}</el-tag>
                    </div>
                  </div>
                </div>
                <div class="character-actions">
                  <el-dropdown @command="(cmd) => handleCharacterAction(cmd, character)" trigger="click">
                    <el-button size="small" type="text" @click.stop>
                      <el-icon><MoreFilled /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="edit">
                          <el-icon><Edit /></el-icon>
                          编辑
                        </el-dropdown-item>
                        <el-dropdown-item command="delete" divided>
                          <el-icon><Delete /></el-icon>
                          删除
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
              
              <div v-if="characters.length === 0" class="empty-state">
                <p>暂无人物设定</p>
                <el-button size="small" @click="addCharacter">创建第一个角色</el-button>
              </div>
            </div>
          </el-card>
        </div>

        <!-- 世界观管理面板 -->
        <div v-show="activeTab === 'worldview'" class="panel-content">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span>🌍 世界观设定</span>
                <div class="world-actions">
                  <el-button size="small" type="primary" @click="addWorldSetting">
                    <el-icon><Plus /></el-icon>
                    新增
                  </el-button>
                  <el-button size="small" type="success" @click="openWorldGenerateDialog">
                    🤖 AI生成
                  </el-button>
                </div>
              </div>
            </template>
            
            <div class="worldview-list">
              <div v-for="setting in worldSettings" :key="setting.id" class="worldview-item">
                <div class="worldview-content" @click="editWorldSetting(setting)">
                  <div class="worldview-header">
                    <h4>{{ setting.title }}</h4>
                    <el-tag :type="getWorldSettingTagType(setting.category)">{{ getWorldSettingTagText(setting.category) }}</el-tag>
                  </div>
                  <el-tooltip 
                    v-if="setting.description" 
                    :content="setting.description" 
                    placement="right"
                    :disabled="setting.description.length <= 80"
                    effect="light"
                    :show-after="300"
                  >
                    <p class="worldview-description worldview-description-truncated">
                      {{ setting.description.length > 80 ? setting.description.substring(0, 80) + '...' : setting.description }}
                    </p>
                  </el-tooltip>
                  <p v-else class="worldview-description">暂无描述</p>
                  <div class="worldview-meta">
                    <span class="create-time">{{ formatDate(setting.createdAt) }}</span>
                    <span v-if="setting.generated" class="ai-generated">AI生成</span>
                  </div>
                </div>
                <div class="worldview-actions">
                  <el-dropdown @command="(cmd) => handleWorldSettingAction(cmd, setting)" trigger="click">
                    <el-button size="small" type="text" @click.stop>
                      <el-icon><MoreFilled /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="edit">
                          <el-icon><Edit /></el-icon>
                          编辑
                        </el-dropdown-item>
                        <el-dropdown-item command="duplicate">
                          <el-icon><CopyDocument /></el-icon>
                          复制
                        </el-dropdown-item>
                        <el-dropdown-item command="delete" divided>
                          <el-icon><Delete /></el-icon>
                          删除
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
              
              <div v-if="worldSettings.length === 0" class="empty-state">
                <p>暂无世界观设定</p>
                <el-button size="small" @click="addWorldSetting">创建第一个设定</el-button>
              </div>
            </div>
          </el-card>
        </div>

        <!-- 语料库面板 -->
        <div v-show="activeTab === 'corpus'" class="panel-content">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span>📚 语料库</span>
                <el-button size="small" type="primary" @click="addCorpus">
                  <el-icon><Plus /></el-icon>
                  新增
                </el-button>
              </div>
            </template>

            <div class="corpus-toolbar">
              <el-select
                v-model="corpusFilter"
                clearable
                placeholder="全部分类"
                size="small"
                style="width: 160px"
              >
                <el-option v-for="cat in corpusCategories" :key="cat" :label="cat" :value="cat" />
              </el-select>
              <el-input
                v-model="corpusSearch"
                size="small"
                clearable
                placeholder="搜索标题 / 内容"
                style="width: 200px"
                :prefix-icon="Search"
              />
            </div>

            <div class="corpus-list">
              <div v-for="corpus in filteredCorpusData" :key="corpus.id" class="corpus-item">
                <div class="corpus-content">
                  <div class="corpus-header">
                     <h4>{{ corpus.title }}</h4>
                     <el-tag :type="getCorpusType(corpus.type)">{{ getCorpusTypeText(corpus.type) }}</el-tag>
                     <el-tag v-if="getCorpusCategory(corpus)" size="small" effect="plain">{{ getCorpusCategory(corpus) }}</el-tag>
                   </div>
                  <el-tooltip 
                    :content="corpus.content" 
                    placement="right"
                    :disabled="corpus.content.length <= 100"
                    effect="light"
                    :show-after="300"
                  >
                    <p class="corpus-preview corpus-preview-truncated">
                      {{ corpus.content.length > 100 ? corpus.content.substring(0, 100) + '...' : corpus.content }}
                    </p>
                  </el-tooltip>
                </div>
                <div class="corpus-actions">
                  <el-button size="small" @click="editCorpus(corpus)">编辑</el-button>
                  <el-button size="small" type="danger" @click="deleteCorpus(corpus)">删除</el-button>
                </div>
              </div>
              
              <div v-if="filteredCorpusData.length === 0 && corpusData.length > 0" class="empty-state">
                <p>没有符合筛选条件的语料</p>
              </div>

              <div v-if="corpusData.length === 0" class="empty-state">
                <p>暂无语料数据</p>
                <el-button size="small" @click="addCorpus">添加第一个语料</el-button>
              </div>
            </div>
          </el-card>
        </div>

        <!-- 事件线面板 -->
        <div v-show="activeTab === 'events'" class="panel-content">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span>📊 事件时间线</span>
                <div class="event-header-actions">
                  <el-radio-group v-model="eventsView" size="small">
                    <el-radio-button value="list">列表</el-radio-button>
                    <el-radio-button value="timeline">时间线</el-radio-button>
                  </el-radio-group>
                  <el-button size="small" type="primary" @click="addEvent">
                    <el-icon><Plus /></el-icon>
                    新增
                  </el-button>
                </div>
              </div>
            </template>

            <!-- 时间线视图：按章节归组排序 -->
            <div v-if="eventsView === 'timeline'" class="events-timeline">
              <el-timeline v-if="sortedEvents.length > 0">
                <el-timeline-item
                  v-for="event in sortedEvents"
                  :key="event.id"
                  :timestamp="getEventChapterText(event)"
                  :type="getImportanceType(event.importance) === 'danger' ? 'danger' : getImportanceType(event.importance) === 'warning' ? 'warning' : 'primary'"
                  placement="top"
                >
                  <div class="event-content timeline-event-content">
                    <div class="event-header">
                      <h4>{{ event.title }}</h4>
                      <div class="event-actions">
                        <el-dropdown @command="(cmd) => handleEventAction(cmd, event)" trigger="click">
                          <el-button size="small" type="text" @click.stop>
                            <el-icon><MoreFilled /></el-icon>
                          </el-button>
                          <template #dropdown>
                            <el-dropdown-menu>
                              <el-dropdown-item command="edit">
                                <el-icon><Edit /></el-icon>
                                编辑
                              </el-dropdown-item>
                              <el-dropdown-item command="delete" divided>
                                <el-icon><Delete /></el-icon>
                                删除
                              </el-dropdown-item>
                            </el-dropdown-menu>
                          </template>
                        </el-dropdown>
                      </div>
                    </div>
                    <p class="event-desc">{{ event.description }}</p>
                    <div class="event-meta">
                      <el-tag size="small">{{ getEventChapterText(event) }}</el-tag>
                      <el-tag
                        v-for="name in getEventCharacterNames(event)"
                        :key="name"
                        size="small"
                        type="info"
                        effect="plain"
                      >{{ name }}</el-tag>
                      <span class="event-time">{{ event.time }}</span>
                    </div>
                  </div>
                </el-timeline-item>
              </el-timeline>
              <div v-else class="empty-state">
                <p>暂无事件记录</p>
                <el-button size="small" @click="addEvent">添加第一个事件</el-button>
              </div>
            </div>

            <!-- 列表视图 -->
            <div v-else class="events-list">
              <div v-for="event in sortedEvents" :key="event.id" class="event-item">
                <div class="event-marker"></div>
                <div class="event-content">
                  <div class="event-header">
                    <h4>{{ event.title }}</h4>
                    <div class="event-actions">
                      <el-dropdown @command="(cmd) => handleEventAction(cmd, event)" trigger="click">
                        <el-button size="small" type="text" @click.stop>
                          <el-icon><MoreFilled /></el-icon>
                        </el-button>
                        <template #dropdown>
                          <el-dropdown-menu>
                            <el-dropdown-item command="edit">
                              <el-icon><Edit /></el-icon>
                              编辑
                            </el-dropdown-item>
                            <el-dropdown-item command="delete" divided>
                              <el-icon><Delete /></el-icon>
                              删除
                            </el-dropdown-item>
                          </el-dropdown-menu>
                        </template>
                      </el-dropdown>
                    </div>
                  </div>
                  <el-tooltip
                    :content="event.description || ''"
                    placement="right"
                    :disabled="(event.description || '').length <= 80"
                    effect="light"
                    :show-after="300"
                  >
                    <p class="event-desc event-desc-truncated">
                      {{ (event.description || '').length > 80 ? (event.description || '').substring(0, 80) + '...' : (event.description || '') }}
                    </p>
                  </el-tooltip>
                  <div class="event-meta">
                    <el-tag size="small">{{ getEventChapterText(event) }}</el-tag>
                    <el-tag
                      v-for="name in getEventCharacterNames(event)"
                      :key="name"
                      size="small"
                      type="info"
                      effect="plain"
                    >{{ name }}</el-tag>
                    <span class="event-time">{{ event.time }}</span>
                  </div>
                </div>
              </div>

              <div v-if="sortedEvents.length === 0" class="empty-state">
                <p>暂无事件记录</p>
                <el-button size="small" @click="addEvent">添加第一个事件</el-button>
              </div>
            </div>
          </el-card>
        </div>
      </div>

      <!-- 右侧编辑器区域 -->
      <div class="editor-panel">
        <el-card shadow="never" v-if="currentChapter">
          <template #header>
            <div class="editor-header">
              <div class="editor-header-left">
                <h3 class="chapter-title">{{ currentChapter.title }}</h3>
                <div class="chapter-meta">
                  <span class="word-count">{{ contentWordCount }}字</span>
                  <el-select 
                    v-if="currentChapter.status" 
                    v-model="currentChapter.status" 
                    size="small" 
                    style="width: 80px;"
                    @change="updateChapterStatus"
                    popper-class="chapter-status-dropdown"
                  >
                    <el-option label="草稿" value="draft" />
                    <el-option label="完成" value="completed" />
                    <el-option label="发表" value="published" />
                  </el-select>
                  <span v-if="isSaving" class="saving-indicator">● 保存中...</span>
                  <el-button v-else-if="saveError" type="danger" size="small" @click="saveCurrentChapter">保存失败，点击重试</el-button>
                </div>
              </div>
              <div class="editor-header-right">
                <el-button-group>
                  <el-button size="small" @click="generateFromOutline" :disabled="!currentChapter.description">
                    <el-icon><Star /></el-icon>
                    根据大纲生成
                  </el-button>
                  <el-button size="small" @click="openContinueDialog">
                    <el-icon><ArrowRight /></el-icon>
                    续写
                  </el-button>
                  <el-button size="small" @click="enhanceContent">
                    <el-icon><Tools /></el-icon>
                    优化
                  </el-button>
                </el-button-group>
              </div>
            </div>
          </template>
          
          
          <WriterEditor ref="editorRef" v-model="content" @change="onContentChange" />
          



        </el-card>
        
        <!-- 未选择章节状态 -->
        <el-card shadow="never" v-else>
          <div class="empty-editor">
            <el-icon class="empty-icon"><Document /></el-icon>
            <p>请选择或创建一个章节开始编辑</p>
            <el-button type="primary" @click="addNewChapter">创建第一章</el-button>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 章节编辑对话框 -->
    <el-dialog v-model="showChapterDialog" :title="editingChapter ? '编辑章节' : '新增章节'" width="600px">
      <el-form :model="chapterForm" label-width="80px">
        <el-form-item label="章节标题">
          <el-input v-model="chapterForm.title" placeholder="请输入章节标题" />
        </el-form-item>
        <el-form-item label="章节简介">
          <div class="form-item-with-ai">
            <el-input 
              v-model="chapterForm.description" 
              type="textarea" 
              :rows="4" 
              placeholder="简要描述本章节内容..." 
            />
            <el-button 
              size="small" 
              type="primary" 
              @click="generateChapterOutline" 
              :loading="isGeneratingOutline"
              style="margin-top: 8px;"
            >
              <el-icon><Star /></el-icon>
              AI生成大纲
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="章节状态">
          <el-select v-model="chapterForm.status">
            <el-option label="草稿" value="draft" />
            <el-option label="完成" value="completed" />
            <el-option label="发表" value="published" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showChapterDialog = false">取消</el-button>
        <el-button type="primary" @click="saveChapter">确定</el-button>
      </template>
    </el-dialog>

    <!-- 人物编辑对话框 -->
    <el-dialog v-model="showCharacterDialog" title="编辑角色" width="700px">
      <el-form :model="characterForm" label-width="80px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="姓名">
              <el-input v-model="characterForm.name" />
            </el-form-item>
            <el-form-item label="角色">
              <el-select v-model="characterForm.role">
                <el-option label="主角" value="protagonist" />
                <el-option label="配角" value="supporting" />
                <el-option label="反派" value="antagonist" />
                <el-option label="路人" value="minor" />
              </el-select>
            </el-form-item>
            <el-form-item label="性别">
              <el-radio-group v-model="characterForm.gender">
                <el-radio label="male">男</el-radio>
                <el-radio label="female">女</el-radio>
                <el-radio label="other">其他</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="年龄">
              <el-input-number v-model="characterForm.age" :min="0" :max="1000" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="外貌">
              <el-input v-model="characterForm.appearance" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="性格">
              <el-input v-model="characterForm.personality" type="textarea" :rows="3" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="背景故事">
          <div class="form-item-with-ai">
            <el-input v-model="characterForm.background" type="textarea" :rows="4" />
            <div class="ai-button-group" style="margin-top: 8px;">
              <el-button 
                size="small" 
                type="primary" 
                @click="generateCharacterAI"
                style="flex: 1;"
              >
                <el-icon><Star /></el-icon>
                AI生成角色信息
              </el-button>
              <el-button size="small" @click="openPromptDialog('character')" style="margin-left: 8px;">
                📝 提示词
              </el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="characterTagInput" placeholder="输入标签后按回车" @keyup.enter="addCharacterTag">
            <template #append>
              <el-button @click="addCharacterTag">添加</el-button>
            </template>
          </el-input>
          <div v-if="characterForm.tags.length > 0" style="margin-top: 8px;">
            <el-tag 
              v-for="(tag, index) in characterForm.tags" 
              :key="index" 
              closable 
              @close="removeCharacterTag(index)"
              style="margin-right: 8px;"
            >
              {{ tag }}
            </el-tag>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCharacterDialog = false">取消</el-button>
        <el-button type="primary" @click="saveCharacter">保存</el-button>
      </template>
    </el-dialog>

    <!-- 世界观编辑对话框 -->
    <el-dialog v-model="showWorldDialog" title="编辑世界观设定" width="600px">
      <el-form :model="worldForm" label-width="80px">
        <el-form-item label="设定标题">
          <el-input v-model="worldForm.title" />
        </el-form-item>
        <el-form-item label="类别">
          <el-select v-model="worldForm.category">
            <el-option label="世界设定" value="setting" />
            <el-option label="魔法体系" value="magic" />
            <el-option label="政治势力" value="politics" />
            <el-option label="地理环境" value="geography" />
            <el-option label="历史背景" value="history" />
          </el-select>
        </el-form-item>
        <el-form-item label="详细描述">
          <div class="form-item-with-ai">
            <el-input v-model="worldForm.description" type="textarea" :rows="6" />
            <el-button 
              size="small" 
              type="primary" 
              @click="generateWorldSettingAI" 
              :loading="isGeneratingWorldSetting"
              style="margin-top: 8px;"
            >
              <el-icon><Star /></el-icon>
              AI生成描述
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      
      <!-- 流式生成状态显示 -->
      <div v-if="isStreaming && streamingType === 'worldSetting'" class="streaming-status-card">
        <div class="streaming-header">
          <span class="streaming-title">AI 正在生成世界观设定...</span>
        </div>
        <div class="streaming-content-display" v-html="formatStreamingContent(streamingContent)"></div>
      </div>
      
      <template #footer>
        <el-button @click="showWorldDialog = false">取消</el-button>
        <el-button type="primary" @click="saveWorldSetting">保存</el-button>
      </template>
    </el-dialog>

    <!-- 语料库编辑对话框 -->
    <el-dialog v-model="showCorpusDialog" title="编辑语料" width="700px">
      <el-form :model="corpusForm" label-width="80px">
        <el-form-item label="标题">
          <el-input v-model="corpusForm.title" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="corpusForm.type">
            <el-option label="场景描述" value="description" />
            <el-option label="对话模板" value="dialogue" />
            <el-option label="情感表达" value="emotion" />
            <el-option label="动作描写" value="action" />
            <el-option label="心理描写" value="psychology" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="corpusForm.category"
            filterable
            allow-create
            default-first-option
            clearable
            placeholder="选择或输入自定义分类"
            style="width: 100%"
          >
            <el-option v-for="cat in corpusCategories" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="corpusForm.content" type="textarea" :rows="8" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCorpusDialog = false">取消</el-button>
        <el-button type="primary" @click="saveCorpus">保存</el-button>
      </template>
    </el-dialog>

    <!-- 事件编辑对话框 -->
    <el-dialog v-model="showEventDialog" title="编辑事件" width="600px">
      <el-form :model="eventForm" label-width="80px">
        <el-form-item label="事件标题">
          <el-input v-model="eventForm.title" />
        </el-form-item>
        <el-form-item label="相关章节">
          <el-select v-model="eventForm.chapter" placeholder="选择章节（决定事件在时间线中的位置）">
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
            v-model="eventForm.characterIds"
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
          <el-input v-model="eventForm.time" placeholder="如：第三天傍晚" />
        </el-form-item>
        <el-form-item label="重要程度">
          <el-radio-group v-model="eventForm.importance">
            <el-radio label="low">次要</el-radio>
            <el-radio label="normal">一般</el-radio>
            <el-radio label="high">重要</el-radio>
            <el-radio label="critical">关键</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="事件描述">
          <el-input v-model="eventForm.description" type="textarea" :rows="4" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEventDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEvent">保存</el-button>
      </template>
    </el-dialog>

    <!-- 章节内容生成对话框 -->
    <el-dialog v-model="showChapterGenerateDialog" title="AI生成章节内容" width="1200px" @close="showChapterGenerateDialog = false">
      <div class="chapter-generate-content">
        <!-- 顶部配置区域 -->
        <div class="generate-config-section">
          <el-card shadow="hover" class="config-card-modern">
            <template #header>
              <div class="config-header">
                <div class="config-left">
                  <span class="config-title">生成配置</span>
                  <el-tag type="info" size="small">{{ currentChapter?.title || '未选择章节' }}</el-tag>
                </div>
                <el-button 
                  type="primary" 
                  @click="generateChapterContentWithDialog" 
                  :loading="isGeneratingContent"
                  :disabled="!selectedPrompt"
                  size="small"
                >
                  <el-icon><MagicStick /></el-icon>
                  {{ isGeneratingContent ? '生成中' : '生成' }}
                </el-button>
              </div>
            </template>
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="目标字数" class="config-item">
                  <el-input-number 
                    v-model="generateConfig.wordCount" 
                    :min="500" 
                    :max="5000" 
                    size="small"
                    controls-position="right"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="写作视角" class="config-item">
                  <el-select v-model="generateConfig.style" size="small" style="width: 100%">
                    <el-option label="第一人称" value="first-person" />
                    <el-option label="第三人称" value="third-person" />
                    <el-option label="全知视角" value="omniscient" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="重点内容" class="config-item">
                  <el-input 
                    v-model="generateConfig.focus" 
                    placeholder="本章重点内容..." 
                    size="small"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            

          </el-card>
        </div>

        <el-row :gutter="20" style="margin-top: 16px;">
          <!-- 左侧：素材选择 -->
          <el-col :span="14">
            <div class="materials-section">
              <div class="section-header">
                <h4 class="section-title">📚 创作素材</h4>
                <el-button size="small" @click="clearAllMaterials">清空选择</el-button>
              </div>

              <!-- 素材选择标签页 -->
              <el-tabs v-model="activeMaterialTab" class="materials-tabs">
                <el-tab-pane label="👥 人物角色" name="characters">
                  <div class="tab-header">
                    <span class="tab-count">已选择 {{ selectedMaterials.characters.length }}/{{ characters.length }}</span>
                    <el-button size="small" @click="selectAllMaterials('characters')" v-if="characters.length > 0">全选</el-button>
                  </div>
                  <div class="materials-grid">
                    <div 
                      v-for="character in characters" 
                      :key="character.id"
                      class="material-card"
                      :class="{ selected: selectedMaterials.characters.some(c => c.id === character.id) }"
                      @click="toggleMaterial('characters', character)"
                    >
                      <div class="material-header">
                        <span class="material-name">{{ character.name }}</span>
                        <el-tag :type="getRoleType(character.role)" size="small">{{ getRoleText(character.role) }}</el-tag>
                      </div>
                      <p class="material-desc">{{ character.personality?.substring(0, 40) || '暂无描述' }}...</p>
                      <div class="material-tags">
                        <el-tag v-for="tag in character.tags?.slice(0, 2)" :key="tag" size="small">{{ tag }}</el-tag>
                      </div>
                    </div>
                  </div>
                  <div v-if="characters.length === 0" class="empty-materials">
                    <p>暂无人物角色</p>
                    <el-button size="small" @click="addCharacter">创建角色</el-button>
                  </div>
                </el-tab-pane>

                <el-tab-pane label="🌍 世界观" name="worldSettings">
                  <div class="tab-header">
                    <span class="tab-count">已选择 {{ selectedMaterials.worldSettings.length }}/{{ worldSettings.length }}</span>
                    <el-button size="small" @click="selectAllMaterials('worldSettings')" v-if="worldSettings.length > 0">全选</el-button>
                  </div>
                  <div class="materials-grid">
                    <div 
                      v-for="setting in worldSettings" 
                      :key="setting.id"
                      class="material-card"
                      :class="{ selected: selectedMaterials.worldSettings.some(w => w.id === setting.id) }"
                      @click="toggleMaterial('worldSettings', setting)"
                    >
                      <div class="material-header">
                        <span class="material-name">{{ setting.title }}</span>
                        <el-tag v-if="setting.category" size="small">{{ setting.category }}</el-tag>
                      </div>
                      <p class="material-desc">{{ setting.description?.substring(0, 50) || '暂无描述' }}...</p>
                    </div>
                  </div>
                  <div v-if="worldSettings.length === 0" class="empty-materials">
                    <p>暂无世界观设定</p>
                    <el-button size="small" @click="addWorldSetting">创建设定</el-button>
                  </div>
                </el-tab-pane>

                <el-tab-pane label="📝 语料库" name="corpus">
                  <div class="tab-header">
                    <span class="tab-count">已选择 {{ selectedMaterials.corpus.length }}/{{ corpusData.length }}</span>
                    <div>
                      <el-button
                        size="small"
                        type="primary"
                        plain
                        :disabled="corpusData.length === 0"
                        @click="recommendCorpusForContext"
                      >🛰️ 按上下文推荐</el-button>
                      <el-button size="small" @click="selectAllMaterials('corpus')" v-if="corpusData.length > 0">全选</el-button>
                    </div>
                  </div>
                  <div class="materials-grid">
                    <div
                      v-for="corpus in corpusData"
                      :key="corpus.id"
                      class="material-card"
                      :class="{ selected: selectedMaterials.corpus.some(c => c.id === corpus.id) }"
                      @click="toggleMaterial('corpus', corpus)"
                    >
                      <div class="material-header">
                        <span class="material-name">{{ corpus.title }}</span>
                      </div>
                      <p class="material-desc">{{ corpus.content?.substring(0, 40) || '暂无内容' }}...</p>
                    </div>
                  </div>
                  <div v-if="corpusData.length === 0" class="empty-materials">
                    <p>暂无语料库</p>
                    <el-button size="small" @click="addCorpus">创建语料</el-button>
                  </div>
                </el-tab-pane>

                <el-tab-pane label="📅 事件线" name="events">
                  <div class="tab-header">
                    <span class="tab-count">已选择 {{ selectedMaterials.events.length }}/{{ events.length }}</span>
                    <el-button size="small" @click="selectAllMaterials('events')" v-if="events.length > 0">全选</el-button>
                  </div>
                  <div class="materials-grid">
                    <div 
                      v-for="event in events" 
                      :key="event.id"
                      class="material-card"
                      :class="{ selected: selectedMaterials.events.some(e => e.id === event.id) }"
                      @click="toggleMaterial('events', event)"
                    >
                      <div class="material-header">
                        <span class="material-name">{{ event.title }}</span>
                        <el-tag :type="getImportanceType(event.importance)" size="small">第{{ event.chapter }}章</el-tag>
                      </div>
                      <p class="material-desc">{{ event.description?.substring(0, 40) || '暂无描述' }}...</p>
                      <div class="material-meta">
                        <span class="event-time">{{ event.time || '时间未定' }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-if="events.length === 0" class="empty-materials">
                    <p>暂无事件线</p>
                    <el-button size="small" @click="addEvent">创建事件</el-button>
                  </div>
                </el-tab-pane>

                <el-tab-pane label="📖 上下文内容" name="chapters">
                  <div class="tab-header">
                    <span class="tab-count">已选择 {{ selectedContextChapters.length }}/{{ availableContextChapters.length }}</span>
                    <div class="context-tab-actions">
                      <el-button size="small" @click="selectAllContextChapters" v-if="availableContextChapters.length > 0">全选</el-button>
                    </div>
                  </div>
                  <div class="materials-list">
                    <div 
                      v-for="chapter in availableContextChapters" 
                      :key="chapter.id"
                      class="chapter-material-card"
                      :class="{ selected: selectedContextChapters.includes(chapter.id) }"
                      @click="toggleContextChapter(chapter.id)"
                    >
                      <div class="chapter-material-header">
                        <span class="chapter-material-name">第{{ chapter.chapterIndex }}章 {{ chapter.title }}</span>
                        <div class="chapter-material-tags">
                          <el-tag :type="getChapterStatusType(chapter.status)" size="small">{{ getChapterStatusText(chapter.status) }}</el-tag>
                          <el-tag size="small" type="info">{{ chapter.wordCount }}字</el-tag>
                        </div>
                      </div>
                      <p class="chapter-material-desc">{{ chapter.description || '暂无大纲' }}</p>
                      <div v-if="chapter.content" class="chapter-material-content">
                        <span class="content-preview">{{ cleanHtmlForPreview(chapter.content, 80) }}...</span>
                      </div>
                    </div>
                  </div>
                  <div v-if="availableContextChapters.length === 0" class="empty-materials">
                    <p>暂无可选择的章节</p>
                    <el-button size="small" @click="addChapter">创建章节</el-button>
                  </div>
                </el-tab-pane>
              </el-tabs>
            </div>
          </el-col>

          <!-- 右侧：提示词选择 -->
          <el-col :span="10">
            <div class="prompt-section">
              <div class="section-header">
                <h4 class="section-title">📝 提示词模板</h4>
                <el-button size="small" @click="useDefaultPrompt">使用默认</el-button>
              </div>
              
              <!-- 提示词分类选择 -->
              <div class="category-selection-modern">
                <div class="category-header">
                  <span>🏷️ 正文类型</span>
                </div>
                <div class="category-grid">
                  <div 
                    v-for="category in contentCategories"
                    :key="category.key"
                    class="category-card"
                    :class="{ active: selectedContentCategory === category.key }"
                    @click="selectedContentCategory = category.key"
                  >
                    <span class="category-icon">{{ category.icon }}</span>
                    <span class="category-name">{{ category.name }}</span>
                  </div>
                </div>
              </div>
              
              <!-- 提示词列表 -->
              <div class="prompt-selection-modern">
                <div class="prompt-header">
                  <span>可用模板 ({{ getPromptsByCategory(selectedContentCategory).length }})</span>
                  <el-button size="small" @click="refreshPrompts">刷新</el-button>
                </div>
                <div class="prompt-list-modern">
                  <div 
                    v-for="prompt in getPromptsByCategory(selectedContentCategory)"
                    :key="prompt.id"
                    class="prompt-item-modern"
                    :class="{ active: selectedPrompt?.id === prompt.id }"
                    @click="selectPromptForChapter(prompt)"
                  >
                    <div class="prompt-content">
                      <h5 class="prompt-title">{{ prompt.title }}</h5>
                      <p class="prompt-desc">{{ prompt.description }}</p>
                      <div class="prompt-meta">
                        <div class="prompt-tags">
                          <el-tag v-for="tag in prompt.tags?.slice(0, 2)" :key="tag" size="small">{{ tag }}</el-tag>
                        </div>

                      </div>
                    </div>
                    <div class="prompt-actions">
                      <el-icon v-if="selectedPrompt?.id === prompt.id" class="selected-icon"><Check /></el-icon>
                    </div>
                  </div>
                </div>
                <div v-if="getPromptsByCategory(selectedContentCategory).length === 0" class="empty-prompts">
                  <p>暂无该类型的提示词模板</p>
                  <el-button size="small" @click="createPromptForCategory">创建模板</el-button>
                </div>
              </div>

              <!-- 变量填充区域 -->
              <div v-if="selectedPrompt && Object.keys(promptVariables).length > 0" class="variables-section">
                <div class="variables-header">
                  <span>📋 变量配置</span>
                  <el-button size="small" @click="autoFillVariables">智能填充</el-button>
                </div>
                <div class="variables-form">
                  <div 
                    v-for="(value, variable) in promptVariables"
                    :key="variable"
                    class="variable-item"
                  >
                    <label class="variable-label">{{ variable }}</label>
                    
                    <!-- 前文概要使用章节多选框 -->
                    <div v-if="variable === '前文概要'" class="context-variable-container">
                      <el-select
                        v-model="selectedContextChapters"
                        multiple
                        placeholder="选择章节作为前文参考"
                        @change="updateContextVariable"
                        size="small"
                        style="width: 100%"
                        max-collapse-tags="3"
                      >
                        <el-option
                          v-for="chapter in availableContextChapters"
                          :key="chapter.id"
                          :label="`第${chapter.chapterIndex}章 ${chapter.title} (${chapter.wordCount}字)`"
                          :value="chapter.id"
                        >
                          <div class="context-chapter-option">
                            <span class="chapter-title">第{{ chapter.chapterIndex }}章 {{ chapter.title }}</span>
                            <div class="chapter-meta">
                              <el-tag :type="getChapterStatusType(chapter.status)" size="small">{{ getChapterStatusText(chapter.status) }}</el-tag>
                              <span class="word-count">{{ chapter.wordCount }}字</span>
                            </div>
                          </div>
                        </el-option>
                      </el-select>
                      <div class="context-actions">
                        <el-button size="small" @click="clearContextSelection" v-if="selectedContextChapters.length > 0">清空</el-button>
                      </div>
                    </div>
                    
                    <!-- 其他变量使用普通输入框 -->
                    <el-input 
                      v-else
                      v-model="promptVariables[variable]"
                      :type="['章节大纲', '主要人物', '世界观设定', '参考语料'].includes(variable) ? 'textarea' : 'text'"
                      :rows="2"
                      :placeholder="'请输入' + variable"
                      @input="generateFinalPrompt"
                      size="small"
                    />
                  </div>
                </div>
              </div>

              <!-- 最终提示词预览 -->
              <div v-if="selectedPrompt" class="preview-section">
                <div class="preview-header">
                  <span>👀 最终提示词</span>
                  <div class="preview-actions">
                    <el-button size="small" @click="copyPrompt">复制</el-button>
                    <el-button size="small" @click="editPrompt">编辑</el-button>
                  </div>
                </div>
                <div class="preview-content">
                  <el-input 
                    v-model="finalPrompt"
                    type="textarea"
                    :rows="8"
                    readonly
                    placeholder="请选择提示词并填充变量"
                    class="preview-textarea"
                  />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>
      
              <template #footer>
        <div class="dialog-footer">
          <div class="action-buttons">
            <el-button @click="showChapterGenerateDialog = false">取消</el-button>
            <el-button 
              type="primary" 
              @click="generateChapterContentWithDialog" 
              :loading="isGeneratingContent"
              :disabled="!selectedPrompt"
            >
              <el-icon><MagicStick /></el-icon>
              {{ isGeneratingContent ? '生成中...' : '开始生成' }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 批量生成角色对话框 -->
    <el-dialog v-model="showBatchGenerateCharacterDialog" title="AI批量生成角色" width="900px" @close="showBatchGenerateCharacterDialog = false">
      <div class="batch-generate-content">
        <!-- 配置区域 -->
        <el-card v-if="!batchGenerating && generatedCharacters.length === 0" shadow="never" class="config-section">
          <template #header>
            <span>⚙️ 生成配置</span>
          </template>
          
          <el-form label-width="120px" size="default">
            <el-row :gutter="20">
              <el-col :span="12">
                <el-form-item label="生成数量">
                  <el-input-number v-model="batchGenerateConfig.count" :min="2" :max="10" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="角色类型">
                  <div class="character-type-options">
                    <el-checkbox v-model="batchGenerateConfig.includeMainCharacters">主角</el-checkbox>
                    <el-checkbox v-model="batchGenerateConfig.includeSupportingCharacters">配角</el-checkbox>
                    <el-checkbox v-model="batchGenerateConfig.includeMinorCharacters">次要角色</el-checkbox>
                  </div>
                </el-form-item>
              </el-col>
            </el-row>
            
            <!-- 提示词选择 -->
            <el-form-item label="使用提示词">
              <div style="display: flex; gap: 10px; align-items: center;">
                <el-button 
                  type="primary" 
                  plain 
                  size="small"
                  @click="openBatchCharacterPromptSelector"
                >
                  📝 选择提示词
                </el-button>
                <span v-if="batchCharacterSelectedPrompt" class="selected-prompt-info">
                  已选择：{{ batchCharacterSelectedPrompt.title }}
                </span>
                <el-button 
                  v-if="batchCharacterSelectedPrompt"
                  link 
                  size="small" 
                  type="danger"
                  @click="clearBatchCharacterPrompt"
                >
                  清除
                </el-button>
              </div>
            </el-form-item>
            
            <el-form-item label="特殊要求">
              <el-input 
                v-model="batchGenerateConfig.customPrompt"
                type="textarea"
                :rows="3"
                placeholder="例如：需要包含反派角色、特定职业角色、具有魔法能力的角色等..."
              />
            </el-form-item>
            
            <el-form-item label="智能分配">
              <el-checkbox v-model="batchGenerateConfig.autoAssignRoles">自动平衡角色关系和重要性</el-checkbox>
            </el-form-item>
          </el-form>
        </el-card>
        
        <!-- 流式生成区域 -->
        <el-card v-if="batchGenerating" shadow="never" class="streaming-section">
          <template #header>
            <span>🤖 AI正在生成角色...</span>
          </template>
          
          <div class="streaming-content-container">
            <div class="streaming-content" v-html="formatStreamingContent(streamingContent)"></div>
          </div>
        </el-card>
        
        <!-- 生成结果区域 -->
        <el-card v-if="!batchGenerating && generatedCharacters.length > 0" shadow="never" class="results-section">
          <template #header>
            <div class="results-header">
              <span>✨ 生成结果 ({{ generatedCharacters.length }}个角色)</span>
              <div class="result-actions">
                <el-button size="small" @click="() => generatedCharacters.forEach(char => char.selected = true)">全选</el-button>
                <el-button size="small" @click="() => generatedCharacters.forEach(char => char.selected = false)">全不选</el-button>
              </div>
            </div>
          </template>
          
          <div class="generated-characters-grid">
            <div 
              v-for="character in generatedCharacters" 
              :key="character.id"
              class="generated-character-card"
              :class="{ selected: character.selected !== false }"
              @click="toggleCharacterSelection(character)"
            >
              <div class="character-header">
                <div class="character-avatar-preview">
                  <div class="default-avatar">{{ character.name?.charAt(0) || '？' }}</div>
                </div>
                <div class="character-basic-info">
                  <h4>{{ character.name }}</h4>
                  <div class="character-meta">
                    <el-tag :type="getRoleType(character.role)" size="small">{{ getRoleText(character.role) }}</el-tag>
                    <el-tag type="info" size="small">{{ getGenderText(character.gender) }}</el-tag>
                    <span class="age-text">{{ character.age }}岁</span>
                  </div>
                </div>
                <div class="selection-indicator">
                  <el-icon v-if="character.selected !== false" class="selected-icon"><Check /></el-icon>
                </div>
              </div>
              
              <div class="character-details">
                <div class="detail-item">
                  <label>外貌：</label>
                  <p>{{ character.appearance || '暂无描述' }}</p>
                </div>
                <div class="detail-item">
                  <label>性格：</label>
                  <p>{{ character.personality || '暂无描述' }}</p>
                </div>
                <div class="detail-item">
                  <label>背景：</label>
                  <p>{{ character.background || '暂无描述' }}</p>
                </div>
                <div class="character-tags-preview" v-if="character.tags?.length">
                  <el-tag v-for="tag in character.tags" :key="tag" size="small">{{ tag }}</el-tag>
                </div>
              </div>
            </div>
          </div>
        </el-card>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showBatchGenerateCharacterDialog = false">取消</el-button>
          <el-button 
            v-if="!batchGenerating && generatedCharacters.length === 0"
            type="primary" 
            @click="batchGenerateCharacters"
            :disabled="!batchGenerateConfig.includeMainCharacters && !batchGenerateConfig.includeSupportingCharacters && !batchGenerateConfig.includeMinorCharacters"
          >
            🚀 开始生成
          </el-button>
          <!-- <el-button 
            type="success"
            size="small"
            @click="testCharacterParsing"
          >
            🧪 测试解析
          </el-button> -->

          <el-button 
            v-if="!batchGenerating && generatedCharacters.length > 0"
            @click="batchGenerateCharacters"
          >
            🔄 重新生成
          </el-button>
          <el-button 
            v-if="!batchGenerating && generatedCharacters.length > 0"
            type="primary" 
            @click="confirmAddGeneratedCharacters"
          >
            ✅ 添加选中角色
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 世界观AI生成对话框 -->
    <el-dialog v-model="showWorldGenerateDialog" title="AI生成世界观设定" width="800px" @close="showWorldGenerateDialog = false">
      <div class="world-generate-content">
        <!-- 配置区域 -->
        <el-card v-if="!worldGenerating && generatedWorldSettings.length === 0" shadow="never" class="config-section">
          <template #header>
            <span>⚙️ 生成配置</span>
          </template>
          
          <el-form label-width="120px" size="default">
                        <el-form-item label="生成数量">
              <el-input-number v-model="worldGenerateConfig.count" :min="1" :max="8" />
            </el-form-item>
            
            <el-form-item label="设定类型">
              <div class="world-type-options">
                <el-checkbox v-model="worldGenerateConfig.includeGeography">地理环境</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includeCulture">文化社会</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includeHistory">历史背景</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includeMagic">魔法体系</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includeTechnology">科技水平</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includePolitics">政治势力</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includeReligion">宗教信仰</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includeEconomy">经济贸易</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includeRaces">种族设定</el-checkbox>
                <el-checkbox v-model="worldGenerateConfig.includeLanguage">语言文字</el-checkbox>
              </div>
            </el-form-item>
            
            <!-- 提示词选择 -->
            <el-form-item label="使用提示词">
              <div style="display: flex; gap: 10px; align-items: center;">
                <el-button 
                  type="primary" 
                  plain 
                  size="small"
                  @click="openWorldSettingPromptSelector"
                >
                  📝 选择提示词
                </el-button>
                <span v-if="worldSettingSelectedPrompt" class="selected-prompt-info">
                  已选择：{{ worldSettingSelectedPrompt.title }}
                </span>
                <el-button 
                  v-if="worldSettingSelectedPrompt"
                  link 
                  size="small" 
                  type="danger"
                  @click="clearWorldSettingPrompt"
                >
                  清除
                </el-button>
              </div>
            </el-form-item>
            
            <el-form-item label="特殊要求">
              <el-input 
                v-model="worldGenerateConfig.customPrompt"
                type="textarea"
                :rows="3"
                placeholder="例如：需要包含特定的种族设定、独特的政治制度、特殊的自然现象等..."
              />
            </el-form-item>
          </el-form>
        </el-card>
        
        <!-- 流式生成区域 -->
        <el-card v-if="worldGenerating" shadow="never" class="streaming-section">
          <template #header>
            <span>🤖 AI正在生成世界观设定...</span>
          </template>
          
          <div class="streaming-content-container">
            <div class="streaming-content" v-html="formatStreamingContent(streamingContent)"></div>
          </div>
        </el-card>
        
        <!-- 生成结果区域 -->
        <el-card v-if="!worldGenerating && generatedWorldSettings.length > 0" shadow="never" class="results-section">
          <template #header>
            <div class="results-header">
              <span>✨ 生成结果 ({{ generatedWorldSettings.length }}个设定)</span>
              <div class="result-actions">
                <el-button size="small" @click="() => generatedWorldSettings.forEach(setting => setting.selected = true)">全选</el-button>
                <el-button size="small" @click="() => generatedWorldSettings.forEach(setting => setting.selected = false)">全不选</el-button>
              </div>
            </div>
          </template>
          
          <div class="generated-settings-list">
            <div 
              v-for="setting in generatedWorldSettings" 
              :key="setting.id"
              class="generated-setting-card"
              :class="{ selected: setting.selected !== false }"
              @click="toggleWorldSettingSelection(setting)"
            >
              <div class="setting-header">
                <div class="setting-basic-info">
                  <h4>{{ setting.title }}</h4>
                  <el-tag :type="getWorldSettingType(setting.type)" size="small">{{ setting.type }}</el-tag>
                </div>
                <div class="selection-indicator">
                  <el-icon v-if="setting.selected !== false" class="selected-icon"><Check /></el-icon>
                </div>
              </div>
              
              <div class="setting-content">
                <p>{{ setting.description || '暂无描述' }}</p>
              </div>
            </div>
          </div>
        </el-card>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showWorldGenerateDialog = false">取消</el-button>
          <el-button 
            v-if="!worldGenerating && generatedWorldSettings.length === 0"
            type="primary" 
            @click="generateWorldSettings"
            :disabled="!worldGenerateConfig.includeGeography && !worldGenerateConfig.includeCulture && !worldGenerateConfig.includeHistory && !worldGenerateConfig.includeMagic && !worldGenerateConfig.includeTechnology && !worldGenerateConfig.includePolitics && !worldGenerateConfig.includeReligion && !worldGenerateConfig.includeEconomy && !worldGenerateConfig.includeRaces && !worldGenerateConfig.includeLanguage"
          >
            🚀 开始生成
          </el-button>
          <el-button 
            v-if="!worldGenerating && generatedWorldSettings.length > 0"
            @click="generateWorldSettings"
          >
            🔄 重新生成
          </el-button>
          <el-button 
            v-if="!worldGenerating && generatedWorldSettings.length > 0"
            type="primary" 
            @click="confirmAddGeneratedWorldSettings"
          >
            ✅ 添加选中设定
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 提示词选择对话框 -->
    <el-dialog v-model="showPromptDialog" title="选择提示词" width="800px" @close="resetPromptDialog">
      <div class="prompt-dialog-content">
        <!-- 提示词列表 -->
        <div class="prompt-list">
          <h4>{{ getCategoryName() }} 提示词</h4>
          <div class="prompt-cards">
            <div 
              v-for="prompt in getPromptsByCategory(selectedPromptCategory)"
              :key="prompt.id"
              class="prompt-card"
              :class="{ active: selectedPrompt?.id === prompt.id }"
              @click="selectPrompt(prompt)"
            >
              <div class="prompt-card-header">
                <h5>{{ prompt.title }}</h5>
              </div>
              <div class="prompt-card-description">
                <p>{{ prompt.description }}</p>
              </div>
              <div class="prompt-card-tags">
                <el-tag v-for="tag in prompt.tags" :key="tag" size="small">{{ tag }}</el-tag>
              </div>
            </div>
          </div>
          
          <div v-if="getPromptsByCategory(selectedPromptCategory).length === 0" class="empty-prompts">
            <p>暂无该类型的提示词</p>
            <el-button type="primary" @click="goToPromptLibrary">去提示词库添加</el-button>
          </div>
        </div>

        <!-- 变量填充区域 -->
        <div v-if="selectedPrompt && Object.keys(promptVariables).length > 0" class="prompt-variables">
          <h4>填充变量</h4>
          <el-form label-width="120px" size="small">
            <el-form-item 
              v-for="(value, variable) in promptVariables"
              :key="variable"
              :label="variable + '：'"
            >
              <el-input 
                v-model="promptVariables[variable]"
                :placeholder="'请输入' + variable"
                @input="generateFinalPrompt"
              />
            </el-form-item>
          </el-form>
        </div>

        <!-- 最终提示词预览 -->
        <div v-if="selectedPrompt" class="final-prompt">
          <h4>最终提示词预览</h4>
          <el-input 
            v-model="finalPrompt"
            type="textarea"
            :rows="8"
            readonly
            placeholder="请先选择提示词并填充变量"
          />
        </div>
      </div>
      
      <!-- 批量章节生成时的流式内容显示 -->
      <div v-if="isStreaming && streamingType === 'batch-chapters' && showAIBatchChapterDialog" class="streaming-content-area">
        <el-card shadow="never" class="streaming-card">
          <template #header>
            <div class="streaming-header">
              <span>🔄 AI正在批量生成章节大纲...</span>
              <el-tag type="success" size="small">实时生成中...</el-tag>
              <el-button size="small" @click="stopStreaming">停止生成</el-button>
            </div>
          </template>
          <div class="streaming-content">
            <pre class="streaming-text-plain">{{ streamingContent }}</pre>
          </div>
        </el-card>
      </div>
      
      <template #footer>
        <el-button @click="showPromptDialog = false">取消</el-button>
        <el-button v-if="selectedPrompt" @click="copyPromptToClipboard">复制提示词</el-button>
        <el-button v-if="selectedPrompt" type="primary" @click="useSelectedPrompt" :loading="isStreaming && streamingType === 'batch-chapters'">
          {{ isStreaming && streamingType === 'batch-chapters' ? '生成中...' : '使用此提示词' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- AI优化提示词选择对话框 -->
    <el-dialog v-model="showOptimizePromptDialog" title="AI文本优化" width="1000px" @close="resetOptimizePromptDialog">
      <div class="optimize-dialog-content">
        <el-row :gutter="20">
          <!-- 左侧：当前文本 -->
          <el-col :span="12">
            <div class="current-text-section">
              <div class="section-header">
                <h4 class="section-title">📝 当前文本</h4>
                <div class="text-info">
                  <span>字数：{{ getCurrentTextLength() }}</span>
                  <span>章节：{{ currentChapter?.title || '未选择' }}</span>
                </div>
              </div>
              <div class="current-text-content">
                <el-input 
                  :value="getCurrentTextForOptimization()"
                  type="textarea"
                  :rows="12"
                  readonly
                  placeholder="请先选择文本内容"
                  class="current-text-area"
                />
              </div>
              <div class="text-actions">
                <el-button size="small" @click="selectAllText">全选文本</el-button>
                <el-button size="small" @click="clearSelectedText">清空选择</el-button>
              </div>
            </div>
          </el-col>

          <!-- 右侧：提示词选择 -->
          <el-col :span="12">
            <div class="optimize-prompt-section">
              <div class="section-header">
                <h4 class="section-title">🔧 优化配置</h4>
                <el-button size="small" @click="useDefaultOptimizePrompt">使用默认</el-button>
              </div>

              <!-- 优化类型选择 -->
              <div class="optimize-type-selection">
                <div class="type-header">优化类型</div>
                <div class="type-options">
                  <el-radio-group v-model="optimizeType" direction="vertical">
                    <el-radio label="grammar">语法润色</el-radio>
                    <el-radio label="style">文风优化</el-radio>
                    <el-radio label="emotion">情感增强</el-radio>
                    <el-radio label="logic">逻辑梳理</el-radio>
                    <el-radio label="custom">自定义优化</el-radio>
                  </el-radio-group>
                </div>
              </div>

              <!-- 提示词选择 -->
              <div class="optimize-prompt-selection">
                <div class="prompt-header">
                  <span>可用模板 ({{ getOptimizePrompts().length }})</span>
                  <el-button size="small" @click="refreshOptimizePrompts">刷新</el-button>
                </div>
                <div class="prompt-list-optimize">
                  <div 
                    v-for="prompt in getOptimizePrompts()"
                    :key="prompt.id"
                    class="prompt-item-optimize"
                    :class="{ active: optimizeSelectedPrompt?.id === prompt.id }"
                    @click="selectOptimizePrompt(prompt)"
                  >
                    <div class="prompt-content">
                      <h5 class="prompt-title">{{ prompt.title }}</h5>
                      <p class="prompt-desc">{{ prompt.description }}</p>
                      <div class="prompt-meta">
                        <div class="prompt-tags">
                          <el-tag v-for="tag in prompt.tags?.slice(0, 2)" :key="tag" size="small">{{ tag }}</el-tag>
                        </div>
                      </div>
                    </div>
                    <div class="prompt-actions">
                      <el-icon v-if="optimizeSelectedPrompt?.id === prompt.id" class="selected-icon"><Check /></el-icon>
                    </div>
                  </div>
                </div>
                <div v-if="getOptimizePrompts().length === 0" class="empty-prompts">
                  <p>暂无优化提示词模板</p>
                  <el-button size="small" @click="createOptimizePrompt">创建模板</el-button>
                </div>
              </div>

              <!-- 变量填充 -->
              <div v-if="optimizeSelectedPrompt && Object.keys(optimizePromptVariables).length > 0" class="optimize-variables">
                <div class="variables-header">
                  <span>📋 变量配置</span>
                  <el-button size="small" @click="autoFillOptimizeVariables">智能填充</el-button>
                </div>
                <div class="variables-form">
                  <div 
                    v-for="(value, variable) in optimizePromptVariables"
                    :key="variable"
                    class="variable-item"
                  >
                    <label class="variable-label">{{ variable }}</label>
                    <el-input 
                      v-model="optimizePromptVariables[variable]"
                      :type="variable.includes('文本') || variable.includes('内容') ? 'textarea' : 'text'"
                      :rows="2"
                      :placeholder="'请输入' + variable"
                      @input="generateOptimizeFinalPrompt"
                      size="small"
                    />
                  </div>
                </div>
              </div>

              <!-- 最终提示词预览 -->
              <div v-if="optimizeSelectedPrompt || optimizeType === 'custom'" class="optimize-preview">
                <div class="preview-header">
                  <span>👀 最终提示词</span>
                  <div class="preview-actions">
                    <el-button size="small" @click="copyOptimizePrompt">复制</el-button>
                    <el-button size="small" @click="editOptimizePrompt">编辑</el-button>
                  </div>
                </div>
                <div class="preview-content">
                  <el-input 
                    v-model="optimizeFinalPrompt"
                    type="textarea"
                    :rows="6"
                    :readonly="optimizeType !== 'custom'"
                    placeholder="请选择优化类型或提示词"
                    class="preview-textarea"
                  />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>

        <!-- 底部操作区 -->
        <div class="optimize-actions">
          <div class="action-info">
            <el-icon><InfoFilled /></el-icon>
            <span>{{ getOptimizeInfo() }}</span>
          </div>
          <div class="action-buttons">
            <el-button @click="showOptimizePromptDialog = false">取消</el-button>
            <el-button @click="previewOptimize" :disabled="!canOptimize()">预览效果</el-button>
            <el-button 
              type="primary" 
              @click="optimizeTextWithPrompt" 
              :loading="isOptimizing"
              :disabled="!canOptimize()"
            >
              <el-icon><Tools /></el-icon>
              {{ isOptimizing ? '优化中...' : '开始优化' }}
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- AI生成单章对话框 -->
    <el-dialog v-model="showAISingleChapterDialog" title="AI生成单章" width="800px" @close="resetAISingleChapterDialog">
      <div class="ai-single-chapter-content">
        <el-form :model="aiSingleChapterForm" label-width="120px">
          <el-form-item label="章节标题">
            <el-input v-model="aiSingleChapterForm.title" placeholder="请输入章节标题" />
          </el-form-item>
          <el-form-item label="情节要求">
            <el-input v-model="aiSingleChapterForm.plotRequirement" type="textarea" :rows="3" placeholder="描述希望的情节发展..." />
          </el-form-item>
          <el-form-item label="提示词模板">
            <el-select v-model="aiSingleChapterForm.template" placeholder="选择模板">
              <el-option label="通用章节" value="general" />
              <el-option label="战斗场景" value="battle" />
              <el-option label="情感戏" value="emotion" />
              <el-option label="转折剧情" value="turning" />
            </el-select>
          </el-form-item>
        </el-form>
        
        <!-- 自定义提示词状态显示 -->
        <div v-if="singleChapterSelectedPrompt" class="custom-prompt-status">
          <el-alert
            :title="`已选择自定义提示词：${singleChapterSelectedPrompt.title}`"
            type="success"
            show-icon
            :closable="false"
          >
            <div class="prompt-preview">
              {{ singleChapterSelectedPrompt.description || '自定义提示词已准备就绪，点击"生成章节"按钮开始使用此提示词生成章节' }}
            </div>
          </el-alert>
        </div>
        
        <!-- 流式生成内容显示 -->
        <div v-if="isStreaming && streamingType === 'single-chapter'" class="streaming-content-area">
          <el-card shadow="never" class="streaming-card">
            <template #header>
              <div class="streaming-header">
                <span>🔄 AI正在生成章节大纲...</span>
                <el-tag type="success" size="small">实时生成中...</el-tag>
              </div>
            </template>
            <div class="streaming-content">
              <pre class="streaming-text-plain">{{ streamingContent }}</pre>
            </div>
          </el-card>
        </div>
      </div>
      <template #footer>
        <el-button @click="showAISingleChapterDialog = false">取消</el-button>
        <el-button @click="selectPromptForSingleChapter">选择提示词</el-button>
        <el-button type="primary" @click="generateSingleChapter" :loading="isGeneratingChapters">
          <el-icon><Star /></el-icon>
          {{ singleChapterSelectedPrompt ? '使用自定义提示词生成' : '生成章节' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- AI批量生成章节对话框 -->
    <el-dialog v-model="showAIBatchChapterDialog" title="AI批量生成章节" width="900px" @close="resetAIBatchChapterDialog">
      <div class="ai-batch-chapter-content">
        <el-form :model="aiBatchChapterForm" label-width="120px">
          <el-form-item label="生成数量">
            <el-input-number v-model="aiBatchChapterForm.count" :min="1" :max="10" />
          </el-form-item>
          <el-form-item label="情节要求">
            <el-input v-model="aiBatchChapterForm.plotRequirement" type="textarea" :rows="3" placeholder="描述希望的情节发展..." />
          </el-form-item>
          <el-form-item label="提示词模板">
            <el-select v-model="aiBatchChapterForm.template" placeholder="选择模板">
              <el-option label="通用章节" value="general" />
              <el-option label="战斗场景" value="battle" />
              <el-option label="情感戏" value="emotion" />
              <el-option label="转折剧情" value="turning" />
            </el-select>
          </el-form-item>
        </el-form>
        
        <!-- 自定义提示词状态显示 -->
        <div v-if="batchChapterSelectedPrompt" class="custom-prompt-status">
          <el-alert
            :title="`已选择自定义提示词：${batchChapterSelectedPrompt.title}`"
            type="success"
            show-icon
            :closable="false"
          >
            <div class="prompt-preview">
              {{ batchChapterSelectedPrompt.description || '自定义提示词已准备就绪，点击"批量生成"按钮开始使用此提示词生成章节' }}
            </div>
          </el-alert>
          
          <!-- 提示词内容预览 -->
          <el-collapse v-model="activePromptCollapse" class="prompt-content-collapse">
            <el-collapse-item title="查看提示词内容" name="promptContent">
              <div class="prompt-content-preview">
                <div class="prompt-content-header">
                  <span class="content-label">原始提示词内容：</span>
                </div>
                <div class="prompt-content-text">
                  {{ batchChapterSelectedPrompt.content }}
                </div>
                
                <div v-if="batchChapterFinalPrompt" class="final-prompt-section">
                  <div class="prompt-content-header">
                    <span class="content-label">填充变量后的最终提示词：</span>
                  </div>
                  <div class="prompt-content-text final-prompt">
                    {{ batchChapterFinalPrompt }}
                  </div>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
        
        <!-- 流式生成内容显示 -->
        <div v-if="isStreaming && streamingType === 'batch-chapters'" class="streaming-content-area">
          <el-card shadow="never" class="streaming-card">
            <template #header>
              <div class="streaming-header">
                <span>🔄 AI正在批量生成章节大纲...</span>
                <el-tag type="success" size="small">实时生成中...</el-tag>
              </div>
            </template>
            <div class="streaming-content">
              <pre class="streaming-text-plain">{{ streamingContent }}</pre>
            </div>
          </el-card>
        </div>
      </div>
      <template #footer>
        <el-button @click="showAIBatchChapterDialog = false">取消</el-button>
        <el-button @click="selectPromptForBatchChapter">选择提示词</el-button>
        <el-button type="primary" @click="generateBatchChapters" :loading="isGeneratingChapters">
          <el-icon><Star /></el-icon>
          {{ batchChapterSelectedPrompt ? '使用自定义提示词生成' : '批量生成' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- AI优化内容对话框 -->
    <el-dialog v-model="showAIOptimizeDialog" title="AI内容优化" width="1000px" @close="resetAIOptimizeDialog">
      <div class="ai-optimize-content">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-card shadow="never" class="optimize-input-card">
              <template #header>
                <span>📝 待优化内容</span>
              </template>
              <el-form :model="aiOptimizeForm" label-width="100px">
                <el-form-item label="优化类型">
                  <el-select v-model="aiOptimizeForm.optimizeType" placeholder="选择优化类型">
                    <el-option label="语法润色" value="grammar" />
                    <el-option label="文风优化" value="style" />
                    <el-option label="情感增强" value="emotion" />
                    <el-option label="逻辑梳理" value="logic" />
                    <el-option label="自定义优化" value="custom" />
                  </el-select>
                </el-form-item>
                <el-form-item v-if="aiOptimizeForm.optimizeType === 'custom'" label="优化要求">
                  <el-input v-model="aiOptimizeForm.customRequirement" type="textarea" :rows="2" placeholder="请描述具体的优化要求..." />
                </el-form-item>
                <el-form-item label="原始内容">
                  <el-input v-model="aiOptimizeForm.originalContent" type="textarea" :rows="8" placeholder="请输入需要优化的内容..." />
                </el-form-item>
              </el-form>
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card shadow="never" class="optimize-result-card">
              <template #header>
                <span>✨ 优化结果</span>
              </template>
              <div v-if="isStreaming && streamingType === 'optimize'" class="streaming-content-area">
                <div class="streaming-content">
                  <div v-html="streamingContent" class="streaming-text"></div>
                </div>
              </div>
              <div v-else-if="aiOptimizeForm.optimizedContent" class="optimized-content">
                <el-input v-model="aiOptimizeForm.optimizedContent" type="textarea" :rows="8" readonly />
              </div>
              <div v-else class="empty-result">
                <p>点击"开始优化"按钮查看优化结果</p>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </div>
      <template #footer>
        <el-button @click="showAIOptimizeDialog = false">取消</el-button>
        <el-button @click="selectPromptForOptimize">选择提示词</el-button>
        <el-button type="primary" @click="startOptimizeContent" :loading="isOptimizing">
          <el-icon><Tools /></el-icon>
          开始优化
        </el-button>
        <el-button v-if="aiOptimizeForm.optimizedContent" type="success" @click="applyOptimizedContent">
          <el-icon><Check /></el-icon>
          应用结果
        </el-button>
      </template>
    </el-dialog>

    <!-- 新的AI优化对话框 -->
    <el-dialog 
      v-model="showNewOptimizeDialog" 
      title="AI文本润色" 
      width="1200px" 
      @close="resetOptimizeDialog"
    >
      <div class="new-optimize-container">
        <el-row :gutter="20">
          <!-- 左侧：配置区域 -->
          <el-col :span="8">
            <el-card shadow="never" class="optimize-config-card">
              <template #header>
                <div class="card-header">
                  <span>⚙️ 润色配置</span>
                  <el-tag v-if="optimizeForm.mode === 'selection'" type="info" size="small">选择内容</el-tag>
                  <el-tag v-else type="warning" size="small">整篇文章</el-tag>
                </div>
              </template>
              
              <!-- 预设提示词选择 -->
              <div class="prompt-selection">
                <h4>选择润色类型</h4>
                <div class="prompt-list">
                  <div 
                    v-for="prompt in optimizePrompts" 
                    :key="prompt.id"
                    class="prompt-item"
                    :class="{ active: optimizeForm.selectedPrompt?.id === prompt.id }"
                    @click="selectNewOptimizePrompt(prompt)"
                  >
                    <div class="prompt-title">{{ prompt.title }}</div>
                    <div class="prompt-desc">{{ prompt.description || prompt.content.substring(0, 60) + '...' }}</div>
                  </div>
                </div>
                <div v-if="optimizePrompts.length === 0" class="empty-prompts">
                  <p>暂无润色提示词</p>
                  <el-button size="small" @click="goToPromptLibrary">去提示词库添加</el-button>
                </div>
              </div>
              
              <!-- 自定义提示词 -->
              <div class="custom-prompt">
                <h4>自定义润色要求</h4>
                <el-input 
                  v-model="optimizeForm.customPrompt"
                  type="textarea"
                  :rows="4"
                  placeholder="输入具体的润色要求，例如：提升文字的画面感、增强对话的真实感、优化句式结构等..."
                />
              </div>

              <!-- 原始内容预览 -->
              <div class="original-content-preview">
                <h4>原始内容预览</h4>
                <el-input 
                  :value="optimizeForm.originalContent"
                  type="textarea"
                  :rows="8"
                  readonly
                  placeholder="暂无内容"
                  class="original-content-textarea"
                />
                <div class="content-stats">
                  字数：{{ optimizeForm.originalContent.length }}
                </div>
              </div>
            </el-card>
          </el-col>
          
          <!-- 右侧：优化结果区域 -->
          <el-col :span="16">
            <el-card shadow="never" class="optimize-result-card">
              <template #header>
                <div class="card-header">
                  <span>✨ 润色结果</span>
                  <el-button 
                    v-if="optimizeForm.optimizedContent && !isOptimizeStreaming" 
                    type="success" 
                    size="small"
                    @click="copyOptimizedContent"
                  >
                    <el-icon><CopyDocument /></el-icon>
                    复制结果
                  </el-button>
                </div>
              </template>
              
              <!-- 流式输出区域 -->
              <div v-if="isOptimizeStreaming" class="streaming-area">
                <div class="streaming-header">
                  <span class="streaming-status">🤖 AI正在润色中...</span>
                  <el-button size="small" type="text" @click="stopOptimizeStreaming">
                    <el-icon><Close /></el-icon>
                    停止
                  </el-button>
                </div>
                <div class="streaming-content-box">
                  <div class="streaming-text">{{ optimizeStreamingContent }}</div>
                </div>
              </div>
              
              <!-- 优化结果显示 -->
              <div v-else-if="optimizeForm.optimizedContent" class="result-area">
                <div class="result-content">
                  {{ optimizeForm.optimizedContent }}
                </div>
                <div class="result-stats">
                  <span>润色后字数：{{ optimizeForm.optimizedContent.length }}</span>
                  <span>字数变化：{{ optimizeForm.optimizedContent.length - optimizeForm.originalContent.length > 0 ? '+' : '' }}{{ optimizeForm.optimizedContent.length - optimizeForm.originalContent.length }}</span>
                </div>
              </div>
              
              <!-- 空状态 -->
              <div v-else class="empty-result">
                <el-empty description="点击润色按钮开始AI润色" />
              </div>
            </el-card>
          </el-col>
        </el-row>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showNewOptimizeDialog = false">取消</el-button>
          <el-button 
            type="primary" 
            @click="startNewOptimize"
            :loading="isOptimizeStreaming"
            :disabled="!canStartOptimize"
          >
            <el-icon><MagicStick /></el-icon>
            {{ isOptimizeStreaming ? '润色中...' : '开始润色' }}
          </el-button>
          <el-button 
            v-if="optimizeForm.optimizedContent && optimizeForm.mode === 'selection'" 
            type="success" 
            @click="replaceSelectedContent"
          >
            <el-icon><Check /></el-icon>
            替换选择内容
          </el-button>
          <el-button 
            v-if="optimizeForm.optimizedContent && optimizeForm.mode === 'full'" 
            type="success" 
            @click="replaceFullContent"
          >
            <el-icon><Check /></el-icon>
            替换全文内容
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 新的AI续写对话框 -->
    <el-dialog 
      v-model="showNewContinueDialog" 
      title="AI智能续写" 
      width="1000px"
      top="5vh"
      @close="resetContinueDialog"
    >
      <div class="new-continue-container">
        <el-row :gutter="20" style="height: 100%;">
          <!-- 左侧：配置区域 -->
          <el-col :span="10" style="height: 100%;">
            <el-card shadow="never" class="continue-config-card">
              <template #header>
                <div class="card-header">
                  <span>⚙️ 续写配置</span>
                </div>
              </template>
              
              <!-- 续写方向 -->
              <div class="continue-direction">
                <h4>续写方向</h4>
                <el-input 
                  v-model="continueForm.direction"
                  type="textarea"
                  :rows="6"
                  placeholder="请描述续写方向，例如：&#10;- 推进主角与反派的对决&#10;- 展现角色内心的纠结&#10;- 描写紧张的追逐场面&#10;- 揭示重要的秘密&#10;&#10;留空将根据大纲和前文自动续写"
                />
              </div>
              
              <!-- 续写字数 -->
              <div class="continue-word-count">
                <h4>续写字数</h4>
                                 <el-slider 
                   v-model="continueForm.wordCount"
                   :min="200"
                   :max="5000"
                   :step="100"
                   show-stops
                   show-input
                 />
                                 <div class="word-count-tips">
                   <span>建议：200-1000字为佳，最多支持5000字</span>
                 </div>
              </div>

                             <!-- 当前内容预览 -->
               <div class="current-content-preview">
                 <h4>当前内容</h4>
                 <el-input
                   :model-value="getCurrentFullContent()"
                   type="textarea"
                   :rows="6"
                   readonly
                   placeholder="暂无内容"
                   style="max-height: 150px;"
                 />
                 <div class="content-stats">
                   当前字数：{{ contentWordCount }}
                 </div>
               </div>
            </el-card>
          </el-col>
          
          <!-- 右侧：续写结果区域 -->
          <el-col :span="14" style="height: 100%;">
            <el-card shadow="never" class="continue-result-card">
              <template #header>
                <div class="card-header">
                  <span>✍️ 续写结果</span>
                  <el-button 
                    v-if="continueStreamingContent && !isContinueStreaming" 
                    type="success" 
                    size="small"
                    @click="copyContinueContent"
                  >
                    <el-icon><CopyDocument /></el-icon>
                    复制结果
                  </el-button>
                </div>
              </template>
              
              <!-- 流式输出区域 -->
              <div v-if="isContinueStreaming" class="streaming-area">
                <div class="streaming-header">
                  <span class="streaming-status">🤖 AI正在续写中...</span>
                  <el-button size="small" type="text" @click="stopContinueStreaming">
                    <el-icon><Close /></el-icon>
                    停止
                  </el-button>
                </div>
                <div class="streaming-content-box">
                  <div class="streaming-text">{{ continueStreamingContent }}</div>
                </div>
              </div>
              
              <!-- 续写结果显示 -->
              <div v-else-if="continueStreamingContent" class="result-area">
                <div class="result-content">
                  {{ continueStreamingContent }}
                </div>
                <div class="result-stats">
                  <span>续写字数：{{ continueStreamingContent.length }}</span>
                  <span>总字数：{{ contentWordCount + continueStreamingContent.length }}</span>
                </div>
              </div>
              
              <!-- 空状态 -->
              <div v-else class="empty-result">
                <el-empty description="点击续写按钮开始AI续写" />
              </div>
            </el-card>
          </el-col>
        </el-row>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showNewContinueDialog = false">取消</el-button>
          <el-button 
            type="primary" 
            @click="startNewContinue"
            :loading="isContinueStreaming"
            :disabled="!canStartContinue"
          >
            <el-icon><ArrowRight /></el-icon>
            {{ isContinueStreaming ? '续写中...' : '开始续写' }}
          </el-button>
          <el-button 
            v-if="continueStreamingContent && !isContinueStreaming" 
            type="success" 
            @click="appendContinueContent"
          >
            <el-icon><Check /></el-icon>
            追加到文章
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, shallowRef, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Plus, Edit, Delete, Document, MoreFilled, ArrowDown, Star, Tools, ArrowRight, Check, InfoFilled, MagicStick, Close, CopyDocument, Search
} from '@element-plus/icons-vue'
import { recommendCorpus } from '@/utils/corpusRetrieval'
import { useWriterProject } from '@/composables/useWriterProject'
const WriterEditor = defineAsyncComponent(() => import('@/components/writer/WriterEditor.vue'))
import { useAIStream } from '@/composables/useAIStream'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'
import { useApiConfig } from '../services/apiConfig'
import { useNovelStore } from '../stores/novel'
import { parseChapterResponse } from '../utils/chapterParser'
import { DEFAULT_PROMPTS, PROMPTS_VERSION, mergeDefaultPrompts } from '../config/defaultPrompts'
import { storageGet, storageSet, StorageKeys } from '@/utils/storage'
import {
  CHAPTER_EXCERPT_MAX_CHARS,
  RECENT_CHAPTERS_FOR_CONTEXT,
  RECENT_EVENTS_FOR_CONTEXT,
  takeLastItems,
  trimTextFromEnd,
  trimTextFromStart,
} from '@/utils/tokenBudget'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const {
  currentNovel, chapters, currentChapter, content, characters, worldSettings,
  corpusData, events, contentWordCount, hasUnsavedChanges, isSaving, saveError,
  saveNovelData, saveCurrentChapter, selectChapter: selectProjectChapter, initNovel, onContentChange, dispose,
} = useWriterProject({ novelStore, notifyError: message => ElMessage.error(message) })
const { activeConfig } = useApiConfig()

// 检查API配置
const checkApiConfig = () => {
  const config = activeConfig.value
  if (!config.apiKey || !config.baseURL) {
    ElMessageBox.confirm(
      '检测到您还未配置AI API，需要先配置API密钥才能使用AI功能。是否前往配置？',
      '需要配置API',
      {
        confirmButtonText: '去配置',
        cancelButtonText: '稍后配置',
        type: 'warning'
      }
    ).then(() => {
      router.push('/config')
    }).catch(() => {
      // 用户选择稍后配置
    })
    return false
  }
  return true
}

// 检查API配置（移除余额检查，用户使用自己的API）
const checkApiAndBalance = () => {
  return checkApiConfig()
}
const showChapterDialog = ref(false)
const editingChapter = ref(null)
const editorRef = shallowRef()
const activeTab = ref('editor')

// AI相关数据
const _activeAITools = ref(['chapter-gen'])
const isGeneratingChapters = ref(false)
const isGeneratingContent = ref(false)
const isOptimizing = ref(false)
const isGeneratingOutline = ref(false)
const optimizeType = ref('grammar')

// 流式生成相关数据
const writerStream = useAIStream()
const { streamingContent, isStreaming } = writerStream
const streamingType = ref('')
let writerOperation = 0 // 'content', 'chapter', 'optimize', 'continue'
let writerDialogOwner = ''
const streamingChapter = ref(null)

// 提示词相关数据
const showPromptDialog = ref(false)
const selectedPromptCategory = ref('')
const availablePrompts = ref([])
const selectedPrompt = ref(null)
const promptVariables = ref({})
const finalPrompt = ref('')

// AI优化提示词选择
const showOptimizePromptDialog = ref(false)
const optimizeSelectedPrompt = ref(null)
const optimizePromptVariables = ref({})
const optimizeFinalPrompt = ref('')
const activeMaterialTab = ref('characters')

// 章节生成对话框相关数据
const showChapterGenerateDialog = ref(false)
const _isDevelopment = ref(true) // 开发模式，可以显示调试功能
const targetChapter = ref(null)
const selectedContentCategory = ref('content') // 当前选择的正文分类
const selectedMaterials = ref({
  characters: [],
  worldSettings: [],
  corpus: [],
  events: [],
  chapters: []
})

// 前文概要章节选择
const selectedContextChapters = ref([])
const generateConfig = ref({
  wordCount: 2000,
  style: 'third-person',
  focus: ''
})

// 正文生成分类
const contentCategories = ref([
  { key: 'content', name: '基础正文', icon: '📝' },
  { key: 'content-dialogue', name: '对话生成', icon: '💬' },
  { key: 'content-scene', name: '场景描写', icon: '🏞️' },
  { key: 'content-action', name: '动作情节', icon: '⚡' },
  { key: 'content-psychology', name: '心理描写', icon: '🧠' }
])

// 批量生成角色相关数据
const showBatchGenerateCharacterDialog = ref(false)
const batchGenerateConfig = ref({
  count: 5,
  includeMainCharacters: true,
  includeSupportingCharacters: true,
  includeMinorCharacters: true,
  customPrompt: '',
  autoAssignRoles: true
})
const batchGenerating = ref(false)
const generatedCharacters = ref([])
const batchGenerateResults = ref([])

// 批量生成提示词相关数据
const batchCharacterSelectedPrompt = ref(null)
const batchCharacterPromptVariables = ref({})
const batchCharacterFinalPrompt = ref('')

// 世界观AI生成相关数据
const showWorldGenerateDialog = ref(false)
const worldGenerateConfig = ref({
  count: 3,
  includeGeography: true,
  includeCulture: true,
  includeHistory: true,
  includeMagic: false,
  includeTechnology: false,
  includePolitics: false,
  includeReligion: false,
  includeEconomy: false,
  includeRaces: false,
  includeLanguage: false,
  customPrompt: ''
})
const worldGenerating = ref(false)
const generatedWorldSettings = ref([])
const isGeneratingWorldSetting = ref(false)

// 世界观生成提示词相关数据
const worldSettingSelectedPrompt = ref(null)
const worldSettingPromptVariables = ref({})
const worldSettingFinalPrompt = ref('')

// 新增AI功能弹窗相关数据
const showAISingleChapterDialog = ref(false)
const showAIBatchChapterDialog = ref(false)
const showAIOptimizeDialog = ref(false)

// AI单章生成表单
const aiSingleChapterForm = ref({
  title: '',
  plotRequirement: '',
  template: 'general'
})

// AI批量生成章节表单
const aiBatchChapterForm = ref({
  count: 3,
  plotRequirement: '',
  template: 'general'
})

// 批量生成章节选中的提示词
const batchChapterSelectedPrompt = ref(null)
const batchChapterPromptVariables = ref({})
const batchChapterFinalPrompt = ref('')
const activePromptCollapse = ref(['promptContent']) // 默认展开提示词内容

// 单章生成选中的提示词
const singleChapterSelectedPrompt = ref(null)
const singleChapterPromptVariables = ref({})
const singleChapterFinalPrompt = ref('')

// AI优化表单
const aiOptimizeForm = ref({
  optimizeType: 'grammar',
  customRequirement: '',
  originalContent: '',
  optimizedContent: ''
})

// 新的优化对话框相关数据
const showNewOptimizeDialog = ref(false)
const optimizeForm = ref({
  originalContent: '',
  optimizedContent: '',
  customPrompt: '',
  selectedPrompt: null,
  mode: 'full', // 'selection' | 'full'
  isOptimizing: false
})
// 润色优化提示词 - 从提示词库的润色分类中获取
const optimizePrompts = computed(() => {
  return availablePrompts.value.filter(prompt => prompt.category === 'polish')
})
const optimizeStream = useAIStream()
const { streamingContent: optimizeStreamingContent, isStreaming: isOptimizeStreaming } = optimizeStream

// 新的续写对话框相关数据
const showNewContinueDialog = ref(false)
const continueForm = ref({
  direction: '', // 续写方向
  wordCount: 500, // 续写字数
  isStreaming: false
})
const continueStream = useAIStream()
const { streamingContent: continueStreamingContent, isStreaming: isContinueStreaming } = continueStream


// 对话框状态
const showCharacterDialog = ref(false)
const showWorldDialog = ref(false)
const showCorpusDialog = ref(false)
const showEventDialog = ref(false)

// 表单数据
const chapterForm = ref({
  title: '',
  description: '',
  status: 'draft'
})

const aiChapterForm = ref({
  count: 3,
  plotRequirement: '',
  template: 'general'
})

const aiContentForm = ref({
  wordCount: 2000,
  style: 'third-person',
  focus: ''
})

const characterForm = ref({
  id: null,
  name: '',
  role: 'supporting',
  gender: 'male',
  age: 25,
  appearance: '',
  personality: '',
  background: '',
  tags: [],
  avatar: ''
})

const characterTagInput = ref('')

const worldForm = ref({
  id: null,
  title: '',
  description: '',
  category: 'setting',
  details: ''
})

const corpusForm = ref({
  id: null,
  title: '',
  type: 'description',
  category: '',
  content: '',
  tags: []
})

const eventForm = ref({
  id: null,
  title: '',
  description: '',
  chapter: '',
  characterIds: [],
  time: '',
  importance: 'normal'
})

// 事件线视图：list 列表 / timeline 时间线（按章节与时间排序）
const eventsView = ref('list')

/** 事件的章节显示文本：兼容旧数据的标题存储与新数据的章号存储 */
const getEventChapterText = (event) => {
  if (!event.chapter && event.chapter !== 0) return '未指定章节'
  const value = String(event.chapter).trim()
  const chapterNum = parseInt(value, 10)
  if (Number.isFinite(chapterNum) && String(chapterNum) === value) {
    const chapter = chapters.value[chapterNum - 1]
    return chapter ? `第${chapterNum}章 ${chapter.title}` : `第${chapterNum}章`
  }
  return String(event.chapter)
}

/** 事件关联角色的名字列表（按 id 映射，兼容旧数据直接存名字的情况） */
const getEventCharacterNames = (event) => {
  const ids = event.characterIds || []
  return ids
    .map((id) => characters.value.find(c => c.id === id)?.name ?? (typeof id === 'string' ? id : null))
    .filter(Boolean)
}

/** 时间线排序：章节号 → 时间文本 → 创建时间 */
const sortedEvents = computed(() => {
  return [...events.value].sort((a, b) => {
    const chapterA = parseInt(String(a.chapter ?? ''), 10)
    const chapterB = parseInt(String(b.chapter ?? ''), 10)
    const numA = Number.isFinite(chapterA) ? chapterA : Number.MAX_SAFE_INTEGER
    const numB = Number.isFinite(chapterB) ? chapterB : Number.MAX_SAFE_INTEGER
    if (numA !== numB) return numA - numB
    const timeA = String(a.time || '')
    const timeB = String(b.time || '')
    if (timeA !== timeB) return timeA.localeCompare(timeB)
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  })
})

// 方法
const goBack = () => router.push('/novels')

const addNewChapter = () => {
  editingChapter.value = null
  chapterForm.value = {
    title: '',
    description: '',
    status: 'draft'
  }
  showChapterDialog.value = true
}

const editChapterTitle = (chapter) => {
  editingChapter.value = chapter
  chapterForm.value = {
    title: chapter.title,
    description: chapter.description || '',
    status: chapter.status || 'draft'
  }
  showChapterDialog.value = true
}

const saveChapter = async () => {
  if (!chapterForm.value.title.trim()) {
    ElMessage.warning('请输入章节标题')
    return
  }
  const isNew = !editingChapter.value
  if (editingChapter.value) {
    editingChapter.value.title = chapterForm.value.title
    editingChapter.value.description = chapterForm.value.description
    editingChapter.value.status = chapterForm.value.status
  } else {
    const newChapter = {
      id: Date.now(),
      title: chapterForm.value.title,
      description: chapterForm.value.description,
      content: '', wordCount: 0,
      createdAt: new Date(), updatedAt: new Date(),
      status: chapterForm.value.status
    }
    chapters.value.push(newChapter)
    // Retrying a failed save updates the same draft instead of creating a duplicate.
    editingChapter.value = newChapter
  }
  if (!(await saveNovelData())) return
  if (isNew && !(await selectChapter(editingChapter.value))) return
  ElMessage.success(isNew ? '章节创建成功' : '章节信息已更新')
  showChapterDialog.value = false
}

const deleteChapter = (chapter) => {
  const novelId = currentNovel.value?.id
  return ElMessageBox.confirm(`确定要删除章节《${chapter.title}》吗？`, '确认删除', {
    type: 'warning'
  }).then(async () => {
    if (currentNovel.value?.id !== novelId) return
    const index = chapters.value.findIndex(c => c.id === chapter.id)
    if (index < 0) return
    const previousChapter = currentChapter.value
    const previousContent = content.value
    chapters.value.splice(index, 1)
    if (currentChapter.value?.id === chapter.id) {
      currentChapter.value = null
      content.value = ''
    }
    if (!(await saveNovelData())) {
      chapters.value.splice(index, 0, chapter)
      currentChapter.value = previousChapter
      content.value = previousContent
      return
    }
    if (!currentChapter.value && chapters.value.length && !(await selectChapter(chapters.value[0]))) return
    ElMessage.success('章节已删除')
  }).catch(() => {})
}




// 章节相关方法
const handleChapterCommand = (command) => {
  switch (command) {
    case 'manual':
      addNewChapter()
      break
    case 'ai-single':
      openAISingleChapterDialog()
      break
    case 'ai-batch':
      openAIBatchChapterDialog()
      break
  }
}

const handleChapterAction = (command, chapter) => {
  switch (command) {
    case 'edit':
      editChapterTitle(chapter)
      break
    case 'generate':
      openChapterGenerateDialog(chapter)
      break
    case 'delete':
      deleteChapter(chapter)
      break
  }
}

const getChapterStatusType = (status) => {
  const statusMap = {
    draft: 'warning',
    completed: 'success',
    published: 'primary'
  }
  return statusMap[status] || 'warning'
}

const getChapterStatusText = (status) => {
  const statusMap = {
    draft: '草稿',
    completed: '完成',
    published: '发表'
  }
  return statusMap[status] || '草稿'
}

// AI生成相关方法
const _generateChapters = async () => {
  if (!checkApiAndBalance()) return
  

  streamingType.value = 'chapter'
  streamingContent.value = ''
  
  const operation = beginWriterOperation(isGeneratingChapters, '')
  try {
    const count = aiChapterForm.value.count
    const plotRequirement = aiChapterForm.value.plotRequirement
    const template = aiChapterForm.value.template
    
    // 构建提示词
    const prompt = `You are a professional Chinese web-novel story architect. All output must be written in natural, idiomatic Simplified Chinese.

=== Novel info ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== Task ===
Generate ${count} chapter outlines that continue from the existing chapters.

Requirements:
- Generate exactly ${count} chapters, no more, no fewer.
- 情节要求：${plotRequirement || '请根据小说主题合理发展'}
- 模板类型：${getTemplateDescription(template)}
- Every outline is concrete: name the events, decisions and characters — never vague summaries like "矛盾升级".
- Chapters connect causally: each opens from the previous chapter's outcome; escalate stakes across the batch.
- Every chapter ends on a hook.

已有章节数：${chapters.value.length}个

=== 前文章节信息（重要参考，接续其情节，不得矛盾或重复） ===
${getRecentChaptersDetail()}

=== Output format — MANDATORY, machine-parsed ===
Output ONLY chapter blocks in exactly the format below, nothing else (no preamble, no closing remarks, no markdown). Keep the Chinese labels 章节/标题/大纲 exactly as shown; do NOT translate or rename them:

章节1：
标题：[章节标题]
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]

章节2：
标题：[章节标题]
大纲：[详细的章节内容描述]

章节3：
标题：[章节标题]
大纲：[详细的章节内容描述]

Continue the numbering up to 章节${count}. Generate exactly ${count} chapters.`

    console.log('开始AI生成章节大纲:', prompt)
    
    // 流式调用AI生成
    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'outline'
    }, (chunk, fullContent) => {
      // 实时更新流式内容
      streamingContent.value = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 解析AI响应，提取章节信息
    const newChapters = parseChapterResponse(aiResponse)
    
    // 记录是否是第一次生成章节
    const wasEmpty = chapters.value.length === 0
    
    // 添加到章节列表
    newChapters.forEach((chapterData, index) => {
      const newChapter = {
        id: Date.now() + index,
        title: chapterData.title || `AI生成章节 ${chapters.value.length + index + 1}`,
        description: chapterData.description || chapterData.outline || '暂无描述',
        content: '',
        wordCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'draft'
      }
      chapters.value.push(newChapter)
    })
    
    // 如果之前没有章节，自动选择第一个生成的章节
    if (wasEmpty && chapters.value.length > 0) {
      if (!(await selectChapter(chapters.value[0]))) return
    if (operation !== writerOperation) return
    }
    
    if (!(await saveNovelData())) return
    if (operation !== writerOperation) return

    ElMessage.success(`成功生成${newChapters.length}个章节大纲`)
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成章节失败:', error)
    ElMessage.error(`章节生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingChapters.value = false
    }
  }
}



const generateContent = async () => {
  if (!checkApiAndBalance()) return
  
  if (!currentChapter.value) {
    ElMessage.warning('请先选择一个章节')
    return
  }
  

  streamingType.value = 'content'
  streamingContent.value = ''
  streamingChapter.value = currentChapter.value
  
  const operation = beginWriterOperation(isGeneratingContent, '')
  try {
    // 构建上下文信息
    const context = buildGenerationContext()
    
    // 构建详细的提示词
    const prompt = buildContentPrompt(currentChapter.value, context)
    
    console.log('开始AI生成正文:', prompt.substring(0, 200) + '...')
    
    // 流式调用AI生成正文
    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'generation'
    }, (chunk, fullContent) => {
      console.log('普通生成流式回调:', chunk.length, '字符，总长度:', fullContent.length)
      
      // 更新流式显示内容（原始内容）
      streamingContent.value = fullContent
      
      // 格式化内容用于编辑器
      const formattedContent = formatGeneratedContent(fullContent, currentChapter.value.title)
      
      // 如果是当前章节，实时更新编辑器内容
      if (streamingChapter.value?.id === currentChapter.value?.id) {
        content.value = formattedContent
        hasUnsavedChanges.value = true
      }
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 格式化生成的内容
    const formattedContent = formatGeneratedContent(aiResponse, currentChapter.value.title)
    
    content.value = formattedContent
    hasUnsavedChanges.value = true
    currentChapter.value.status = 'draft'
    
    if (!(await saveCurrentChapter())) return
    if (operation !== writerOperation) return

    ElMessage.success('正文生成成功')
    
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成正文失败:', error)
    ElMessage.error(`正文生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingContent.value = false
      streamingChapter.value = null
    }
  }
}

const _generateChapterContent = async (chapter) => {
  if (await selectChapter(chapter)) await generateContent()
}



const _optimizeText = async () => {
  if (!checkApiAndBalance()) return
  
  if (!currentChapter.value || !content.value) {
    ElMessage.warning('请先选择章节并添加内容')
    return
  }
  

  streamingType.value = 'optimize'
  streamingContent.value = ''
  streamingChapter.value = currentChapter.value
  
  const operation = beginWriterOperation(isOptimizing, '')
  try {
    const currentContent = content.value.replace(/<[^>]*>/g, '').trim() // 移除HTML标签
    const optimizeTypeText = getOptimizeTypeText()
    
    const prompt = `请对以下小说内容进行${optimizeTypeText}。

原文内容：
${currentContent}

优化要求：
${getOptimizeInstructions(optimizeType.value)}

请返回优化后的内容：`

    console.log(`开始AI${optimizeTypeText}:`, prompt.substring(0, 200) + '...')
    
    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.3, // 优化时使用较低的温度，保持内容稳定
      type: 'polish'
    }, (chunk, fullContent) => {
      // 实时更新流式内容并格式化
      const formattedContent = formatGeneratedContent(fullContent, currentChapter.value.title)
      streamingContent.value = formattedContent
      
      // 如果是当前章节，实时更新编辑器内容
      if (streamingChapter.value?.id === currentChapter.value?.id) {
        content.value = formattedContent
        hasUnsavedChanges.value = true
      }
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 格式化优化后的内容
    const optimizedContent = formatGeneratedContent(aiResponse, currentChapter.value.title)
    
    content.value = optimizedContent
    hasUnsavedChanges.value = true
    
    if (!(await saveCurrentChapter())) return
    if (operation !== writerOperation) return

    ElMessage.success(`文本${optimizeTypeText}完成`)
    
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI文本优化失败:', error)
    ElMessage.error(`文本优化失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isOptimizing.value = false
      streamingChapter.value = null
    }
  }
}

const getOptimizeTypeText = () => {
  const typeMap = {
    grammar: '语法润色',
    style: '文风优化',
    emotion: '情感增强',
    logic: '逻辑梳理'
  }
  return typeMap[optimizeType.value] || '优化'
}

const getOptimizeInstructions = (type) => {
  const instructions = {
    grammar: `
1. 检查并修正语法错误、错别字、标点符号问题
2. 优化句式结构，使表达更加流畅
3. 保持原文的意思和风格不变
4. 提升文字的准确性和规范性`,
    style: `
1. 优化文字表达，使语言更加优美流畅
2. 增强文字的感染力和表现力
3. 统一文章的语言风格
4. 保持故事情节和人物性格不变`,
    emotion: `
1. 加强情感描写，使情感表达更加深刻
2. 增加心理描写和情感细节
3. 提升读者的情感共鸣
4. 保持情节发展的合理性`,
    logic: `
1. 梳理故事情节的逻辑关系
2. 检查人物行为的合理性
3. 优化情节发展的连贯性
4. 确保时间线和因果关系清晰`
  }
  return instructions[type] || '进行全面优化'
}

// 获取流式生成类型文本
const _getStreamingTypeText = () => {
  const typeMap = {
    content: '正文内容',
    chapter: '章节大纲',
    optimize: '文本优化',
    continue: '续写内容',
    character: '角色生成',
    'single-chapter': '章节大纲',
    'batch-chapters': '批量章节'
  }
  return typeMap[streamingType.value] || '内容'
}

// 停止流式生成
const stopStreaming = () => {
  cancelWriterStream('已停止AI生成')
}

// 监听流式内容变化，自动滚动到底部
watch(streamingContent, () => {
  if (isStreaming.value) {
    nextTick(() => {
      const streamingContentEl = document.querySelector('.streaming-content')
      if (streamingContentEl) {
        streamingContentEl.scrollTop = streamingContentEl.scrollHeight
      }
    })
  }
})

// 加载提示词数据（内置默认库升级时自动合并刷新，用户自建模板保留）
const loadPrompts = () => {
  const parsed = storageGet(StorageKeys.prompts, null)
  if (parsed && Array.isArray(parsed)) {
    try {
      const version = storageGet(StorageKeys.promptsVersion, 0)
      if (version !== PROMPTS_VERSION) {
        availablePrompts.value = mergeDefaultPrompts(parsed)
        savePrompts()
        storageSet(StorageKeys.promptsVersion, PROMPTS_VERSION)
      } else {
        availablePrompts.value = parsed
      }
    } catch (error) {
      console.error('加载提示词失败:', error)
      availablePrompts.value = getDefaultPrompts()
      savePrompts()
    }
  } else {
    availablePrompts.value = getDefaultPrompts()
    savePrompts() // 首次加载时保存默认提示词
    storageSet(StorageKeys.promptsVersion, PROMPTS_VERSION)
  }
}

// 获取默认提示词
const getDefaultPrompts = () => {
  return DEFAULT_PROMPTS
}

// 保存提示词到本地存储
const savePrompts = () => {
  try {
    storageSet(StorageKeys.prompts, availablePrompts.value)
  } catch (error) {
    console.error('保存提示词失败:', error)
  }
}

// 根据类型筛选提示词
const getPromptsByCategory = (category) => {
  return availablePrompts.value.filter(prompt => prompt.category === category)
}

// 打开提示词选择对话框
const openPromptDialog = (category) => {
  console.log('openPromptDialog 被调用，category:', category, 'showAIBatchChapterDialog:', showAIBatchChapterDialog.value)
  
  selectedPromptCategory.value = category
  showPromptDialog.value = true
  selectedPrompt.value = null
  promptVariables.value = {}
  finalPrompt.value = ''
  
  // 如果是人物生成，自动填充已有的人物信息
  if (category === 'character' && characterForm.value) {
    setTimeout(() => {
      autoFillCharacterVariables()
    }, 100) // 延迟执行确保对话框已显示
  }
  
  // 如果是世界观生成，自动填充相关信息
  if (category === 'worldview' && showWorldGenerateDialog.value) {
    setTimeout(() => {
      autoFillWorldSettingVariables()
    }, 100) // 延迟执行确保对话框已显示
  }
  
  // 如果是批量章节生成，也需要在这里预处理（虽然还没选择具体提示词）
  if (category === 'outline' && showAIBatchChapterDialog.value) {
    console.log('openPromptDialog: 批量章节生成模式，准备预填充基础变量')
    // 这里不填充具体变量，等用户选择提示词后再填充
  }
}

// 选择提示词
const selectPrompt = (prompt) => {
  selectedPrompt.value = prompt
  promptVariables.value = {}
  
  // 提取变量
  const matches = prompt.content.match(/\{([^}]+)\}/g)
  if (matches) {
    matches.forEach(match => {
      const variable = match.slice(1, -1)
      promptVariables.value[variable] = ''
    })
  }
  
  // 如果是人物生成，自动填充已有的人物信息
  if (selectedPromptCategory.value === 'character' && characterForm.value) {
    autoFillCharacterVariables()
  }
  
  // 如果是世界观生成，自动填充相关信息
  if (selectedPromptCategory.value === 'worldview' && showWorldGenerateDialog.value) {
    autoFillWorldSettingVariables()
  }
  
  // 如果是批量章节生成，自动填充批量章节变量
  if (selectedPromptCategory.value === 'outline' && showAIBatchChapterDialog.value) {
    console.log('selectPrompt中检测到批量章节生成，调用autoFillBatchChapterVariables')
    // 延迟一下确保变量提取完成
    setTimeout(() => {
      autoFillBatchChapterVariables()
    }, 50)
  }
  
  // 如果是单章生成，自动填充单章变量
  if (selectedPromptCategory.value === 'outline' && showAISingleChapterDialog.value) {
    console.log('selectPrompt中检测到单章生成，调用autoFillSingleChapterVariables')
    // 延迟一下确保变量提取完成
    setTimeout(() => {
      autoFillSingleChapterVariables()
    }, 50)
  }
  
  generateFinalPrompt()
}

// 自动填充人物变量
const autoFillCharacterVariables = () => {
  if (selectedPromptCategory.value !== 'character') return
  
  // 自动填充基本信息
  promptVariables.value['小说标题'] = currentNovel.value?.title || '未命名小说'
  promptVariables.value['姓名'] = characterForm.value.name || ''
  promptVariables.value['性别'] = characterForm.value.gender === 'male' ? '男' : 
                              characterForm.value.gender === 'female' ? '女' : '其他'
  promptVariables.value['年龄'] = characterForm.value.age?.toString() || '25'
  
  // 角色定位转换
  const roleMapping = {
    protagonist: '主角',
    supporting: '配角', 
    antagonist: '反派',
    minor: '次要角色'
  }
  promptVariables.value['角色定位'] = roleMapping[characterForm.value.role] || '配角'
  promptVariables.value['角色类型'] = roleMapping[characterForm.value.role] || '配角'
  
  // 根据小说类型填充相关信息
  const novelGenre = currentNovel.value?.genre || '现代'
  promptVariables.value['小说类型'] = novelGenre
  
  // 为不同类型的人物生成器预填充特定信息
  if (characterForm.value.role === 'antagonist') {
    promptVariables.value['关系设定'] = '与主角对立的敌人'
  }
  
  if (characterForm.value.role === 'supporting') {
    promptVariables.value['角色作用'] = '协助主角发展剧情'
  }
  
  // 根据小说类型填充背景信息
  if (novelGenre.includes('古风') || novelGenre.includes('古代')) {
    promptVariables.value['社会地位'] = '普通百姓'
  } else if (novelGenre.includes('现代') || novelGenre.includes('都市')) {
    promptVariables.value['职业设定'] = '上班族'
  } else if (novelGenre.includes('玄幻') || novelGenre.includes('修仙')) {
    promptVariables.value['修为等级'] = '练气期'
  } else if (novelGenre.includes('科幻')) {
    promptVariables.value['科技设定'] = '星际文明时代'
  }
  
  generateFinalPrompt()
}

// 生成最终提示词
const generateFinalPrompt = () => {
  if (!selectedPrompt.value) {
    finalPrompt.value = ''
    return
  }
  
  let result = selectedPrompt.value.content
  Object.keys(promptVariables.value).forEach(variable => {
    const value = promptVariables.value[variable] || `{${variable}}`
    result = result.replace(new RegExp(`\\{${variable}\\}`, 'g'), value)
  })
  
  finalPrompt.value = result
  
  // 如果是批量章节生成，打印调试信息
  if (selectedPromptCategory.value === 'outline' && showAIBatchChapterDialog.value) {
    console.log('generateFinalPrompt - 批量章节生成:', {
      提示词标题: selectedPrompt.value.title,
      已有章节变量值: promptVariables.value['已有章节'] ? promptVariables.value['已有章节'].substring(0, 300) + '...' : '未设置',
      最终提示词包含已有章节: result.includes('已有章节'),
      最终提示词包含章节标题关键词: result.includes('第') && result.includes('章'),
      所有变量: Object.keys(promptVariables.value)
    })
  }
}

// 监听变量变化
watch(promptVariables, () => {
  generateFinalPrompt()
}, { deep: true })

// 监听生成配置变化，自动更新提示词变量
watch(generateConfig, () => {
  if (selectedPrompt.value && showChapterGenerateDialog.value) {
    // 重新填充配置相关的变量
    promptVariables.value['目标字数'] = generateConfig.value.wordCount.toString()
    promptVariables.value['写作视角'] = getViewpointDescription(generateConfig.value.style)
    promptVariables.value['重点内容'] = generateConfig.value.focus || '按大纲发展'
    
    // 如果有目标章节，检查是否需要自动选择前文章节
    if (targetChapter.value && selectedContextChapters.value.length === 0) {
      autoSelectRecentTwoChapters()
    }
    
    // 重新生成最终提示词
    generateFinalPrompt()
  }
}, { deep: true })

// 监听选中素材变化，自动更新提示词变量
watch(selectedMaterials, () => {
  if (selectedPrompt.value && showChapterGenerateDialog.value) {
    // 重新填充素材相关的变量
    
    // 填充人物信息
    if (selectedMaterials.value.characters.length > 0) {
      const characterInfo = selectedMaterials.value.characters.map(char => 
        `${char.name}（${char.role}）：${char.personality || '暂无描述'}`
      ).join('\n')
      promptVariables.value['主要人物'] = characterInfo
    } else {
      // 如果没有选中人物，清空人物信息
      if (promptVariables.value['主要人物']) {
        promptVariables.value['主要人物'] = ''
      }
    }
    
    // 填充世界观信息
    if (selectedMaterials.value.worldSettings.length > 0) {
      const worldInfo = selectedMaterials.value.worldSettings.map(setting => 
        `${setting.title}：${setting.description || '暂无描述'}`
      ).join('\n')
      promptVariables.value['世界观设定'] = worldInfo
    } else {
      // 如果没有选中世界观，清空世界观信息
      if (promptVariables.value['世界观设定']) {
        promptVariables.value['世界观设定'] = ''
      }
    }
    
    // 填充语料库信息
    if (selectedMaterials.value.corpus.length > 0) {
      const corpusInfo = selectedMaterials.value.corpus.map(item => 
        `【${item.title}】${item.content}`
      ).join('\n\n')
      promptVariables.value['参考语料'] = corpusInfo
    } else {
      // 如果没有选中语料库，清空语料库信息
      if (promptVariables.value['参考语料']) {
        promptVariables.value['参考语料'] = ''
      }
    }
    
    // 填充选中的章节内容
    if (selectedMaterials.value.chapters.length > 0) {
      const chaptersInfo = selectedMaterials.value.chapters.map(ch => {
        const chapterIndex = getChapterIndex(ch)
        let chapterInfo = `第${chapterIndex}章《${ch.title}》\n`
        
        if (ch.description) {
          chapterInfo += `章节大纲：${ch.description}\n`
        }
        
        if (ch.content && ch.content.trim()) {
          // 取章节内容的前500字作为参考，清理HTML标签
          const contentPreview = cleanHtmlForPreview(ch.content, 500)
          chapterInfo += `章节内容：${contentPreview}${ch.content.length > 500 ? '...' : ''}`
        }
        
        return chapterInfo
      }).join('\n\n')
      
      promptVariables.value['前文概要'] = chaptersInfo
    } else {
      // 如果没有选中章节，清空前文概要
      if (promptVariables.value['前文概要']) {
        promptVariables.value['前文概要'] = ''
      }
    }
    
    // 重新生成最终提示词
    generateFinalPrompt()
  }
}, { deep: true })

// 获取分类名称
const getCategoryName = () => {
  const categoryNames = {
    outline: '章节大纲',
    content: '基础正文',
    'content-dialogue': '对话生成',
    'content-scene': '场景描写',
    'content-action': '动作情节',
    'content-psychology': '心理描写',
    polish: '文本优化',
    continue: '智能续写',
    character: '人物生成',
    worldview: '世界观生成'
  }
  return categoryNames[selectedPromptCategory.value] || '提示词'
}

// 重置提示词对话框
const resetPromptDialog = () => {
  selectedPrompt.value = null
  promptVariables.value = {}
  finalPrompt.value = ''
}

// 复制提示词到剪贴板
const copyPromptToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(finalPrompt.value)
    ElMessage.success('提示词已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败')
  }
}

// 跳转到提示词库
const goToPromptLibrary = () => {
  router.push('/prompts')
}

// 使用选中的提示词
const useSelectedPrompt = () => {
  if (!selectedPrompt.value || !finalPrompt.value) {
    ElMessage.warning('请选择提示词并填充变量')
    return
  }

  // 判断当前是什么类型的提示词选择
  if (selectedPromptCategory.value === 'character' && showBatchGenerateCharacterDialog.value) {
    // 批量生成角色提示词
    batchCharacterSelectedPrompt.value = selectedPrompt.value
    batchCharacterPromptVariables.value = { ...promptVariables.value }
    batchCharacterFinalPrompt.value = finalPrompt.value
    showPromptDialog.value = false
    ElMessage.success('已选择批量生成角色提示词')
    return
  }
  
  if (selectedPromptCategory.value === 'worldview' && showWorldGenerateDialog.value) {
    // 世界观生成提示词
    worldSettingSelectedPrompt.value = selectedPrompt.value
    worldSettingPromptVariables.value = { ...promptVariables.value }
    worldSettingFinalPrompt.value = finalPrompt.value
    showPromptDialog.value = false
    ElMessage.success('已选择世界观生成提示词')
    return
  }
  
  // 判断是否是单章生成
  if (selectedPromptCategory.value === 'outline' && showAISingleChapterDialog.value) {
    // 单章生成提示词 - 保存提示词信息，不立即生成
    autoFillSingleChapterVariables()
    
    setTimeout(() => {
      generateFinalPrompt()
      
      singleChapterSelectedPrompt.value = selectedPrompt.value
      singleChapterPromptVariables.value = { ...promptVariables.value }
      singleChapterFinalPrompt.value = finalPrompt.value
      
      console.log('保存单章提示词信息:', {
        提示词标题: selectedPrompt.value.title,
        章节标题: aiSingleChapterForm.value.title,
        情节要求: aiSingleChapterForm.value.plotRequirement,
        最终提示词长度: finalPrompt.value.length
      })
      
      showPromptDialog.value = false
      ElMessage.success('已选择单章生成提示词，请点击"生成章节"按钮开始生成')
    }, 100)
    
    return
  }

  // 判断是否是批量章节生成
  if (selectedPromptCategory.value === 'outline' && showAIBatchChapterDialog.value) {
    // 批量章节生成提示词 - 确保包含最新的前5章信息
    console.log('确认批量章节提示词，重新填充变量确保包含前5章信息')
    
    // 重新填充变量确保包含最新的前5章信息
    autoFillBatchChapterVariables()
    
    // 等一下确保变量填充完成
    setTimeout(() => {
      // 重新生成最终提示词
      generateFinalPrompt()
      
      // 保存提示词信息
      batchChapterSelectedPrompt.value = selectedPrompt.value
      batchChapterPromptVariables.value = { ...promptVariables.value }
      batchChapterFinalPrompt.value = finalPrompt.value
      
      console.log('保存批量章节提示词信息:', {
        提示词标题: selectedPrompt.value.title,
        变量数量: Object.keys(promptVariables.value).length,
        已有章节变量: promptVariables.value['已有章节'] ? promptVariables.value['已有章节'].substring(0, 200) + '...' : '未找到',
        最终提示词长度: finalPrompt.value.length,
        最终提示词包含前5章信息: finalPrompt.value.includes('第') && finalPrompt.value.includes('章')
      })
      
      showPromptDialog.value = false
      ElMessage.success('已选择批量生成章节提示词，请点击"批量生成"按钮开始生成')
    }, 100)
    
    return
  }

  // 原有的生成操作
  switch (selectedPromptCategory.value) {
    case 'outline':
      generateChaptersWithPrompt(finalPrompt.value)
      break
    case 'content':
      generateContentWithPrompt(finalPrompt.value)
      break
    case 'polish':
      optimizeTextWithPrompt(finalPrompt.value)
      break
    case 'continue':
      continueWritingWithPrompt(finalPrompt.value)
      break
    case 'character':
      generateCharacterWithPrompt(finalPrompt.value)
      break
    case 'worldview':
      // 世界观提示词已在上面的特殊处理中处理
      ElMessage.success('世界观提示词已准备就绪')
      break
    default:
      ElMessage.warning('未知的提示词类型')
      return
  }

  showPromptDialog.value = false
  ElMessage.success('正在使用自定义提示词生成内容...')
}

// 打开章节生成对话框
const openChapterGenerateDialog = (chapter) => {
  targetChapter.value = chapter
  showChapterGenerateDialog.value = true
  
  // 重置选择的素材
  selectedMaterials.value = {
    characters: [],
    worldSettings: [],
    corpus: [],
    events: [],
    chapters: []
  }
  
  // 默认选中最近两章内容
  autoSelectRecentTwoChapters()
  
  // 重置生成配置
  generateConfig.value = {
    wordCount: 2000,
    style: 'third-person',
    focus: ''
  }
  
  // 重置提示词选择
  selectedPrompt.value = null
  promptVariables.value = {}
  finalPrompt.value = ''
}

// 自动填充变量
const autoFillVariables = () => {
  if (!selectedPrompt.value) return
  
  // 如果是批量章节生成，使用专门的填充函数
  if (showAIBatchChapterDialog.value) {
    autoFillBatchChapterVariables()
    return
  }
  
  // 正常章节生成需要目标章节
  if (!targetChapter.value) return
  
  // 自动填充基本信息
  promptVariables.value['小说标题'] = currentNovel.value?.title || '未命名小说'
  promptVariables.value['章节标题'] = targetChapter.value.title || ''
  promptVariables.value['章节大纲'] = targetChapter.value.description || '暂无大纲'
  promptVariables.value['目标字数'] = generateConfig.value.wordCount.toString()
  promptVariables.value['写作视角'] = getViewpointDescription(generateConfig.value.style)
  promptVariables.value['重点内容'] = generateConfig.value.focus || '按大纲发展'
  
  // 填充人物信息
  if (selectedMaterials.value.characters.length > 0) {
    const characterInfo = selectedMaterials.value.characters.map(char => 
      `${char.name}（${char.role}）：${char.personality || '暂无描述'}`
    ).join('\n')
    promptVariables.value['主要人物'] = characterInfo
  }
  
  // 填充世界观信息
  if (selectedMaterials.value.worldSettings.length > 0) {
    const worldInfo = selectedMaterials.value.worldSettings.map(setting => 
      `${setting.title}：${setting.description || '暂无描述'}`
    ).join('\n')
    promptVariables.value['世界观设定'] = worldInfo
  }
  
  // 填充语料库信息
  if (selectedMaterials.value.corpus.length > 0) {
    const corpusInfo = selectedMaterials.value.corpus.map(item => 
      `【${item.title}】${item.content}`
    ).join('\n\n')
    promptVariables.value['参考语料'] = corpusInfo
  }
  
  // 填充选中的章节内容（使用新的上下文章节选择）
  if (selectedContextChapters.value.length > 0) {
    // 使用用户选择的前文概要章节
    const contextChapters = selectedContextChapters.value.map(chapterId => {
      return chapters.value.find(ch => ch.id === chapterId)
    }).filter(Boolean)
    
    const contextInfo = contextChapters.map(ch => {
      const chapterIndex = getChapterIndex(ch)
      let chapterInfo = `第${chapterIndex}章《${ch.title}》\n`
      
      if (ch.description) {
        chapterInfo += `章节大纲：${ch.description}\n`
      }
      
      if (ch.content && ch.content.trim()) {
        // 取章节内容的前500字作为参考，清理HTML标签
        const contentPreview = cleanHtmlForPreview(ch.content, 500)
        chapterInfo += `章节内容：${contentPreview}${ch.content.length > 500 ? '...' : ''}`
      }
      
      return chapterInfo
    }).join('\n\n')
    
    promptVariables.value['前文概要'] = contextInfo
  } else if (targetChapter.value && selectedContextChapters.value.length === 0) {
    // 如果没有选择章节，自动选择最近两章
    autoSelectRecentTwoChapters()
  }
  
  generateFinalPrompt()
}

// 使用选中的提示词和素材生成
const _generateWithSelectedMaterials = async () => {
  if (!selectedPrompt.value || !finalPrompt.value) {
    ElMessage.warning('请选择提示词并确保变量已填充完整')
    return
  }
  
  if (!targetChapter.value) {
    ElMessage.warning('目标章节丢失，请重新选择')
    return
  }
  
  // 切换到目标章节
  const prompt = finalPrompt.value
  if (!(await selectChapter(targetChapter.value))) return
  
  // 关闭对话框
  showChapterGenerateDialog.value = false
  
  // 使用自定义提示词生成内容
  await generateContentWithPrompt(prompt)
}

// 切换素材选择
const toggleMaterial = (type, material) => {
  const materials = selectedMaterials.value[type]
  const index = materials.findIndex(item => item.id === material.id)
  
  if (index > -1) {
    // 已选中，取消选择
    materials.splice(index, 1)
  } else {
    // 未选中，添加选择
    materials.push(material)
  }
}

// 为章节选择提示词
const selectPromptForChapter = (prompt) => {
  selectedPrompt.value = prompt
  promptVariables.value = {}
  
  // 提取变量
  const matches = prompt.content.match(/\{([^}]+)\}/g)
  if (matches) {
    matches.forEach(match => {
      const variable = match.slice(1, -1)
      promptVariables.value[variable] = ''
    })
  }
  
  // 自动填充变量
  nextTick(() => {
    autoFillVariables()
  })
}



// 获取世界观设定标签类型
const getWorldSettingTagType = (category) => {
  const typeMap = {
    'setting': 'primary',
    'magic': 'danger',
    'politics': 'warning',
    'geography': 'success',
    'history': 'info'
  }
  return typeMap[category] || 'info'
}

// 获取世界观设定标签文本
const getWorldSettingTagText = (category) => {
  const textMap = {
    'setting': '世界设定',
    'magic': '魔法体系',
    'politics': '政治势力',
    'geography': '地理环境',
    'history': '历史背景'
  }
  return textMap[category] || category
}

// 获取语料库类型样式
const getCorpusType = (type) => {
  const typeMap = {
    'description': 'success',
    'dialogue': 'primary',
    'emotion': 'warning',
    'action': 'danger',
    'psychology': 'info'
  }
  return typeMap[type] || 'info'
}

// 语料分类：读取 + 兜底显示
const getCorpusCategory = (corpus) => {
  const category = (corpus.category || '').trim()
  return category || ''
}

// 语料分类筛选 + 关键词搜索
const corpusFilter = ref('')
const corpusSearch = ref('')
const corpusCategories = computed(() => {
  const categories = new Set()
  corpusData.value.forEach((corpus) => {
    const category = getCorpusCategory(corpus)
    if (category) categories.add(category)
  })
  return [...categories].sort()
})
const filteredCorpusData = computed(() => {
  const keyword = corpusSearch.value.trim().toLowerCase()
  return corpusData.value.filter((corpus) => {
    if (corpusFilter.value && getCorpusCategory(corpus) !== corpusFilter.value) return false
    if (keyword) {
      const haystack = `${corpus.title || ''}\n${corpus.content || ''}`.toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })
})

/** 按当前章节上下文推荐语料并合并选中（一键注入：推荐结果进入「参考语料」提示词变量） */
const recommendCorpusForContext = () => {
  const contextText = [
    currentNovel.value?.title || '',
    currentChapter.value?.title || '',
    currentChapter.value?.description || '',
    currentChapter.value?.content || '',
  ].join('\n')

  const recommendations = recommendCorpus(corpusData.value, contextText, { topK: 5 })
  if (recommendations.length === 0) {
    ElMessage.info('未找到与当前章节上下文重合的语料，可尝试手动选择或先完善章节大纲')
    return
  }

  const selectedIds = new Set(selectedMaterials.value.corpus.map(c => c.id))
  let added = 0
  recommendations.forEach((rec) => {
    if (!selectedIds.has(rec.item.id)) {
      selectedMaterials.value.corpus.push(rec.item)
      selectedIds.add(rec.item.id)
      added += 1
    }
  })

  // selectedMaterials 的深度 watch 会自动刷新「参考语料」提示词变量
  ElMessage.success(`已按上下文推荐 ${recommendations.length} 篇语料（新选中 ${added} 篇），可在「参考语料」变量中确认`)
}

// 获取语料库类型文本
const getCorpusTypeText = (type) => {
  const textMap = {
    'description': '场景描述',
    'dialogue': '对话模板',
    'emotion': '情感表达',
    'action': '动作描写',
    'psychology': '心理描写'
  }
  return textMap[type] || type
}

// 获取事件重要性样式
const getImportanceType = (importance) => {
  const typeMap = {
    'high': 'danger',
    'normal': 'primary',
    'low': 'info'
  }
  return typeMap[importance] || 'primary'
}

// 获取可选择的章节列表（排除当前正在生成的章节）
const availableChaptersForSelection = computed(() => {
  if (!chapters.value || !targetChapter.value) return []
  
  // 只返回当前目标章节之前的章节
  const targetIndex = chapters.value.findIndex(ch => ch.id === targetChapter.value.id)
  if (targetIndex <= 0) return []
  
  return chapters.value.slice(0, targetIndex).filter(ch => ch.content && ch.content.trim())
})

// 获取可用于前文概要的章节列表（所有有内容的章节，不限制当前章节）
const availableContextChapters = computed(() => {
  if (!chapters.value) return []
  
  return chapters.value.filter(ch => {
    // 只返回有内容的章节（可以是大纲或正文）
    return ch.description || (ch.content && ch.content.trim())
  }).map(ch => ({
    id: ch.id,
    title: ch.title,
    description: ch.description,
    content: ch.content,
    status: ch.status,
    wordCount: ch.wordCount || 0,
    chapterIndex: getChapterIndex(ch)
  }))
})

// 获取章节索引（第几章）
const getChapterIndex = (chapter) => {
  return chapters.value.findIndex(ch => ch.id === chapter.id) + 1
}

// 清理HTML标签并截取内容预览
const cleanHtmlForPreview = (htmlContent, maxLength = 80) => {
  if (!htmlContent) return ''
  
  // 去除HTML标签
  let cleanText = htmlContent.replace(/<[^>]*>/g, '')
  
  // 转换HTML实体
  cleanText = cleanText
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  
  // 去除多余的空白字符
  cleanText = cleanText.replace(/\s+/g, ' ').trim()
  
  // 截取指定长度
  return cleanText.length > maxLength ? cleanText.substring(0, maxLength) : cleanText
}

// 更新前文概要变量
const updateContextVariable = () => {
  if (selectedContextChapters.value.length > 0) {
    const contextChapters = selectedContextChapters.value.map(chapterId => {
      return chapters.value.find(ch => ch.id === chapterId)
    }).filter(Boolean)
    
    const contextInfo = contextChapters.map(ch => {
      const chapterIndex = getChapterIndex(ch)
      let chapterInfo = `第${chapterIndex}章《${ch.title}》\n`
      
      if (ch.description) {
        chapterInfo += `章节大纲：${ch.description}\n`
      }
      
      if (ch.content && ch.content.trim()) {
        // 取章节内容的前500字作为参考，清理HTML标签
        const contentPreview = cleanHtmlForPreview(ch.content, 500)
        chapterInfo += `章节内容：${contentPreview}${ch.content.length > 500 ? '...' : ''}`
      }
      
      return chapterInfo
    }).join('\n\n')
    
    promptVariables.value['前文概要'] = contextInfo
  } else {
    promptVariables.value['前文概要'] = ''
  }
  
  generateFinalPrompt()
}

// 自动选择最近两章内容
const autoSelectRecentTwoChapters = () => {
  if (!targetChapter.value || !chapters.value.length) {
    selectedContextChapters.value = []
    return
  }
  
  const targetIndex = chapters.value.findIndex(ch => ch.id === targetChapter.value.id)
  if (targetIndex <= 0) {
    selectedContextChapters.value = []
    return
  }
  
  // 选择前面最近2章有内容的章节
  const previousChapters = takeLastItems(
    chapters.value.slice(0, targetIndex)
      .filter(ch => ch.description || (ch.content && ch.content.trim())),
    RECENT_CHAPTERS_FOR_CONTEXT,
  )
  
  selectedContextChapters.value = previousChapters.map(ch => ch.id)
  updateContextVariable()
}

// 清空前文概要选择
const clearContextSelection = () => {
  selectedContextChapters.value = []
  updateContextVariable()
  ElMessage.success('已清空前文概要选择')
}

// 切换上下文章节选择（双向同步）
const toggleContextChapter = (chapterId) => {
  const index = selectedContextChapters.value.indexOf(chapterId)
  
  if (index > -1) {
    // 已选中，取消选择
    selectedContextChapters.value.splice(index, 1)
  } else {
    // 未选中，添加选择
    selectedContextChapters.value.push(chapterId)
  }
  
  // 更新前文概要变量
  updateContextVariable()
}

// 选择所有上下文章节
const selectAllContextChapters = () => {
  selectedContextChapters.value = availableContextChapters.value.map(ch => ch.id)
  updateContextVariable()
  ElMessage.success(`已选择所有${availableContextChapters.value.length}个章节`)
}



// 显示批量生成对话框
const showBatchGenerateDialog = () => {
  cancelWriterDialog('characters')
  showBatchGenerateCharacterDialog.value = true
  // 重置配置
  batchGenerateConfig.value = {
    count: 5,
    includeMainCharacters: true,
    includeSupportingCharacters: true,
    includeMinorCharacters: true,
    customPrompt: '',
    autoAssignRoles: true
  }
  batchGenerateResults.value = []
  generatedCharacters.value = []
}

// 批量生成角色
const batchGenerateCharacters = async () => {
  if (!checkApiAndBalance()) return
  
  batchGenerateResults.value = []
  generatedCharacters.value = []
  streamingContent.value = ''

  streamingType.value = 'batchCharacters'
  
  const operation = beginWriterOperation(batchGenerating, 'characters')
  try {
    let finalPrompt = ''
    
    // 获取用户配置
    const characterTypes = []
    if (batchGenerateConfig.value.includeMainCharacters) characterTypes.push('主角')
    if (batchGenerateConfig.value.includeSupportingCharacters) characterTypes.push('配角')
    if (batchGenerateConfig.value.includeMinorCharacters) characterTypes.push('次要角色')
    
    // 如果选择了自定义提示词，融合用户配置
    if (batchCharacterSelectedPrompt.value && batchCharacterFinalPrompt.value) {
      finalPrompt = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
        const genreMap = {
          'fantasy': '玄幻小说',
          'urban': '都市言情',
          'historical': '历史架空',
          'martial': '武侠修仙',
          'science': '科幻未来',
          'romance': '现代言情',
          'mystery': '悬疑推理',
          'adventure': '冒险奇幻',
          'horror': '恐怖惊悚',
          'general': '通用小说'
        }
        return genreMap[currentNovel.value?.genre] || '通用小说'
      })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 角色生成要求 ===
${batchCharacterFinalPrompt.value}

=== 生成配置 ===
生成数量：${batchGenerateConfig.value.count}个角色
角色类型：${characterTypes.join('、')}

${batchGenerateConfig.value.customPrompt ? `额外要求：${batchGenerateConfig.value.customPrompt}` : ''}

请根据小说信息和以上提示词生成${batchGenerateConfig.value.count}个角色，角色类型应该包括：${characterTypes.join('、')}。确保角色设定符合小说的世界观和风格。`
    } else {
      // 使用默认提示词逻辑
      finalPrompt = `You are a professional character designer for Chinese fiction. All field values must be written in natural, idiomatic Simplified Chinese.

=== Novel info ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
        const genreMap = {
          'fantasy': '玄幻小说',
          'urban': '都市言情',
          'historical': '历史架空',
          'martial': '武侠修仙',
          'science': '科幻未来',
          'romance': '现代言情',
          'mystery': '悬疑推理',
          'adventure': '冒险奇幻',
          'horror': '恐怖惊悚',
          'general': '通用小说'
        }
        return genreMap[currentNovel.value?.genre] || '通用小说'
      })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== Task ===
Generate ${batchGenerateConfig.value.count} characters that fit this novel's genre, world and tone.

Cast design requirements:
- Characters complement each other: distinct names (no similar-sounding names), distinct roles, and at least one pair with built-in tension.
- Each character internally: concrete visualizable appearance, layered personality with a flaw that can generate drama, causal background (key formative event + current motivation), 3-4 separating tags.

=== 角色类型要求 ===
${characterTypes.join('、')}
${batchGenerateConfig.value.customPrompt ? `特殊要求：${batchGenerateConfig.value.customPrompt}` : ''}

开始生成：`
    }

    // 为批量角色生成添加强制格式后缀
    const formatSuffix = `

=== Output format — MANDATORY, machine-parsed (overrides anything above) ===
Output ONLY ${batchGenerateConfig.value.count} character blocks in exactly the format below, nothing else (no title, no preamble, no markdown). Keep the Chinese labels 角色/姓名/角色/性别/年龄/外貌/性格/背景/标签 exactly as shown; do NOT translate or rename them:

角色1：
姓名：[角色姓名]
角色：[主角/配角/反派/次要角色]
性别：[男/女/其他]
年龄：[数字]
外貌：[详细外貌描述]
性格：[性格特点描述]
背景：[背景故事]
标签：[标签1,标签2,标签3]

角色2：
姓名：[角色姓名]
角色：[主角/配角/反派/次要角色]
性别：[男/女/其他]
年龄：[数字]
外貌：[详细外貌描述]
性格：[性格特点描述]
背景：[背景故事]
标签：[标签1,标签2,标签3]

Continue the numbering up to 角色${batchGenerateConfig.value.count}. Every block must contain all 8 fields. 角色类型 must be chosen from: ${characterTypes.join('、')}. Tags must use half-width commas (,).`

    const finalPromptWithFormat = finalPrompt + formatSuffix
    
    console.log('=== 批量角色生成最终提示词 ===')
    console.log(finalPromptWithFormat)
    console.log('=== 提示词结束 ===')

    const aiResponse = await writerStream.generate(finalPromptWithFormat, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'character'
    }, (chunk, fullContent) => {
      // 实时更新流式内容
      streamingContent.value = fullContent
      
      // 实时解析角色
      parseGeneratedCharacters(fullContent)
      
      // 自动滚动到最新内容
      nextTick(() => {
        const streamElement = document.querySelector('.streaming-content')
        if (streamElement) {
          streamElement.scrollTop = streamElement.scrollHeight
        }
      })
    })
    
    // 最终解析
    parseGeneratedCharacters(aiResponse)
    
    ElMessage.success(`成功生成 ${generatedCharacters.value.length} 个角色`)
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('批量生成角色失败:', error)
    ElMessage.error(`批量生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      batchGenerating.value = false
    }
  }
}

// 测试角色解析功能
const _testCharacterParsing = () => {
  const testContent = `角色1：
姓名：张三
角色：主角
性别：男
年龄：25
外貌：身高一米八，黑发黑眼，面容俊朗
性格：勇敢果断，有些冲动，但心地善良
背景：出身贫寒农家，但意志坚定，立志成为英雄
标签：主角,勇敢,农家子弟

角色2：
姓名：李美娜
角色：配角
性别：女
年龄：22
外貌：身材娇小，长发飘逸，眼神清澈动人
性格：温柔善良，聪明机智，偶尔有些任性
背景：大家闺秀，从小接受良好教育，精通琴棋书画
标签：配角,温柔,才女`
  
  console.log('开始测试角色解析...')
  parseGeneratedCharacters(testContent)
  console.log('测试完成，解析结果:', generatedCharacters.value)
  
  if (generatedCharacters.value.length > 0) {
    ElMessage.success(`测试成功！解析出 ${generatedCharacters.value.length} 个角色`)
  } else {
    ElMessage.error('测试失败：没有解析出任何角色')
  }
}

// 解析生成的角色信息  
const parseGeneratedCharacters = (content) => {
  if (!content || !content.trim()) {
    generatedCharacters.value = []
    return
  }
  
  console.log('=== 开始解析角色信息 ===')
  console.log('角色原始内容:', content)
  console.log('内容长度:', content.length)
  console.log('内容前300字符:', content.substring(0, 300))
  
  // 通用的角色信息提取函数
  const extractCharacterInfo = (text) => {
    const character = {
      id: Date.now() + Math.random() * 1000,
      name: '',
      role: 'supporting',
      gender: 'male', 
      age: 25,
      appearance: '',
      personality: '',
      background: '',
      tags: [],
      avatar: '',
      createdAt: new Date(),
      generated: true
    }
    
    // 提取姓名 - 支持多种格式
    const namePatterns = [
      /(?:姓名|名字|角色名|name)\s*[：:]\s*([^\n\r]+)/i,
      /^([^\n\r：:]{1,10})\s*[：:]?\s*(?:是|为|作为)/,
      /^([^\n\r：:]{2,8})(?:\s|$)/,
    ]
    
    for (const pattern of namePatterns) {
      const match = text.match(pattern)
      if (match && match[1] && match[1].trim()) {
        character.name = match[1].trim()
        console.log('提取到姓名:', character.name)
        break
      }
    }
    
    // 提取角色类型
    const rolePatterns = [
      /(?:角色|职责|定位|类型)\s*[：:]\s*([^\n\r]+)/i,
      /(主角|配角|反派|次要角色|男主|女主|反面角色|支持角色)/i
    ]
    
    for (const pattern of rolePatterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        const roleText = match[1].trim()
        if (roleText.includes('主角') || roleText.includes('男主') || roleText.includes('女主')) {
          character.role = 'protagonist'
        } else if (roleText.includes('反派') || roleText.includes('反面')) {
          character.role = 'antagonist'
        } else if (roleText.includes('配角') || roleText.includes('支持')) {
          character.role = 'supporting'
        } else {
          character.role = 'minor'
        }
        console.log('提取到角色类型:', character.role)
        break
      }
    }
    
    // 提取性别
    const genderPatterns = [
      /(?:性别|gender)\s*[：:]\s*([^\n\r]+)/i,
      /(男性|女性|男|女|male|female)/i
    ]
    
    for (const pattern of genderPatterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        const genderText = match[1].trim().toLowerCase()
        if (genderText.includes('女') || genderText.includes('female')) {
          character.gender = 'female'
        } else if (genderText.includes('男') || genderText.includes('male')) {
          character.gender = 'male'
        } else {
          character.gender = 'other'
        }
        console.log('提取到性别:', character.gender)
        break
      }
    }
    
    // 提取年龄
    const agePatterns = [
      /(?:年龄|age)\s*[：:]\s*(\d+)/i,
      /(\d+)\s*(?:岁|years)/i,
      /年龄[约大概]*\s*(\d+)/i
    ]
    
    for (const pattern of agePatterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        const age = parseInt(match[1])
        if (!isNaN(age) && age > 0 && age < 200) {
          character.age = age
          console.log('提取到年龄:', character.age)
          break
        }
      }
    }
    
    // 提取外貌
    const appearancePatterns = [
      /(?:外貌|外观|长相|appearance)\s*[：:]\s*([^\n\r姓名角色性别年龄性格背景标签]+)/i,
      /外貌特征[：:]([^\n\r姓名角色性别年龄性格背景标签]+)/i,
      /长得([^\n\r姓名角色性别年龄性格背景标签]+)/i
    ]
    
    for (const pattern of appearancePatterns) {
      const match = text.match(pattern)
      if (match && match[1] && match[1].trim()) {
        character.appearance = match[1].trim()
        console.log('提取到外貌:', character.appearance.substring(0, 50))
        break
      }
    }
    
    // 提取性格
    const personalityPatterns = [
      /(?:性格|个性|personality)\s*[：:]\s*([^\n\r姓名角色性别年龄外貌背景标签]+)/i,
      /性格特点[：:]([^\n\r姓名角色性别年龄外貌背景标签]+)/i,
      /为人([^\n\r姓名角色性别年龄外貌背景标签]+)/i
    ]
    
    for (const pattern of personalityPatterns) {
      const match = text.match(pattern)
      if (match && match[1] && match[1].trim()) {
        character.personality = match[1].trim()
        console.log('提取到性格:', character.personality.substring(0, 50))
        break
      }
    }
    
    // 提取背景
    const backgroundPatterns = [
      /(?:背景|经历|身世|background)\s*[：:]\s*([^\n\r姓名角色性别年龄外貌性格标签]+)/i,
      /出身([^\n\r姓名角色性别年龄外貌性格标签]+)/i,
      /来自([^\n\r姓名角色性别年龄外貌性格标签]+)/i
    ]
    
    for (const pattern of backgroundPatterns) {
      const match = text.match(pattern)
      if (match && match[1] && match[1].trim()) {
        character.background = match[1].trim()
        console.log('提取到背景:', character.background.substring(0, 50))
        break
      }
    }
    
    // 提取标签
    const tagPatterns = [
      /(?:标签|tags?)\s*[：:]\s*([^\n\r]+)/i,
      /特征[：:]([^\n\r]+)/i
    ]
    
    for (const pattern of tagPatterns) {
      const match = text.match(pattern)
      if (match && match[1] && match[1].trim()) {
        character.tags = match[1].trim().split(/[,，\s]+/).map(tag => tag.trim()).filter(tag => tag)
        console.log('提取到标签:', character.tags)
        break
      }
    }
    
    return character
  }
  
  // 尝试不同的分割方式
  let characterBlocks = []
  
  // 方式1: 按角色编号分割 (角色1:, 角色2:, etc.)
  if (content.match(/角色\d+[：:]/)) {
    characterBlocks = content.split(/角色\d+[：:]/i).filter(block => block.trim())
    console.log('使用角色编号分割，得到', characterBlocks.length, '个块')
  }
  // 方式2: 按标题分割 (## 标题, # 标题)
  else if (content.match(/#{1,3}\s+/)) {
    characterBlocks = content.split(/#{1,3}\s+/).filter(block => block.trim())
    console.log('使用标题分割，得到', characterBlocks.length, '个块')
  }
  // 方式3: 按数字列表分割 (1., 2., etc.)
  else if (content.match(/^\d+\./m)) {
    characterBlocks = content.split(/^\d+\./m).filter(block => block.trim())
    console.log('使用数字列表分割，得到', characterBlocks.length, '个块')
  }
  // 方式4: 按姓名字段分割
  else if ((content.match(/姓名[：:]/g) || []).length > 1) {
    characterBlocks = content.split(/(?=姓名[：:])/).filter(block => block.trim())
    console.log('使用姓名字段分割，得到', characterBlocks.length, '个块')
  }
  // 方式5: 按空行分割
  else {
    characterBlocks = content.split(/\n\s*\n/).filter(block => block.trim())
    if (characterBlocks.length === 1) {
      // 如果只有一个块，尝试按其他方式分割
      characterBlocks = [content]
    }
    console.log('使用空行分割，得到', characterBlocks.length, '个块')
  }
  
  characterBlocks.forEach((block, i) => {
    console.log(`块${i}内容:`, block.substring(0, 100) + (block.length > 100 ? '...' : ''))
  })
  
  const parsed = []
  
  // 使用新的提取逻辑处理每个块
  characterBlocks.forEach((block, index) => {
    if (!block.trim()) return
    
    console.log(`=== 处理角色块 ${index} ===`)
    console.log('块内容:', block)
    
    const character = extractCharacterInfo(block)
    
    // 如果没有提取到姓名，尝试生成一个
    if (!character.name) {
      // 尝试从第一行提取可能的姓名
      const firstLine = block.split('\n')[0]?.trim()
      if (firstLine && firstLine.length < 20 && !firstLine.includes('：') && !firstLine.includes(':')) {
        character.name = firstLine.replace(/^[^\u4e00-\u9fa5a-zA-Z]*/, '').trim()
      }
      
      // 如果还是没有姓名，生成默认姓名
      if (!character.name) {
        character.name = `角色${index + 1}`
      }
    }
    
    // 为空字段提供智能默认值
    if (!character.appearance && (character.personality || character.background)) {
      character.appearance = '外貌特征待补充'
    }
    if (!character.personality && (character.appearance || character.background)) {
      character.personality = '性格特点待补充'
    }
    if (!character.background && (character.appearance || character.personality)) {
      character.background = '背景故事待补充'
    }
    if (character.tags.length === 0) {
      character.tags = [character.role === 'protagonist' ? '主角' : '配角']
    }
    
    console.log(`最终角色结果 ${index}:`, {
      name: character.name,
      role: character.role,
      gender: character.gender,
      age: character.age,
      appearance: character.appearance?.substring(0, 50) + '...',
      personality: character.personality?.substring(0, 50) + '...',
      background: character.background?.substring(0, 50) + '...',
      tags: character.tags
    })
    
    // 只要有姓名就添加
    if (character.name && character.name !== '角色') {
      parsed.push(character)
    }
  })
  
  console.log('角色最终解析结果数量:', parsed.length)
  generatedCharacters.value = parsed
}

// 确认添加生成的角色
const confirmAddGeneratedCharacters = async () => {
  const selectedCharacters = generatedCharacters.value.filter(char => char.selected !== false)
  
  if (selectedCharacters.length === 0) {
    ElMessage.warning('请选择要添加的角色')
    return
  }
  
  // 添加到角色列表
  const existingIds = new Set(characters.value.map(character => character.id))
  characters.value.push(...selectedCharacters.filter(character => !existingIds.has(character.id)))
  
  // 保存数据
  if (!(await saveNovelData())) return
  
  // 关闭对话框
  showBatchGenerateCharacterDialog.value = false
  
  ElMessage.success(`成功添加 ${selectedCharacters.length} 个角色`)
}

// 切换角色选择状态
const toggleCharacterSelection = (character) => {
  character.selected = character.selected !== false ? false : true
}

// 获取角色类型样式
const getRoleType = (role) => {
  const roleMap = {
    'protagonist': 'danger',
    'supporting': 'primary',
    'antagonist': 'warning',
    'minor': 'info'
  }
  return roleMap[role] || 'info'
}

// 获取角色类型文本
const getRoleText = (role) => {
  const roleMap = {
    'protagonist': '主角',
    'supporting': '配角',
    'antagonist': '反派',
    'minor': '次要角色'
  }
  return roleMap[role] || '配角'
}

// 获取性别文本
const getGenderText = (gender) => {
  const genderMap = {
    'male': '男',
    'female': '女',
    'other': '其他'
  }
  return genderMap[gender] || '男'
}

// 格式化流式内容显示
const formatStreamingContent = (content) => {
  if (!content) return ''
  
  // 将换行符转换为HTML换行
  let formatted = content.replace(/\n/g, '<br/>')
  
  // 高亮角色标题
  formatted = formatted.replace(/(角色\d+：)/g, '<strong style="color: var(--brand-500); font-size: 16px;">$1</strong>')
  
  // 高亮世界观设定标题
  formatted = formatted.replace(/(设定\d+：)/g, '<strong style="color: var(--brand-500); font-size: 16px;">$1</strong>')
  
  // 高亮字段标签（角色相关）
  formatted = formatted.replace(/(姓名|角色|性别|年龄|外貌|性格|背景|标签)：/g, '<strong style="color: var(--el-color-success);">$1：</strong>')
  
  // 高亮字段标签（世界观相关）
  formatted = formatted.replace(/(标题|类型|描述)：/g, '<strong style="color: var(--el-color-success);">$1：</strong>')
  
  return formatted
}

// 获取世界观设定类型样式
const getWorldSettingType = (type) => {
  const typeMap = {
    '地理环境': 'success',
    '文化社会': 'primary',
    '历史背景': 'warning',
    '魔法体系': 'danger',
    '科技水平': 'info',
    '其他': ''
  }
  return typeMap[type] || ''
}

// 显示世界观生成对话框
const openWorldGenerateDialog = () => {
  cancelWriterDialog('worlds')
  showWorldGenerateDialog.value = true
  // 重置配置
  worldGenerateConfig.value = {
    count: 3,
    includeGeography: true,
    includeCulture: true,
    includeHistory: true,
    includeMagic: false,
    includeTechnology: false,
    customPrompt: ''
  }
  generatedWorldSettings.value = []
}

// 将英文类型编码转换为中文
const getChineseGenre = (englishGenre) => {
  const genreMap = {
    'fantasy': '玄幻修仙',
    'urban': '都市现代',
    'scifi': '科幻未来', 
    'historical': '历史古代',
    'mystery': '悬疑推理',
    'wuxia': '武侠江湖',
    'western-fantasy': '西方奇幻',
    'apocalypse': '末世灾难',
    'romance': '言情小说',
    'military': '军事战争',
    'game': '游戏竞技',
    'business': '商战职场'
  }
  return genreMap[englishGenre] || '通用小说'
}



// AI生成世界观设定
const generateWorldSettings = async () => {
  if (!checkApiAndBalance()) return
  
  generatedWorldSettings.value = []
  streamingContent.value = ''

  streamingType.value = 'worldSettings'
  
  const operation = beginWriterOperation(worldGenerating, 'worlds')
  try {
    let finalPrompt = ''
    
    // 如果用户选择了自定义提示词，使用自定义提示词
    if (worldSettingSelectedPrompt.value && worldSettingFinalPrompt.value) {
      finalPrompt = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${getChineseGenre(currentNovel.value?.genre)}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 世界观生成要求 ===
${worldSettingFinalPrompt.value}

请根据小说信息和以上要求生成${worldGenerateConfig.value.count}个世界观设定，确保设定符合小说的整体风格和世界观。`
      console.log('使用自定义世界观提示词:', finalPrompt)
    } else {
      // 使用默认的生成逻辑
      const includeTypes = []
      if (worldGenerateConfig.value.includeGeography) includeTypes.push('地理环境')
      if (worldGenerateConfig.value.includeCulture) includeTypes.push('文化社会')
      if (worldGenerateConfig.value.includeHistory) includeTypes.push('历史背景')
      if (worldGenerateConfig.value.includeMagic) includeTypes.push('魔法体系')
      if (worldGenerateConfig.value.includeTechnology) includeTypes.push('科技水平')
      if (worldGenerateConfig.value.includePolitics) includeTypes.push('政治势力')
      if (worldGenerateConfig.value.includeReligion) includeTypes.push('宗教信仰')
      if (worldGenerateConfig.value.includeEconomy) includeTypes.push('经济贸易')
      if (worldGenerateConfig.value.includeRaces) includeTypes.push('种族设定')
      if (worldGenerateConfig.value.includeLanguage) includeTypes.push('语言文字')
      
      finalPrompt = `You are a professional worldbuilder for Chinese fiction. All field values must be written in natural, idiomatic Simplified Chinese.

=== Novel info ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${getChineseGenre(currentNovel.value?.genre)}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== Task ===
Generate ${worldGenerateConfig.value.count} worldbuilding settings that fit this novel's genre and tone.

=== 生成要求 ===
设定类型要求：${includeTypes.join('、')}
${worldGenerateConfig.value.customPrompt ? `特殊要求：${worldGenerateConfig.value.customPrompt}` : ''}

Quality requirements:
- Each setting contains concrete rules and consequences (who can do what, at what cost, enforced by whom) — not mood adjectives.
- Settings interlock: at least one explicit dependency or friction between them.
- Every setting hints at conflicts characters can run into.

=== Output format — MANDATORY, machine-parsed ===
Output ONLY setting blocks in exactly the format below, nothing else (no preamble, no markdown). Keep the Chinese labels 设定/标题/类型/描述 exactly as shown; do NOT translate or rename them. 类型 must be chosen from: 地理环境 / 文化社会 / 历史背景 / 魔法体系 / 科技水平 / 其他.

设定1：
标题：[设定标题]
类型：[设定类型]
描述：[详细描述：具体规则、运作方式、代价、影响]

设定2：
（同上格式）

Continue the numbering up to 设定${worldGenerateConfig.value.count}. Generate exactly ${worldGenerateConfig.value.count} blocks.`
      
      console.log('使用默认世界观提示词')
    }

    const aiResponse = await writerStream.generate(finalPrompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'worldview'
    }, (chunk, fullContent) => {
      // 实时更新流式内容
      streamingContent.value = fullContent
      
      // 实时解析世界观设定
      parseGeneratedWorldSettings(fullContent)
      
      // 自动滚动到最新内容
      nextTick(() => {
        const streamElement = document.querySelector('.streaming-content')
        if (streamElement) {
          streamElement.scrollTop = streamElement.scrollHeight
        }
      })
    })
    
    // 最终解析
    parseGeneratedWorldSettings(aiResponse)
    
    ElMessage.success(`成功生成 ${generatedWorldSettings.value.length} 个世界观设定`)
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成世界观设定失败:', error)
    ElMessage.error(`世界观生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      worldGenerating.value = false
    }
  }
}

// 解析生成的世界观设定
const parseGeneratedWorldSettings = (content) => {
  if (!content || !content.trim()) {
    generatedWorldSettings.value = []
    return
  }
  
  console.log('原始内容:', content)
  
  // 更灵活的分割方式，支持多种格式
  let settingBlocks = []
  
  // 尝试不同的分割模式
  if (content.includes('设定1：') || content.includes('设定2：')) {
    // 标准格式：设定1：、设定2：
    settingBlocks = content.split(/设定\d+[：:]/i).filter(block => block.trim())
  } else if (content.includes('## ') || content.includes('# ')) {
    // Markdown格式
    settingBlocks = content.split(/#{1,3}\s+/).filter(block => block.trim())
  } else if (content.includes('1.') || content.includes('2.')) {
    // 列表格式：1. 2. 3.
    settingBlocks = content.split(/\d+\./).filter(block => block.trim())
  } else if (content.includes('**') && content.includes('标题：')) {
    // 包含粗体标记的格式
    settingBlocks = content.split(/\*\*[^*]+\*\*/).filter(block => block.trim())
  } else {
    // 如果没有明确分割符，尝试按连续的"标题："分割
    if (content.split('标题：').length > 2) {
      settingBlocks = content.split('标题：').filter(block => block.trim())
      // 为每个块添加回标题标识符（除了第一个空块）
      settingBlocks = settingBlocks.map((block, index) => {
        if (index === 0 && !block.includes('标题：')) return null // 第一个通常是空的
        return block.includes('标题：') ? block : ('标题：' + block)
      }).filter(block => block !== null)
    } else {
      // 按双换行分割
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim())
      if (paragraphs.length > 1) {
        settingBlocks = paragraphs
      } else {
        // 单个大段落
        settingBlocks = [content]
      }
    }
  }
  
  console.log('分割后的块数:', settingBlocks.length)
  
  const parsed = []
  
  settingBlocks.forEach((block, index) => {
    if (!block.trim()) return
    
    console.log(`处理块 ${index}:`, block.substring(0, 100))
    
    const lines = block.split('\n').map(line => line.trim()).filter(line => line)
    const setting = {
      id: Date.now() + index * 1000,
      title: '',
      type: '其他',
      description: '',
      createdAt: new Date(),
      generated: true
    }
    
    let isInDescription = false
    let descriptionParts = []
    
    lines.forEach((line, lineIndex) => {
      if (line.startsWith('标题：') || line.startsWith('标题:')) {
        setting.title = line.replace(/标题[：:]/, '').trim()
        isInDescription = false
      } else if (line.startsWith('类型：') || line.startsWith('类型:')) {
        setting.type = line.replace(/类型[：:]/, '').trim()
        isInDescription = false
      } else if (line.startsWith('描述：') || line.startsWith('描述:')) {
        // 描述行可能包含内容
        const descriptionContent = line.replace(/描述[：:]/, '').trim()
        if (descriptionContent) {
          descriptionParts = [descriptionContent]
        } else {
          descriptionParts = []
        }
        isInDescription = true
      } else if (isInDescription && line && !line.match(/^(标题|类型|描述)[：:]/)) {
        // 描述的续行（不是其他字段的开始）
        descriptionParts.push(line)
      } else if (!setting.title && lineIndex === 0) {
        // 如果第一行没有"标题："前缀，直接作为标题
        setting.title = line.replace(/^[^\u4e00-\u9fa5a-zA-Z]*/, '').trim()
      } else if (!isInDescription && line && !line.match(/^(标题|类型|描述)[：:]/)) {
        // 如果还没有开始描述部分，且不是特定字段，将其作为描述
        descriptionParts.push(line)
        isInDescription = true
      }
    })
    
    // 组合描述内容
    if (descriptionParts.length > 0) {
      setting.description = descriptionParts.join('\n').trim()
    }
    
    // 如果仍然没有标题，尝试从内容中智能提取
    if (!setting.title) {
      if (setting.description && setting.description.length > 0) {
        const firstLine = setting.description.split('\n')[0]
        if (firstLine.length <= 50) {
          setting.title = firstLine
          setting.description = setting.description.split('\n').slice(1).join('\n').trim()
        } else {
          // 尝试从第一句话中提取关键词作为标题
          const firstSentence = firstLine.split(/[。！？.!?]/)[0]
          if (firstSentence.length <= 30) {
            setting.title = firstSentence
          } else {
            setting.title = `世界观设定${index + 1}`
          }
        }
      } else {
        setting.title = `世界观设定${index + 1}`
      }
    }
    
    // 如果解析失败，尝试将整个块作为一个设定处理
    if (!setting.title && !setting.description) {
      // 将整个块作为描述，从中提取标题
      const blockText = block.trim()
      if (blockText.length > 0) {
        const firstLine = blockText.split('\n')[0].trim()
        if (firstLine.length <= 50 && firstLine.length > 0) {
          setting.title = firstLine
          setting.description = blockText.split('\n').slice(1).join('\n').trim() || '详细设定内容'
        } else {
          setting.title = `世界观设定${index + 1}`
          setting.description = blockText
        }
      }
    }
    
    // 确保有描述内容
    if (!setting.description || setting.description.trim() === '') {
      setting.description = '暂无描述'
    }
    
    console.log(`解析结果 ${index}:`, {
      title: setting.title,
      type: setting.type,
      description: setting.description.substring(0, 100) + (setting.description.length > 100 ? '...' : '')
    })
    
    // 只要有标题就添加设定
    if (setting.title && setting.title.trim() !== '') {
      parsed.push(setting)
    }
  })
  
  // 如果没有解析到任何设定，但有内容，创建一个默认设定
  if (parsed.length === 0 && content.trim().length > 0) {
    const lines = content.trim().split('\n').filter(line => line.trim())
    if (lines.length > 0) {
      const defaultSetting = {
        id: Date.now(),
        title: lines[0].length <= 50 ? lines[0] : '世界观设定',
        type: '其他',
        description: lines.length > 1 ? lines.slice(1).join('\n') : lines[0],
        createdAt: new Date(),
        generated: true
             }
       parsed.push(defaultSetting)
       console.log('创建默认设定:', defaultSetting)
     }
   }
    
    console.log('最终解析结果数量:', parsed.length)
  generatedWorldSettings.value = parsed
}

// 确认添加生成的世界观设定
const confirmAddGeneratedWorldSettings = async () => {
  const selectedSettings = generatedWorldSettings.value.filter(setting => setting.selected !== false)
  
  if (selectedSettings.length === 0) {
    ElMessage.warning('请选择要添加的世界观设定')
    return
  }
  
  // 添加到世界观设定列表（使用store）
  selectedSettings.forEach(setting => {
    if (!worldSettings.value.some(existing => existing.id === setting.id)) novelStore.addWorldSetting(setting)
  })
  
  // 保存数据
  if (!(await saveNovelData())) return
  
  // 关闭对话框
  showWorldGenerateDialog.value = false
  
  ElMessage.success(`成功添加 ${selectedSettings.length} 个世界观设定`)
}

// 切换世界观设定选择状态
const toggleWorldSettingSelection = (setting) => {
  setting.selected = setting.selected !== false ? false : true
}

// AI生成单个世界观设定描述
const generateWorldSettingAI = async () => {
  if (!checkApiAndBalance()) return
  
  if (!worldForm.value.title?.trim()) {
    ElMessage.warning('请先输入设定标题')
    return
  }
  
  streamingContent.value = ''

  streamingType.value = 'worldSetting'
  
  // 清空描述字段，准备接收生成内容
  worldForm.value.description = ''
  
  const operation = beginWriterOperation(isGeneratingWorldSetting, 'world')
  try {
    const categoryText = {
      'setting': '世界设定',
      'magic': '魔法体系', 
      'politics': '政治势力',
      'geography': '地理环境',
      'history': '历史背景'
    }[worldForm.value.category] || '世界设定'
    
    const prompt = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 世界观设定生成任务 ===
请为上述小说生成世界观设定的详细描述。

=== 设定信息 ===
- 设定标题：${worldForm.value.title}
- 设定类别：${categoryText}

=== 生成要求 ===
请生成详细的设定描述，包括：
1. 具体的设定内容和规则
2. 在小说世界中的作用和意义
3. 与其他设定的关联性
4. 对故事情节的影响

要求描述详细、生动，符合小说的类型、风格和整体世界观。`

    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'worldview'
    }, (chunk, fullContent) => {
      // 实时更新流式内容
      streamingContent.value = fullContent
      
      // 实时更新表单字段
      worldForm.value.description = fullContent
    })
    
    // 最终更新
    worldForm.value.description = aiResponse
    
    ElMessage.success('AI世界观设定生成完成')
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成世界观设定失败:', error)
    ElMessage.error(`设定生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingWorldSetting.value = false
    }
  }
}

// 使用自定义提示词生成章节
const generateChaptersWithPrompt = async (customPrompt) => {
  if (!checkApiAndBalance()) return
  

  streamingType.value = 'chapter'
  streamingContent.value = ''
  
  const operation = beginWriterOperation(isGeneratingChapters, '')
  try {
    console.log('使用自定义提示词生成章节:', customPrompt)
    
    // 在自定义提示词前添加小说基本信息
    const promptWithNovelInfo = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 章节生成要求 ===
${customPrompt}

请确保生成的章节符合小说的整体风格、类型和世界观设定。`
    
    const aiResponse = await writerStream.generate(promptWithNovelInfo, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'outline'
    }, (chunk, fullContent) => {
      streamingContent.value = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 解析AI响应，提取章节信息
    const newChapters = parseChapterResponse(aiResponse)
    
    newChapters.forEach((chapterData, index) => {
      const newChapter = {
        id: Date.now() + index,
        title: chapterData.title || `AI生成章节 ${chapters.value.length + index + 1}`,
        description: chapterData.description || chapterData.outline || '暂无描述',
        content: '',
        wordCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'draft'
      }
      chapters.value.push(newChapter)
    })
    
    if (!(await saveNovelData())) return
    if (operation !== writerOperation) return

    ElMessage.success(`成功生成${newChapters.length}个章节大纲`)
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成章节失败:', error)
    ElMessage.error(`章节生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingChapters.value = false
    }
  }
}

// 使用自定义提示词生成正文
const generateContentWithPrompt = async (customPrompt) => {
  if (!checkApiAndBalance()) return
  
  if (!currentChapter.value) {
    ElMessage.warning('请先选择一个章节')
    return
  }
  

  streamingType.value = 'content'
  streamingContent.value = ''
  streamingChapter.value = currentChapter.value
  
  const operation = beginWriterOperation(isGeneratingContent, '')
  try {
    console.log('使用自定义提示词生成正文:', customPrompt)
    
    // 构建完整的生成上下文，确保故事一致性和连贯性
    // 从generateConfig获取当前配置（这些是用户在弹窗中设置的最新配置）
    const currentConfig = generateConfig.value
    
    // 构建完整的提示词，包含小说信息、配置和自定义提示词
    let promptWithNovelInfo = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 当前章节信息 ===
章节标题：${currentChapter.value.title}
章节大纲：${currentChapter.value.description || '暂无大纲'}

=== 生成配置（用户最新设置） ===
目标字数：约${currentConfig.wordCount}字
写作视角：${getViewpointDescription(currentConfig.style)}
重点内容：${currentConfig.focus || '按大纲发展'}

`

    // 添加人物信息（如果用户选择了人物素材）
    if (selectedMaterials.value.characters.length > 0) {
      const charactersToUse = selectedMaterials.value.characters
      promptWithNovelInfo += `=== 主要人物设定 ===
${charactersToUse.map(char => 
  `- ${char.name}（${char.role}）：${char.personality || '暂无描述'}`
).join('\n')}

`
    }

    // 添加世界观信息（如果用户选择了世界观素材）
    if (selectedMaterials.value.worldSettings.length > 0) {
      const worldSettingsToUse = selectedMaterials.value.worldSettings
      promptWithNovelInfo += `=== 世界观设定 ===
${worldSettingsToUse.map(setting => 
  `- ${setting.title}：${setting.description || '暂无描述'}`
).join('\n')}

`
    }

    // 添加语料库信息（如果用户选择了语料库素材）
    if (selectedMaterials.value.corpus.length > 0) {
      promptWithNovelInfo += `=== 参考语料 ===
${selectedMaterials.value.corpus.map(item => 
  `【${item.title}】${item.content}`
).join('\n\n')}

`
    }

    // 添加事件线信息（如果用户选择了事件素材）
    if (selectedMaterials.value.events.length > 0) {
      const eventsToUse = selectedMaterials.value.events
      promptWithNovelInfo += `=== 相关事件线 ===
${eventsToUse.map(event => 
  `- 第${event.chapter}章：${event.title} - ${event.description || '暂无描述'}${getEventCharacterNames(event).length > 0 ? `（参与角色：${getEventCharacterNames(event).join('、')}）` : ''}`
).join('\n')}

【事件线要求】本章内容需要考虑以上事件的影响和发展，确保情节的连贯性和合理性。

`
    }

    // 添加前文上下文（优先使用用户选择的上下文章节）
    let selectedChapters = []
    
    // 如果用户在对话框中选择了特定的上下文章节，使用这些章节
    if (selectedContextChapters.value && selectedContextChapters.value.length > 0) {
      selectedChapters = selectedContextChapters.value.map(chapterId => {
        return chapters.value.find(ch => ch.id === chapterId)
      }).filter(Boolean)
         }
    
    if (selectedChapters.length > 0) {
      // 显示使用的上下文章节信息
      const chapterNames = selectedChapters.map(ch => {
        const chapterIndex = chapters.value.findIndex(c => c.id === ch.id) + 1
        return `第${chapterIndex}章：${ch.title}`
      }).join('、')
      
      console.log(`正在使用以下章节作为上下文参考：${chapterNames}`)
      ElMessage.info({
        message: `使用上下文：${chapterNames}`,
        duration: 3000
      })
      
      promptWithNovelInfo += `=== 前文概要（必须保持连贯） ===
${selectedChapters.map((ch) => {
  const chapterIndex = chapters.value.findIndex(c => c.id === ch.id) + 1
  return `第${chapterIndex}章《${ch.title}》：${ch.description || '暂无概要'}`
}).join('\n')}

=== 前文详细内容（保持文风和情节连贯） ===`

      // 获取选中章节的实际内容，特别是结尾部分
      selectedChapters.forEach((ch) => {
        const chapterIndex = chapters.value.findIndex(c => c.id === ch.id) + 1
        if (ch.description) {
          promptWithNovelInfo += `
【第${chapterIndex}章大纲】
${ch.description}
`
        }
        
        if (ch.content && ch.content.trim()) {
          // 提取章节内容的前500字和后500字作为参考
          const content = ch.content.replace(/<[^>]*>/g, '').trim() // 去除HTML标签
          
          if (content.length <= 1000) {
            // 如果内容不长，直接包含全部
            promptWithNovelInfo += `
【第${chapterIndex}章内容】
${content}
`
          } else {
            // 如果内容较长，取开头和结尾部分
            const startPart = trimTextFromStart(content, CHAPTER_EXCERPT_MAX_CHARS)
            const endPart = trimTextFromEnd(content, CHAPTER_EXCERPT_MAX_CHARS)
            promptWithNovelInfo += `
【第${chapterIndex}章开头部分】
${startPart}

【第${chapterIndex}章结尾部分】
${endPart}
`
          }
        }
      })

      promptWithNovelInfo += `
【重要】必须确保本章内容与选定的前文章节在以下方面保持连贯：
- 人物性格和行为逻辑一致
- 时间线和事件发展合理
- 情节推进自然流畅
- 世界观设定保持统一
- 文风和叙述风格保持一致
- 与前文情节自然衔接，特别是与最后章节的结尾部分

`
    }

    // 添加用户的自定义提示词作为核心生成要求
    promptWithNovelInfo += `=== 核心生成要求 ===
${customPrompt}

=== 写作要求（必须严格遵守） ===
1. 保持${getViewpointDescription(currentConfig.style)}的叙述方式
2. 字数控制在${currentConfig.wordCount}字左右
3. 重点突出：${currentConfig.focus || '按大纲推进剧情'}
4. 严格按照章节大纲发展情节，不得偏离主线剧情
5. 与前文内容保持逻辑连贯，人物行为符合已建立的性格
6. 世界观、人物设定、时间线必须与前文保持一致
7. 确保本章有明确的开始、发展、高潮、结尾

=== 质量标准 ===
1. 情节发展必须合理，不出现逻辑漏洞
2. 人物对话符合各自的性格特点
3. 环境描写与已建立的世界观一致
4. 节奏控制得当，张弛有度
5. 语言风格与整部小说保持统一

【警告】绝对不能：
- 偏离章节大纲的主要情节
- 改变已确定的人物性格
- 违背已建立的世界观设定
- 出现与前文矛盾的内容

请确保生成的正文符合小说的整体风格、类型和世界观设定，与章节大纲保持一致。`
    
    console.log('=== 发送给AI的完整提示词 ===')
    console.log('选中的上下文章节:', selectedChapters.map(ch => `第${chapters.value.findIndex(c => c.id === ch.id) + 1}章：${ch.title}`))
    console.log(promptWithNovelInfo)
    console.log('=== 提示词结束 ===')
    
    const aiResponse = await writerStream.generate(promptWithNovelInfo, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'generation'
    }, (chunk, fullContent) => {
      console.log('提示词生成流式回调:', chunk.length, '字符，总长度:', fullContent.length)
      
      // 更新流式显示内容（原始内容，用于流式显示）
      streamingContent.value = fullContent
      
      // 格式化内容用于编辑器
      const formattedContent = formatGeneratedContent(fullContent, currentChapter.value.title)
      
      if (streamingChapter.value?.id === currentChapter.value?.id) {
        content.value = formattedContent
        hasUnsavedChanges.value = true
      }
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    const formattedContent = formatGeneratedContent(aiResponse, currentChapter.value.title)
    content.value = formattedContent
    hasUnsavedChanges.value = true
    currentChapter.value.status = 'draft'
    
    if (!(await saveCurrentChapter())) return
    if (operation !== writerOperation) return

    ElMessage.success('正文生成成功')
    
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成正文失败:', error)
    ElMessage.error(`正文生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingContent.value = false
      streamingChapter.value = null
    }
  }
}

// 使用自定义提示词优化文本
const optimizeTextWithPrompt = async (customPrompt = null) => {
  if (!checkApiAndBalance()) return
  
  if (!currentChapter.value || !content.value) {
    ElMessage.warning('请先选择章节并添加内容')
    return
  }
  

  streamingType.value = 'optimize'
  streamingContent.value = ''
  streamingChapter.value = currentChapter.value
  
  const operation = beginWriterOperation(isOptimizing, '')
  try {
    let promptToUse = customPrompt
    
    // 如果没有提供自定义提示词，使用弹窗中的配置
    if (!customPrompt) {
      if (optimizeSelectedPrompt.value) {
        promptToUse = optimizeFinalPrompt.value
      } else {
        // 使用默认优化提示词
        promptToUse = getDefaultOptimizePrompt()
      }
    }
    
    // 在自定义提示词前添加小说基本信息
    const promptWithNovelInfo = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 当前章节信息 ===
章节标题：${currentChapter.value.title}
章节大纲：${currentChapter.value.description || '暂无大纲'}

=== 优化要求 ===
${promptToUse}

=== 原文内容 ===
${getCurrentTextForOptimization()}

请确保优化后的内容符合小说的整体风格、类型和世界观设定。`
    
    const optimizedContent = await writerStream.generate(promptWithNovelInfo, {
      maxTokens: null, // 移除token限制
      temperature: 0.7,
      type: 'optimize'
    }, (chunk, fullContent) => {
      console.log('优化流式回调:', chunk.length, '字符，总长度:', fullContent.length)
      streamingContent.value = fullContent
    })
    
    content.value = optimizedContent
    hasUnsavedChanges.value = true
    if (!(await saveCurrentChapter())) return
    if (operation !== writerOperation) return
    ElMessage.success('文本优化完成')
    showOptimizePromptDialog.value = false
    
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('文本优化失败:', error)
    ElMessage.error(`优化失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isOptimizing.value = false
    }
  }
}

// AI优化弹窗相关方法
const _openOptimizePromptDialog = () => {
  if (!currentChapter.value || !content.value) {
    ElMessage.warning('请先选择章节并添加内容')
    return
  }
  
  showOptimizePromptDialog.value = true
  refreshOptimizePrompts()
  generateOptimizeFinalPrompt()
}

const resetOptimizePromptDialog = () => {
  optimizeSelectedPrompt.value = null
  optimizePromptVariables.value = {}
  optimizeFinalPrompt.value = ''
}

const getOptimizePrompts = () => {
  const prompts = storageGet(StorageKeys.prompts, [])
  return prompts.filter(p => p.category === 'polish' || p.category === 'optimize')
}

const refreshOptimizePrompts = () => {
  // 刷新提示词列表，可以从本地存储重新加载
  const prompts = getOptimizePrompts()
  console.log('刷新优化提示词:', prompts.length)
}

const selectOptimizePrompt = (prompt) => {
  optimizeSelectedPrompt.value = prompt
  
  // 解析提示词中的变量
  const variables = {}
  const matches = prompt.content.match(/\{\{([^}]+)\}\}/g)
  if (matches) {
    matches.forEach(match => {
      const variable = match.replace(/\{\{|\}\}/g, '')
      variables[variable] = ''
    })
  }
  
  optimizePromptVariables.value = variables
  generateOptimizeFinalPrompt()
}

const autoFillOptimizeVariables = () => {
  if (!optimizeSelectedPrompt.value) return
  
  // 智能填充变量
  Object.keys(optimizePromptVariables.value).forEach(variable => {
    if (variable.includes('文本') || variable.includes('内容')) {
      optimizePromptVariables.value[variable] = getCurrentTextForOptimization().substring(0, 200) + '...'
    } else if (variable.includes('类型') || variable.includes('风格')) {
      optimizePromptVariables.value[variable] = currentNovel.value?.genre || '通用'
    } else if (variable.includes('章节') || variable.includes('标题')) {
      optimizePromptVariables.value[variable] = currentChapter.value?.title || ''
    }
  })
  
  generateOptimizeFinalPrompt()
}

const generateOptimizeFinalPrompt = () => {
  if (!optimizeSelectedPrompt.value) {
    optimizeFinalPrompt.value = getDefaultOptimizePrompt()
    return
  }
  
  let prompt = optimizeSelectedPrompt.value.content
  
  // 替换变量
  Object.keys(optimizePromptVariables.value).forEach(variable => {
    const value = optimizePromptVariables.value[variable] || `[${variable}]`
    prompt = prompt.replace(new RegExp(`\\{\\{${variable}\\}\\}`, 'g'), value)
  })
  
  optimizeFinalPrompt.value = prompt
}

const getCurrentTextForOptimization = () => {
  if (!content.value) return ''
  
  // 移除HTML标签，获取纯文本
  const textContent = content.value.replace(/<[^>]*>/g, '').trim()
  
  // 如果有选中的文本，优先使用选中的文本
  // 这里可以根据实际需求实现文本选择逻辑
  return textContent
}

const getCurrentTextLength = () => {
  const text = getCurrentTextForOptimization()
  return text.length
}

const selectAllText = () => {
  // 全选当前章节文本
  ElMessage.info('已选择全部文本')
}

const clearSelectedText = () => {
  // 清空选择
  ElMessage.info('已清空选择')
}

const useDefaultOptimizePrompt = () => {
  optimizeSelectedPrompt.value = null
  optimizePromptVariables.value = {}
  generateOptimizeFinalPrompt()
}

const getDefaultOptimizePrompt = () => {
  const instructions = getOptimizeInstructions(optimizeType.value)
  return `请对以下小说内容进行${getOptimizeTypeText()}。

优化要求：
${instructions}

请返回优化后的内容，保持原文的故事情节和人物性格不变。`
}

const createOptimizePrompt = () => {
  router.push('/prompts-library')
}

const copyOptimizePrompt = () => {
  if (optimizeFinalPrompt.value) {
    navigator.clipboard.writeText(optimizeFinalPrompt.value)
    ElMessage.success('提示词已复制到剪贴板')
  }
}

const editOptimizePrompt = () => {
  // 允许编辑最终提示词
  ElMessage.info('您可以直接在预览框中编辑提示词')
}

const previewOptimize = () => {
  if (!canOptimize()) return
  
  ElMessageBox.alert(
    `优化类型：${getOptimizeTypeText()}\n` +
    `文本长度：${getCurrentTextLength()} 字\n` +
    `预估费用：¥${(getCurrentTextLength() * 0.001).toFixed(3)}\n` +
    `使用提示词：${optimizeSelectedPrompt.value?.title || '默认提示词'}`,
    '优化预览',
    {
      confirmButtonText: '确定'
    }
  )
}

const canOptimize = () => {
  return getCurrentTextLength() > 0 && (optimizeSelectedPrompt.value || optimizeType.value)
}

const getOptimizeInfo = () => {
  const textLength = getCurrentTextLength()
  const estimatedCost = (textLength * 0.001).toFixed(3)
  return `文本${textLength}字，预估费用¥${estimatedCost}`
}

// 使用自定义提示词续写
const continueWritingWithPrompt = async (customPrompt) => {
  if (!checkApiAndBalance()) return
  
  if (!currentChapter.value) {
    ElMessage.warning('请先选择一个章节')
    return
  }
  
  if (!content.value || content.value.trim().length < 50) {
    ElMessage.warning('请先写一些内容，AI将基于现有内容进行续写')
    return
  }
  

  streamingType.value = 'continue'
  streamingContent.value = ''
  streamingChapter.value = currentChapter.value
  
  const originalContent = content.value
  
  const operation = beginWriterOperation(isGeneratingContent, '')
  try {
    console.log('使用自定义提示词续写:', customPrompt)
    
    // 构建完整的生成上下文
    const context = buildGenerationContext()
    const settings = aiContentForm.value
    
    // 在自定义提示词前添加完整的配置信息
    let promptWithNovelInfo = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 当前章节信息 ===
章节标题：${currentChapter.value.title}
章节大纲：${currentChapter.value.description || '暂无大纲'}

=== 生成配置 ===
生成类型：${getContentCategoryDescription(selectedContentCategory.value)}
写作视角：${getViewpointDescription(settings.style)}
重点内容：${settings.focus || '按大纲发展'}

`

    // 添加人物信息
    if (context.characters.length > 0 && settings.useCharacters) {
      promptWithNovelInfo += `=== 主要人物设定 ===
${context.characters.map(char => 
  `- ${char.name}（${char.role}）：${char.personality || '暂无描述'}`
).join('\n')}

`
    }

    // 添加世界观信息
    if (context.worldSettings.length > 0 && settings.useWorldview) {
      promptWithNovelInfo += `=== 世界观设定 ===
${context.worldSettings.map(setting => 
  `- ${setting.title}：${setting.description || '暂无描述'}`
).join('\n')}

`
    }

    promptWithNovelInfo += `=== 已有内容（必须保持连贯） ===
${originalContent}

=== 续写要求 ===
${customPrompt}

=== 核心约束（必须严格遵守） ===
1. 【连贯性】必须与已有内容在语言风格、情节发展、人物行为上完全连贯
2. 【一致性】人物性格、世界观设定、时间线必须与前文保持一致
3. 【逻辑性】情节发展必须符合逻辑，不能出现突兀的转折
4. 【主题控制】不得偏离章节大纲的主要情节线

=== 写作要求 ===
1. 基于已有内容的风格和语调继续创作
2. 保持${getViewpointDescription(settings.style)}的叙述方式
3. 保持情节的连贯性和逻辑性
4. 符合章节大纲的发展方向
5. 根据生成类型重点突出：${getContentCategoryGuidance(selectedContentCategory.value)}
6. 突出重点：${settings.focus || '按大纲推进剧情'}

=== 质量标准 ===
1. 续写内容与前文无缝衔接，读者感受不到断层
2. 人物对话和行为符合已建立的性格特点
3. 情节推进自然流畅，不出现逻辑跳跃
4. 语言风格与前文完全一致

【警告】绝对不能：
- 改变已有内容中人物的性格特点
- 违背已建立的情节设定
- 出现与前文矛盾的描述
- 偏离章节大纲的发展方向

请确保续写内容符合小说的整体风格、类型和世界观设定，与前文保持完美连贯性。`
    
    const aiResponse = await writerStream.generate(promptWithNovelInfo, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'continue'
    }, (chunk, fullContent) => {
      const formattedContent = formatGeneratedContent(fullContent, '')
      streamingContent.value = formattedContent
      
      if (streamingChapter.value?.id === currentChapter.value?.id) {
        content.value = originalContent + '\n' + formattedContent
        hasUnsavedChanges.value = true
      }
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    const formattedContent = formatGeneratedContent(aiResponse, '')
    content.value = originalContent + '\n' + formattedContent
    hasUnsavedChanges.value = true
    
    if (!(await saveCurrentChapter())) return
    if (operation !== writerOperation) return

    ElMessage.success('续写完成')
    
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI续写失败:', error)
    ElMessage.error(`续写失败: ${error.message}`)
    content.value = originalContent
  } finally {
    if (operation === writerOperation) {
      isGeneratingContent.value = false
      streamingChapter.value = null
    }
  }
}

// 使用自定义提示词生成人物
const generateCharacterWithPrompt = async (customPrompt) => {
  if (!checkApiAndBalance()) return
  
  if (!characterForm.value.name.trim()) {
    ElMessage.warning('请先输入角色姓名')
    return
  }
  
  streamingType.value = 'character'
  streamingContent.value = ''
  
  characterForm.value.appearance = ''
  characterForm.value.personality = ''
  characterForm.value.background = ''
  characterForm.value.tags = []
  
  const operation = beginWriterOperation(null, 'character')
  try {
    console.log('使用自定义提示词生成人物:', customPrompt)
    
    // 在自定义提示词前添加小说基本信息
    const promptWithNovelInfo = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 角色基本设定 ===
- 姓名：${characterForm.value.name}
- 角色定位：${characterForm.value.role === 'protagonist' ? '主角' : characterForm.value.role === 'antagonist' ? '反派' : '配角'}
- 性别：${characterForm.value.gender === 'male' ? '男' : characterForm.value.gender === 'female' ? '女' : '其他'}
- 年龄：${characterForm.value.age}岁

=== 角色生成要求 ===
${customPrompt}

请确保角色设定符合小说的世界观、类型和风格特点。`
    
    // 为自定义提示词角色生成添加强制格式后缀
    const customCharacterFormatSuffix = `

=== Output format — MANDATORY, machine-parsed (overrides anything above) ===
Output ONLY the following four lines, nothing else (no title, no preamble, no extra fields, no markdown). Keep the Chinese field labels 外貌/性格/背景/标签 exactly as shown; do NOT translate or rename them:

外貌：[详细外貌描述]
性格：[性格特点描述]
背景：[背景故事]
标签：[标签1,标签2,标签3]

All field values must be written in natural, idiomatic Simplified Chinese. Tags must use half-width commas (,).`

    const customPromptWithFormat = promptWithNovelInfo + customCharacterFormatSuffix
    
    console.log('=== 自定义提示词角色生成最终提示词 ===')
    console.log(customPromptWithFormat)
    console.log('=== 提示词结束 ===')

    const aiResponse = await writerStream.generate(customPromptWithFormat, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'character'
    }, (chunk, fullContent) => {
      streamingContent.value = fullContent
      
      // 实时解析并更新表单字段
      const lines = fullContent.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('外貌：')) {
          characterForm.value.appearance = trimmed.replace('外貌：', '').trim()
        } else if (trimmed.startsWith('性格：')) {
          characterForm.value.personality = trimmed.replace('性格：', '').trim()
        } else if (trimmed.startsWith('背景：')) {
          characterForm.value.background = trimmed.replace('背景：', '').trim()
        } else if (trimmed.startsWith('标签：')) {
          const tagString = trimmed.replace('标签：', '').trim()
          if (tagString) {
            characterForm.value.tags = tagString.split(',').map(tag => tag.trim()).filter(tag => tag)
          }
        }
      }
    })
    
    // 最终解析AI响应
    const lines = aiResponse.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('外貌：')) {
        characterForm.value.appearance = trimmed.replace('外貌：', '').trim()
      } else if (trimmed.startsWith('性格：')) {
        characterForm.value.personality = trimmed.replace('性格：', '').trim()
      } else if (trimmed.startsWith('背景：')) {
        characterForm.value.background = trimmed.replace('背景：', '').trim()
      } else if (trimmed.startsWith('标签：')) {
        const tagString = trimmed.replace('标签：', '').trim()
        characterForm.value.tags = tagString.split(',').map(tag => tag.trim()).filter(tag => tag)
      }
    }
    
    ElMessage.success('AI角色生成完成')
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成角色失败:', error)
    ElMessage.error(`角色生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
    }
  }
}

const generateChapterOutline = async () => {
  if (!checkApiAndBalance()) return
  
  const operation = beginWriterOperation(isGeneratingOutline, 'chapter')
  try {
    const chapterTitle = chapterForm.value.title || '新章节'
    const context = buildGenerationContext()
    
    const prompt = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 章节大纲生成任务 ===
请为上述小说的章节《${chapterTitle}》生成详细大纲。

章节标题：${chapterTitle}

${context.characters.length > 0 ? `主要人物：
${context.characters.map(char => `- ${char.name}（${char.role}）`).join('\n')}` : ''}

${context.worldSettings.length > 0 ? `世界观设定：
${context.worldSettings.map(setting => `- ${setting.title}`).join('\n')}` : ''}

已有章节：
${chapters.value.map((ch, idx) => `第${idx + 1}章：${ch.title} - ${ch.description || '暂无描述'}`).join('\n')}

=== 核心约束（必须严格遵守） ===
1. 【主题控制】大纲必须服务于小说的主线剧情，不得偏离主题
2. 【连贯性】与前文章节在情节、人物、世界观上保持完全连贯
3. 【逻辑性】情节发展必须符合逻辑，人物行为合理
4. 【完整性】确保章节有明确的目标和完整的结构

=== 大纲生成要求 ===
1. 生成该章节的详细内容大纲
2. 包含具体的情节发展和转折点
3. 标明重要的人物出场和互动
4. 设计关键的场景和冲突
5. 安排章节的起承转合
6. 明确章节在整体故事中的作用

=== 质量标准 ===
1. 大纲内容与小说主题高度契合
2. 情节发展自然流畅，无逻辑漏洞
3. 人物行为符合已建立的性格特点
4. 与前文章节形成有机整体

【警告】绝对不能：
- 偏离小说的主线剧情
- 违背已建立的世界观设定
- 出现与前文矛盾的情节
- 设计不符合人物性格的行为

请生成详细的章节大纲：`

    console.log('开始AI生成章节大纲:', prompt)
    
    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'outline'
    }, (chunk, fullContent) => {
      // 实时更新章节大纲
      chapterForm.value.description = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    ElMessage.success('章节大纲生成成功')
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成大纲失败:', error)
    ElMessage.error(`大纲生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingOutline.value = false
    }
  }
}

const generateFromOutline = () => {
  if (!currentChapter.value?.description) {
    ElMessage.warning('请先为章节添加大纲描述')
    return
  }
  // 打开AI正文生成弹窗，而不是直接调用生成函数
  openChapterGenerateDialog(currentChapter.value)
}

const _continueWriting = async () => {
  if (!checkApiAndBalance()) return
  
  if (!currentChapter.value) {
    ElMessage.warning('请先选择一个章节')
    return
  }
  
  if (!content.value || content.value.trim().length < 50) {
    ElMessage.warning('请先写一些内容，AI将基于现有内容进行续写')
    return
  }
  

  streamingType.value = 'continue'
  streamingContent.value = ''
  streamingChapter.value = currentChapter.value
  
  // 保存续写前的原始内容
  const originalContent = content.value
  
  const operation = beginWriterOperation(isGeneratingContent, '')
  try {
    const context = buildGenerationContext()
    const currentContent = content.value.replace(/<[^>]*>/g, '').trim() // 移除HTML标签
    
    const prompt = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 当前章节信息 ===
章节标题：${currentChapter.value.title}
章节大纲：${currentChapter.value.description || '暂无大纲'}

=== 续写任务 ===
请为上述小说的当前章节续写内容。

=== 已有内容（必须保持连贯） ===
${currentContent}

${context.characters.length > 0 ? `=== 主要人物设定 ===
${context.characters.map(char => `- ${char.name}：${char.personality || '暂无描述'}`).join('\n')}` : ''}

=== 核心约束（必须严格遵守） ===
1. 【连贯性】必须与已有内容在语言风格、情节发展、人物行为上完全连贯
2. 【一致性】人物性格、世界观设定、时间线必须与前文保持一致
3. 【逻辑性】情节发展必须符合逻辑，不能出现突兀的转折
4. 【主题控制】不得偏离章节大纲的主要情节线

=== 续写要求 ===
1. 基于已有内容的风格和语调继续创作
2. 保持情节的连贯性和逻辑性
3. 符合章节大纲的发展方向
4. 长度约500-800字
5. 根据生成类型重点突出：${getContentCategoryGuidance(selectedContentCategory.value)}
6. 推进剧情发展

=== 质量标准 ===
1. 续写内容与前文无缝衔接，读者感受不到断层
2. 人物对话和行为符合已建立的性格特点
3. 情节推进自然流畅，不出现逻辑跳跃
4. 语言风格与前文完全一致

【警告】绝对不能：
- 改变已有内容中人物的性格特点
- 违背已建立的情节设定
- 出现与前文矛盾的描述
- 偏离章节大纲的发展方向

请继续创作：`

    console.log('开始AI续写:', prompt.substring(0, 300) + '...')
    
    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'continue'
    }, (chunk, fullContent) => {
      console.log('续写流式回调:', chunk.length, '字符，总长度:', fullContent.length)
      
      // 更新流式显示内容（原始内容）
      streamingContent.value = fullContent
      
      // 格式化续写内容
      const formattedContent = formatGeneratedContent(fullContent, '')
      
      // 如果是当前章节，实时更新编辑器内容（追加续写内容）
      if (streamingChapter.value?.id === currentChapter.value?.id) {
        content.value = originalContent + '\n' + formattedContent
        hasUnsavedChanges.value = true
      }
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 格式化续写内容
    const formattedContent = formatGeneratedContent(aiResponse, '')
    
    content.value = originalContent + '\n' + formattedContent
    hasUnsavedChanges.value = true
    
    if (!(await saveCurrentChapter())) return
    if (operation !== writerOperation) return

    ElMessage.success('续写完成')
    
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI续写失败:', error)
    ElMessage.error(`续写失败: ${error.message}`)
    // 出错时恢复原始内容
    content.value = originalContent
  } finally {
    if (operation === writerOperation) {
      isGeneratingContent.value = false
      streamingChapter.value = null
    }
  }
}

const enhanceContent = () => {
  if (!checkApiAndBalance()) return
  
  // 获取编辑器选中的内容
  let selectedText = ''
  
  if (editorRef.value) {
    try {
      selectedText = editorRef.value.getSelectionText() || ''
    } catch (error) {
      console.warn('获取选择文本失败:', error)
      selectedText = ''
    }
  }

  resetOptimizeDialog()
  
  // 设置优化内容
  if (selectedText.trim()) {
    // 有选择内容，优化选择的内容
    optimizeForm.value.originalContent = selectedText.trim()
    optimizeForm.value.mode = 'selection'
    ElMessage.info('检测到选择内容，将优化选择的文本')
  } else {
    // 没有选择内容，优化整篇文章
    const fullText = content.value.replace(/<[^>]*>/g, '').trim() // 去除HTML标签
    if (!fullText) {
      ElMessage.warning('当前章节没有内容可以优化')
      return
    }
    optimizeForm.value.originalContent = fullText
    optimizeForm.value.mode = 'full'
    ElMessage.info('未检测到选择内容，将优化整篇文章')
  }
  
  // 显示新的优化对话框
  showNewOptimizeDialog.value = true
}

// 新润色对话框相关方法
const canStartOptimize = computed(() => {
  return optimizeForm.value.originalContent.trim() && 
         (optimizeForm.value.selectedPrompt || optimizeForm.value.customPrompt.trim())
})

// 为新润色对话框选择提示词
const selectNewOptimizePrompt = (prompt) => {
  optimizeForm.value.selectedPrompt = prompt
  console.log('选择润色提示词:', prompt.title)
}

// 新续写对话框相关方法
const canStartContinue = computed(() => {
  return content.value.trim().length >= 50 // 至少需要50字的内容才能续写
})

// 打开续写对话框
const openContinueDialog = () => {
  if (!checkApiAndBalance()) return
  
  if (!currentChapter.value) {
    ElMessage.warning('请先选择一个章节')
    return
  }
  
  if (!content.value || content.value.trim().length < 50) {
    ElMessage.warning('请先写一些内容，AI将基于现有内容进行续写')
    return
  }
  
  // 重置表单
  continueStream.reset()
  continueForm.value.direction = ''
  continueForm.value.wordCount = 500
  continueStreamingContent.value = ''
  
  showNewContinueDialog.value = true
}

// 获取当前内容全文
const getCurrentFullContent = () => {
  if (!content.value) return ''
  
  // 移除HTML标签，返回纯文本内容
  return content.value.replace(/<[^>]*>/g, '').trim()
}

// 重置续写对话框
const resetContinueDialog = () => {
  continueStream.dispose()
  continueForm.value.direction = ''
  continueForm.value.wordCount = 500
  continueStreamingContent.value = ''

}

// 开始新的续写
const startNewContinue = async () => {
  if (!canStartContinue.value) {
    ElMessage.warning('内容太少，无法进行续写')
    return
  }
  
  continueStreamingContent.value = ''
  
  try {
    const context = buildGenerationContext()
    const currentContent = content.value.replace(/<[^>]*>/g, '').trim()
    
    // 构建续写提示词
    let prompt = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 当前章节信息 ===
章节标题：${currentChapter.value.title}
章节大纲：${currentChapter.value.description || '暂无大纲'}

=== 续写任务 ===
请为上述小说的当前章节续写内容。

=== 已有内容（必须保持连贯） ===
${currentContent}

${context.characters.length > 0 ? `=== 主要人物设定 ===
${context.characters.map(char => `- ${char.name}：${char.personality || '暂无描述'}`).join('\n')}

` : ''}=== 续写要求 ===
1. 基于已有内容的风格和语调继续创作
2. 保持情节的连贯性和逻辑性
3. 符合章节大纲的发展方向
4. 续写长度约${continueForm.value.wordCount}字`

    // 如果有续写方向，添加到提示词中
    if (continueForm.value.direction.trim()) {
      prompt += `
5. 续写方向：${continueForm.value.direction.trim()}`
    }

    prompt += `

=== 核心约束（必须严格遵守） ===
1. 【连贯性】必须与已有内容在语言风格、情节发展、人物行为上完全连贯
2. 【一致性】人物性格、世界观设定、时间线必须与前文保持一致
3. 【逻辑性】情节发展必须符合逻辑，不能出现突兀的转折
4. 【主题控制】不得偏离章节大纲的主要情节线

请直接输出续写内容，无需额外说明：`

    console.log('开始新的AI续写:', prompt.substring(0, 200) + '...')
    
    // 流式调用AI续写
    const aiResponse = await continueStream.generate(prompt, {
      maxTokens: null,
      temperature: 0.8,
      type: 'continue'
    }, (chunk, fullContent) => {
      // 实时更新流式内容
      continueStreamingContent.value = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 设置最终续写结果
    continueStreamingContent.value = aiResponse.trim()
    ElMessage.success('续写完成')
    
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI续写失败:', error)
    ElMessage.error(`续写失败: ${error.message}`)
  }
}

// 停止续写流式输出
const stopContinueStreaming = () => continueStream.stop('已停止续写')

// 复制续写内容
const copyContinueContent = async () => {
  if (!continueStreamingContent.value) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  
  try {
    await navigator.clipboard.writeText(continueStreamingContent.value)
    ElMessage.success('续写内容已复制到剪贴板')
  } catch (error) {
    console.error('复制失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

// 追加续写内容到文章
const appendContinueContent = async () => {
  if (!continueStreamingContent.value) {
    ElMessage.warning('没有可追加的内容')
    return
  }
  
  // 格式化续写内容
  const formattedContent = formatGeneratedContent(continueStreamingContent.value, '')
  
  // 追加到当前内容
  content.value = content.value + '\n' + formattedContent
  hasUnsavedChanges.value = true
  
  if (!(await saveCurrentChapter())) return

  ElMessage.success('续写内容已追加到文章')
  showNewContinueDialog.value = false
}



const resetOptimizeDialog = () => {
  optimizeStream.dispose()
  optimizeForm.value.optimizedContent = ''
  optimizeForm.value.customPrompt = ''
  optimizeForm.value.selectedPrompt = null
  optimizeStreamingContent.value = ''

}

const startNewOptimize = async () => {
  if (!canStartOptimize.value) {
    ElMessage.warning('请选择润色类型或输入自定义要求')
    return
  }
  
  optimizeStreamingContent.value = ''
  optimizeForm.value.optimizedContent = ''
  
  try {
    // 构建优化提示词
    let promptContent = ''
    if (optimizeForm.value.selectedPrompt) {
      promptContent = optimizeForm.value.selectedPrompt.content
    } else if (optimizeForm.value.customPrompt.trim()) {
      promptContent = optimizeForm.value.customPrompt.trim()
    }
    
    const fullPrompt = `${promptContent}

原始内容：
${optimizeForm.value.originalContent}

请直接输出优化后的内容，无需额外说明：`

    console.log('开始新的AI优化:', fullPrompt.substring(0, 200) + '...')
    
    // 流式调用AI优化
    const aiResponse = await optimizeStream.generate(fullPrompt, {
      maxTokens: null,
      temperature: 0.7,
      type: 'optimize'
    }, (chunk, fullContent) => {
      // 实时更新流式内容
      optimizeStreamingContent.value = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 设置最终优化结果
    optimizeForm.value.optimizedContent = aiResponse.trim()
    ElMessage.success('内容润色完成')
    
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI润色失败:', error)
    ElMessage.error(`润色失败: ${error.message}`)
  }
}

const stopOptimizeStreaming = () => {
  optimizeForm.value.optimizedContent = optimizeStreamingContent.value
  optimizeStream.stop('已停止润色')
}



const copyOptimizedContent = async () => {
  if (!optimizeForm.value.optimizedContent) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  
  try {
    await navigator.clipboard.writeText(optimizeForm.value.optimizedContent)
    ElMessage.success('内容已复制到剪贴板')
  } catch (error) {
    console.error('复制失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

const replaceSelectedContent = async () => {
  if (!optimizeForm.value.optimizedContent) {
    ElMessage.warning('没有可替换的内容')
    return
  }
  
  try {
    if (editorRef.value && optimizeForm.value.mode === 'selection') {
      // 检查是否有选择的内容
      const selectedText = editorRef.value.getSelectionText()
      if (selectedText) {
        // 替换选中的内容
        editorRef.value.insertText(optimizeForm.value.optimizedContent)
        // Read the editor directly so saving does not depend on the next v-model tick.
        content.value = editorRef.value.getHtml()
        hasUnsavedChanges.value = true
        if (!(await saveCurrentChapter())) return
        ElMessage.success('选择内容已替换为润色结果')
        showNewOptimizeDialog.value = false
      } else {
        ElMessage.warning('未找到选择的内容，请重新选择要替换的文本')
      }
    } else {
      ElMessage.warning('当前不是选择模式或编辑器未就绪')
    }
  } catch (error) {
    console.error('替换失败:', error)
    ElMessage.error('替换失败')
  }
}

const replaceFullContent = () => {
  if (!optimizeForm.value.optimizedContent) {
    ElMessage.warning('没有可替换的内容')
    return
  }
  
  ElMessageBox.confirm(
    '确定要用润色后的内容替换整篇文章吗？此操作不可撤销。',
    '确认替换',
    {
      confirmButtonText: '确定替换',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(async () => {
    // 替换全文内容
    const formattedContent = formatGeneratedContent(optimizeForm.value.optimizedContent, currentChapter.value?.title || '')
    content.value = formattedContent
    hasUnsavedChanges.value = true
    
    if (!(await saveCurrentChapter())) return

    ElMessage.success('全文内容已替换为润色结果')
    showNewOptimizeDialog.value = false
  }).catch(() => {
    // 用户取消
  })
}

// 解析AI章节响应
// 章节解析策略已提取至 @/utils/chapterParser（parseChapterResponse）

// 获取模板描述
const getTemplateDescription = (template) => {
  const templates = {
    general: '通用章节模板，平衡叙述和对话',
    battle: '战斗场景模板，突出动作和紧张感',
    emotion: '情感戏模板，重点描写心理和情感',
    turning: '转折剧情模板，制造悬念和反转'
  }
  return templates[template] || '通用模板'
}

// 获取最近5章的详细信息
const getRecentChaptersDetail = () => {
  console.log('getRecentChaptersDetail 被调用，当前章节数量:', chapters.value.length)
  
  if (chapters.value.length === 0) {
    console.log('返回：暂无已有章节')
    return '暂无已有章节'
  }
  
  // 获取最近5章（或所有章节，如果不足5章）
  const recentCount = Math.min(5, chapters.value.length)
  const recentChapters = chapters.value.slice(-recentCount)
  
  console.log('最近章节数量:', recentCount, '章节详情:', recentChapters.map(ch => ({
    title: ch.title,
    description: ch.description,
    wordCount: ch.wordCount
  })))
  
  const result = recentChapters.map((ch, idx) => {
    const chapterIndex = chapters.value.length - recentCount + idx + 1
    let chapterInfo = `第${chapterIndex}章《${ch.title}》`
    
    if (ch.description && ch.description.trim()) {
      chapterInfo += `\n章节大纲：${ch.description}`
    } else {
      chapterInfo += `\n章节大纲：暂无大纲描述`
    }
    
    if (ch.wordCount && ch.wordCount > 0) {
      chapterInfo += `\n字数：${ch.wordCount}字`
    }
    
    return chapterInfo
  }).join('\n\n')
  
  console.log('最终返回的章节详情:', result)
  return result
}

// 构建内容生成提示词
const buildContentPrompt = (chapter, context, config = null) => {
  const novel = currentNovel.value
  const settings = config || aiContentForm.value
  
  let prompt = `=== 小说基本信息 ===
小说标题：${novel?.title || '未命名小说'}
小说类型：${novel?.genre || '通用'}
小说简介：${novel?.description || '暂无简介'}

=== 正文生成任务 ===
请为上述小说的章节《${chapter.title}》写正文内容。

章节信息：
- 章节标题：${chapter.title}
- 章节大纲：${chapter.description || '暂无大纲'}
- 章节位置：第${context.currentChapterIndex}章（共${context.totalChapters}章）
- 故事进度：${Math.round(context.storyProgress * 100)}%
- 生成类型：${getContentCategoryDescription(selectedContentCategory.value)}
- 目标字数：约${settings.wordCount}字
- 写作视角：${getViewpointDescription(settings.style)}
- 重点内容：${settings.focus || '按大纲发展'}

`

  // 添加人物信息
  if (context.characters.length > 0 && settings.useCharacters) {
    prompt += `主要人物设定：
${context.characters.map(char => 
  `- ${char.name}（${char.role}）：${char.personality || '暂无描述'}`
).join('\n')}

`
  }

  // 添加世界观信息
  if (context.worldSettings.length > 0 && settings.useWorldview) {
    prompt += `世界观设定：
${context.worldSettings.map(setting => 
  `- ${setting.title}：${setting.description || '暂无描述'}`
).join('\n')}

`
  }

  // 添加事件线信息
  if (context.recentEvents.length > 0 && settings.useEvents) {
    prompt += `相关事件线：
${context.recentEvents.map(event => 
  `- 第${event.chapter}章：${event.title} - ${event.description || '暂无描述'}${getEventCharacterNames(event).length > 0 ? `（参与角色：${getEventCharacterNames(event).join('、')}）` : ''}`
).join('\n')}

【事件线要求】本章内容需要考虑以上事件的影响和发展，确保情节的连贯性和合理性。

`
  }

  // 添加前文上下文
  if (context.previousChapters.length > 0 && settings.useContext) {
    const recentChapters = takeLastItems(context.previousChapters, RECENT_CHAPTERS_FOR_CONTEXT)
    prompt += `=== 前文概要（必须保持连贯） ===
${recentChapters.map((ch, idx) => 
  `第${context.previousChapters.length - recentChapters.length + idx + 1}章《${ch.title}》：${ch.description || '暂无概要'}`
).join('\n')}

【重要】必须确保本章内容与前文在以下方面保持连贯：
- 人物性格和行为逻辑一致
- 时间线和事件发展合理
- 情节推进自然流畅
- 世界观设定保持统一

`
  }

  prompt += `=== 核心约束（必须严格遵守） ===
1. 【主题控制】严格按照章节大纲发展情节，不得偏离主线剧情
2. 【连贯性】与前文内容保持逻辑连贯，人物行为符合已建立的性格
3. 【一致性】世界观、人物设定、时间线必须与前文保持一致
4. 【章节完整性】确保本章有明确的开始、发展、高潮、结尾
5. 【进度控制】根据故事进度(${Math.round(context.storyProgress * 100)}%)合理安排情节节奏和内容深度

=== 写作要求 ===
1. 保持${getViewpointDescription(settings.style)}的叙述方式
2. 字数控制在${settings.wordCount}字左右
3. 根据生成类型重点突出：${getContentCategoryGuidance(selectedContentCategory.value)}
4. 突出重点：${settings.focus || '按大纲推进剧情'}

=== 质量标准 ===
1. 情节发展必须合理，不出现逻辑漏洞
2. 人物对话符合各自的性格特点
3. 环境描写与已建立的世界观一致
4. 节奏控制得当，张弛有度
5. 语言风格与整部小说保持统一

【警告】绝对不能：
- 偏离章节大纲的主要情节
- 改变已确定的人物性格
- 违背已建立的世界观设定
- 出现与前文矛盾的内容

请开始创作正文内容：`

  return prompt
}

// 获取视角描述
const getViewpointDescription = (style) => {
  const styles = {
    'first-person': '第一人称',
    'third-person': '第三人称',
    'omniscient': '全知视角'
  }
  return styles[style] || '第三人称'
}

// 获取正文生成类型描述
const getContentCategoryDescription = (category) => {
  const categories = {
    'content': '基础正文（标准章节内容生成）',
    'content-dialogue': '对话生成（以对话为主的内容）',
    'content-scene': '场景描写（环境氛围描写）',
    'content-action': '动作情节（动作和冲突为主）',
    'content-psychology': '心理描写（内心活动和情感）'
  }
  return categories[category] || '基础正文'
}

// 获取正文生成类型的具体指导
const getContentCategoryGuidance = (category) => {
  const guidance = {
    'content': '平衡叙述、对话、心理描写、环境描写，创造完整的章节内容',
    'content-dialogue': '重点突出人物对话，通过对话推进情节，展现人物性格和关系',
    'content-scene': '详细描写环境、氛围、场景细节，营造身临其境的感觉',
    'content-action': '重点描写动作场面、冲突情节，节奏紧凑，充满张力',
    'content-psychology': '深入刻画人物内心活动、情感变化、心理冲突'
  }
  return guidance[category] || '平衡各种描写手法，创造丰富的内容'
}

// 格式化生成的内容
const formatGeneratedContent = (rawContent, chapterTitle) => {
  // 清理内容
  let formatted = rawContent.trim()
  
  // 添加章节标题（如果没有的话）
  if (!formatted.includes(chapterTitle)) {
    formatted = `<h3>${chapterTitle}</h3>\n\n${formatted}`
  }
  
  // 段落格式化
  const paragraphs = formatted.split('\n').filter(p => p.trim())
  const htmlContent = paragraphs.map(paragraph => {
    const trimmed = paragraph.trim()
    
    // 处理标题
    if (trimmed.startsWith('#') || trimmed === chapterTitle) {
      return `<h3>${trimmed.replace(/^#+\s*/, '')}</h3>`
    }
    
    // 处理对话
    if (trimmed.startsWith('"') || trimmed.startsWith('"') || trimmed.startsWith('「')) {
      return `<p class="dialogue">${trimmed}</p>`
    }
    
    // 普通段落
    return `<p>${trimmed}</p>`
  }).join('')
  
  return htmlContent
}

// 构建生成上下文
const buildGenerationContext = () => {
  const currentIndex = chapters.value.findIndex(c => c.id === currentChapter.value?.id)
  const previousChapters = chapters.value.slice(0, currentIndex)
  
  return {
    characters: characters.value,
    worldSettings: worldSettings.value,
    corpus: corpusData.value,
    events: events.value,
    previousChapters: previousChapters,
    currentNovelInfo: currentNovel.value,
    // 新增：更详细的上下文信息
    totalChapters: chapters.value.length,
    currentChapterIndex: currentIndex + 1,
    storyProgress: currentIndex / Math.max(chapters.value.length - 1, 1), // 故事进度百分比
    recentEvents: takeLastItems(
      events.value.filter(e => e.chapter && parseInt(e.chapter) <= currentIndex + 1),
      RECENT_EVENTS_FOR_CONTEXT,
    ), // 最近3个事件
    activeCharacters: characters.value.filter(char => char.role === 'protagonist' || char.role === 'antagonist'), // 主要角色
    storyTheme: currentNovel.value?.genre || '通用' // 故事主题
  }
}

// 人物管理方法
const addCharacter = () => {
  characterForm.value = {
    id: null,
    name: '',
    role: 'supporting',
    gender: 'male',
    age: 25,
    appearance: '',
    personality: '',
    background: '',
    tags: [],
    avatar: ''
  }
  showCharacterDialog.value = true
}

const editCharacter = (character) => {
  characterForm.value = { ...character }
  showCharacterDialog.value = true
}

const saveCharacter = async () => {
  if (!characterForm.value.name.trim()) {
    ElMessage.warning('请输入角色姓名')
    return
  }
  const isNew = !characterForm.value.id
  if (isNew) {
    characterForm.value.id = Date.now()
    characterForm.value.createdAt = new Date()
  }
  const index = characters.value.findIndex(item => item.id === characterForm.value.id)
  if (index > -1) characters.value[index] = { ...characterForm.value }
  else characters.value.push({ ...characterForm.value })
  if (!(await saveNovelData())) return
  ElMessage.success(isNew ? '角色创建成功' : '角色信息已更新')
  showCharacterDialog.value = false
}

// AI生成角色
const generateCharacterAI = async () => {
  if (!checkApiAndBalance()) return
  
  if (!characterForm.value.name.trim()) {
    ElMessage.warning('请先输入角色姓名')
    return
  }
  
  // 设置流式生成状态

  streamingType.value = 'character'
  streamingContent.value = ''
  
  // 清空表单相关字段，准备接收生成内容
  characterForm.value.appearance = ''
  characterForm.value.personality = ''
  characterForm.value.background = ''
  characterForm.value.tags = []
  
  const operation = beginWriterOperation(null, 'character')
  try {
    const prompt = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${(() => {
      const genreMap = {
        'fantasy': '玄幻小说',
        'urban': '都市言情',
        'historical': '历史架空',
        'martial': '武侠修仙',
        'science': '科幻未来',
        'romance': '现代言情',
        'mystery': '悬疑推理',
        'adventure': '冒险奇幻',
        'horror': '恐怖惊悚',
        'general': '通用小说'
      }
      return genreMap[currentNovel.value?.genre] || '通用小说'
    })()}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== Character generation task ===
You are a professional character designer for Chinese fiction. Design the character 《${characterForm.value.name}》 for the novel above.

Requirements:
- Appearance: concrete and visualizable (build, hair, eyes, distinguishing mark), matching the genre's aesthetic.
- Personality: 2-4 traits with a built-in contradiction or flaw that can generate drama.
- Background: causal, not biographic listing — key formative event, current motivation, and a hidden tension that can surface later.

=== 角色基本设定 ===
- 姓名：${characterForm.value.name}
- 角色定位：${characterForm.value.role === 'protagonist' ? '主角' : characterForm.value.role === 'antagonist' ? '反派' : '配角'}
- 性别：${characterForm.value.gender === 'male' ? '男' : characterForm.value.gender === 'female' ? '女' : '其他'}
- 年龄：${characterForm.value.age}岁

请确保角色设定符合小说的世界观、类型和风格特点。

开始生成：`

    // 为单个角色生成添加强制格式后缀
    const singleCharacterFormatSuffix = `

=== Output format — MANDATORY, machine-parsed (overrides anything above) ===
Output ONLY the following four lines, nothing else (no title, no preamble, no extra fields, no markdown). Keep the Chinese field labels 外貌/性格/背景/标签 exactly as shown; do NOT translate or rename them:

外貌：[详细外貌描述]
性格：[性格特点描述]
背景：[背景故事]
标签：[标签1,标签2,标签3]

All field values must be written in natural, idiomatic Simplified Chinese. Tags must use half-width commas (,).`

    const promptWithFormat = prompt + singleCharacterFormatSuffix
    
    console.log('=== 单个角色生成最终提示词 ===')
    console.log(promptWithFormat)
    console.log('=== 提示词结束 ===')

    const aiResponse = await writerStream.generate(promptWithFormat, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'character'
    }, (chunk, fullContent) => {
      // 实时更新流式内容
      streamingContent.value = fullContent
      
      // 实时解析并更新表单字段
      const lines = fullContent.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('外貌：')) {
          characterForm.value.appearance = trimmed.replace('外貌：', '').trim()
        } else if (trimmed.startsWith('性格：')) {
          characterForm.value.personality = trimmed.replace('性格：', '').trim()
        } else if (trimmed.startsWith('背景：')) {
          characterForm.value.background = trimmed.replace('背景：', '').trim()
        } else if (trimmed.startsWith('标签：')) {
          const tagString = trimmed.replace('标签：', '').trim()
          if (tagString) {
            characterForm.value.tags = tagString.split(',').map(tag => tag.trim()).filter(tag => tag)
          }
        }
      }
    })
    
    // 最终解析AI响应
    const lines = aiResponse.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('外貌：')) {
        characterForm.value.appearance = trimmed.replace('外貌：', '').trim()
      } else if (trimmed.startsWith('性格：')) {
        characterForm.value.personality = trimmed.replace('性格：', '').trim()
      } else if (trimmed.startsWith('背景：')) {
        characterForm.value.background = trimmed.replace('背景：', '').trim()
      } else if (trimmed.startsWith('标签：')) {
        const tagString = trimmed.replace('标签：', '').trim()
        characterForm.value.tags = tagString.split(',').map(tag => tag.trim()).filter(tag => tag)
      }
    }
    
    ElMessage.success('AI角色生成完成')
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成角色失败:', error)
    ElMessage.error(`角色生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
    }
  }
}

const addCharacterTag = () => {
  const tag = characterTagInput.value.trim()
  if (tag && !characterForm.value.tags.includes(tag)) {
    characterForm.value.tags.push(tag)
    characterTagInput.value = ''
  }
}

const removeCharacterTag = (index) => {
  characterForm.value.tags.splice(index, 1)
}

// 处理人物操作
const handleCharacterAction = (command, character) => {
  switch (command) {
    case 'edit':
      editCharacter(character)
      break
    case 'delete':
      deleteCharacter(character)
      break
  }
}

// 删除角色
const deleteCharacter = (character) => {
  const novelId = currentNovel.value?.id
  return ElMessageBox.confirm(`确定要删除角色《${character.name}》吗？`, '确认删除', {
    type: 'warning'
  }).then(async () => {
    if (currentNovel.value?.id !== novelId) return
    const index = characters.value.findIndex(item => item.id === character.id)
    if (index < 0) return
    const [removed] = characters.value.splice(index, 1)
    if (!(await saveNovelData())) {
      characters.value.splice(index, 0, removed)
      return
    }
    ElMessage.success('角色已删除')
  }).catch(() => {})
}

// 世界观管理方法
const addWorldSetting = () => {
  worldForm.value = {
    title: '',
    description: '',
    category: 'setting',
    details: ''
  }
  showWorldDialog.value = true
}

const editWorldSetting = (setting) => {
  worldForm.value = { ...setting }
  showWorldDialog.value = true
}

const deleteWorldSetting = (setting) => {
  const novelId = currentNovel.value?.id
  return ElMessageBox.confirm(`确定要删除设定《${setting.title}》吗？`, '确认删除', {
    type: 'warning'
  }).then(async () => {
    if (currentNovel.value?.id !== novelId) return
    const index = worldSettings.value.findIndex(item => item.id === setting.id)
    if (index < 0) return
    novelStore.removeWorldSetting(setting.id)
    if (!(await saveNovelData())) {
      novelStore.worldSettings.splice(index, 0, setting)
      return
    }
    ElMessage.success('设定已删除')
  }).catch(() => {})
}

// 处理世界观设定操作
const handleWorldSettingAction = (command, setting) => {
  switch (command) {
    case 'edit':
      editWorldSetting(setting)
      break
    case 'duplicate':
      duplicateWorldSetting(setting)
      break
    case 'delete':
      deleteWorldSetting(setting)
      break
  }
}

// 复制世界观设定
const duplicateWorldSetting = async (setting) => {
  const newSetting = {
    ...setting,
    id: new Date().getTime(),
    title: setting.title + ' (副本)',
    createdAt: new Date(),
    generated: false
  }
  novelStore.addWorldSetting(newSetting)
  if (!(await saveNovelData())) return
  ElMessage.success('设定已复制')
}

// 格式化日期
const formatDate = (date) => {
  if (!date) return ''
  const d = new Date(date)
  return d.toLocaleDateString('zh-CN', { 
    month: 'numeric', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 语料库管理方法
const addCorpus = () => {
  corpusForm.value = {
    id: null,
    title: '',
    type: 'description',
    category: '',
    content: '',
    tags: []
  }
  showCorpusDialog.value = true
}

const editCorpus = (corpus) => {
  corpusForm.value = { ...corpus }
  showCorpusDialog.value = true
}

const deleteCorpus = (corpus) => {
  const novelId = currentNovel.value?.id
  return ElMessageBox.confirm(`确定要删除语料《${corpus.title}》吗？`, '确认删除', {
    type: 'warning'
  }).then(async () => {
    if (currentNovel.value?.id !== novelId) return
    const index = corpusData.value.findIndex(item => item.id === corpus.id)
    if (index < 0) return
    const [removed] = corpusData.value.splice(index, 1)
    if (!(await saveNovelData())) {
      corpusData.value.splice(index, 0, removed)
      return
    }
    ElMessage.success('语料已删除')
  }).catch(() => {})
}



// 事件管理方法
const addEvent = () => {
  const currentIndex = chapters.value.findIndex(ch => ch.id === currentChapter.value?.id)
  eventForm.value = {
    id: null,
    title: '',
    description: '',
    chapter: currentIndex > -1 ? String(currentIndex + 1) : '',
    characterIds: [],
    time: new Date().toISOString().slice(0, 16),
    importance: 'normal'
  }
  showEventDialog.value = true
}

const editEvent = (event) => {
  eventForm.value = {
    ...event,
    characterIds: Array.isArray(event.characterIds) ? [...event.characterIds] : []
  }
  showEventDialog.value = true
}

const saveEvent = async () => {
  if (!eventForm.value.title.trim()) {
    ElMessage.warning('请输入事件标题')
    return
  }
  const isNew = !eventForm.value.id
  if (isNew) {
    eventForm.value.id = Date.now()
    eventForm.value.createdAt = new Date()
  }
  const index = events.value.findIndex(item => item.id === eventForm.value.id)
  if (index > -1) events.value[index] = { ...eventForm.value }
  else events.value.push({ ...eventForm.value })
  if (!(await saveNovelData())) return
  ElMessage.success(isNew ? '事件创建成功' : '事件信息已更新')
  showEventDialog.value = false
}

const deleteEvent = (event) => {
  const novelId = currentNovel.value?.id
  return ElMessageBox.confirm(`确定要删除事件《${event.title}》吗？`, '确认删除', {
    type: 'warning'
  }).then(async () => {
    if (currentNovel.value?.id !== novelId) return
    const index = events.value.findIndex(item => item.id === event.id)
    if (index < 0) return
    const [removed] = events.value.splice(index, 1)
    if (!(await saveNovelData())) {
      events.value.splice(index, 0, removed)
      return
    }
    ElMessage.success('事件已删除')
  }).catch(() => {})
}

// 处理事件操作
const handleEventAction = (command, event) => {
  switch (command) {
    case 'edit':
      editEvent(event)
      break
    case 'delete':
      deleteEvent(event)
      break
  }
}

// 更新章节状态
const updateChapterStatus = async () => {
  if (!currentChapter.value) return
  
  // 同步更新章节列表中的状态
  const chapterIndex = chapters.value.findIndex(ch => ch.id === currentChapter.value.id)
  if (chapterIndex > -1) {
    chapters.value[chapterIndex].status = currentChapter.value.status
    chapters.value[chapterIndex].updatedAt = new Date()
  }
  
  // 保存更新
  if (!(await saveCurrentChapter())) return
  
  ElMessage.success(`章节状态已更新为：${getChapterStatusText(currentChapter.value.status)}`)
}



// 世界观保存方法
const saveWorldSetting = async () => {
  if (!worldForm.value.title.trim()) {
    ElMessage.warning('请输入设定标题')
    return
  }
  const isNew = !worldForm.value.id
  if (isNew) {
    worldForm.value.id = Date.now()
    worldForm.value.createdAt = new Date()
  }
  if (worldSettings.value.some(setting => setting.id === worldForm.value.id)) {
    novelStore.updateWorldSetting(worldForm.value.id, worldForm.value)
  } else {
    novelStore.addWorldSetting({ ...worldForm.value })
  }
  if (!(await saveNovelData())) return
  ElMessage.success(isNew ? '设定创建成功' : '设定信息已更新')
  showWorldDialog.value = false
}

// 语料库保存方法
const saveCorpus = async () => {
  if (!corpusForm.value.title.trim()) {
    ElMessage.warning('请输入语料标题')
    return
  }
  const isNew = !corpusForm.value.id
  if (isNew) {
    corpusForm.value.id = Date.now()
    corpusForm.value.createdAt = new Date()
  }
  const index = corpusData.value.findIndex(item => item.id === corpusForm.value.id)
  if (index > -1) corpusData.value[index] = { ...corpusForm.value }
  else corpusData.value.push({ ...corpusForm.value })
  if (!(await saveNovelData())) return
  ElMessage.success(isNew ? '语料创建成功' : '语料信息已更新')
  showCorpusDialog.value = false
}

// 批量生成角色提示词相关函数
const openBatchCharacterPromptSelector = () => {
  selectedPromptCategory.value = 'character'
  showPromptDialog.value = true
  selectedPrompt.value = null
  promptVariables.value = {}
  finalPrompt.value = ''
}

const clearBatchCharacterPrompt = () => {
  batchCharacterSelectedPrompt.value = null
  batchCharacterPromptVariables.value = {}
  batchCharacterFinalPrompt.value = ''
}

const _autoFillBatchCharacterVariables = () => {
  if (!batchCharacterSelectedPrompt.value) return
  
  // 自动填充基本信息
  batchCharacterPromptVariables.value['小说标题'] = currentNovel.value?.title || '未命名小说'
  batchCharacterPromptVariables.value['小说类型'] = currentNovel.value?.genre || '现代'
  batchCharacterPromptVariables.value['小说简介'] = currentNovel.value?.description || '暂无简介'
  batchCharacterPromptVariables.value['生成数量'] = batchGenerateConfig.value.count.toString()
  
  // 角色类型要求
  const characterTypes = []
  if (batchGenerateConfig.value.includeMainCharacters) characterTypes.push('主角')
  if (batchGenerateConfig.value.includeSupportingCharacters) characterTypes.push('配角')
  if (batchGenerateConfig.value.includeMinorCharacters) characterTypes.push('次要角色')
  batchCharacterPromptVariables.value['角色类型'] = characterTypes.join('、')
  
  // 特殊要求
  batchCharacterPromptVariables.value['特殊要求'] = batchGenerateConfig.value.customPrompt || '按小说设定生成'
  
  generateBatchCharacterFinalPrompt()
}

const generateBatchCharacterFinalPrompt = () => {
  if (!batchCharacterSelectedPrompt.value) {
    batchCharacterFinalPrompt.value = ''
    return
  }
  
  let result = batchCharacterSelectedPrompt.value.content
  Object.keys(batchCharacterPromptVariables.value).forEach(variable => {
    const value = batchCharacterPromptVariables.value[variable] || `{${variable}}`
    result = result.replace(new RegExp(`\\{${variable}\\}`, 'g'), value)
  })
  
  batchCharacterFinalPrompt.value = result
}

// 世界观生成提示词相关函数
const openWorldSettingPromptSelector = () => {
  selectedPromptCategory.value = 'worldview'
  showPromptDialog.value = true
  selectedPrompt.value = null
  promptVariables.value = {}
  finalPrompt.value = ''
}

const clearWorldSettingPrompt = () => {
  worldSettingSelectedPrompt.value = null
  worldSettingPromptVariables.value = {}
  worldSettingFinalPrompt.value = ''
}

const autoFillWorldSettingVariables = () => {
  if (!worldSettingSelectedPrompt.value) return
  
  // 自动填充基本信息
  worldSettingPromptVariables.value['小说标题'] = currentNovel.value?.title || '未命名小说'
  worldSettingPromptVariables.value['小说类型'] = getChineseGenre(currentNovel.value?.genre)
  worldSettingPromptVariables.value['小说简介'] = currentNovel.value?.description || '暂无简介'
  worldSettingPromptVariables.value['生成数量'] = worldGenerateConfig.value.count.toString()
  
  // 设定类型要求
  const settingTypes = []
  if (worldGenerateConfig.value.includeGeography) settingTypes.push('地理环境')
  if (worldGenerateConfig.value.includeCulture) settingTypes.push('文化社会')
  if (worldGenerateConfig.value.includeHistory) settingTypes.push('历史背景')
  if (worldGenerateConfig.value.includeMagic) settingTypes.push('魔法体系')
  if (worldGenerateConfig.value.includeTechnology) settingTypes.push('科技水平')
  if (worldGenerateConfig.value.includePolitics) settingTypes.push('政治势力')
  if (worldGenerateConfig.value.includeReligion) settingTypes.push('宗教信仰')
  if (worldGenerateConfig.value.includeEconomy) settingTypes.push('经济贸易')
  if (worldGenerateConfig.value.includeRaces) settingTypes.push('种族设定')
  if (worldGenerateConfig.value.includeLanguage) settingTypes.push('语言文字')
  worldSettingPromptVariables.value['设定类型'] = settingTypes.join('、')
  
  // 特殊要求
  worldSettingPromptVariables.value['特殊要求'] = worldGenerateConfig.value.customPrompt || '符合小说世界观设定'
  
  generateWorldSettingFinalPrompt()
}

const generateWorldSettingFinalPrompt = () => {
  if (!worldSettingSelectedPrompt.value) {
    worldSettingFinalPrompt.value = ''
    return
  }
  
  let result = worldSettingSelectedPrompt.value.content
  Object.keys(worldSettingPromptVariables.value).forEach(variable => {
    const value = worldSettingPromptVariables.value[variable] || `{${variable}}`
    result = result.replace(new RegExp(`\\{${variable}\\}`, 'g'), value)
  })
  
  worldSettingFinalPrompt.value = result
}

// 章节生成弹窗相关方法
const clearAllMaterials = () => {
  selectedMaterials.value = {
    characters: [],
    worldSettings: [],
    corpus: [],
    events: [],
    chapters: []
  }
  
  // 清空前文概要章节选择
  selectedContextChapters.value = []
  if (promptVariables.value['前文概要']) {
    promptVariables.value['前文概要'] = ''
    generateFinalPrompt()
  }
  
  ElMessage.success('已清空所有选择')
}

const selectAllMaterials = (type) => {
  switch (type) {
    case 'characters':
      selectedMaterials.value.characters = [...characters.value]
      break
    case 'worldSettings':
      selectedMaterials.value.worldSettings = [...worldSettings.value]
      break
    case 'corpus':
      selectedMaterials.value.corpus = [...corpusData.value]
      break
    case 'events':
      selectedMaterials.value.events = [...events.value]
      break
    case 'chapters':
      // 章节选择已改为使用上下文选择，这里保持原有逻辑但不再使用
      selectedMaterials.value.chapters = [...availableChaptersForSelection.value]
      break
  }
  const typeText = type === 'characters' ? '人物' : 
                   type === 'worldSettings' ? '世界观' : 
                   type === 'corpus' ? '语料' : 
                   type === 'events' ? '事件线' : 
                   type === 'chapters' ? '章节' : '素材'
  ElMessage.success(`已选择所有${typeText}`)
}

const useDefaultPrompt = () => {
  selectedPrompt.value = null
  promptVariables.value = {}
  finalPrompt.value = ''
  ElMessage.info('已切换到默认提示词')
}

const refreshPrompts = () => {
  // 刷新提示词列表
  ElMessage.success('提示词列表已刷新')
}

const createPromptForCategory = () => {
  router.push('/prompts-library')
}

const copyPrompt = () => {
  if (finalPrompt.value) {
    navigator.clipboard.writeText(finalPrompt.value)
    ElMessage.success('提示词已复制到剪贴板')
  }
}

const editPrompt = () => {
  ElMessage.info('您可以直接在预览框中编辑提示词')
}

const _getGenerateInfo = () => {
  const selectedCount = (selectedMaterials.value.characters?.length || 0) + 
                       (selectedMaterials.value.worldSettings?.length || 0) + 
                       (selectedMaterials.value.corpus?.length || 0) + 
                       (selectedMaterials.value.events?.length || 0) +
                       (selectedContextChapters.value?.length || 0)
  const estimatedCost = (generateConfig.value.wordCount * 0.001).toFixed(3)
  return `已选择${selectedCount}个素材（含${selectedContextChapters.value?.length || 0}个上下文章节），目标${generateConfig.value.wordCount}字，预估费用¥${estimatedCost}`
}

const _previewGenerate = () => {
  if (!selectedPrompt.value) return
  
  ElMessageBox.alert(
    `提示词：${selectedPrompt.value.title}\n` +
    `目标字数：${generateConfig.value.wordCount}\n` +
    `写作视角：${generateConfig.value.style}\n` +
    `选择素材：${selectedMaterials.value.characters?.length || 0}个人物，${selectedMaterials.value.worldSettings?.length || 0}个设定，${selectedMaterials.value.corpus?.length || 0}个语料，${selectedMaterials.value.events?.length || 0}个事件线\n` +
    `上下文章节：${selectedContextChapters.value?.length || 0}个章节\n` +
    `预估费用：¥${(generateConfig.value.wordCount * 0.001).toFixed(3)}`,
    '生成配置预览',
    {
      confirmButtonText: '确定'
    }
  )
}

const generateChapterContentWithDialog = async () => {
  if (!selectedPrompt.value) {
    ElMessage.warning('请先选择提示词模板')
    return
  }
  
  if (!currentChapter.value) {
    ElMessage.warning('请先选择要生成内容的章节')
    return
  }
  
  if (!checkApiAndBalance()) return
  
  showChapterGenerateDialog.value = false
  await generateContentWithPrompt(finalPrompt.value)
}

// 新增AI功能弹窗方法
const openAISingleChapterDialog = () => {
  cancelWriterDialog('single')
  aiSingleChapterForm.value = {
    title: '',
    plotRequirement: '',
    template: 'general'
  }
  showAISingleChapterDialog.value = true
}

const openAIBatchChapterDialog = () => {
  cancelWriterDialog('batch')
  aiBatchChapterForm.value = {
    count: 3,
    plotRequirement: '',
    template: 'general'
  }
  showAIBatchChapterDialog.value = true
}

const _openAIOptimizeDialog = (chapter) => {
  cancelWriterDialog('optimize')
  aiOptimizeForm.value = {
    optimizeType: 'grammar',
    customRequirement: '',
    originalContent: chapter ? chapter.content || '' : '',
    optimizedContent: ''
  }
  showAIOptimizeDialog.value = true
}

const resetAISingleChapterDialog = () => {
  aiSingleChapterForm.value = {
    title: '',
    plotRequirement: '',
    template: 'general'
  }
  // 重置自定义提示词
  singleChapterSelectedPrompt.value = null
  singleChapterPromptVariables.value = {}
  singleChapterFinalPrompt.value = ''
  streamingContent.value = ''

}

const resetAIBatchChapterDialog = () => {
  aiBatchChapterForm.value = {
    count: 3,
    plotRequirement: '',
    template: 'general'
  }
  // 重置自定义提示词
  batchChapterSelectedPrompt.value = null
  batchChapterPromptVariables.value = {}
  batchChapterFinalPrompt.value = ''
  activePromptCollapse.value = ['promptContent']
  streamingContent.value = ''

}

const resetAIOptimizeDialog = () => {
  aiOptimizeForm.value = {
    optimizeType: 'grammar',
    customRequirement: '',
    originalContent: '',
    optimizedContent: ''
  }
  streamingContent.value = ''

}

const generateSingleChapter = async () => {
  if (!checkApiAndBalance()) return
  
  if (!aiSingleChapterForm.value.title.trim()) {
    ElMessage.warning('请输入章节标题')
    return
  }
  

  streamingType.value = 'single-chapter'
  streamingContent.value = ''
  
  const operation = beginWriterOperation(isGeneratingChapters, 'single')
  try {
    // 检查是否有选中的自定义提示词
    if (singleChapterSelectedPrompt.value && singleChapterFinalPrompt.value) {
      console.log('使用自定义提示词生成单章')
      await generateSingleChapterWithPrompt(singleChapterFinalPrompt.value)
      return
    }
    
    // 使用默认模板，确保包含用户填写的所有信息
    const prompt = `=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${getChineseGenre(currentNovel.value?.genre)}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 单章生成任务 ===
【重要提醒】：请只生成一个章节的大纲，不要生成多个章节！

目标章节信息：
- 章节标题：${aiSingleChapterForm.value.title}
- 情节要求：${aiSingleChapterForm.value.plotRequirement || '请根据章节标题合理发展'}
- 模板类型：${getTemplateDescription(aiSingleChapterForm.value.template)}
- 章节序号：第${chapters.value.length + 1}章

已有章节概况：
${chapters.value.map((ch, idx) => `第${idx + 1}章：${ch.title} - ${ch.description || '暂无描述'}`).join('\n')}

【核心要求】：
1. 只生成一个章节（第${chapters.value.length + 1}章）的详细大纲
2. 使用用户指定的章节标题：${aiSingleChapterForm.value.title}
3. 严格遵循用户的情节要求：${aiSingleChapterForm.value.plotRequirement || '按章节标题合理发展'}
4. 与前文保持逻辑连贯性，推进主线剧情发展
5. 包含具体的情节要点、人物发展、重要事件等
6. 不要生成多个章节，只生成一个章节的内容

请严格按照以下格式返回（只返回一个章节）：
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]`

    console.log('开始AI生成单章大纲:', prompt)
    
    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null,
      temperature: 0.8,
      type: 'outline'
    }, (chunk, fullContent) => {
      streamingContent.value = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 创建新章节
    const newChapter = {
      id: Date.now(),
      title: aiSingleChapterForm.value.title,
      description: aiResponse.replace(/^大纲：/, '').trim(),
      content: '',
      wordCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'draft'
    }
    
    chapters.value.push(newChapter)
    if (!(await saveNovelData())) return
    if (operation !== writerOperation) return
    showAISingleChapterDialog.value = false
    ElMessage.success('单章大纲生成成功')
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI生成单章失败:', error)
    ElMessage.error(`单章生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingChapters.value = false
    }
  }
}

const generateBatchChapters = async () => {
  if (!checkApiAndBalance()) return
  
  console.log('开始批量生成章节')
  console.log('当前章节列表:', chapters.value.map(ch => ({ title: ch.title, description: ch.description })))
  
  // 检查是否有选中的自定义提示词
  if (batchChapterSelectedPrompt.value && batchChapterFinalPrompt.value) {
    console.log('使用自定义提示词生成')
    // 使用自定义提示词生成
    await generateBatchChaptersWithPrompt(batchChapterFinalPrompt.value)
    return
  }
  
  console.log('使用默认模板生成')
  

  streamingType.value = 'batch-chapters'
  streamingContent.value = ''
  
  const operation = beginWriterOperation(isGeneratingChapters, 'batch')
  try {
    const count = aiBatchChapterForm.value.count
    const plotRequirement = aiBatchChapterForm.value.plotRequirement
    const template = aiBatchChapterForm.value.template
    
    console.log('批量生成章节配置检查:', {
      count: count,
      plotRequirement: plotRequirement,
      template: template,
      formData: aiBatchChapterForm.value
    })
    
    // 构建章节编号示例
    const chapterExamples = []
    for (let i = 1; i <= count; i++) {
      chapterExamples.push(`章节${i}：
标题：[章节标题]
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]`)
    }
    
    const prompt = `You are a professional Chinese web-novel story architect. All output must be written in natural, idiomatic Simplified Chinese.

=== Novel info ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${getChineseGenre(currentNovel.value?.genre)}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== Task ===
Generate ${count} chapter outlines that continue from the existing chapters.

【用户具体要求】：
- 生成章节数量：${count}个章节（不多不少）
- 用户情节要求：${plotRequirement || '请根据小说主题合理发展'}
- 模板类型：${getTemplateDescription(template)}
- Every outline is concrete: name the events, decisions, reversals and which characters appear — never vague summaries.
- Chapters connect causally and escalate; every chapter ends on a hook.
- 严格遵循用户的情节要求，围绕用户指定的情节发展

已有章节数：${chapters.value.length}个

=== 前文章节信息（重要参考，接续其情节，不得矛盾或重复） ===
${getRecentChaptersDetail()}

=== Output format — MANDATORY, machine-parsed ===
Output ONLY chapter blocks in exactly the format below, nothing else (no preamble, no closing remarks, no markdown). Keep the Chinese labels 章节/标题/大纲 exactly as shown; do NOT translate or rename them:

${chapterExamples.join('\n\n')}

Hard constraints:
1. Start every block with the exact line "章节X：" (X = 1 to ${count}).
2. Every block contains both "标题：" and "大纲：" fields.
3. Generate exactly ${count} complete chapters — neither fewer nor more.

请现在开始生成：`

    console.log('批量生成章节最终提示词:', prompt)
    console.log('请求生成章节数量:', count)
    console.log('前5章详细信息:', getRecentChaptersDetail())
    
    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'outline'
    }, (chunk, fullContent) => {
      streamingContent.value = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 解析AI响应，提取章节信息
    console.log('AI响应长度:', aiResponse.length)
    console.log('AI响应内容:', aiResponse)
    
    const newChapters = parseChapterResponse(aiResponse)
    
    console.log('解析结果:', newChapters)
    console.log('期望生成数量:', count, '实际解析数量:', newChapters.length)
    
    if (newChapters.length !== count) {
      console.warn(`警告：期望生成${count}个章节，但实际解析出${newChapters.length}个章节`)
      ElMessage.warning(`期望生成${count}个章节，但实际解析出${newChapters.length}个章节`)
    }
    
    // 添加到章节列表
    newChapters.forEach((chapterData, index) => {
      const newChapter = {
        id: Date.now() + index,
        title: chapterData.title || `AI生成章节 ${chapters.value.length + index + 1}`,
        description: chapterData.description || chapterData.outline || '暂无描述',
        content: '',
        wordCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'draft'
      }
      chapters.value.push(newChapter)
      console.log(`添加章节 ${index + 1}:`, newChapter.title)
    })
    
    if (!(await saveNovelData())) return
    if (operation !== writerOperation) return

    showAIBatchChapterDialog.value = false
    ElMessage.success(`成功生成${newChapters.length}个章节大纲`)
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI批量生成章节失败:', error)
    ElMessage.error(`批量生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingChapters.value = false
    }
  }
}

const startOptimizeContent = async () => {
  if (!checkApiAndBalance()) return
  
  if (!aiOptimizeForm.value.originalContent.trim()) {
    ElMessage.warning('请输入需要优化的内容')
    return
  }
  

  streamingType.value = 'optimize'
  streamingContent.value = ''
  aiOptimizeForm.value.optimizedContent = ''
  
  const operation = beginWriterOperation(isOptimizing, 'optimize')
  try {
    let optimizeInstruction = ''
    switch (aiOptimizeForm.value.optimizeType) {
      case 'grammar':
        optimizeInstruction = '请对以下文本进行语法润色，修正语法错误，提升表达流畅度'
        break
      case 'style':
        optimizeInstruction = '请对以下文本进行文风优化，提升文学性和可读性'
        break
      case 'emotion':
        optimizeInstruction = '请对以下文本进行情感增强，加强情感表达和感染力'
        break
      case 'logic':
        optimizeInstruction = '请对以下文本进行逻辑梳理，优化结构和逻辑关系'
        break
      case 'custom':
        optimizeInstruction = aiOptimizeForm.value.customRequirement || '请对以下文本进行优化'
        break
    }
    
    const prompt = `${optimizeInstruction}：

原始内容：
${aiOptimizeForm.value.originalContent}

要求：
1. 保持原意不变
2. 优化表达方式
3. 提升整体质量
4. 直接输出优化后的内容，无需说明

优化后内容：`

    console.log('开始AI优化内容:', prompt)
    
    const aiResponse = await writerStream.generate(prompt, {
      maxTokens: null, // 移除token限制
      temperature: 0.7,
      type: 'optimize'
    }, (chunk, fullContent) => {
      streamingContent.value = fullContent
      aiOptimizeForm.value.optimizedContent = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    aiOptimizeForm.value.optimizedContent = aiResponse
    ElMessage.success('内容优化完成')
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI优化失败:', error)
    ElMessage.error(`优化失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isOptimizing.value = false
    }
  }
}

const applyOptimizedContent = () => {
  if (currentChapter.value && aiOptimizeForm.value.optimizedContent) {
    currentChapter.value.content = aiOptimizeForm.value.optimizedContent
    content.value = aiOptimizeForm.value.optimizedContent
    hasUnsavedChanges.value = true
    showAIOptimizeDialog.value = false
    ElMessage.success('优化内容已应用到当前章节')
  } else {
    ElMessage.warning('无法应用优化内容')
  }
}

const selectPromptForSingleChapter = () => {
  selectedPromptCategory.value = 'outline'
  showPromptDialog.value = true
}

// 使用自定义提示词生成单章
const generateSingleChapterWithPrompt = async (customPrompt) => {
  if (!checkApiAndBalance()) return
  

  streamingType.value = 'single-chapter'
  streamingContent.value = ''
  
  const operation = beginWriterOperation(isGeneratingChapters, 'single')
  try {
    // 在自定义提示词中确保包含用户填写的基本信息
    const promptWithUserInput = `=== 用户输入信息 ===
章节标题：${aiSingleChapterForm.value.title}
情节要求：${aiSingleChapterForm.value.plotRequirement || '请根据章节标题合理发展'}
模板类型：${getTemplateDescription(aiSingleChapterForm.value.template)}

=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${getChineseGenre(currentNovel.value?.genre)}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 已有章节概况 ===
${chapters.value.map((ch, idx) => `第${idx + 1}章：${ch.title} - ${ch.description || '暂无描述'}`).join('\n')}

=== 基于以上信息，请按照以下要求生成章节 ===
${customPrompt}

=== 重要约束 ===
【关键】：请只生成一个章节的大纲，不要生成多个章节！

1. 只生成一个章节（第${chapters.value.length + 1}章）的详细大纲
2. 必须使用用户指定的章节标题：${aiSingleChapterForm.value.title}
3. 必须遵循用户的情节要求：${aiSingleChapterForm.value.plotRequirement || '按章节标题合理发展'}
4. 与已有章节保持逻辑连贯性，推进主线剧情发展
5. 包含具体的情节要点、人物发展、重要事件等
6. 不要生成多个章节，无论提示词中是否提到"10章"等内容，都只生成一个章节

请严格按照以下格式返回（只返回一个章节）：
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]`

    console.log('使用自定义提示词生成单章:', promptWithUserInput.substring(0, 300) + '...')
    
    const aiResponse = await writerStream.generate(promptWithUserInput, {
      maxTokens: null,
      temperature: 0.8,
      type: 'outline'
    }, (chunk, fullContent) => {
      streamingContent.value = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 创建新章节
    const newChapter = {
      id: Date.now(),
      title: aiSingleChapterForm.value.title,
      description: aiResponse.replace(/^大纲：/, '').trim(),
      content: '',
      wordCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'draft'
    }
    
    chapters.value.push(newChapter)
    if (!(await saveNovelData())) return
    if (operation !== writerOperation) return
    showAISingleChapterDialog.value = false
    ElMessage.success('使用自定义提示词生成单章成功')
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('使用自定义提示词生成单章失败:', error)
    ElMessage.error(`单章生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingChapters.value = false
    }
  }
}

const selectPromptForBatchChapter = () => {
  console.log('打开批量章节提示词选择对话框')
  console.log('当前章节数量:', chapters.value.length)
  console.log('当前章节列表:', chapters.value.map(ch => ({ title: ch.title, description: ch.description })))
  
  selectedPromptCategory.value = 'outline'
  showPromptDialog.value = true
  
  // 自动填充批量章节生成的变量
  nextTick(() => {
    if (selectedPrompt.value) {
      console.log('nextTick中调用autoFillBatchChapterVariables')
      autoFillBatchChapterVariables()
    }
  })
}

// 自动填充批量章节变量
const autoFillBatchChapterVariables = () => {
  if (!selectedPrompt.value) {
    console.log('autoFillBatchChapterVariables: 没有选中的提示词')
    return
  }
  
  console.log('开始自动填充批量章节变量')
  
  // 自动填充基本信息
  promptVariables.value['小说标题'] = currentNovel.value?.title || '未命名小说'
  promptVariables.value['小说类型'] = getChineseGenre(currentNovel.value?.genre)
  promptVariables.value['小说简介'] = currentNovel.value?.description || '暂无简介'
  promptVariables.value['生成章节数量'] = aiBatchChapterForm.value.count.toString()
  promptVariables.value['情节要求'] = aiBatchChapterForm.value.plotRequirement || '请根据小说主题合理发展'
  promptVariables.value['模板类型'] = getTemplateDescription(aiBatchChapterForm.value.template)
  
  // 填充已有章节信息（使用详细的前5章信息）
  const chaptersDetail = getRecentChaptersDetail()
  promptVariables.value['已有章节'] = chaptersDetail
  
  console.log('批量章节变量填充完成:', {
    小说标题: promptVariables.value['小说标题'],
    已有章节: chaptersDetail.substring(0, 200) + '...',
    变量数量: Object.keys(promptVariables.value).length
  })
  
  generateFinalPrompt()
}

// 自动填充单章变量
const autoFillSingleChapterVariables = () => {
  if (!selectedPrompt.value) {
    console.log('autoFillSingleChapterVariables: 没有选中的提示词')
    return
  }
  
  console.log('开始自动填充单章变量')
  
  // 自动填充基本信息
  promptVariables.value['小说标题'] = currentNovel.value?.title || '未命名小说'
  promptVariables.value['小说类型'] = getChineseGenre(currentNovel.value?.genre)
  promptVariables.value['小说简介'] = currentNovel.value?.description || '暂无简介'
  promptVariables.value['章节标题'] = aiSingleChapterForm.value.title || ''
  promptVariables.value['情节要求'] = aiSingleChapterForm.value.plotRequirement || '请根据章节标题合理发展'
  promptVariables.value['模板类型'] = getTemplateDescription(aiSingleChapterForm.value.template)
  
  // 填充已有章节信息
  const chaptersDetail = getRecentChaptersDetail()
  promptVariables.value['已有章节'] = chaptersDetail
  
  console.log('单章变量填充完成:', {
    小说标题: promptVariables.value['小说标题'],
    章节标题: promptVariables.value['章节标题'],
    情节要求: promptVariables.value['情节要求'],
    变量数量: Object.keys(promptVariables.value).length
  })
  
  generateFinalPrompt()
}

// 监听批量章节表单变化，自动更新提示词变量
watch(() => aiBatchChapterForm.value, () => {
  if (showAIBatchChapterDialog.value && selectedPrompt.value && selectedPromptCategory.value === 'outline') {
    console.log('批量章节表单变化，重新填充提示词变量')
    autoFillBatchChapterVariables()
  }
}, { deep: true })

// 监听单章表单变化，自动更新提示词变量
watch(() => aiSingleChapterForm.value, () => {
  if (showAISingleChapterDialog.value && selectedPrompt.value && selectedPromptCategory.value === 'outline') {
    console.log('单章表单变化，重新填充提示词变量')
    autoFillSingleChapterVariables()
  }
}, { deep: true })

const selectPromptForOptimize = () => {
  selectedPromptCategory.value = 'optimize'
  showPromptDialog.value = true
}

// 使用自定义提示词批量生成章节
const generateBatchChaptersWithPrompt = async (customPrompt) => {
  if (!checkApiAndBalance()) return
  

  streamingType.value = 'batch-chapters'
  streamingContent.value = ''
  
  const operation = beginWriterOperation(isGeneratingChapters, 'batch')
  try {
    const count = aiBatchChapterForm.value.count
    const plotRequirement = aiBatchChapterForm.value.plotRequirement
    const template = aiBatchChapterForm.value.template
    
    console.log('使用自定义提示词批量生成章节配置检查:', {
      count: count,
      plotRequirement: plotRequirement,
      template: template,
      customPrompt: customPrompt.substring(0, 200) + '...'
    })
    
    console.log('使用自定义提示词:', {
      原始提示词长度: customPrompt.length,
      是否包含已有章节: customPrompt.includes('已有章节'),
      前5章详细信息: getRecentChaptersDetail().substring(0, 300) + '...'
    })
    
    // 获取前5章详细信息
    const recentChaptersDetail = getRecentChaptersDetail()
    
    // 在自定义提示词前面添加用户输入和前文信息
    const promptWithChapters = `=== 用户输入信息 ===
生成数量：${count}个章节
用户情节要求：${plotRequirement || '请根据小说主题合理发展'}
模板类型：${getTemplateDescription(template)}

=== 小说基本信息 ===
小说标题：${currentNovel.value?.title || '未命名小说'}
小说类型：${getChineseGenre(currentNovel.value?.genre)}
小说简介：${currentNovel.value?.description || '暂无简介'}

=== 前文章节信息（重要参考） ===
${recentChaptersDetail}

=== 基于以上信息，请按照以下要求生成新章节 ===
${customPrompt}`
    
    console.log('添加前5章信息后的提示词长度:', promptWithChapters.length)
    console.log('确认包含章节信息:', promptWithChapters.includes('第') && promptWithChapters.includes('章'))
    
    // 在自定义提示词基础上添加格式约束
    const promptWithFormat = `${promptWithChapters}

=== 重要格式约束（必须严格遵守） ===
无论上述提示词如何，你必须严格按照以下格式输出${count}个章节，不得有任何偏差：

章节1：
标题：[章节标题]
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]

章节2：
标题：[章节标题]
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]

章节3：
标题：[章节标题]
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]

【核心约束】：
1. 必须严格按照"章节X："格式开始每个章节（X为数字1到${count}）
2. 每个章节必须包含"标题："和"大纲："两个字段
3. 必须生成完整的${count}个章节，缺一不可
4. 确保格式完全一致，便于程序解析
5. 不要生成超过${count}个章节
6. 不要生成少于${count}个章节
7. 标题要简洁有吸引力
8. 大纲要详细具体，包含具体的情节发展
9. 严格遵循用户的情节要求：${plotRequirement || '请根据小说主题合理发展'}

请现在开始生成${count}个章节大纲：`

    console.log('使用自定义提示词批量生成 - 最终提示词:')
    console.log('==================== 完整提示词开始 ====================')
    console.log(promptWithFormat)
    console.log('==================== 完整提示词结束 ====================')
    console.log('请求生成章节数量:', count)
    console.log('前5章详细信息:', getRecentChaptersDetail())
    
    const aiResponse = await writerStream.generate(promptWithFormat, {
      maxTokens: null, // 移除token限制
      temperature: 0.8,
      type: 'outline'
    }, (chunk, fullContent) => {
      streamingContent.value = fullContent
    })
    
    if (!aiResponse.trim()) {
      throw new Error('AI返回内容为空')
    }
    
    // 解析AI响应，提取章节信息
    console.log('AI响应长度:', aiResponse.length)
    console.log('AI响应内容:', aiResponse)
    
    const newChapters = parseChapterResponse(aiResponse)
    
    console.log('解析结果:', newChapters)
    console.log('期望生成数量:', count, '实际解析数量:', newChapters.length)
    
    if (newChapters.length !== count) {
      console.warn(`警告：期望生成${count}个章节，但实际解析出${newChapters.length}个章节`)
      ElMessage.warning(`期望生成${count}个章节，但实际解析出${newChapters.length}个章节`)
    }
    
    // 添加到章节列表
    newChapters.forEach((chapterData, index) => {
      const newChapter = {
        id: Date.now() + index,
        title: chapterData.title || `AI生成章节 ${chapters.value.length + index + 1}`,
        description: chapterData.description || chapterData.outline || '暂无描述',
        content: '',
        wordCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'draft'
      }
      chapters.value.push(newChapter)
      console.log(`添加章节 ${index + 1}:`, newChapter.title)
    })
    
    if (!(await saveNovelData())) return
    if (operation !== writerOperation) return

    showAIBatchChapterDialog.value = false
    ElMessage.success(`成功使用自定义提示词生成${newChapters.length}个章节大纲`)
  } catch (error) {
    if (isAIRequestCancelled(error)) return
    console.error('AI批量生成章节失败:', error)
    ElMessage.error(`批量生成失败: ${error.message}`)
  } finally {
    if (operation === writerOperation) {
      isGeneratingChapters.value = false
    }
  }
}


const stopWriterStreams = () => {
  cancelWriterStream()
  continueStream.dispose()
  optimizeStream.dispose()
  resetContinueDialog()
  resetOptimizeDialog()
  showNewContinueDialog.value = false
  showNewOptimizeDialog.value = false
  showAIOptimizeDialog.value = false
  showOptimizePromptDialog.value = false
  showChapterGenerateDialog.value = false
  showPromptDialog.value = false
  showAISingleChapterDialog.value = false
  showAIBatchChapterDialog.value = false
  showBatchGenerateCharacterDialog.value = false
  showWorldGenerateDialog.value = false
  generatedCharacters.value = []
  generatedWorldSettings.value = []
  batchGenerateResults.value = []
  targetChapter.value = null
  aiOptimizeForm.value.optimizedContent = ''
  streamingContent.value = ''
}

const resetWriterGenerationFlags = () => {
  for (const flag of [isGeneratingContent, isGeneratingChapters, isOptimizing,
    isGeneratingOutline, batchGenerating, worldGenerating, isGeneratingWorldSetting]) {
    flag.value = false
  }
}

const cancelWriterStream = (message = '') => {
  writerOperation += 1
  writerDialogOwner = ''
  writerStream.stop(message)
  resetWriterGenerationFlags()
  streamingChapter.value = null
}

const beginWriterOperation = (flag = null, owner = '') => {
  writerStream.dispose()
  resetWriterGenerationFlags()
  if (flag) flag.value = true
  writerDialogOwner = owner
  return ++writerOperation
}

const cancelWriterDialog = (owner) => {
  if (writerDialogOwner === owner) cancelWriterStream()
}

// Only a generation dialog that owns the current request may cancel it.
// The prompt picker also closes normally when handing a request to the editor.
for (const [dialog, owner] of [
  [showAISingleChapterDialog, 'single'], [showAIBatchChapterDialog, 'batch'],
  [showAIOptimizeDialog, 'optimize'], [showBatchGenerateCharacterDialog, 'characters'],
  [showWorldGenerateDialog, 'worlds'], [showWorldDialog, 'world'],
  [showCharacterDialog, 'character'], [showChapterDialog, 'chapter'],
]) {
  watch(dialog, opened => { if (!opened) cancelWriterDialog(owner) }, { flush: 'sync' })
}

const selectChapter = async (chapter) => {
  if (currentChapter.value && currentChapter.value.id !== chapter.id) stopWriterStreams()
  return selectProjectChapter(chapter)
}

// Deleting the selected chapter and loading another novel also change this ref.
watch(() => currentChapter.value?.id, (id, previousId) => {
  if (previousId !== undefined && id !== previousId) stopWriterStreams()
}, { flush: 'sync' })

// 页面离开前等待真实保存完成，失败时保留当前编辑上下文。
onBeforeRouteLeave(async () => {
  stopWriterStreams()
  return saveCurrentChapter()
})
onBeforeRouteUpdate(async (to, from) => {
  if (to.query.novelId === from.query.novelId) return true
  stopWriterStreams()
  return saveCurrentChapter()
})
onMounted(async () => {
  const opened = await initNovel(route.query.novelId)
  if (!opened && !currentNovel.value) { void router.replace('/novels'); return }
  loadPrompts()
})
watch(() => route.query.novelId, async (id, previousId) => {
  if (id !== previousId) await initNovel(id)
})
onUnmounted(() => {
  stopWriterStreams()
  void dispose()
})
</script>

<style scoped>
.writer-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--el-fill-color-light);
}

.title-bar {
  height: 50px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
  display: flex;
  align-items: center;
  padding: 0 20px;
  flex-shrink: 0;
}

.title-left {
  display: flex;
  align-items: center;
  gap: 15px;
}

.novel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tabs-bar {
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
  padding: 0 20px;
  flex-shrink: 0;
}

.main-tabs {
  margin: 0;
}

.main-tabs .el-tabs__header {
  margin: 0;
}

.main-tabs .el-tabs__nav-wrap::after {
  display: none;
}

.main-content {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
}

.left-panel {
  width: 280px;
  flex-shrink: 0;
}

.editor-panel {
  flex: 1;
  min-width: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

/* 新的编辑器头部样式 */
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.editor-header-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chapter-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.4;
}

.chapter-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.word-count {
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.editor-header-right {
  flex-shrink: 0;
  margin-left: 20px;
}

.saving-indicator {
  color: var(--brand-500) !important;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.chapters-list {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.chapter-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chapter-item:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.chapter-item.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
}

.chapter-info {
  flex: 1;
}

.chapter-info h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.chapter-info p {
  margin: 0 0 4px 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

.chapter-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.chapter-actions {
  display: flex;
  gap: 4px;
}

.empty-chapters {
  text-align: center;
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
}

.preview-container {
  height: calc(100vh - 300px);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  overflow-y: auto;
  padding: 20px;
  background: var(--el-bg-color);
}

.preview-content {
  line-height: 1.8;
  color: var(--el-text-color-primary);
}

.empty-editor {
  text-align: center;
  padding: 80px 20px;
  color: var(--el-text-color-secondary);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

/* 现代化弹窗样式 */
.chapter-generate-content {
  padding: 0;
}

.generate-config-section {
  margin-bottom: 16px;
}

.config-card-modern {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.config-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.config-item {
  margin-bottom: 0;
}

.config-item .el-form-item__label {
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-weight: 500;
}

.checkbox-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.checkbox-group-horizontal {
  display: flex;
  gap: 24px;
  align-items: center;
  flex-wrap: wrap;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

.materials-tabs {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.materials-tabs .el-tabs__header {
  margin: 0;
  background-color: var(--el-fill-color-light);
}

.materials-tabs .el-tabs__nav-wrap::after {
  display: none;
}

.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: #fafbfc;
  border-bottom: 1px solid var(--el-border-color-light);
  min-height: 48px;
  flex-wrap: nowrap;
}

.tab-count {
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.materials-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  padding: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.material-card {
  border: 2px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  background-color: var(--el-bg-color);
  position: relative;
}

.material-card:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.material-card.selected {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.material-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.material-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.2;
}

.material-desc {
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
  margin: 0 0 8px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.material-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.empty-materials {
  text-align: center;
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
}

.category-selection-modern {
  margin-bottom: 16px;
}

.category-header {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 12px;
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.category-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  border: 2px solid var(--el-border-color-light);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  background-color: var(--el-bg-color);
}

.category-card:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.category-card.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  color: var(--brand-500);
}

.category-icon {
  font-size: 20px;
  margin-bottom: 4px;
}

.category-name {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}

.prompt-selection-modern {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.prompt-list-modern {
  max-height: 250px;
  overflow-y: auto;
  padding: 8px;
}

.prompt-item-modern {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background-color: var(--el-bg-color);
}

.prompt-item-modern:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.prompt-item-modern.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
}

.prompt-content {
  flex: 1;
}

.prompt-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 4px 0;
}

.prompt-desc {
  font-size: 12px;
  color: var(--el-text-color-regular);
  margin: 0 0 8px 0;
  line-height: 1.4;
}

.prompt-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}



.prompt-actions {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-prompts {
  text-align: center;
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
}

.variables-section {
  margin-top: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.variables-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.variables-form {
  padding: 16px;
}

.variable-item {
  margin-bottom: 16px;
}

.variable-label {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-weight: 500;
  margin-bottom: 4px;
}

.preview-section {
  margin-top: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.preview-actions {
  display: flex;
  gap: 8px;
}

.preview-content {
  padding: 16px;
}

.preview-textarea {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.generate-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
  padding: 16px 0 0 0;
  border-top: 1px solid var(--el-border-color-light);
}

.action-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.action-buttons {
  display: flex;
  gap: 12px;
}

/* AI优化弹窗样式 */
.optimize-dialog-content {
  padding: 0;
}

.current-text-section {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.text-info {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.current-text-content {
  padding: 16px;
}

.current-text-area {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.text-actions {
  padding: 12px 16px;
  background-color: var(--el-fill-color-light);
  border-top: 1px solid var(--el-border-color-light);
  display: flex;
  gap: 8px;
}

.optimize-prompt-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.optimize-type-selection {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.type-header {
  padding: 12px 16px;
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.type-options {
  padding: 16px;
}

.optimize-prompt-selection {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.prompt-list-optimize {
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
}

.prompt-item-optimize {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.2s;
  background-color: var(--el-bg-color);
}

.prompt-item-optimize:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.prompt-item-optimize.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
}

.optimize-variables {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.optimize-preview {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.optimize-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
  padding: 16px 0 0 0;
  border-top: 1px solid var(--el-border-color-light);
}

.ai-tools {
  padding: 10px;
}

.ai-section {
  margin-bottom: 10px;
}

.form-item-with-ai {
  display: flex;
  align-items: center;
}

.form-item-with-ai .el-input {
  flex: 1;
}

.form-item-with-ai .el-button {
  margin-top: 8px;
}

.dialogue {
  font-style: italic;
  color: #2c3e50;
  padding-left: 16px;
  border-left: 3px solid var(--brand-500);
  margin: 8px 0;
}

.characters-list {
  max-height: calc(100vh - 260px);
  overflow-y: auto;
}

.character-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.character-item:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.character-item.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
}

.character-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  margin-right: 10px;
}

.character-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.default-avatar {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 16px;
}

.character-content {
  display: flex;
  align-items: center;
  flex: 1;
  cursor: pointer;
}

.character-info {
  flex: 1;
}

.character-info h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.character-info p {
  margin: 0 0 4px 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

.character-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  flex-wrap: wrap;
}

.character-meta .age-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-left: 4px;
}

.character-desc {
  font-size: 12px;
  color: #666;
  margin: 4px 0;
  line-height: 1.3;
  max-height: 2.6em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.character-desc-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.character-desc-truncated:hover {
  color: var(--el-text-color-primary);
}

.character-tags {
  margin-top: 4px;
}

.character-tags .el-tag {
  margin-right: 4px;
  margin-bottom: 4px;
}

.character-item .character-actions {
  flex-shrink: 0;
  margin-left: 8px;
}

.chapter-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.3;
}

.chapter-desc-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.chapter-desc-truncated:hover {
  color: var(--el-text-color-regular);
}

.chapter-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}



.panel-content {
  height: calc(100vh - 150px);
  overflow: hidden;
}

.event-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.timeline-event-content {
  padding-bottom: 4px;
}

.corpus-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.corpus-item {
  flex-direction: column;
  align-items: flex-start;
}

.event-item {
  align-items: flex-start;
}

.event-time {
  margin-left: 8px;
  color: #c0c4cc;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
}

.worldview-list {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.worldview-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.worldview-item:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.worldview-content {
  flex: 1;
  cursor: pointer;
}

.worldview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.worldview-header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
  flex: 1;
  margin-right: 8px;
}

.worldview-description {
  margin: 6px 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.worldview-description-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.worldview-description-truncated:hover {
  color: var(--el-text-color-primary);
}

.worldview-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.worldview-meta .create-time {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.worldview-meta .ai-generated {
  font-size: 11px;
  color: var(--el-color-success);
  background-color: var(--brand-50);
  padding: 2px 6px;
  border-radius: 10px;
  border: 1px solid #b3d8ff;
}

.worldview-actions {
  flex-shrink: 0;
  margin-left: 8px;
}

.corpus-list {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.corpus-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.corpus-content {
  flex: 1;
  text-align: left;
}

.corpus-item:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.corpus-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.worldview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.corpus-header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.corpus-preview {
  margin: 8px 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.corpus-preview-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.corpus-preview-truncated:hover {
  color: var(--el-text-color-primary);
}

.corpus-actions {
  display: flex;
  gap: 4px;
}

.events-timeline {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.event-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.event-item:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.event-marker {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--brand-500);
  margin-right: 10px;
}

.event-content {
  flex: 1;
}

.event-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.event-content h4 {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.event-actions {
  opacity: 0;
  transition: opacity 0.3s;
}

.event-item:hover .event-actions {
  opacity: 1;
}

/* 章节状态下拉菜单样式 */
.chapter-status-dropdown .el-select-dropdown__item {
  padding: 6px 16px;
  font-size: 12px;
}

.chapter-status-dropdown .el-select-dropdown__item.selected {
  font-weight: 600;
}

/* 章节元信息样式优化 */
.chapter-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chapter-meta .el-select {
  min-width: 70px;
}

.chapter-meta .el-select .el-input__wrapper {
  padding: 0 8px;
  height: 24px;
  font-size: 12px;
}

/* 新的AI优化对话框样式 */
.new-optimize-container {
  max-height: 70vh;
  overflow-y: auto;
}

.optimize-config-card,
.optimize-result-card {
  height: 600px;
  display: flex;
  flex-direction: column;
}

.optimize-config-card .el-card__body,
.optimize-result-card .el-card__body {
  flex: 1;
  overflow-y: auto;
}

.prompt-selection {
  margin-bottom: 20px;
}

.prompt-selection h4 {
  margin: 0 0 12px 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s;
}

.prompt-item:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.prompt-item.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.prompt-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.prompt-desc {
  font-size: 11px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

.custom-prompt {
  margin-bottom: 20px;
}

.custom-prompt h4 {
  margin: 0 0 12px 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.original-content-preview {
  margin-bottom: 20px;
}

.original-content-preview h4 {
  margin: 0 0 12px 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.content-preview {
  padding: 12px;
  background-color: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
  max-height: 120px;
  overflow-y: auto;
  word-wrap: break-word;
}

.content-stats {
  margin-top: 8px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.streaming-area {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.streaming-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.streaming-status {
  color: var(--brand-500);
  font-size: 14px;
  font-weight: 500;
}

.streaming-content-box {
  flex: 1;
  background-color: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 16px;
  overflow-y: auto;
  min-height: 300px;
}

.streaming-text {
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
}

.result-area {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.result-content {
  flex: 1;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 16px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-primary);
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  min-height: 300px;
}

.result-stats {
  margin-top: 12px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.empty-result {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.dialog-footer:has(.action-info) {
  justify-content: space-between;
  align-items: center;
  padding: 16px 0 0 0;
  border-top: 1px solid var(--el-border-color-light);
}

.dialog-footer .action-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.dialog-footer .action-buttons {
  display: flex;
  gap: 12px;
}

/* 流式生成内容样式 */
.streaming-content-area {
  margin-bottom: 16px;
}

.streaming-card {
  border: 1px solid var(--el-color-success);
  background-color: var(--brand-50);
}

.streaming-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 500;
  color: var(--el-color-success);
}

.streaming-content {
  max-height: 300px;
  overflow-y: auto;
  padding: 12px;
  background-color: var(--el-bg-color);
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
}

.streaming-text {
  line-height: 1.8;
  font-size: 14px;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-all;
}

.streaming-text-plain {
  margin: 0;
  line-height: 1.6;
  font-size: 13px;
  color: var(--el-text-color-regular);
  font-family: 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-all;
}

.streaming-content::-webkit-scrollbar {
  width: 6px;
}

.streaming-content::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.streaming-content::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.streaming-content::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

.section-desc {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

/* AI按钮组样式 */
.ai-button-group {
  display: flex;
  align-items: center;
}

/* 提示词对话框样式 */
.prompt-dialog-content {
  max-height: 600px;
  overflow-y: auto;
}

.prompt-list h4 {
  margin: 0 0 16px 0;
  color: var(--el-text-color-primary);
  font-size: 16px;
}

.prompt-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.prompt-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: var(--el-bg-color);
}

.prompt-card:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(64, 158, 255, 0.1);
}

.prompt-card.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.prompt-card-header h5 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.prompt-card-description p {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

.prompt-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.prompt-card-tags .el-tag {
  font-size: 11px;
  height: 20px;
  line-height: 18px;
}

.empty-prompts {
  text-align: center;
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
}

.prompt-variables {
  margin: 20px 0;
  padding: 16px;
  background-color: #f9f9f9;
  border-radius: 6px;
}

.prompt-variables h4 {
  margin: 0 0 16px 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.final-prompt {
  margin-top: 20px;
}

.final-prompt h4 {
  margin: 0 0 12px 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
}

/* 章节生成对话框样式 */
.chapter-generate-content {
  max-height: 70vh;
  overflow: hidden;
}

.materials-section,
.prompt-section {
  height: 500px;
  overflow-y: auto;
}

.materials-section h4,
.prompt-section h4 {
  margin: 0 0 16px 0;
  color: var(--el-text-color-primary);
  font-size: 16px;
  font-weight: 600;
}

.config-card,
.materials-card,
.prompt-selection-card,
.variables-card,
.preview-card {
  margin-bottom: 16px;
}

.materials-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.materials-count {
  font-size: 12px;
  color: var(--brand-500);
  background-color: #ecf5ff;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 600;
  border: 1px solid #b3d8ff;
}

.materials-list {
  max-height: 200px;
  overflow-y: auto;
}

.material-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: var(--el-bg-color);
}

.material-item:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.material-item.selected {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.material-info {
  flex: 1;
}

.material-info h5 {
  margin: 0 0 4px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.material-info p {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

.material-tags,
.material-type {
  display: flex;
  gap: 4px;
}

/* 分类选择样式 */
.category-selection-card {
  margin-bottom: 16px;
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.category-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: var(--el-bg-color);
  min-width: 70px;
  text-align: center;
}

.category-tab:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.category-tab.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.category-icon {
  font-size: 16px;
  margin-bottom: 4px;
}

.category-name {
  font-size: 11px;
  color: var(--el-text-color-regular);
  line-height: 1.2;
}

.category-tab.active .category-name {
  color: var(--brand-500);
  font-weight: 600;
}

.prompt-cards-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  max-height: 250px;
  overflow-y: auto;
}

.prompt-card-small {
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: var(--el-bg-color);
}

.prompt-card-small:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.prompt-card-small.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.prompt-card-small h5 {
  margin: 0 0 6px 0;
  font-size: 13px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.prompt-card-small p {
  margin: 0 0 6px 0;
  font-size: 11px;
  color: var(--el-text-color-regular);
  line-height: 1.3;
}

.prompt-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.prompt-tags .el-tag {
  font-size: 10px;
  height: 18px;
  line-height: 16px;
}

.variables-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 前文概要章节选择样式 */
.context-variable-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.context-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.context-chapter-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.context-chapter-option .chapter-title {
  font-size: 13px;
  color: var(--el-text-color-primary);
  font-weight: 500;
  flex: 1;
}

.context-chapter-option .chapter-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.context-chapter-option .word-count {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

/* 上下文标签页操作按钮 */
.context-tab-actions {
  display: flex;
  gap: 8px;
}

/* 批量生成角色对话框样式 */
.batch-generate-content {
  max-height: 70vh;
  overflow-y: auto;
}

.config-section,
.streaming-section,
.results-section {
  margin-bottom: 16px;
}

.character-type-options {
  display: flex;
  gap: 16px;
}

.streaming-content-container {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background-color: var(--el-fill-color-light);
}

.streaming-content {
  padding: 16px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.result-actions {
  display: flex;
  gap: 8px;
}

.generated-characters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.generated-character-card {
  border: 2px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: var(--el-bg-color);
}

.generated-character-card:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.generated-character-card.selected {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.character-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.character-avatar-preview {
  flex-shrink: 0;
}

.character-avatar-preview .default-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 16px;
}

.character-basic-info {
  flex: 1;
}

.character-basic-info h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.character-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.age-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.selection-indicator {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.selected-icon {
  color: var(--brand-500);
  font-size: 18px;
}

.character-details {
  border-top: 1px solid var(--ink-100);
  padding-top: 12px;
}

.detail-item {
  margin-bottom: 8px;
}

.detail-item label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: 600;
  margin-bottom: 4px;
  display: block;
}

.detail-item p {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
  max-height: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.character-tags-preview {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.character-tags-preview .el-tag {
  font-size: 10px;
  height: 18px;
  line-height: 16px;
}

.character-actions,
.world-actions {
  display: flex;
  gap: 8px;
}

/* 世界观生成对话框样式 */
.world-generate-content {
  max-height: 70vh;
  overflow-y: auto;
}

.world-type-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
  align-items: center;
}

.world-type-options .el-checkbox {
  margin: 0;
  white-space: nowrap;
  min-width: fit-content;
}

.generated-settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.generated-setting-card {
  border: 2px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: var(--el-bg-color);
}

.generated-setting-card:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
}

.generated-setting-card.selected {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.setting-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.setting-basic-info {
  flex: 1;
}

.setting-basic-info h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.setting-content p {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  max-height: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}

/* 世界观设定编辑对话框中的流式显示样式 */
.streaming-status-card {
  margin-top: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background-color: var(--el-fill-color-light);
}

.streaming-header {
  padding: 12px 16px;
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
  border-radius: 6px 6px 0 0;
}

.streaming-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.streaming-content-display {
  padding: 16px;
  max-height: 200px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
}

.event-content p {
  margin: 0 0 4px 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

.event-desc-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.event-desc-truncated:hover {
  color: var(--el-text-color-primary);
}

.event-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.empty-editor {
  text-align: center;
  padding: 80px 20px;
  color: var(--el-text-color-secondary);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.selected-prompt-info {
  color: var(--brand-500);
  font-size: 12px;
  margin-left: 5px;
}

/* AI弹窗样式 */
.ai-single-chapter-content,
.ai-batch-chapter-content,
.ai-optimize-content {
  padding: 10px 0;
}

.optimize-input-card,
.optimize-result-card {
  height: 100%;
}

.optimized-content,
.empty-result {
  padding: 20px;
  text-align: center;
  color: var(--el-text-color-secondary);
}

.optimized-content .el-textarea {
  height: 100%;
}

.streaming-content-area {
  margin-top: 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background-color: var(--el-fill-color-light);
}

.streaming-card {
  margin: 0;
  border: none;
  background: transparent;
}

.streaming-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
  border-radius: 6px 6px 0 0;
}

.streaming-content {
  padding: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.streaming-text-plain {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  margin: 0;
}

.streaming-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  white-space: pre-wrap;
  word-wrap: break-word;
  min-height: 100px;
}

/* 流式内容光标动画效果 */
.streaming-text::after {
  content: '▋';
  color: var(--brand-500);
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 主编辑器流式内容区域特殊样式 */
.editor-panel .streaming-content-area {
  margin: 16px 0;
  border: 2px solid var(--brand-500);
  border-radius: 8px;
  background: var(--brand-50);
}

.editor-panel .streaming-card {
  background: transparent;
  border: none;
}

.editor-panel .streaming-header .streaming-title {
  color: var(--brand-500);
  font-weight: 600;
}

/* 新续写对话框样式 */
.new-continue-container {
  height: 600px;
  max-height: 80vh;
}

.continue-config-card,
.continue-result-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.continue-config-card .el-card__body,
.continue-result-card .el-card__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.continue-direction {
  margin-bottom: 20px;
}

.continue-direction h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.continue-word-count {
  margin-bottom: 20px;
}

.continue-word-count h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.word-count-tips {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.current-content-preview {
  margin-bottom: 20px;
}

.current-content-preview h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.content-summary {
  padding: 8px 12px;
  background-color: var(--el-bg-color-page);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-regular);
  max-height: 80px;
  overflow-y: auto;
}

/* 续写结果区域样式调整 */
.streaming-content-box,
.result-content {
  max-height: 400px;
  overflow-y: auto;
}

.empty-result {
  min-height: 300px;
}

/* 章节选择样式 */
.materials-list {
  max-height: 400px;
  overflow-y: auto;
}

.chapter-material-card {
  padding: 14px;
  border: 1px solid #e1e8ed;
  border-radius: 8px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #fafbfc;
  min-height: 80px;
  position: relative;
}

.chapter-material-card:hover {
  border-color: var(--brand-500);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.chapter-material-card.selected {
  border-color: var(--brand-500);
  background-color: #e6f4ff;
}

.chapter-material-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
  min-height: 32px;
  gap: 8px;
}

.chapter-material-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
  font-size: 14px;
  flex: 1;
  margin-right: 8px;
  line-height: 1.4;
  word-wrap: break-word;
  overflow-wrap: break-word;
  min-width: 0;
}

.chapter-material-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: flex-start;
}

.chapter-material-desc {
  color: #666;
  font-size: 12px;
  line-height: 1.4;
  margin: 4px 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.chapter-material-content {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #eee;
}

.content-preview {
  color: #999;
  font-size: 11px;
  line-height: 1.3;
  font-style: italic;
  word-wrap: break-word;
  overflow-wrap: break-word;
  display: block;
  margin-top: 4px;
}

/* 批量生成章节自定义提示词状态样式 */
.custom-prompt-status {
  margin: 16px 0;
}

.custom-prompt-status .el-alert {
  border-radius: 8px;
}

.prompt-preview {
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-color-success);
  line-height: 1.4;
  opacity: 0.9;
}

/* 提示词内容预览样式 */
.prompt-content-collapse {
  margin-top: 12px;
  border: 1px solid #e1f5fe;
  border-radius: 6px;
  background-color: #f8fdff;
}

.prompt-content-preview {
  padding: 0;
}

.prompt-content-header {
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #e8f4fd;
}

.content-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-500);
}

.prompt-content-text {
  padding: 12px;
  background-color: #fafcff;
  border: 1px solid #e8f4fd;
  border-radius: 4px;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.final-prompt-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e8f4fd;
}

.final-prompt {
  background-color: var(--brand-50);
  border-color: #b3e5fc;
  color: #01579b;
}
</style>
