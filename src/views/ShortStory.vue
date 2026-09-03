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
      <div v-show="activeTab === 'article'" class="workspace">
        <div class="workspace-layout">
          <!-- 左侧配置面板 -->
          <div class="config-sidebar">
            <div class="config-header">
              <h3>📝 短文配置</h3>
              <el-button size="small" text @click="resetArticleConfig">
                重置
              </el-button>
            </div>
            
            <!-- 生成按钮 -->
            <el-button 
              type="primary" 
              size="default"
              @click="generateArticle" 
              :loading="generatingArticle"
              :disabled="!isArticleConfigValid"
              class="generate-btn"
            >
              <el-icon><MagicStick /></el-icon>
              {{ generatingArticle ? '生成中...' : '生成短文' }}
            </el-button>
            
            <!-- 配置表单 -->
            <div class="config-form">

<!-- 必填项提示 -->
            <div v-if="!isArticleConfigValid" class="validation-tip">
              <el-icon><InfoFilled /></el-icon>
              <span>还需填写：
                <span v-if="!articleData.title">标题</span>
                <span v-if="!articleData.title && !articleData.prompt.trim()">、</span>
                <span v-if="!articleData.prompt.trim()">提示词</span>
              </span>
            </div>


              <!-- 标题 -->
              <div class="form-item">
                <label>文章标题</label>
                <el-input 
                  v-model="articleData.title" 
                  placeholder="请输入文章标题"
                />
              </div>

              <!-- 字数和文风 -->
              <div class="form-row">
                <div class="form-item">
                  <label>字数</label>
                  <el-input-number 
                    v-model="articleData.wordCount" 
                    :min="200" 
                    :max="5000" 
                    :step="100"
                    style="width: 100%"
                  />
                </div>
                <div class="form-item">
                  <div class="item-header">
                    <label>文风</label>
                    <el-button size="small" text @click="showWritingStyleManager = true">
                      <el-icon><Setting /></el-icon>设置文风
                    </el-button>
                  </div>
                  <el-select v-model="articleData.style" placeholder="选择文风" style="width: 100%">
                    <el-option v-for="style in customWritingStyles" :key="style.value" :label="style.label" :value="style.value" />
                  </el-select>
                </div>
              </div>

              <!-- 提示词 -->
              <div class="form-item">
                <div class="item-header">
                  <label>创作提示词</label>
                  <el-button size="small" text @click="showArticlePromptSelector = true">
                    <el-icon><List /></el-icon>选择模板
                  </el-button>
                </div>
                
                <div v-if="selectedArticlePromptTemplate" class="selected-template">
                  <el-tag type="info" size="small">{{ selectedArticlePromptTemplate.title }}</el-tag>
                  <el-button size="small" text @click="clearArticleSelectedTemplate">清除</el-button>
                </div>
                
                <el-input
                  v-model="articleData.prompt"
                  type="textarea"
                  :rows="4"
                  placeholder="描述您想要创作的短文内容、主题、风格等要求..."
                />
              </div>

              <!-- 参考文章 -->
              <div class="form-item">
                <div class="item-header">
                  <label>参考文章（可选）</label>
                  <el-button size="small" text type="primary" @click="addReferenceArticle">
                    <el-icon><Plus /></el-icon>添加
                  </el-button>
                </div>
                
                <div v-if="articleData.references.length > 0" class="reference-list">
                  <div v-for="(ref, index) in articleData.references" :key="index" class="reference-item">
                    <div class="ref-header">
                      <span>参考 {{ index + 1 }}</span>
                      <el-button size="small" text @click="removeReferenceArticle(index)">删除</el-button>
                    </div>
                    <el-input v-model="ref.title" placeholder="标题" size="small" style="margin-bottom: 6px" />
                    <el-input v-model="ref.content" type="textarea" :rows="2" placeholder="内容要点..." />
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- 右侧编辑器 -->
          <div class="editor-main">
            <div class="editor-header">
              <div class="editor-title">
                <span>{{ articleData.title || '短文编辑器' }}</span>
                <span class="word-count">{{ articleWordCount }} 字</span>
              </div>
              <div class="editor-actions">
                <el-button size="small" @click="copyArticleContent">
                  <el-icon><DocumentCopy /></el-icon>复制
                </el-button>
                <el-button size="small" @click="saveArticle">
                  <el-icon><Download /></el-icon>保存
                </el-button>
                <el-button size="small" @click="clearArticleContent">
                  <el-icon><Delete /></el-icon>清空
                </el-button>
              </div>
            </div>
            
            <div class="editor-content">
              <div v-if="generatingArticle" class="generating-overlay">
                <div class="generating-header">
                  <span>AI正在生成短文...</span>
                  <el-button size="small" type="danger" text @click="stopArticleGeneration">停止生成</el-button>
                </div>
                <div class="streaming-content">{{ articleStreamingContent }}</div>
              </div>
              
              <div v-else class="editor-wrapper">
                <Toolbar
                  :editor="articleEditorRef"
                  :defaultConfig="articleToolbarConfig"
                  mode="default"
                />
                <Editor
                  v-model="articleContent"
                  :defaultConfig="articleEditorConfig"
                  mode="default"
                  @onCreated="handleArticleEditorCreated"
                  @onChange="onArticleEditorChange"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 文风管理弹窗 -->
      <el-dialog v-model="showWritingStyleManager" title="文风配置管理" width="800px" class="writing-style-dialog">
        <div class="writing-style-container">
          <div class="style-header">
            <h4>文风配置</h4>
            <el-button type="primary" size="small" @click="addWritingStyle">
              <el-icon><Plus /></el-icon>添加文风
            </el-button>
          </div>
          
          <div class="style-list">
            <div v-for="(style, index) in configData.writingStyles" :key="index" class="style-item-row">
              <el-input v-model="style.label" placeholder="显示名称" class="style-input" />
              <el-input v-model="style.value" placeholder="值（英文）" class="style-input" />
              <el-input v-model="style.prompt" placeholder="文风提示词" class="style-input style-prompt-input" />
              <el-button type="danger" size="small" text @click="removeWritingStyle(index)">
                删除
              </el-button>
            </div>
          </div>
        </div>
        
        <template #footer>
          <div class="dialog-footer">
            <el-button @click="showWritingStyleManager = false">取消</el-button>
            <el-button type="primary" @click="saveWritingStyleConfig">保存配置</el-button>
          </div>
        </template>
      </el-dialog>

      <!-- 短篇小说模块 -->
      <div v-show="activeTab === 'story'" class="workspace">
        <div class="workspace-layout">
        
          <!-- 配置面板 -->
          <div class="config-sidebar">
            <div class="config-header">
              <h3>📖 小说配置</h3>
              <div class="header-actions">
                <el-button 
                  size="small" 
                  type="primary" 
                  @click="openConfigManager"
                  title="管理数据源设置"
                >
                  <el-icon><Setting /></el-icon>数据源设置
                </el-button>
                <el-button size="small" text @click="resetConfig">
                  重置
                </el-button>
              </div>
            </div>
            

            
            <el-button 
              type="primary" 
              @click="generateStory" 
              :loading="generating"
              :disabled="!isConfigValid"
              class="generate-btn"
            >
              <el-icon><MagicStick /></el-icon>
              {{ generating ? '生成中...' : '生成小说' }}
            </el-button>


            <!-- 验证提示 -->
            <div v-if="!isConfigValid" class="validation-tip">
              <el-icon><InfoFilled /></el-icon>
              <span>还需填写：
                <span v-if="!storyData.title">标题</span>
                <span v-if="!storyData.title && !storyData.protagonist.name">、</span>
                <span v-if="!storyData.protagonist.name">主角</span>
                <span v-if="(!storyData.title || !storyData.protagonist.name) && !unifiedPrompt.trim()">、</span>
                <span v-if="!unifiedPrompt.trim()">提示词</span>
              </span>
            </div>

            <div class="config-form">
              <!-- 基础配置区域 -->
              <div class="config-section">
                <div class="section-title">基础配置</div>
                <div class="form-grid">
                  <div class="form-item">
                    <label>小说标题</label>
                    <el-input v-model="storyData.title" placeholder="请输入小说标题" size="small" />
                  </div>
                  <div class="form-item">
                    <label>主角姓名</label>
                    <el-input v-model="storyData.protagonist.name" placeholder="请输入主角姓名" size="small" />
                  </div>
                  <div class="form-item">
                    <label>题材类型</label>
                    <el-select v-model="storyData.genre" placeholder="选择题材" size="small">
                      <el-option v-for="genre in customGenres" :key="genre.value" :label="genre.label" :value="genre.value" />
                    </el-select>
                  </div>
                  <div class="form-item">
                    <label>情节设定</label>
                    <el-select v-model="storyData.plotType" placeholder="选择情节" size="small">
                      <el-option v-for="plot in customPlotTypes" :key="plot.value" :label="plot.label" :value="plot.value" />
                    </el-select>
                  </div>
                  <div class="form-item">
                    <label>故事氛围</label>
                    <el-select v-model="storyData.emotion" placeholder="选择氛围" size="small">
                      <el-option v-for="emotion in customEmotions" :key="emotion.value" :label="emotion.label" :value="emotion.value" />
                    </el-select>
                  </div>
                  <div class="form-item">
                    <label>时代背景</label>
                    <el-select v-model="storyData.timeFrame" placeholder="选择时代" size="small">
                      <el-option v-for="time in customTimeFrames" :key="time.value" :label="time.label" :value="time.value" />
                    </el-select>
                  </div>
                  <div class="form-item">
                    <label>目标字数</label>
                    <el-input-number v-model="storyData.wordCount" :min="500" :max="10000" :step="100" size="small" style="width: 100%" />
                  </div>
                </div>
              </div>

              <!-- 创作提示词区域 -->
              <div class="config-section">
                <div class="section-header">
                  <div class="section-title">创作提示词</div>
                  <div class="section-actions">
                    <el-button size="small" text @click="showStoryPromptSelector = true">
                      <el-icon><List /></el-icon>模板
                    </el-button>
                    <el-button size="small" text type="primary" @click="showAdvancedConfig = showAdvancedConfig.includes('advanced') ? [] : ['advanced']">
                      {{ showAdvancedConfig.includes('advanced') ? '收起' : '展开' }}高级
                    </el-button>
                  </div>
                </div>
                
                <div v-if="selectedPromptTemplate" class="selected-template">
                  <el-tag type="info" size="small">{{ selectedPromptTemplate.title }}</el-tag>
                  <el-button size="small" text @click="clearSelectedTemplate">清除</el-button>
                </div>
                
                <el-input
                  v-model="unifiedPrompt"
                  type="textarea"
                  :rows="3"
                  :placeholder="promptPlaceholder"
                  size="small"
                />
              </div>

              <!-- 高级配置 -->
              <el-collapse v-model="showAdvancedConfig" class="advanced-config">
                <el-collapse-item title="高级配置" name="advanced">
                  <div class="form-grid">
                    <div class="form-item">
                      <label>主角性别</label>
                      <el-radio-group v-model="storyData.protagonist.gender" size="small">
                        <el-radio-button label="male">男</el-radio-button>
                        <el-radio-button label="female">女</el-radio-button>
                      </el-radio-group>
                    </div>
                    <div class="form-item">
                      <label>主角年龄</label>
                      <div class="age-input">
                        <el-button size="small" @click="storyData.protagonist.age = Math.max(10, storyData.protagonist.age - 1)">-</el-button>
                        <span class="age-display">{{ storyData.protagonist.age }}</span>
                        <el-button size="small" @click="storyData.protagonist.age = Math.min(100, storyData.protagonist.age + 1)">+</el-button>
                      </div>
                    </div>
                  </div>
                  
                  <div class="form-item">
                    <label>故事地点</label>
                    <el-input v-model="storyData.location" placeholder="故事发生地点" size="small" />
                  </div>
                  
                  <div class="form-item full-width">
                    <label>参考文本</label>
                    <el-input
                      v-model="storyData.referenceText"
                      type="textarea"
                      :rows="2"
                      placeholder="可以贴一些参考文本或风格例子（可选）"
                      size="small"
                    />
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>

            
          </div>

          <!-- 编辑器 -->
          <div class="editor-main">
            <div class="editor-header">
              <div class="editor-title">
                <span>{{ storyData.title || '小说编辑器' }}</span>
                <span class="word-count">{{ getTextWordCount(generatedStory) }} 字</span>
              </div>
              <div class="editor-actions">
                <el-button size="small" @click="continueStory" :disabled="!generatedStory || continuingStory">
                  <el-icon><EditPen /></el-icon>续写
                </el-button>
                <el-button size="small" @click="optimizeSelection" :disabled="!generatedStory">
                  <el-icon><MagicStick /></el-icon>优化
                </el-button>

                <el-button size="small" @click="exportStory" :disabled="!generatedStory">
                  <el-icon><Download /></el-icon>导出
                </el-button>
              </div>
            </div>
            
            <div class="editor-content">
              <!-- 生成状态提示 -->
              <div v-if="generating" class="generating-status">
                <div class="status-bar">
                  <div class="status-info">
                    <el-icon class="rotating"><Loading /></el-icon>
                    <span>AI正在生成小说... ({{ streamingContent.length }}字)</span>
                  </div>
                  <el-button size="small" type="danger" text @click="stopGeneration">停止生成</el-button>
                </div>
              </div>
              
              <div class="editor-wrapper">
                <Toolbar
                  :editor="editorRef"
                  :defaultConfig="toolbarConfig"
                  mode="default"
                />
                <Editor
                  v-model="generatedStory"
                  :defaultConfig="editorConfig"
                  mode="default"
                  @onCreated="handleEditorCreated"
                  @onChange="onEditorChange"
                  @mouseup="handleTextSelection"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 对话框 -->
    <!-- 短文提示词选择对话框 -->
    <el-dialog v-model="showArticlePromptSelector" title="选择短文提示词模板" width="80%" :before-close="handleArticlePromptDialogClose">
      <div class="prompt-selector">
        <div class="search-bar">
          <el-input v-model="articlePromptSearchKeyword" placeholder="搜索提示词模板..." prefix-icon="Search" size="small" clearable />
        </div>
        <div class="prompt-list">
          <div v-for="prompt in filteredArticlePrompts" :key="prompt.id" class="prompt-item" @click="selectArticlePrompt(prompt)">
            <div class="prompt-title">{{ prompt.title }}</div>
            <div class="prompt-description">{{ prompt.description }}</div>
            <div class="prompt-tags">
              <el-tag v-for="tag in prompt.tags" :key="tag" size="small">{{ tag }}</el-tag>
            </div>
          </div>
        </div>
        <div v-if="filteredArticlePrompts.length === 0" class="empty-state">
          <el-empty description="暂无短文提示词模板">
            <el-button type="primary" @click="createPrompt">创建提示词</el-button>
          </el-empty>
        </div>
      </div>
    </el-dialog>

    <!-- 短篇小说提示词选择对话框 -->
    <el-dialog v-model="showStoryPromptSelector" title="选择短篇小说提示词模板" width="80%" :before-close="handleStoryPromptDialogClose">
      <div class="prompt-selector">
        <div class="search-bar">
          <el-input v-model="storyPromptSearchKeyword" placeholder="搜索提示词模板..." prefix-icon="Search" size="small" clearable />
        </div>
        <div class="prompt-list">
          <div v-for="prompt in filteredStoryPrompts" :key="prompt.id" class="prompt-item" @click="selectStoryPrompt(prompt)">
            <div class="prompt-title">{{ prompt.title }}</div>
            <div class="prompt-description">{{ prompt.description }}</div>
            <div class="prompt-tags">
              <el-tag v-for="tag in prompt.tags" :key="tag" size="small">{{ tag }}</el-tag>
            </div>
          </div>
        </div>
        <div v-if="filteredStoryPrompts.length === 0" class="empty-state">
          <el-empty description="暂无短篇小说提示词模板">
            <el-button type="primary" @click="createPrompt">创建提示词</el-button>
          </el-empty>
        </div>
      </div>
    </el-dialog>

    <!-- 续写对话框 -->
    <el-dialog 
      v-model="showContinueDialog" 
      title="" 
      width="1000px" 
      class="modern-continue-dialog"
      :show-close="false"
      destroy-on-close
    >
      <template #header>
        <div class="dialog-header">
          <div class="header-left">
            <div class="header-icon">
              <el-icon size="24"><EditPen /></el-icon>
            </div>
            <div class="header-text">
              <h3>AI智能续写</h3>
              <p>基于现有内容智能续写，保持风格连贯</p>
            </div>
          </div>
          <el-button 
            type="text" 
            size="large" 
            @click="showContinueDialog = false"
            class="close-btn"
          >
            <el-icon size="20"><Close /></el-icon>
          </el-button>
        </div>
      </template>
      
      <div class="modern-continue-container">
        <!-- 配置卡片 -->
        <el-card shadow="never" class="config-card">
          <template #header>
            <div class="card-header">
              <el-icon><Setting /></el-icon>
              <span>续写配置</span>
            </div>
          </template>
          
          <div class="config-content">
            <div class="config-row">
              <div class="config-item">
                <label class="config-label">
                  <el-icon><Document /></el-icon>
                  续写方向
                </label>
                <el-input 
                  v-model="continueDirection"
                  type="textarea"
                  :rows="4"
                  placeholder="描述续写的具体方向和要求，例如：\n• 推进主角与反派的最终对决\n• 展现角色内心的复杂情感\n• 描写紧张刺激的追逐场面\n• 揭示隐藏已久的重要秘密\n\n留空将根据前文内容自动续写"
                  class="direction-input"
                />
              </div>
              
              <div class="config-item">
                <label class="config-label">
                  <el-icon><Tickets /></el-icon>
                  续写字数
                </label>
                <el-slider
                  v-model="continueWordCount"
                  :min="200"
                  :max="5000"
                  :step="100"
                  show-input
                  :format-tooltip="(val) => `${val}字`"
                  class="word-count-slider"
                />
              </div>
            </div>
            
            <div class="tips-section">
              <div class="tips-header">
                <el-icon><InfoFilled /></el-icon>
                <span>使用提示</span>
              </div>
              <div class="tips-grid">
                <div class="tip-item">
                  <el-icon color="var(--el-color-success)"><Check /></el-icon>
                  <span>基于当前内容智能续写</span>
                </div>
                <div class="tip-item">
                  <el-icon color="var(--el-color-success)"><Check /></el-icon>
                  <span>保持原有风格和语调</span>
                </div>
                <div class="tip-item">
                  <el-icon color="var(--el-color-success)"><Check /></el-icon>
                  <span>支持自定义续写方向</span>
                </div>
                <div class="tip-item">
                  <el-icon color="var(--el-color-success)"><Check /></el-icon>
                  <span>确保情节自然连贯</span>
                </div>
              </div>
            </div>
          </div>
        </el-card>
        
        <!-- 结果卡片 -->
        <el-card shadow="never" class="result-card">
          <template #header>
            <div class="card-header">
              <el-icon><Magic /></el-icon>
              <span>续写结果</span>
              <div class="header-actions" v-if="continueResult && !continuingStory">
                <el-button size="small" @click="copyContinueText">
                  <el-icon><CopyDocument /></el-icon>
                  复制
                </el-button>
              </div>
            </div>
          </template>
          
          <div class="result-content">
            <!-- 续写中状态 -->
            <div v-if="continuingStory" class="streaming-state">
              <div class="streaming-header">
                <div class="streaming-icon">
                  <el-icon class="rotating"><Loading /></el-icon>
                </div>
                <div class="streaming-text">
                  <h4>AI正在创作中...</h4>
                  <p>请稍候，正在为您生成精彩的续写内容</p>
                </div>
              </div>
              <div class="streaming-content" v-if="continueResult">
                <div class="streaming-text-content">{{ continueResult }}</div>
              </div>
            </div>
            
            <!-- 续写完成状态 -->
            <div v-else-if="continueResult" class="result-display">
              <div class="result-stats">
                <div class="stat-item">
                  <span class="stat-label">续写字数</span>
                  <span class="stat-value">{{ continueResult.length }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">预计阅读</span>
                  <span class="stat-value">{{ Math.ceil(continueResult.length / 300) }}分钟</span>
                </div>
              </div>
              <div ref="continueTextRef" class="result-text">{{ continueResult }}</div>
            </div>
            
            <!-- 空状态 -->
            <div v-else class="empty-state">
              <div class="empty-icon">
                <el-icon size="48" color="#c0c4cc"><Document /></el-icon>
              </div>
              <h4>准备开始续写</h4>
              <p>点击下方按钮，AI将基于您的现有内容进行智能续写</p>
            </div>
          </div>
        </el-card>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <div class="footer-info">
            <el-icon><InfoFilled /></el-icon>
            <span>续写将基于当前{{ (generatedStory || '').replace(/<[^>]*>/g, '').length }}字的内容</span>
          </div>
          <div class="footer-actions">
            <el-button size="large" @click="showContinueDialog = false">取消</el-button>
            <el-button 
              type="primary" 
              size="large" 
              @click="performContinue" 
              :loading="continuingStory"
              :disabled="!generatedStory || generatedStory.replace(/<[^>]*>/g, '').trim().length < 50"
            >
              <el-icon v-if="!continuingStory"><Magic /></el-icon>
              {{ continuingStory ? '续写中...' : (continueResult ? '重新续写' : '开始续写') }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 选段优化对话框 -->
    <el-dialog v-model="showOptimizeModal" title="✨ 选段优化" width="900px" class="optimize-dialog">
      <div class="optimize-container">
        <el-row :gutter="20" style="height: 100%;">
          <!-- 左侧：配置区域 -->
          <el-col :span="12" style="height: 100%;">
            <div class="optimize-config">
              <div class="config-section">
                <h4>选中的文本</h4>
                <div class="selected-text-preview">{{ selectedTextForOptimize || '请先在编辑器中选择要优化的文本' }}</div>
              </div>
              
              <div class="config-section">
                <h4>优化方向</h4>
                <el-input 
                  v-model="optimizeDirection"
                  type="textarea"
                  :rows="6"
                  placeholder="请描述优化方向，例如：&#10;- 使语言更加生动形象&#10;- 增强情感表达&#10;- 优化描写细节&#10;- 提升文学性&#10;- 改善节奏感"
                />
              </div>
              
              <div class="config-actions">
                <el-button @click="showOptimizeModal = false">取消</el-button>
                <el-button type="primary" @click="performOptimize" :loading="optimizing">
                  {{ optimizing ? '优化中...' : '开始优化' }}
                </el-button>
              </div>
            </div>
          </el-col>
          
          <!-- 右侧：结果区域 -->
          <el-col :span="12" style="height: 100%;">
            <div class="optimize-result">
              <div class="result-header">
                <h4>优化结果</h4>
              </div>
              
              <div class="result-content">
                <!-- 优化状态提示 -->
                <div v-if="optimizing" class="optimizing-status">
                  <div class="status-bar">
                    <div class="status-info">
                      <el-icon class="rotating"><Loading /></el-icon>
                      <span>AI正在优化中... ({{ optimizedResult.length }}字)</span>
                    </div>
                  </div>
                </div>
                
                <!-- 优化结果显示区域 -->
                <div v-if="optimizedResult || optimizing" class="optimized-content-container">
                  <div ref="optimizedTextRef" class="optimized-content">{{ optimizedResult }}</div>
                  <div v-if="!optimizing" class="result-actions">
                    <el-button size="small" @click="copyOptimizedText">复制</el-button>
                    <el-button size="small" type="primary" @click="replaceOriginalText">替换原文</el-button>
                  </div>
                </div>
                
                <div v-else class="empty-result">
                  <el-empty description="点击开始优化" image-size="80" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>
    </el-dialog>

    <!-- 配置管理对话框 -->
    <el-dialog v-model="showConfigManager" title="创作配置管理" width="1000px" class="config-manager-dialog">
      <div class="config-manager-container">
        <el-tabs v-model="activeConfigTab" class="config-tabs">
          <!-- 题材管理 -->
          <el-tab-pane label="题材" name="genres">
            <div class="config-tab-content">
              <div class="tab-header">
                <h4>题材配置</h4>
                <el-button type="primary" size="small" @click="addConfigItem('genres')">
                  <el-icon><Plus /></el-icon>添加题材
                </el-button>
              </div>
              
              <div class="config-list">
                <div v-for="(item, index) in configData.genres" :key="index" class="config-item-row">
                  <el-input v-model="item.label" placeholder="显示名称" class="config-input" />
                  <el-input v-model="item.value" placeholder="值（英文）" class="config-input" />
                  <el-input v-model="item.description" placeholder="描述" class="config-input description-input" />
                  <el-button type="danger" size="small" text @click="removeConfigItem('genres', index)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 情节管理 -->
          <el-tab-pane label="情节" name="plotTypes">
            <div class="config-tab-content">
              <div class="tab-header">
                <h4>情节配置</h4>
                <el-button type="primary" size="small" @click="addConfigItem('plotTypes')">
                  <el-icon><Plus /></el-icon>添加情节
                </el-button>
              </div>
              
              <div class="config-list">
                <div v-for="(item, index) in configData.plotTypes" :key="index" class="config-item-row">
                  <el-input v-model="item.label" placeholder="显示名称" class="config-input" />
                  <el-input v-model="item.value" placeholder="值（英文）" class="config-input" />
                  <el-input v-model="item.description" placeholder="描述" class="config-input description-input" />
                  <el-button type="danger" size="small" text @click="removeConfigItem('plotTypes', index)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 氛围管理 -->
          <el-tab-pane label="氛围" name="emotions">
            <div class="config-tab-content">
              <div class="tab-header">
                <h4>氛围配置</h4>
                <el-button type="primary" size="small" @click="addConfigItem('emotions')">
                  <el-icon><Plus /></el-icon>添加氛围
                </el-button>
              </div>
              
              <div class="config-list">
                <div v-for="(item, index) in configData.emotions" :key="index" class="config-item-row">
                  <el-input v-model="item.label" placeholder="显示名称" class="config-input" />
                  <el-input v-model="item.value" placeholder="值（英文）" class="config-input" />
                  <el-input v-model="item.description" placeholder="描述" class="config-input description-input" />
                  <el-button type="danger" size="small" text @click="removeConfigItem('emotions', index)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 时代管理 -->
          <el-tab-pane label="时代" name="timeFrames">
            <div class="config-tab-content">
              <div class="tab-header">
                <h4>时代配置</h4>
                <el-button type="primary" size="small" @click="addConfigItem('timeFrames')">
                  <el-icon><Plus /></el-icon>添加时代
                </el-button>
              </div>
              
              <div class="config-list">
                <div v-for="(item, index) in configData.timeFrames" :key="index" class="config-item-row">
                  <el-input v-model="item.label" placeholder="显示名称" class="config-input" />
                  <el-input v-model="item.value" placeholder="值（英文）" class="config-input" />
                  <el-input v-model="item.description" placeholder="描述" class="config-input description-input" />
                  <el-button type="danger" size="small" text @click="removeConfigItem('timeFrames', index)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>


        </el-tabs>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="resetToDefault">恢复默认</el-button>
          <el-button @click="showConfigManager = false">取消</el-button>
          <el-button type="primary" @click="saveConfigData">保存配置</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, shallowRef, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick, Refresh, EditPen, Download, Check, Loading, Plus, Setting, List, DocumentCopy, Switch, Delete, Search, InfoFilled } from '@element-plus/icons-vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import '@wangeditor/editor/dist/css/style.css'
import { useNovelStore } from '@/stores/novel'
import { storageGet, storageSet, StorageKeys } from '@/utils/storage'
import { useRouter } from 'vue-router'

const novelStore = useNovelStore()
const router = useRouter()

// 模块切换
const activeTab = ref('article') // 默认显示短文模块

// 短文模块数据
const articleData = reactive({
  title: '',
  wordCount: 800,
  style: '',
  prompt: '',
  references: []
})

// 短文模块状态
const generatingArticle = ref(false)
const articleContent = ref('')
const articleStreamingContent = ref('')
const selectedArticlePromptTemplate = ref(null)
const showArticlePromptSelector = ref(false)
const articlePromptSearchKeyword = ref('')

// 响应式数据
const generating = ref(false)
const streamingContent = ref('')
const continuingStory = ref(false)
const generatedStory = ref('')
const hasSelection = ref(false)
const selectedText = ref('')
const showAdvancedConfig = ref([])
const unifiedPrompt = ref('')

// 续写相关
const showContinueDialog = ref(false)
const continueDirection = ref('')
const continueWordCount = ref(2000)
const continueResult = ref('')
const continueTextRef = ref(null)

// 配置管理相关
const showConfigManager = ref(false)
const activeConfigTab = ref('genres')
const showWritingStyleManager = ref(false)

// 提示词选择相关
const showPromptSelector = ref(false)
const selectedPromptId = ref(null)
const selectedPromptTemplate = ref(null)
const previewPrompt = ref(null)
const editablePromptContent = ref('')
const availablePrompts = ref([])

// 选段优化相关
const showOptimizeModal = ref(false)
const selectedTextForOptimize = ref('')
const optimizeDirection = ref('')
const optimizing = ref(false)
const optimizedResult = ref('')
const optimizedTextRef = ref(null)

// 短文模块计算属性
const isArticleConfigValid = computed(() => {
  return articleData.title.trim() && articleData.prompt.trim()
})

const articleWordCount = computed(() => {
  if (!articleContent.value) return 0
  // 移除HTML标签并计算字数
  return articleContent.value.replace(/<[^>]*>/g, '').trim().length
})

const filteredArticlePrompts = computed(() => {
  const allPrompts = storageGet(StorageKeys.prompts, [])
  const articlePrompts = allPrompts.filter(p => p.category === 'short-story')
  
  if (!articlePromptSearchKeyword.value) {
    return articlePrompts
  }
  
  const keyword = articlePromptSearchKeyword.value.toLowerCase()
  return articlePrompts.filter(prompt => 
    prompt.title.toLowerCase().includes(keyword) ||
    prompt.description.toLowerCase().includes(keyword) ||
    prompt.tags.some(tag => tag.toLowerCase().includes(keyword))
  )
})

// 短篇小说提示词选择
const showStoryPromptSelector = ref(false)
const storyPromptSearchKeyword = ref('')

// 计算属性 - 短篇小说提示词
const filteredStoryPrompts = computed(() => {
  const allPrompts = storageGet(StorageKeys.prompts, [])
  const storyPrompts = allPrompts.filter(p => p.category === 'short-story')
  
  if (!storyPromptSearchKeyword.value) {
    return storyPrompts
  }
  
  const keyword = storyPromptSearchKeyword.value.toLowerCase()
  return storyPrompts.filter(prompt => 
    prompt.title.toLowerCase().includes(keyword) ||
    prompt.description.toLowerCase().includes(keyword) ||
    prompt.tags.some(tag => tag.toLowerCase().includes(keyword))
  )
})

// 计算属性 - 提示词占位符
const promptPlaceholder = computed(() => {
  if (selectedPromptTemplate.value) {
    return '请编辑上方选择的提示词模板，可以根据需要修改内容'
  }
  return `请详细描述您想要创作的短篇小说，包括：
• 主角的性格特点和背景
• 故事情节和冲突
• 场景和环境描述
• 您希望的故事风格和结局

例如：创作一篇都市爱情小说，主角是25岁的软件工程师李明，性格内向但善良。故事讲述他在咖啡馆遇到了画家女孩小雅，两人从陌生到相知相爱的过程。希望故事温馨感人，有一些生活的小细节，结局美满。`
})

// WangEditor相关
const editorRef = shallowRef()
const toolbarConfig = {}
const editorConfig = {
  placeholder: '生成的小说内容将显示在这里...',
  MENU_CONF: {
    uploadImage: {
      server: '/api/upload-image',
      fieldName: 'file',
      maxFileSize: 5 * 1024 * 1024,
      allowedFileTypes: ['image/*']
    }
  }
}

// 短文编辑器相关
const articleEditorRef = shallowRef()
const articleToolbarConfig = {}
const articleEditorConfig = {
  placeholder: '生成的短文内容将显示在这里，您也可以直接编辑...',
  MENU_CONF: {
    uploadImage: {
      server: '/api/upload-image',
      fieldName: 'file',
      maxFileSize: 5 * 1024 * 1024,
      allowedFileTypes: ['image/*']
    }
  }
}

// 故事数据
const storyData = reactive({
  genre: '',
  protagonist: {
    name: '',
    gender: 'male',
    age: 25
  },
  plotType: '',
  emotion: '',
  timeFrame: '',
  location: '',
  referenceText: '',
  title: '',
  wordCount: 3000
})

// 默认配置数据
const defaultConfigData = {
  genres: [
    { value: 'urban', label: '都市生活', description: '现代都市背景，贴近生活' },
    { value: 'urban_evil', label: '都市恶灵', description: '都市背景的恐怖灵异故事' },
    { value: 'fantasy', label: '奇幻冒险', description: '魔法世界，英雄历险' },
    { value: 'romance', label: '浪漫爱情', description: '感人爱情故事' },
    { value: 'mystery', label: '悬疑推理', description: '谜题解密，逻辑推理' },
    { value: 'scifi', label: '科幻未来', description: '未来科技，星际探索' },
    { value: 'horror', label: '惊悚恐怖', description: '恐怖氛围，惊心动魄' }
  ],
  plotTypes: [
    { value: 'growth', label: '成长蜕变', description: '主角经历挫折后成长' },
    { value: 'adventure', label: '冒险探索', description: '探索未知，寻找宝藏' },
    { value: 'conflict', label: '冲突解决', description: '面对冲突，寻求解决' },
    { value: 'redemption', label: '救赎重生', description: '犯错后的救赎之路' },
    { value: 'discovery', label: '发现真相', description: '揭露隐藏的秘密' }
  ],
  emotions: [
    { value: 'happy', label: '😊 欢乐', description: '轻松愉快的氛围' },
    { value: 'sad', label: '😢 悲伤', description: '感人催泪的情感' },
    { value: 'tense', label: '😰 紧张', description: '紧张刺激的氛围' },
    { value: 'romantic', label: '💕 浪漫', description: '温馨浪漫的情调' },
    { value: 'mysterious', label: '🔮 神秘', description: '神秘未知的氛围' }
  ],
  timeFrames: [
    { value: 'ancient', label: '古代', description: '古代背景设定' },
    { value: 'modern', label: '近代', description: '近代历史背景' },
    { value: 'contemporary', label: '当代', description: '现代社会背景' },
    { value: 'future', label: '未来', description: '未来科幻背景' }
  ],
  writingStyles: [
    { value: 'zhihu', label: '知乎风格', description: '理性分析，逻辑清晰，适合深度思考类内容' },
    { value: 'wechat', label: '公众号风格', description: '亲和力强，易于传播，适合大众阅读' },
    { value: 'toutiao', label: '头条风格', description: '标题党，吸引眼球，适合热点话题' },
    { value: 'xiaohongshu', label: '小红书风格', description: '生活化，年轻态，适合分享体验' },
    { value: 'weibo', label: '微博风格', description: '简洁明快，热点话题，适合快速传播' },
    { value: 'academic', label: '学术风格', description: '严谨专业，引经据典，适合学术论述' },
    { value: 'news', label: '新闻风格', description: '客观中立，事实为主，适合新闻报道' },
    { value: 'story', label: '故事风格', description: '叙事生动，情节丰富，适合故事创作' }
  ]
}

// 配置数据
const configData = reactive({
  genres: [],
  plotTypes: [],
  emotions: [],
  timeFrames: [],
  writingStyles: []
})

// 计算属性
const isConfigValid = computed(() => {
  return storyData.title && 
         storyData.protagonist.name && 
         unifiedPrompt.value.trim().length > 0
})

// 获取当前配置选项
const customGenres = computed(() => configData.genres)
const customPlotTypes = computed(() => configData.plotTypes)
const customEmotions = computed(() => configData.emotions)
const customTimeFrames = computed(() => configData.timeFrames)
const customWritingStyles = computed(() => configData.writingStyles)

// 短文模块方法
const handleTabClick = (tab) => {
  activeTab.value = tab.name
}

const resetArticleConfig = () => {
  articleData.title = ''
  articleData.wordCount = 800
  articleData.style = ''
  articleData.prompt = ''
  articleData.references = []
  articleContent.value = ''
}

const addReferenceArticle = () => {
  articleData.references.push({
    title: '',
    content: ''
  })
}

const removeReferenceArticle = (index) => {
  articleData.references.splice(index, 1)
}

const selectArticlePrompt = (prompt) => {
  selectedArticlePromptTemplate.value = prompt
  articleData.prompt = prompt.content
  showArticlePromptSelector.value = false
}

const clearArticleSelectedTemplate = () => {
  selectedArticlePromptTemplate.value = null
}

const handleArticlePromptDialogClose = () => {
  showArticlePromptSelector.value = false
  articlePromptSearchKeyword.value = ''
}

// 短篇小说提示词选择方法
const selectStoryPrompt = (prompt) => {
  selectedPromptTemplate.value = prompt
  unifiedPrompt.value = prompt.content
  showStoryPromptSelector.value = false
}

const handleStoryPromptDialogClose = () => {
  showStoryPromptSelector.value = false
  storyPromptSearchKeyword.value = ''
}

const generateArticle = async () => {
  if (!isArticleConfigValid.value) {
    ElMessage.warning('请完善文章配置')
    return
  }

  try {
    generatingArticle.value = true
    articleContent.value = ''
    articleStreamingContent.value = ''

    // 构建提示词
    let prompt = `请根据以下要求创作一篇短文：

标题：${articleData.title}
字数：约${articleData.wordCount}字
文风类型：${getStyleDescription(articleData.style)}

创作要求：
${articleData.prompt}`

    // 添加参考文章
    if (articleData.references.length > 0) {
      prompt += `\n\n参考文章：\n`
      articleData.references.forEach((ref, index) => {
        if (ref.title || ref.content) {
          prompt += `参考${index + 1}：\n`
          if (ref.title) prompt += `标题：${ref.title}\n`
          if (ref.content) prompt += `内容：${ref.content}\n\n`
        }
      })
    }

    prompt += `\n请创作一篇符合要求的${articleData.wordCount}字左右的短文，要求内容充实，语言流畅，符合指定的文风特点。`

    // 调用AI生成
    let accumulatedText = ''
    await novelStore.generateContent(prompt, (chunk) => {
      if (!generatingArticle.value) return // 如果已停止，不更新内容
      
      accumulatedText += chunk
      articleStreamingContent.value = accumulatedText
      
      // 实时更新编辑器内容
      const htmlContent = accumulatedText.replace(/\n/g, '<br/>')
      articleContent.value = htmlContent
      
      // 同步更新编辑器显示
      if (articleEditorRef.value) {
        nextTick(() => {
          if (articleEditorRef.value) {
            articleEditorRef.value.setHtml(htmlContent)
          }
        })
      }
    })

    if (generatingArticle.value) { // 只有在没被停止的情况下才设置最终内容
      // 将换行转换为适合富文本编辑器的格式
      const finalContent = accumulatedText.replace(/\n/g, '<br/>')
      articleContent.value = finalContent
      
      // 确保编辑器显示最终内容
      if (articleEditorRef.value) {
        articleEditorRef.value.setHtml(finalContent)
      }
      
      ElMessage.success('短文生成完成')
    }

  } catch (error) {
    console.error('短文生成失败:', error)
    ElMessage.error(`生成失败: ${error.message}`)
  } finally {
    generatingArticle.value = false
    articleStreamingContent.value = ''
  }
}

const stopArticleGeneration = () => {
  generatingArticle.value = false
  ElMessage.info('已停止生成')
}

const copyArticleContent = async () => {
  if (!articleContent.value) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  
  try {
    // 移除HTML标签，获取纯文本
    const plainText = articleContent.value.replace(/<[^>]*>/g, '').trim()
    await navigator.clipboard.writeText(plainText)
    ElMessage.success('内容已复制到剪贴板')
  } catch (error) {
    ElMessage.error('复制失败')
  }
}

const saveArticle = () => {
  if (!articleContent.value) {
    ElMessage.warning('没有可保存的内容')
    return
  }
  
  // 移除HTML标签，获取纯文本
  const plainText = articleContent.value.replace(/<[^>]*>/g, '').trim()
  const content = `${articleData.title}\n\n${plainText}`
  
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${articleData.title || '短文'}.txt`
  link.click()
  ElMessage.success('文章已保存')
}

const clearArticleContent = () => {
  ElMessageBox.confirm('确定要清空内容吗？', '确认', {
    type: 'warning'
  }).then(() => {
    articleContent.value = ''
    ElMessage.success('内容已清空')
  }).catch(() => {})
}

const getStyleDescription = (style) => {
  const styleInfo = customWritingStyles.value.find(s => s.value === style)
  if (styleInfo) {
    // 如果有文风提示词，返回完整信息
    if (styleInfo.prompt) {
      return `${styleInfo.label} - ${styleInfo.description}\n\n文风要求：${styleInfo.prompt}`
    }
    return `${styleInfo.label} - ${styleInfo.description}`
  }
  return '通用风格'
}

const createPrompt = () => {
  router.push('/prompts')
}

// 方法

const generateStory = async () => {
  if (generating.value) return
  
  generating.value = true
  generatedStory.value = ''
  
  try {
    const prompt = buildStoryPrompt()
    
    // 添加详细的调试信息
    console.log('=== 短篇小说生成调试信息 ===')
    console.log('prompt类型:', typeof prompt)
    console.log('prompt长度:', prompt.length)
    console.log('prompt内容:', prompt)
    
    // 检查prompt中是否包含可能导致JSON问题的字符
    const problematicChars = prompt.match(/[\u0000-\u001F\u007F-\u009F]/g)
    if (problematicChars) {
      console.warn('发现控制字符:', problematicChars)
    }
    
    // 检查是否有未转义的引号
    const unescapedQuotes = prompt.match(/(?<!\\)"/g)
    if (unescapedQuotes) {
      console.warn('发现未转义的引号数量:', unescapedQuotes.length)
    }
    
    // 尝试JSON序列化测试
    try {
      JSON.stringify({ content: prompt })
      console.log('JSON序列化测试通过')
    } catch (jsonError) {
      console.error('JSON序列化测试失败:', jsonError)
      throw new Error('提示词包含无法序列化的字符: ' + jsonError.message)
    }
    
    // 使用流式返回
    let accumulatedText = ''
    await novelStore.generateContent(prompt, (chunk) => {
      if (!generating.value) return // 如果已停止，不更新内容
      
      accumulatedText += chunk
      streamingContent.value = accumulatedText
      
      // 将纯文本转换为HTML格式
      const htmlContent = accumulatedText.replace(/\n/g, '<br/>')
      generatedStory.value = htmlContent
      
      // 实时更新编辑器显示
      if (editorRef.value) {
        // 使用nextTick确保DOM更新
        nextTick(() => {
          if (editorRef.value) {
            editorRef.value.setHtml(htmlContent)
          }
        })
      }
    })
    
    ElMessage.success('小说生成成功！')
  } catch (error) {
    console.error('=== 生成失败详细信息 ===')
    console.error('错误类型:', error.constructor.name)
    console.error('错误消息:', error.message)
    console.error('错误堆栈:', error.stack)
    ElMessage.error('生成失败：' + error.message)
  } finally {
    generating.value = false
  }
}

const buildStoryPrompt = () => {
  const { protagonist, genre, plotType, emotion, timeFrame, location } = storyData
  
  let prompt = `请根据以下要求创作一篇短篇小说：\n\n`
  
  // 基础信息 - 始终包含所有参数设置
  prompt += `【基础设定】\n`
  prompt += `- 小说标题：${storyData.title}\n`
  prompt += `- 主角姓名：${protagonist.name}`
  if (protagonist.gender) {
    prompt += `（${protagonist.gender === 'male' ? '男性' : '女性'}`
    if (protagonist.age) {
      prompt += `，${protagonist.age}岁`
    }
    prompt += `）`
  }
  prompt += `\n`
  
  // 所有设置参数都传递给AI
  if (genre) {
    const genreInfo = customGenres.value.find(g => g.value === genre)
    prompt += `- 题材风格：${genreInfo?.label || genre}\n`
  }
  if (plotType) {
    const plotInfo = customPlotTypes.value.find(p => p.value === plotType)
    prompt += `- 情节类型：${plotInfo?.label || plotType}\n`
  }
  if (emotion) {
    const emotionInfo = customEmotions.value.find(e => e.value === emotion)
    // 修复表情符号处理，确保JSON序列化安全
    let emotionLabel = emotion
    if (emotionInfo && emotionInfo.label) {
      // 移除所有表情符号和特殊字符，只保留文字
      emotionLabel = emotionInfo.label.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim()
      // 如果去掉表情符号后为空，使用原始emotion值
      if (!emotionLabel) {
        emotionLabel = emotion
      }
    }
    prompt += `- 情绪氛围：${emotionLabel}\n`
  }
  if (timeFrame) {
    const timeInfo = customTimeFrames.value.find(t => t.value === timeFrame)
    prompt += `- 时间背景：${timeInfo?.label || timeFrame}\n`
  }
  if (location) {
    prompt += `- 故事地点：${location}\n`
  }
  
  // 字数要求 - 现在是数字形式
  if (storyData.wordCount) {
    prompt += `- 目标字数：${storyData.wordCount}字\n`
  }
  
  // 创作要求部分 - 包含提示词模板和自定义要求
  prompt += `\n【创作要求】\n`
  
  // 如果使用了提示词模板，将其作为创作要求的一部分
  if (selectedPromptTemplate.value && unifiedPrompt.value) {
    prompt += `${unifiedPrompt.value}\n\n`
    console.log('已将提示词模板和所有参数设置传递给AI')
  } else if (unifiedPrompt.value) {
    prompt += `${unifiedPrompt.value}\n\n`
  }
  
  if (storyData.referenceText) {
    prompt += `【参考文本】\n${storyData.referenceText}\n\n`
  }
  
  prompt += `请创作一篇完整的短篇小说，字数控制在${storyData.wordCount}字左右，要求情节完整，人物鲜明，语言生动。`
  
  // 添加调试日志
  console.log('构建的prompt长度:', prompt.length)
  console.log('prompt预览:', prompt.substring(0, 200) + '...')
  
  return prompt
}

const regenerateStory = () => {
  generatedStory.value = ''
  generateStory()
}

// 续写功能
const continueStory = async () => {
  if (continuingStory.value) return
  
  // 显示续写弹窗
  showContinueDialog.value = true
  continueDirection.value = ''
  continueResult.value = ''
}

// 执行续写
const performContinue = async () => {
  if (continuingStory.value) return
  
  // 获取当前故事内容（去除HTML标签）
  const currentText = generatedStory.value ? generatedStory.value.replace(/<[^>]*>/g, '') : ''
  if (!currentText.trim()) {
    ElMessage.warning('请先生成一些内容再进行续写')
    return
  }
  
  continuingStory.value = true
  continueResult.value = ''
  
  try {
    // 构建续写提示词
    const continuePrompt = buildContinuePrompt(currentText)
    
    console.log('=== 续写调试信息 ===')
    console.log('续写prompt长度:', continuePrompt.length)
    console.log('当前内容长度:', currentText.length)
    console.log('续写方向:', continueDirection.value)
    
    // 使用流式返回，实时更新续写结果
    let accumulatedText = ''
    await novelStore.generateContent(continuePrompt, (chunk) => {
      if (!continuingStory.value) return // 如果已停止，不更新内容
      
      accumulatedText += chunk
      continueResult.value = accumulatedText
      
      // 自动滚动到底部
      nextTick(() => {
        if (continueTextRef.value) {
          continueTextRef.value.scrollTop = continueTextRef.value.scrollHeight
        }
      })
    })
    
    ElMessage.success('续写完成！')
  } catch (error) {
    console.error('续写失败:', error)
    ElMessage.error('续写失败：' + error.message)
  } finally {
    continuingStory.value = false
  }
}



// 复制续写内容
const copyContinueText = async () => {
  try {
    if (!continueResult.value.trim()) {
      ElMessage.warning('没有续写内容可以复制')
      return
    }
    
    await navigator.clipboard.writeText(continueResult.value)
    ElMessage.success('续写内容已复制到剪贴板')
  } catch (error) {
    console.error('复制失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

// 追加续写内容到原文
// 构建续写提示词
const buildContinuePrompt = (currentText) => {
  const { protagonist, genre, plotType, emotion, timeFrame, location } = storyData
  
  let prompt = `请继续续写以下短篇小说，保持风格和情节的连贯性：\n\n`
  
  // 添加原始设置信息，保持一致性
  prompt += `【原始设定】\n`
  prompt += `- 小说标题：${storyData.title}\n`
  prompt += `- 主角姓名：${protagonist.name}`
  if (protagonist.gender) {
    prompt += `（${protagonist.gender === 'male' ? '男性' : '女性'}`
    if (protagonist.age) {
      prompt += `，${protagonist.age}岁`
    }
    prompt += `）`
  }
  prompt += `\n`
  
  if (genre) {
    const genreInfo = customGenres.value.find(g => g.value === genre)
    prompt += `- 题材风格：${genreInfo?.label || genre}\n`
  }
  if (emotion) {
    const emotionInfo = customEmotions.value.find(e => e.value === emotion)
    let emotionLabel = emotion
    if (emotionInfo && emotionInfo.label) {
      emotionLabel = emotionInfo.label.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim()
      if (!emotionLabel) {
        emotionLabel = emotion
      }
    }
    prompt += `- 情绪氛围：${emotionLabel}\n`
  }
  
  prompt += `\n【当前内容】\n${currentText}\n\n`
  
  prompt += `【续写要求】\n`
  prompt += `请继续续写这个故事，保持以下要求：\n`
  prompt += `1. 保持与前文的风格和语调一致\n`
  prompt += `2. 情节发展自然流畅，不要突兀转折\n`
  prompt += `3. 继续深入刻画人物性格\n`
  prompt += `4. 续写长度约${continueWordCount.value}字\n`
  prompt += `5. 推进故事情节向高潮或结局发展\n`
  
  // 添加用户指定的续写方向
  if (continueDirection.value.trim()) {
    prompt += `6. 按照以下方向发展：${continueDirection.value}\n`
  }
  
  prompt += `\n请直接开始续写，不要重复前面的内容：`
  
  return prompt
}

const resetConfig = () => {
  ElMessageBox.confirm(
    '确定要重置所有配置吗？这将清空当前所有设置内容。',
    '重置确认',
    {
      confirmButtonText: '确定重置',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    // 重置所有配置
    storyData.genre = ''
    storyData.title = ''
    storyData.plotType = ''
    storyData.emotion = ''
    storyData.timeFrame = ''
    storyData.location = ''
    storyData.referenceText = ''
    storyData.wordCount = 3000
    storyData.protagonist.name = ''
    storyData.protagonist.gender = 'male'
    storyData.protagonist.age = 25
    unifiedPrompt.value = ''
    showAdvancedConfig.value = []
    
    ElMessage.success('配置已重置')
  }).catch(() => {
    // 用户取消
  })
}

const handleEditorCreated = (editor) => {
  editorRef.value = editor
}

const onEditorChange = (editor) => {
  // 编辑器内容变化时的处理，v-model会自动处理
}

// 短文编辑器事件处理
const handleArticleEditorCreated = (editor) => {
  articleEditorRef.value = editor
}

const onArticleEditorChange = (editor) => {
  // 短文编辑器内容变化时的处理，v-model会自动处理
}

const handleTextSelection = (event) => {
  const selection = window.getSelection().toString()
  if (selection.length > 0) {
    selectedText.value = selection
    hasSelection.value = true
  } else {
    hasSelection.value = false
  }
}

// 显示选段优化弹窗
const showOptimizeDialog = () => {
  if (!editorRef.value) {
    ElMessage.warning('编辑器未初始化')
    return
  }
  
  // 改进文本选择逻辑
  let selectedText = ''
  try {
    // 尝试从编辑器获取选中文本
    selectedText = editorRef.value.getSelectionText()
    
    // 如果编辑器方法失败，尝试使用浏览器原生方法
    if (!selectedText) {
      const selection = window.getSelection()
      if (selection && selection.toString()) {
        selectedText = selection.toString()
      }
    }
  } catch (error) {
    console.warn('获取选中文本失败，尝试备用方法:', error)
    const selection = window.getSelection()
    if (selection && selection.toString()) {
      selectedText = selection.toString()
    }
  }
  
  if (!selectedText || selectedText.trim().length === 0) {
    ElMessage.warning('请先选择要优化的文本')
    return
  }
  
  selectedTextForOptimize.value = selectedText.trim()
  optimizeDirection.value = ''
  optimizedResult.value = ''
  showOptimizeModal.value = true
}

// 执行优化
const performOptimize = async () => {
  if (!selectedTextForOptimize.value) {
    ElMessage.warning('没有选中的文本')
    return
  }
  
  if (!optimizeDirection.value.trim()) {
    ElMessage.warning('请填写优化方向')
    return
  }
  
  optimizing.value = true
  optimizedResult.value = ''
  
  try {
    let prompt = `请根据以下要求优化这段文字：\n\n`
    prompt += `【优化方向】\n${optimizeDirection.value}\n\n`
    prompt += `【原文】\n${selectedTextForOptimize.value}\n\n`
    prompt += `请直接输出优化后的文字，保持原文的基本意思，但要按照优化方向进行改进。`
    
    // 使用流式输出，实时显示优化过程
    await novelStore.generateContent(prompt, (chunk) => {
      optimizedResult.value += chunk
      
      // 自动滚动到底部，显示最新内容
      nextTick(() => {
        if (optimizedTextRef.value) {
          optimizedTextRef.value.scrollTop = optimizedTextRef.value.scrollHeight
        }
      })
    })
    
    ElMessage.success('优化完成！')
  } catch (error) {
    console.error('优化失败:', error)
    ElMessage.error('优化失败：' + error.message)
  } finally {
    optimizing.value = false
  }
}

// 复制优化后的文本
const copyOptimizedText = async () => {
  if (!optimizedResult.value) {
    ElMessage.warning('没有优化结果可复制')
    return
  }
  
  try {
    await navigator.clipboard.writeText(optimizedResult.value)
    ElMessage.success('已复制到剪贴板')
  } catch (error) {
    // 如果clipboard API不可用，使用传统方法
    const textArea = document.createElement('textarea')
    textArea.value = optimizedResult.value
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    ElMessage.success('已复制到剪贴板')
  }
}

// 替换原文
const replaceOriginalText = () => {
  if (!optimizedResult.value) {
    ElMessage.warning('没有优化结果可替换')
    return
  }
  
  if (!selectedTextForOptimize.value) {
    ElMessage.warning('没有选中的原文')
    return
  }
  
  try {
    // 获取当前编辑器的HTML内容
    let currentContent = ''
    if (editorRef.value) {
      currentContent = editorRef.value.getHtml() || generatedStory.value || ''
    } else {
      currentContent = generatedStory.value || ''
    }
    
    console.log('当前内容:', currentContent)
    console.log('要替换的文本:', selectedTextForOptimize.value)
    console.log('替换为:', optimizedResult.value)
    
    // 处理HTML内容中的文本替换
    // 先尝试直接替换
    let newContent = currentContent.replace(selectedTextForOptimize.value, optimizedResult.value)
    
    // 如果直接替换失败，尝试处理HTML标签
    if (newContent === currentContent) {
      // 移除HTML标签进行匹配
      const plainContent = currentContent.replace(/<[^>]*>/g, '')
      if (plainContent.includes(selectedTextForOptimize.value)) {
        // 在纯文本中找到了，需要在HTML中定位并替换
        const regex = new RegExp(selectedTextForOptimize.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
        newContent = currentContent.replace(regex, optimizedResult.value)
      }
    }
    
    if (newContent === currentContent) {
      ElMessage.warning('未找到要替换的文本，请重新选择')
      return
    }
    
    // 更新内容
    generatedStory.value = newContent
    
    // 更新编辑器
    if (editorRef.value) {
      editorRef.value.setHtml(newContent)
    }
    
    // 关闭弹窗
    showOptimizeModal.value = false
    
    ElMessage.success('已替换原文')
  } catch (error) {
    console.error('替换失败:', error)
    ElMessage.error('替换失败：' + error.message)
  }
}

const optimizeSelection = async () => {
  // 保留原有方法以防兼容性问题
  showOptimizeDialog()
}

const exportStory = () => {
  // 实现导出功能
  const pureText = generatedStory.value ? generatedStory.value.replace(/<[^>]*>/g, '') : ''
  const content = `${storyData.title}\n\n${storyData.synopsis}\n\n${pureText}`
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${storyData.title || '短篇小说'}.txt`
  link.click()
  URL.revokeObjectURL(url)
}

// 获取纯文本字数统计
const getTextWordCount = (html) => {
  if (!html) return 0
  // 移除HTML标签
  const text = html.replace(/<[^>]*>/g, '')
  return text.length
}

// 配置管理方法
const loadConfigData = () => {
  try {
    const config = storageGet(StorageKeys.shortStoryConfig, null)
    if (config) {
      Object.keys(defaultConfigData).forEach(key => {
        configData[key] = config[key] || [...defaultConfigData[key]]
      })
      console.log('加载已保存的配置数据:', configData)
    } else {
      // 首次使用，加载默认配置
      Object.keys(defaultConfigData).forEach(key => {
        configData[key] = [...defaultConfigData[key]]
      })
      console.log('加载默认配置数据:', configData)
    }
  } catch (error) {
    console.error('加载配置失败:', error)
    // 出错时使用默认配置
    Object.keys(defaultConfigData).forEach(key => {
      configData[key] = [...defaultConfigData[key]]
    })
    console.log('出错后使用默认配置:', configData)
  }
  
  // 确保配置数据包含至少一些数据源设置
  if (configData.genres.length === 0) {
    configData.genres = [...defaultConfigData.genres]
  }
  if (configData.plotTypes.length === 0) {
    configData.plotTypes = [...defaultConfigData.plotTypes]
  }
  if (configData.emotions.length === 0) {
    configData.emotions = [...defaultConfigData.emotions]
  }
  if (configData.timeFrames.length === 0) {
    configData.timeFrames = [...defaultConfigData.timeFrames]
  }
  if (configData.writingStyles.length === 0) {
    configData.writingStyles = [...defaultConfigData.writingStyles]
  }
  
  console.log('最终配置数据:', configData)
}

const saveConfigData = () => {
  try {
    storageSet(StorageKeys.shortStoryConfig, configData)
    ElMessage.success('配置保存成功！')
    showConfigManager.value = false
  } catch (error) {
    console.error('保存配置失败:', error)
    ElMessage.error('保存配置失败')
  }
}

const addConfigItem = (type) => {
  configData[type].push({
    label: '',
    value: '',
    description: ''
  })
}

const removeConfigItem = (type, index) => {
  configData[type].splice(index, 1)
}

// 文风管理方法
const addWritingStyle = () => {
  configData.writingStyles.push({
    label: '',
    value: '',
    prompt: ''
  })
}

const removeWritingStyle = (index) => {
  configData.writingStyles.splice(index, 1)
}

const saveWritingStyleConfig = () => {
  try {
    storageSet(StorageKeys.shortStoryConfig, configData)
    ElMessage.success('文风配置保存成功！')
    showWritingStyleManager.value = false
  } catch (error) {
    console.error('保存文风配置失败:', error)
    ElMessage.error('保存文风配置失败')
  }
}

const openConfigManager = () => {
  console.log('准备打开配置管理器')
  console.log('当前配置数据:', configData)
  console.log('默认配置数据:', defaultConfigData)
  
  // 确保配置数据已加载
  if (configData.genres.length === 0) {
    console.log('配置数据为空，重新加载...')
    loadConfigData()
  }
  
  console.log('重新加载后的配置数据:', configData)
  showConfigManager.value = true
}

const resetToDefault = () => {
  ElMessageBox.confirm(
    '确定要恢复默认配置吗？这将清除所有自定义配置。',
    '恢复默认配置',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    Object.keys(defaultConfigData).forEach(key => {
      configData[key] = [...defaultConfigData[key]]
    })
    ElMessage.success('已恢复默认配置')
  }).catch(() => {
    // 用户取消
  })
}

