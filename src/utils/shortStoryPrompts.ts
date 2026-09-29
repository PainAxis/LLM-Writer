import type { ShortStoryDraft, ShortArticleDraft, ShortStoryConfig } from '@/types/shortStory'

function describeWritingStyle(style: string, config: ShortStoryConfig) {
  const styleInfo = config.writingStyles.find(s => s.value === style)
  if (styleInfo) {
    // 如果有文风提示词，返回完整信息
    if (styleInfo.prompt) {
      return `${styleInfo.label} - ${styleInfo.description}\n\n文风要求：${styleInfo.prompt}`
    }
    return `${styleInfo.label} - ${styleInfo.description}`
  }
  return '通用风格'
}

export function buildShortArticlePrompt(articleData: ShortArticleDraft, config: ShortStoryConfig) {
  // 构建提示词
  let prompt = `请根据以下要求创作一篇短文：

标题：${articleData.title}
字数：约${articleData.wordCount}字
文风类型：${describeWritingStyle(articleData.style, config)}

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

  return prompt
}

export function buildShortStoryPrompt(storyData: ShortStoryDraft, config: ShortStoryConfig, requirements: string) {
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
    const genreInfo = config.genres.find(g => g.value === genre)
    prompt += `- 题材风格：${genreInfo?.label || genre}\n`
  }
  if (plotType) {
    const plotInfo = config.plotTypes.find(p => p.value === plotType)
    prompt += `- 情节类型：${plotInfo?.label || plotType}\n`
  }
  if (emotion) {
    const emotionInfo = config.emotions.find(e => e.value === emotion)
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
    const timeInfo = config.timeFrames.find(t => t.value === timeFrame)
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

  if (requirements) prompt += `${requirements}\n\n`

  if (storyData.referenceText) {
    prompt += `【参考文本】\n${storyData.referenceText}\n\n`
  }

  prompt += `请创作一篇完整的短篇小说，字数控制在${storyData.wordCount}字左右，要求情节完整，人物鲜明，语言生动。`


  return prompt
}


export function buildShortStoryContinuation(currentText: string, storyData: ShortStoryDraft, config: ShortStoryConfig, direction: string, wordCount: number) {
  const { protagonist, genre, emotion } = storyData

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
    const genreInfo = config.genres.find(g => g.value === genre)
    prompt += `- 题材风格：${genreInfo?.label || genre}\n`
  }
  if (emotion) {
    const emotionInfo = config.emotions.find(e => e.value === emotion)
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
  prompt += `4. 续写长度约${wordCount}字\n`
  prompt += `5. 推进故事情节向高潮或结局发展\n`

  // 添加用户指定的续写方向
  if (direction.trim()) {
    prompt += `6. 按照以下方向发展：${direction}\n`
  }

  prompt += `\n请直接开始续写，不要重复前面的内容：`

  return prompt
}

export function buildShortStoryOptimization(selectedText: string, direction: string) {
  return `请根据以下要求优化这段文字：\n\n【优化方向】\n${direction}\n\n【原文】\n${selectedText}\n\n请直接输出优化后的文字，保持原文的基本意思，但要按照优化方向进行改进。`
}
