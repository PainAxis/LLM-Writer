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
              
              <div v-show="!generatingArticle" class="editor-wrapper">
                <Toolbar
                  :editor="articleEditorRef || undefined"
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
                  :editor="editorRef || undefined"
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
    <ShortStoryPromptSelector
      v-model="showArticlePromptSelector"
      title="选择短文提示词模板"
      empty-message="暂无短文提示词模板"
      :prompts="availablePrompts"
      @select="selectArticlePrompt"
      @create="createPrompt"
    />
    <ShortStoryPromptSelector
      v-model="showStoryPromptSelector"
      title="选择短篇小说提示词模板"
      empty-message="暂无短篇小说提示词模板"
      :prompts="availablePrompts"
      @select="selectStoryPrompt"
      @create="createPrompt"
    />

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
                  <el-empty description="点击开始优化" :image-size="80" />
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

<script setup lang="ts">
import { MagicStick, EditPen, Download, Check, Loading, Plus, Setting, List, DocumentCopy, Delete, InfoFilled } from '@element-plus/icons-vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import '@wangeditor/editor/dist/css/style.css'
import ShortStoryPromptSelector from '@/components/short-story/ShortStoryPromptSelector.vue'
import { useShortStoryWorkspace } from '@/composables/useShortStoryWorkspace'
const { activeTab, articleData, articleContent, selectedArticlePromptTemplate, showArticlePromptSelector, generatedStory, showAdvancedConfig, unifiedPrompt, showContinueDialog, continueDirection, continueWordCount, continueTextRef, showConfigManager, activeConfigTab, showWritingStyleManager, selectedPromptTemplate, availablePrompts, showOptimizeModal, selectedTextForOptimize, optimizeDirection, optimizedTextRef, generatingArticle, articleStreamingContent, generating, streamingContent, continuingStory, continueResult, optimizing, optimizedResult, isArticleConfigValid, articleWordCount, showStoryPromptSelector, promptPlaceholder, editorRef, toolbarConfig, editorConfig, articleEditorRef, articleToolbarConfig, articleEditorConfig, storyData, configData, isConfigValid, customGenres, customPlotTypes, customEmotions, customTimeFrames, customWritingStyles, handleTabClick, resetArticleConfig, addReferenceArticle, removeReferenceArticle, selectArticlePrompt, clearArticleSelectedTemplate, selectStoryPrompt, generateArticle, stopArticleGeneration, copyArticleContent, saveArticle, clearArticleContent, createPrompt, generateStory, continueStory, performContinue, copyContinueText, resetConfig, handleEditorCreated, onEditorChange, handleArticleEditorCreated, onArticleEditorChange, handleTextSelection, performOptimize, copyOptimizedText, replaceOriginalText, optimizeSelection, exportStory, getTextWordCount, saveConfigData, addConfigItem, removeConfigItem, addWritingStyle, removeWritingStyle, saveWritingStyleConfig, openConfigManager, resetToDefault, clearSelectedTemplate, stopGeneration } = useShortStoryWorkspace()
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