// 提示词管理方法
const loadPrompts = () => {
  try {
    const prompts = storageGet(StorageKeys.prompts, null)
    if (prompts) {
      // 检查是否有短篇小说分类的提示词，如果没有则添加默认的
      const hasShortStoryPrompts = prompts.some(p => p.category === 'short-story')
      if (!hasShortStoryPrompts) {
        const defaultShortStoryPrompts = getDefaultShortStoryPrompts()
        prompts.push(...defaultShortStoryPrompts)
        // 保存更新后的提示词
        storageSet(StorageKeys.prompts, prompts)
        console.log('已添加默认短篇小说提示词')
      }
      availablePrompts.value = prompts
    } else {
      // 如果没有任何提示词，加载默认的
      const defaultPrompts = getDefaultShortStoryPrompts()
      availablePrompts.value = defaultPrompts
      storageSet(StorageKeys.prompts, defaultPrompts)
    }
    console.log('短篇小说模块加载提示词数据:', availablePrompts.value.length)
  } catch (error) {
    console.error('加载提示词失败:', error)
    // 出错时也提供默认的短篇小说提示词
    availablePrompts.value = getDefaultShortStoryPrompts()
  }
}

// 获取默认短篇小说提示词
const getDefaultShortStoryPrompts = () => {
  return [
    {
      id: Date.now() + 1,
      title: '都市短篇小说生成器',
      category: 'short-story',
      description: '专门用于创作都市背景的短篇小说，贴近现代生活',
      content: `请创作一篇都市背景的短篇小说。

【基础设定】
- 小说标题：{小说标题}
- 主角姓名：{主角姓名}（{主角性别}，{主角年龄}岁）
- 故事地点：{故事地点}
- 字数要求：{字数要求}

【题材风格】
题材类型：{题材类型}
情节类型：{情节类型}
情绪氛围：{情绪氛围}
时间背景：{时间背景}

【创作要求】
{创作要求}

【输出要求】
1. 情节完整，有明确的开头、发展、高潮、结局
2. 人物性格鲜明，符合都市背景设定
3. 语言生动流畅，贴近现代生活
4. 场景描写真实，体现都市特色
5. 包含丰富的对话和细节描写
6. 传达积极正面的价值观

请创作一篇完整的都市短篇小说。`,
      tags: ['短篇小说', '都市', '现代生活', '完整故事'],
      isDefault: true
    },
    {
      id: Date.now() + 2,
      title: '通用短篇小说模板',
      category: 'short-story',
      description: '适用于各种题材的通用短篇小说创作模板',
      content: `请根据以下设定创作一篇短篇小说。

【基础信息】
标题：{小说标题}
主角：{主角姓名}（{主角性别}，{主角年龄}岁）
地点：{故事地点}
字数：{字数要求}

【风格设定】
题材：{题材类型}
情节：{情节类型}
氛围：{情绪氛围}
背景：{时间背景}

【特殊要求】
{创作要求}

【创作原则】
1. 开头要抓人，快速进入故事情境
2. 中间发展要有转折和冲突
3. 结尾要有深度，给读者思考空间
4. 人物性格要鲜明立体
5. 对话要自然流畅
6. 描写要生动有画面感
7. 主题积极正面

请严格按照上述要求创作一篇完整的短篇小说。`,
      tags: ['短篇小说', '通用模板', '多题材', '标准格式'],
      isDefault: true
    },
    {
      id: Date.now() + 3,
      title: '玄幻短篇小说生成器',
      category: 'short-story',
      description: '创作充满想象力的玄幻类短篇小说',
      content: `请创作一篇玄幻背景的短篇小说。

【基础设定】
- 小说标题：{小说标题}
- 主角姓名：{主角姓名}（{主角性别}，{主角年龄}岁）
- 故事地点：{故事地点}
- 字数要求：{字数要求}

【玄幻元素】
题材类型：{题材类型}
情节类型：{情节类型}
情绪氛围：{情绪氛围}

【输出要求】
1. 构建完整的玄幻世界观背景
2. 设计独特的修炼体系或魔法系统
3. 情节紧凑，悬念迭起
4. 人物具有鲜明的玄幻特色
5. 包含精彩的战斗或法术描写
6. 语言富有古典韵味或奇幻色彩
7. 传达成长、正义等正面主题

请创作一篇完整的玄幻短篇小说。`,
      tags: ['短篇小说', '玄幻', '修炼', '魔法', '完整故事'],
      isDefault: true
    }
  ]
}

const selectPrompt = (prompt) => {
  selectedPromptId.value = prompt.id
  previewPrompt.value = prompt
  editablePromptContent.value = prompt.content
}

const resetPromptSelector = () => {
  selectedPromptId.value = null
  previewPrompt.value = null
  editablePromptContent.value = ''
}

const clearSelectedTemplate = () => {
  selectedPromptTemplate.value = null
  // 清空当前提示词内容，让用户重新输入
  unifiedPrompt.value = ''
  ElMessage.success('已清除提示词模板')
}

const useOriginalPrompt = () => {
  if (!previewPrompt.value) return
  
  // 使用原版提示词并填充变量
  const filledPrompt = fillPromptVariables(previewPrompt.value.content)
  unifiedPrompt.value = filledPrompt
  selectedPromptTemplate.value = previewPrompt.value
  showPromptSelector.value = false
  ElMessage.success('已使用原版提示词模板')
}

const useEditedPrompt = () => {
  if (!previewPrompt.value || !editablePromptContent.value) return
  
  // 使用编辑后的提示词并填充变量
  const filledPrompt = fillPromptVariables(editablePromptContent.value)
  unifiedPrompt.value = filledPrompt
  selectedPromptTemplate.value = { ...previewPrompt.value, content: editablePromptContent.value }
  showPromptSelector.value = false
  ElMessage.success('已使用编辑版提示词模板')
}

const fillPromptVariables = (promptContent) => {
  let result = promptContent
  
  // 填充基础信息变量
  const variables = {
    '小说标题': storyData.title || '{小说标题}',
    '主角姓名': storyData.protagonist.name || '{主角姓名}',
    '主角性别': storyData.protagonist.gender === 'male' ? '男' : '女',
    '主角年龄': storyData.protagonist.age || '{主角年龄}',
    '故事地点': storyData.location || '{故事地点}',
    '字数要求': getWordCountText(storyData.wordCount),
    '题材类型': getGenreText(storyData.genre) || '{题材类型}',
    '情节类型': getPlotText(storyData.plotType) || '{情节类型}',
    '情绪氛围': getEmotionText(storyData.emotion) || '{情绪氛围}',
    '时间背景': getTimeFrameText(storyData.timeFrame) || '{时间背景}',
    '创作要求': '请根据上述设定创作一篇精彩的短篇小说',
    '参考文本': storyData.referenceText || '无'
  }
  
  // 替换变量
  Object.keys(variables).forEach(key => {
    const regex = new RegExp(`\\{${key}\\}`, 'g')
    result = result.replace(regex, variables[key])
  })
  
  return result
}

// 辅助方法 - 获取选项文本
const getWordCountText = (value) => {
  // 现在wordCount是数字形式
  return `${value}字`
}

const getGenreText = (value) => {
  const genre = customGenres.value.find(g => g.value === value)
  return genre?.label
}

const getPlotText = (value) => {
  const plot = customPlotTypes.value.find(p => p.value === value)
  return plot?.label
}

const getEmotionText = (value) => {
  const emotion = customEmotions.value.find(e => e.value === value)
  return emotion?.label?.replace(/[😊😢😰💕🔮]\s/, '') || emotion?.label
}

const getTimeFrameText = (value) => {
  const timeFrame = customTimeFrames.value.find(t => t.value === value)
  return timeFrame?.label
}

const goToPromptLibrary = () => {
  router.push('/prompts')
}

// 停止生成
const stopGeneration = () => {
  generating.value = false
  streamingContent.value = ''
  ElMessage.info('已停止生成')
}

// 页面初始化时加载配置
onMounted(() => {
  loadConfigData()
  loadPrompts()
})

// 组件卸载时销毁编辑器
onUnmounted(() => {
  if (editorRef.value) {
    editorRef.value.destroy()
  }
  if (articleEditorRef.value) {
    articleEditorRef.value.destroy()
  }
})
</script>

<style scoped>
.short-story-page {
  width: 100%;
  height: 100vh;
  padding: 20px;
  box-sizing: border-box;
  background: var(--el-fill-color-light);
}

/* 新的页面样式 */
.short-story-page {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 20px;
  box-sizing: border-box;
  background: var(--el-fill-color-light);
}

.page-tabs {
  flex-shrink: 0;
  margin-bottom: 20px;
}

.page-content {
  flex: 1;
  overflow: hidden;
}

.workspace {
  height: 100%;
}

.workspace-layout {
  display: flex;
  gap: 20px;
  height: 100%;
}

/* 配置侧边栏样式 */
.config-sidebar {
  width: 340px;
  flex-shrink: 0;
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.config-header h3 {
  margin: 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.generate-btn {
  width: 100%;
  margin-bottom: 20px;
  height: 40px;
  font-weight: 500;
}

.config-form {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  padding-top: 8px;
}

/* 配置区域样式 */
.config-section {
  margin-bottom: 20px;
  padding: 16px;
  background: #fafbfc;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.section-actions {
  display: flex;
  gap: 8px;
}

/* 网格布局 */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  align-items: start;
}

/* 表单项样式 */
.form-item {
  display: flex;
  flex-direction: column;
}

.form-item.full-width {
  grid-column: 1 / -1;
}

.form-item label {
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  margin-bottom: 6px;
  line-height: 1.2;
}

/* 输入框统一样式 */
.form-item .el-input,
.form-item .el-select,
.form-item .el-input-number {
  width: 100%;
}

/* 年龄输入器样式 */
.age-input {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
}

.age-display {
  min-width: 30px;
  text-align: center;
  font-weight: 500;
  color: #2c3e50;
  font-size: 14px;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.selected-template {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: var(--brand-50);
  border-radius: 4px;
  font-size: 12px;
}

.validation-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-color-danger);
}

/* 高级配置样式优化 */
.advanced-config {
  margin-top: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: visible;
}

.advanced-config .el-collapse-item__header {
  height: 40px;
  line-height: 40px;
  font-size: 13px;
  font-weight: 500;
  padding: 0 16px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.advanced-config .el-collapse-item__content {
  padding: 16px;
  background: #fafbfc;
  min-height: 200px;
  max-height: none;
}

.advanced-config .el-collapse-item__wrap {
  border-bottom: none;
  overflow: visible;
}

.advanced-config .el-collapse-item {
  border-bottom: none;
}

.advanced-config .form-grid {
  margin-bottom: 16px;
}

.advanced-config .full-width {
  margin-top: 16px;
}

.config-scroll-container {
  flex: 1;
  overflow: hidden;
}

.config-sidebar .config-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.header-title-row {
  display: flex;
  justify-content: center;
  align-items: center;
}

.header-actions-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.secondary-actions {
  display: flex;
  gap: 6px;
  justify-content: center;
}

.primary-action {
  display: flex;
}

.config-sidebar .config-header h3 {
  margin: 0;
  color: #2c3e50;
  font-size: 16px;
}

/* 配置管理对话框样式 */
.config-manager-dialog {
  .el-dialog__body {
    padding: 20px;
  }
}

.config-manager-container {
  height: 600px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.config-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 确保tab标签栏在顶部 */
.config-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin-bottom: 20px;
  order: -1;
  border-bottom: 1px solid var(--el-border-color-light);
}

.config-tabs :deep(.el-tabs__nav-wrap) {
  margin-bottom: 0;
  background: var(--el-bg-color);
}

.config-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow: hidden;
  padding: 0;
}

/* 覆盖可能导致tab下移的样式 */
.config-tabs :deep(.el-tabs__item) {
  padding: 0 20px;
  height: 40px;
  line-height: 40px;
}

.config-tab-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0 10px;
}

.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
}

.tab-header h4 {
  margin: 0;
  color: #2c3e50;
  font-size: 16px;
}

.config-list {
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
}

.config-item-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  border: 1px solid #e9ecef;
}

.config-input {
  flex: 1;
}

.description-input {
  flex: 2;
}

.config-item-row .el-button {
  margin-left: 8px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* 新的配置面板样式 */
.config-header .header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.required-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 4px;
  font-size: 12px;
  color: var(--el-color-danger);
  margin-top: 8px;
}

.config-form {
  flex: 1;
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 6px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row.two-cols {
  flex-direction: row;
  gap: 12px;
}

.form-row.two-cols > * {
  flex: 1;
}

.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: #2c3e50;
  margin-bottom: 4px;
}

.selected-template {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 8px;
  background: var(--brand-50);
  border-radius: 4px;
  font-size: 12px;
}

.reference-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reference-item {
  border: 1px solid #e1e5e9;
  border-radius: 4px;
  padding: 8px;
  background: #fafbfc;
}

.ref-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

/* 这些样式已经被新的 .required-tip 替代，保留用于兼容性 */

.config-content {
  padding-bottom: 16px; /* 减小底部内边距 */
}

.quick-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.basic-selects {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.select-row {
  display: flex;
  gap: 12px;
}

.select-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.select-item label {
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-weight: 500;
}

.quick-inputs .input-row {
  display: flex;
  gap: 12px;
}

.prompt-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-weight: 500;
}

.unified-prompt-input {
  border-radius: 4px;
}

.unified-prompt-input .el-textarea__inner {
  line-height: 1.5;
  font-family: 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
}

.advanced-config {
  padding: 10px;
}



.generate-section {
  text-align: center;
  padding: 60px 0;
}

.content-panel {
  flex: 1;
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.panel-header h3 {
  margin: 0;
  color: #2c3e50;
}

.content-body {
  flex: 1;
  /* overflow: auto; */
  position: relative;
}





/* 旧的编辑器样式已迁移到新版本 */



.story-result {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.story-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.story-textarea {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.content-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-top: 1px solid var(--el-border-color-light);
  margin-top: 16px;
  flex-shrink: 0;
}

.word-count {
  margin: 0;
}

.footer-actions {
  display: flex;
  gap: 8px;
}

.add-custom-item {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #c0c4cc;
  border-radius: 6px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.3s;
  margin-top: 8px;
  background-color: var(--el-fill-color-light);
}

.add-custom-item:hover {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
}

.add-custom-item .el-icon {
  margin-right: 8px;
  font-size: 16px;
  color: var(--el-text-color-secondary);
}

.add-custom-item:hover .el-icon {
  color: var(--brand-500);
}

@media (max-width: 768px) {
  .story-header {
    flex-direction: column;
    gap: 16px;
  }
  
  .story-actions {
    flex-wrap: wrap;
    justify-content: center;
  }
}

/* 配置管理弹窗样式 */
.config-section {
  padding: 16px;
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.config-header h4 {
  margin: 0;
  color: #2c3e50;
  font-size: 16px;
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 500px;
  overflow-y: auto;
}

.config-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: #fafbfc;
  transition: all 0.3s;
}

.config-item:hover {
  border-color: #c6e2ff;
  background: #ecf5ff;
}

.config-item .el-input {
  flex: 1;
}

/* 让第三个输入框（提示词）更宽 */
.config-item .el-input:nth-child(3) {
  flex: 2;
}

.config-item .el-button {
  flex-shrink: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.empty-config {
  text-align: center;
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
}

.empty-config .el-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

/* 提示词选择器样式 */
.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.prompt-actions {
  display: flex;
  gap: 8px;
}

.selected-template {
  background: var(--brand-50);
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
}

.template-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.template-title {
  font-weight: 500;
  color: #1e40af;
}

.template-description {
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
}

.prompt-selector {
  display: flex;
  gap: 20px;
  min-height: 500px;
}

.prompt-list {
  flex: 1;
  max-height: 500px;
  overflow-y: auto;
}

.prompt-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.prompt-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--el-bg-color);
}

.prompt-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.prompt-card.active {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15);
}

.prompt-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.prompt-card-header h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
}

.selected-icon {
  color: #3b82f6;
  font-size: 16px;
}

.prompt-card-description {
  margin-bottom: 12px;
}

.prompt-card-description p {
  margin: 0;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.4;
}

.prompt-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.prompt-preview {
  flex: 1;
  border-left: 1px solid #e5e7eb;
  padding-left: 20px;
}

.prompt-preview h4 {
  margin: 0 0 16px 0;
  color: #1f2937;
  font-size: 16px;
}

.preview-content {
  height: calc(100% - 40px);
}

.prompt-content-editor {
  height: 100%;
}

.prompt-content-editor .el-textarea__inner {
  height: 100% !important;
  resize: none;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.empty-prompts {
  text-align: center;
  padding: 60px 20px;
  color: #6b7280;
}

.empty-prompts .el-empty {
  padding: 20px;
}

/* 续写对话框样式 */
.continue-direction {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.direction-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.direction-input label {
  font-weight: 500;
  color: #2c3e50;
  font-size: 14px;
}

.direction-tips {
  background: var(--el-fill-color-light);
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 16px;
}

.direction-tips h4 {
  margin: 0 0 12px 0;
  color: #495057;
  font-size: 14px;
  font-weight: 500;
}

.direction-tips ul {
  margin: 0;
  padding-left: 20px;
}

.direction-tips li {
  color: #6c757d;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 4px;
}

.direction-tips li:last-child {
  margin-bottom: 0;
}

/* 选段优化弹窗样式 */
.optimize-dialog {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.selected-content h4,
.optimize-direction h4,
.optimize-result h4 {
  margin: 0 0 8px 0;
  color: #2c3e50;
  font-size: 14px;
  font-weight: 600;
}

.selected-text {
  background: var(--el-fill-color-light);
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #495057;
  max-height: 120px;
  overflow-y: auto;
}

.optimize-actions {
  text-align: center;
}

.optimized-text {
  background: var(--brand-50);
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #1e40af;
  max-height: 200px;
  overflow-y: auto;
  scroll-behavior: smooth;
}

.optimizing-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-style: italic;
}

.optimizing-placeholder .el-icon {
  font-size: 16px;
}

.optimized-content {
  white-space: pre-wrap;
  word-wrap: break-word;
}

.result-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
}

/* 现代续写弹窗样式 */
.modern-continue-dialog {
  border-radius: 16px;
  overflow: hidden;
}

.modern-continue-dialog .el-dialog__header {
  padding: 0;
  margin: 0;
  border-bottom: 1px solid var(--ink-100);
}

.modern-continue-dialog .el-dialog__body {
  padding: 24px;
  background: #fafbfc;
}

.modern-continue-dialog .el-dialog__footer {
  padding: 20px 24px;
  background: var(--el-bg-color);
  border-top: 1px solid var(--ink-100);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-text h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.header-text p {
  margin: 4px 0 0 0;
  font-size: 14px;
  opacity: 0.9;
}

.close-btn {
  color: white !important;
  background: rgba(255, 255, 255, 0.1) !important;
  border: none !important;
  border-radius: 8px !important;
  transition: all 0.3s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.2) !important;
}

.modern-continue-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  min-height: 500px;
}

.config-card,
.result-card {
  border-radius: 12px;
  border: 1px solid #e8eaed;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.config-card .el-card__header,
.result-card .el-card__header {
  background: var(--el-fill-color-light);
  border-bottom: 1px solid #e8eaed;
  padding: 16px 20px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #1f2937;
}

.header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.config-content {
  padding: 20px;
}

.config-row {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: #374151;
  font-size: 14px;
}

.direction-input {
  border-radius: 8px;
}

.direction-input .el-textarea__inner {
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 14px;
  line-height: 1.5;
}

.word-count-slider {
  margin-top: 8px;
}

.tips-section {
  margin-top: 24px;
  padding: 16px;
  background: var(--brand-50);
  border-radius: 8px;
  border: 1px solid #bae6fd;
}

.tips-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 500;
  color: #0369a1;
}

.tips-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.tip-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #374151;
}

.result-content {
  padding: 20px;
  min-height: 400px;
}

.streaming-state {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.streaming-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--brand-50);
  border-radius: 8px;
  margin-bottom: 16px;
}

.streaming-icon {
  width: 40px;
  height: 40px;
  background: #3b82f6;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.rotating {
  animation: rotate 2s linear infinite;
}

.streaming-text h4 {
  margin: 0;
  color: #1f2937;
  font-size: 16px;
}

.streaming-text p {
  margin: 4px 0 0 0;
  color: #6b7280;
  font-size: 14px;
}

.streaming-content {
  flex: 1;
  background: var(--el-bg-color);
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  padding: 16px;
  overflow-y: auto;
}

.streaming-text-content {
  font-size: 14px;
  line-height: 1.6;
  color: #374151;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.result-display {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.result-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.stat-value {
  font-size: 16px;
  color: #1f2937;
  font-weight: 600;
}

.result-text {
  flex: 1;
  padding: 16px;
  background: var(--el-bg-color);
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  font-size: 14px;
  line-height: 1.6;
  color: #374151;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: #6b7280;
}

.empty-icon {
  margin-bottom: 16px;
}

.empty-state h4 {
  margin: 0 0 8px 0;
  color: #374151;
  font-size: 16px;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
  max-width: 280px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.footer-info {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-size: 14px;
}

.footer-actions {
  display: flex;
  gap: 12px;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 旧的续写弹窗样式保留 */
.continue-dialog .el-dialog__body {
  padding: 20px;
}

.continue-container {
  display: flex;
  gap: 20px;
  height: 500px;
}

.continue-config {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-section h4 {
  margin: 0 0 8px 0;
  color: #2c3e50;
  font-size: 14px;
  font-weight: 600;
}

.tips-list {
  margin: 0;
  padding-left: 20px;
  color: #6c757d;
  font-size: 13px;
  line-height: 1.5;
}

.tips-list li {
  margin-bottom: 4px;
}

.config-actions {
  margin-top: auto;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.continue-result {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e5e7eb;
  padding-left: 20px;
}

.result-header h4 {
  margin: 0 0 12px 0;
  color: #2c3e50;
  font-size: 14px;
  font-weight: 600;
}

.result-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.continuing-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-style: italic;
  padding: 20px;
  justify-content: center;
}

.continuing-placeholder .loading-icon {
  font-size: 16px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.continued-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.continued-text {
  background: var(--brand-50);
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #1e40af;
  height: 300px;
  overflow-y: auto;
  scroll-behavior: smooth;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.continuing-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  margin-top: 8px;
  background: #e3f2fd;
  border-radius: 4px;
  font-size: 12px;
  color: #1976d2;
}

.continuing-indicator .loading-icon {
  margin-right: 4px;
  animation: spin 1s linear infinite;
}

.word-count-tips {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}

.empty-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-placeholder .el-empty {
  padding: 20px;
}

/* Tab样式优化 */
.page-tabs .el-tabs__header {
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  padding: 10px 20px;
  margin: 0 0 20px 0;
}

.page-tabs .el-tabs__nav-wrap {
  padding: 0;
}

.page-tabs .el-tabs__item {
  font-weight: 500;
  font-size: 15px;
  padding: 0 20px;
  height: 40px;
  line-height: 40px;
}

/* 编辑器主体样式 */
/* 高级配置样式 */
.advanced-config {
  margin-top: 16px;
}

.advanced-config .el-collapse-item__header {
  font-size: 14px;
  font-weight: 500;
  color: #2c3e50;
}

.age-input {
  display: flex;
  align-items: center;
  gap: 12px;
}

.age-display {
  font-size: 16px;
  font-weight: 500;
  color: #2c3e50;
  min-width: 40px;
  text-align: center;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.editor-main {
  flex: 1;
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-light);
  background: #fafbfc;
}

.editor-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
}

.word-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: #f0f2f5;
  padding: 2px 8px;
  border-radius: 12px;
}

.editor-actions {
  display: flex;
  gap: 8px;
}

.editor-content {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.editor-wrapper .w-e-toolbar {
  border-bottom: 1px solid var(--el-border-color-light);
  background: #fafbfc;
  flex-shrink: 0;
}

.editor-wrapper .w-e-text-container {
  flex: 1;
  background: var(--el-bg-color);
  overflow-y: auto !important;
  min-height: 400px;
}

.editor-wrapper .w-e-text-container .w-e-text {
  min-height: 400px !important;
  max-height: none !important;
}

.editor-wrapper .w-e-text-container .w-e-scroll {
  overflow-y: auto !important;
  max-height: none !important;
}

/* 确保 wangEditor 内容区域的滚动 */
.editor-wrapper :deep(.w-e-text-container) {
  overflow-y: auto !important;
  min-height: 400px;
  max-height: calc(100vh - 300px);
}

.editor-wrapper :deep(.w-e-text) {
  min-height: 400px !important;
  padding: 20px !important;
  font-family: 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.6;
}

.editor-wrapper :deep(.w-e-scroll) {
  overflow-y: auto !important;
  max-height: none !important;
}

/* 强制显示滚动条 */
.editor-wrapper :deep(.w-e-text-container),
.editor-wrapper :deep(.w-e-scroll),
.editor-wrapper :deep(.w-e-text) {
  scrollbar-width: auto !important;
  -webkit-overflow-scrolling: touch;
}

.editor-wrapper :deep(.w-e-text-container)::-webkit-scrollbar,
.editor-wrapper :deep(.w-e-scroll)::-webkit-scrollbar,
.editor-wrapper :deep(.w-e-text)::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.editor-wrapper :deep(.w-e-text-container)::-webkit-scrollbar-track,
.editor-wrapper :deep(.w-e-scroll)::-webkit-scrollbar-track,
.editor-wrapper :deep(.w-e-text)::-webkit-scrollbar-track {
  background: var(--el-bg-color-page);
  border-radius: 4px;
}

.editor-wrapper :deep(.w-e-text-container)::-webkit-scrollbar-thumb,
.editor-wrapper :deep(.w-e-scroll)::-webkit-scrollbar-thumb,
.editor-wrapper :deep(.w-e-text)::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
}

.editor-wrapper :deep(.w-e-text-container)::-webkit-scrollbar-thumb:hover,
.editor-wrapper :deep(.w-e-scroll)::-webkit-scrollbar-thumb:hover,
.editor-wrapper :deep(.w-e-text)::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* 生成中状态 */
.generating-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--el-bg-color);
  padding: 20px;
  z-index: 10;
}

/* 参考文章样式 */
.reference-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reference-item {
  border: 1px solid #e1e5e9;
  border-radius: 6px;
  padding: 12px;
  background: var(--el-fill-color-light);
}

.ref-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.generating-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-light);
  font-weight: 500;
  color: var(--brand-500);
}

.streaming-content {
  line-height: 1.6;
  color: #2c3e50;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 350px;
  overflow-y: auto;
}

.prompt-selector {
  height: 400px;
  display: flex;
  flex-direction: column;
}

.search-bar {
  margin-bottom: 16px;
}

.prompt-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-item {
  padding: 16px;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.prompt-item:hover {
  border-color: var(--brand-500);
  background: var(--brand-50);
}

.prompt-title {
  font-weight: 500;
  color: #2c3e50;
  margin-bottom: 8px;
}

.prompt-description {
  color: var(--el-text-color-regular);
  font-size: 13px;
  margin-bottom: 8px;
}

.prompt-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* 续写对话框样式 */
.continue-dialog .el-dialog__body {
  padding: 20px;
}

.continue-container {
  height: 500px;
}

.continue-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.config-section h4 {
  margin: 0 0 8px 0;
  color: #2c3e50;
  font-size: 14px;
  font-weight: 600;
}

.tips-list {
  margin: 0;
  padding-left: 20px;
  color: #6c757d;
  font-size: 13px;
  line-height: 1.5;
}

.tips-list li {
  margin-bottom: 4px;
}

.config-actions {
  margin-top: auto;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.continue-result {
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e5e7eb;
  padding-left: 20px;
  height: 100%;
}

.result-header h4 {
  margin: 0 0 12px 0;
  color: #2c3e50;
  font-size: 14px;
  font-weight: 600;
}

.result-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  max-height: 500px;
}

.continuing-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-style: italic;
  padding: 20px;
  justify-content: center;
}

.continuing-placeholder .loading-icon {
  font-size: 16px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.continued-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.continued-text {
  background: var(--brand-50);
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #1e40af;
  height: 300px;
  overflow-y: auto;
  scroll-behavior: smooth;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.result-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
}

.empty-result {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 优化对话框样式 */
.optimize-dialog .el-dialog__body {
  padding: 20px;
}

.optimize-container {
  height: 500px;
}

.optimize-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.selected-text-preview {
  background: var(--el-fill-color-light);
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: #495057;
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.optimize-result {
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e5e7eb;
  padding-left: 20px;
  height: 100%;
}

.optimizing-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-style: italic;
  padding: 20px;
  justify-content: center;
}

.optimizing-placeholder .loading-icon {
  font-size: 16px;
  animation: spin 1s linear infinite;
}

.optimized-content-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.optimized-content {
  background: var(--brand-50);
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #1e40af;
  flex: 1;
  overflow-y: auto;
  scroll-behavior: smooth;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* 工具栏和按钮样式 */
.header-actions {
  display: flex;
  gap: 8px;
}

/* 生成状态提示样式 */
.generating-status {
  margin-bottom: 12px;
}

.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 8px 16px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}

.rotating {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 选段优化状态提示样式 */
.optimizing-status {
  margin-bottom: 12px;
}

.optimizing-status .status-bar {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(240, 147, 251, 0.3);
  font-size: 13px;
}

.optimizing-status .status-info {
  gap: 6px;
  font-weight: 500;
}

/* 文风管理弹窗样式 */
.writing-style-dialog .el-dialog__body {
  padding: 20px;
}

.writing-style-container {
  max-height: 500px;
  overflow-y: auto;
}

.style-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.style-header h4 {
  margin: 0;
  color: #374151;
  font-size: 16px;
  font-weight: 600;
}

.style-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.style-item-row {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.style-input {
  flex: 1;
}

.style-prompt-input {
  flex: 2;
}

.style-item-row .el-button {
  flex-shrink: 0;
}
</style>