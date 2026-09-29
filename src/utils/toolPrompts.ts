import { TOOL_DEFINITIONS } from '@/config/tools'
import type { ToolPromptSource } from '@/types/tools'

export function buildToolPrompt(source: ToolPromptSource) {
  const {
    type,
    form: toolForm,
    selectedPrompt: selectedPromptData,
    novels: novelList,
    chapters: selectedNovelChapters,
    originals: originalNovels,
  } = source
  const tool = TOOL_DEFINITIONS[type]
  let prompt = ''
  const useTemplate = selectedPromptData && selectedPromptData.content

  // 首先构建小说信息部分（如果工具支持小说选择器）
  let novelInfoSection = ''
  if (tool.hasNovelSelector && toolForm.selectedNovel) {
    const selectedNovel = novelList.find((novel) => novel.value === toolForm.selectedNovel)
    if (selectedNovel) {
      // 获取完整的小说数据
      const originalNovel = originalNovels.find(
        (n) => n.id == selectedNovel.value || n.title === selectedNovel.label
      )

      novelInfoSection += `=== 目标小说信息 ===\n`
      novelInfoSection += `小说标题：${selectedNovel.label}\n`

      if (originalNovel) {
        // 自动添加小说的基本信息
        if (originalNovel.genre) {
          novelInfoSection += `小说类型：${originalNovel.genre}\n`
        }
        if (originalNovel.description) {
          novelInfoSection += `小说简介：${originalNovel.description}\n`
        }
        if (originalNovel.tags && Array.isArray(originalNovel.tags)) {
          novelInfoSection += `标签：${originalNovel.tags.join('、')}\n`
        }

        // 添加角色信息
        if (
          originalNovel.characters &&
          Array.isArray(originalNovel.characters) &&
          originalNovel.characters.length > 0
        ) {
          novelInfoSection += `\n=== 主要角色 ===\n`
          originalNovel.characters.forEach((char) => {
            if (char.name) {
              novelInfoSection += `${char.name}：${char.description || char.personality || '主要角色'}\n`
            }
          })
        }

        // 添加世界观设定
        if (
          originalNovel.worldSettings &&
          Array.isArray(originalNovel.worldSettings) &&
          originalNovel.worldSettings.length > 0
        ) {
          novelInfoSection += `\n=== 世界观设定 ===\n`
          originalNovel.worldSettings.forEach((setting) => {
            novelInfoSection += `${setting.name || setting.title}：${setting.description || setting.content}\n`
          })
        }
      }

      // 添加选中章节的内容
      if (toolForm.selectedChapters && toolForm.selectedChapters.length > 0) {
        novelInfoSection += `\n=== 参考章节内容 ===\n`
        toolForm.selectedChapters.forEach((chapterId) => {
          const chapter = selectedNovelChapters.find((ch) => ch.value === chapterId)
          if (chapter) {
            novelInfoSection += `\n【${chapter.label}】\n`
            if (chapter.description) {
              novelInfoSection += `大纲：${chapter.description}\n`
            }
            if (chapter.content) {
              // 截取部分内容，避免过长
              const content =
                chapter.content.length > 500
                  ? chapter.content.substring(0, 500) + '...'
                  : chapter.content
              novelInfoSection += `内容：${content}\n`
            }
          }
        })
        novelInfoSection += `\n`
      }
    }
  }

  // 如果选择了提示词模板，使用模板内容
  if (useTemplate) {
    prompt = selectedPromptData?.content || ''

    // 如果有小说信息，首先添加到提示词前面
    if (novelInfoSection) {
      prompt = novelInfoSection + '\n' + prompt
    }

    // 替换模板中的变量
    if (tool.hasNovelSelector && toolForm.selectedNovel) {
      const selectedNovel = novelList.find((novel) => novel.value === toolForm.selectedNovel)
      if (selectedNovel) {
        const originalNovel = originalNovels.find(
          (n) => n.id == selectedNovel.value || n.title === selectedNovel.label
        )

        // 替换小说相关变量
        prompt = prompt.replace(/\{小说标题\}/g, () => String(selectedNovel.label))
        if (originalNovel) {
          prompt = prompt.replace(/\{小说类型\}/g, () => String(originalNovel.genre || '未设定'))
          prompt = prompt.replace(/\{小说简介\}/g, () =>
            String(originalNovel.description || '无简介')
          )
          prompt = prompt.replace(/\{标签\}/g, () =>
            String(originalNovel.tags ? originalNovel.tags.join('、') : '无标签')
          )

          // 替换角色信息
          if (
            originalNovel.characters &&
            Array.isArray(originalNovel.characters) &&
            originalNovel.characters.length > 0
          ) {
            const charactersInfo = originalNovel.characters
              .map((char) => `${char.name}：${char.description || char.personality || '主要角色'}`)
              .join('\n')
            prompt = prompt.replace(/\{主要人物\}/g, () => String(charactersInfo))
          } else {
            prompt = prompt.replace(/\{主要人物\}/g, () => String('暂无详细人物设定'))
          }

          // 替换世界观信息
          if (
            originalNovel.worldSettings &&
            Array.isArray(originalNovel.worldSettings) &&
            originalNovel.worldSettings.length > 0
          ) {
            const worldInfo = originalNovel.worldSettings
              .map(
                (setting) =>
                  `${setting.name || setting.title}：${setting.description || setting.content}`
              )
              .join('\n')
            prompt = prompt.replace(/\{世界观设定\}/g, () => String(worldInfo))
          } else {
            prompt = prompt.replace(/\{世界观设定\}/g, () => String('暂无详细世界观设定'))
          }
        }

        // 替换章节信息
        if (toolForm.selectedChapters && toolForm.selectedChapters.length > 0) {
          let chaptersInfo = ''
          toolForm.selectedChapters.forEach((chapterId) => {
            const chapter = selectedNovelChapters.find((ch) => ch.value === chapterId)
            if (chapter) {
              chaptersInfo += `\n【${chapter.label}】\n`
              if (chapter.description) {
                chaptersInfo += `大纲：${chapter.description}\n`
              }
              if (chapter.content) {
                const content =
                  chapter.content.length > 500
                    ? chapter.content.substring(0, 500) + '...'
                    : chapter.content
                chaptersInfo += `内容：${content}\n`
              }
            }
          })
          prompt = prompt.replace(/\{参考章节内容\}/g, () => String(chaptersInfo || '暂无参考章节'))
        } else {
          prompt = prompt.replace(/\{参考章节内容\}/g, () => String('暂无参考章节'))
        }
      }
    }

    // 替换表单字段变量
    tool.fields.forEach((field) => {
      if (
        field.type !== 'novel-select' &&
        field.type !== 'chapter-select' &&
        field.type !== 'prompt-select' &&
        toolForm[field.key]
      ) {
        const value = toolForm[field.key]
        // 支持中文和英文字段名
        const patterns = [
          new RegExp(`\\{${field.label}\\}`, 'g'),
          new RegExp(`\\{${field.key}\\}`, 'g'),
        ]
        patterns.forEach((pattern) => {
          prompt = prompt.replace(pattern, () => String(value))
        })
      }
    })

    // 特殊处理生成数量变量
    if (toolForm.count) {
      prompt = prompt.replace(/\{生成数量\}/g, () => String(toolForm.count))
      prompt = prompt.replace(/\{count\}/g, () => String(toolForm.count))
    }

    // 清理未替换的变量
    prompt = prompt.replace(/\{[^}]*\}/g, () => String('[待填充]'))

    return prompt
  }

  // 如果没有选择提示词模板，使用默认构建方式
  prompt = `请作为一个专业的${tool.title}，根据以下信息生成高质量的内容：\n\n`

  // 添加小说信息
  if (novelInfoSection) {
    prompt += novelInfoSection
  }

  // 添加其他字段信息
  tool.fields.forEach((field) => {
    // 跳过小说、章节选择和提示词选择字段
    if (
      field.type !== 'novel-select' &&
      field.type !== 'chapter-select' &&
      field.type !== 'prompt-select' &&
      toolForm[field.key]
    ) {
      prompt += `${field.label}：${toolForm[field.key]}\n`
    }
  })

  // 根据不同工具类型添加具体要求
  switch (type) {
    case 'outline':
      prompt +=
        '\n请根据上述小说信息生成详细的章节细纲，包括：\n1. 每章的标题和主要情节\n2. 故事发展脉络和转折点\n3. 人物关系变化\n4. 冲突设置和解决\n5. 整体结构要完整（开头、发展、高潮、结局）\n6. 与已有角色和世界观保持一致\n\n请按照以下格式输出：\n第一章：章节标题\n- 主要情节描述\n- 重要转折点\n第二章：...'
      break
    case 'cheat':
      prompt +=
        '\n请根据上述小说的类型和世界观，生成一个独特的金手指设定，包括：\n1. 能力名称和核心功能\n2. 详细的能力描述和效果\n3. 获得方式和触发条件\n4. 使用限制和副作用\n5. 能力的成长路径和进阶可能\n6. 与故事情节和世界观的结合点\n\n要求创意新颖，符合小说类型的特点，与现有角色和设定协调。'
      break
    case 'opening':
      prompt +=
        '\n请生成一个引人入胜的小说开篇，要求：\n1. 字数控制在500-800字\n2. 立即抓住读者注意力\n3. 巧妙引入主角和背景\n4. 设置悬念或冲突点\n5. 语言风格符合所选氛围\n6. 为后续情节发展做好铺垫\n\n请直接输出开篇内容，无需其他说明。'
      break
    case 'title':
      const titleCount = toolForm.count || '10'
      prompt += `\n请生成${titleCount}个不同风格的书名供选择，要求：\n1. 符合所选类型的特点\n2. 体现关键词元素\n3. 具有吸引力和记忆点\n4. 长度适中（3-8个字为佳）\n5. 避免俗套，有创新性\n6. 风格多样化，覆盖不同类型\n\n请按照以下格式输出：\n1. 书名 - 创意说明\n2. 书名 - 创意说明\n3. 书名 - 创意说明\n...\n${titleCount}. 书名 - 创意说明`
      break
    case 'genre':
      const genreCount = toolForm.count || '5'
      prompt += `\n请分析当前流行趋势，提供${genreCount}个具有潜力的题材方向，每个题材都要包括：\n1. 题材名称和核心概念\n2. 市场潜力分析\n3. 目标读者群体\n4. 创作要点和注意事项\n5. 成功案例参考\n6. 创新突破点建议\n\n请按照以下格式输出：\n=== 题材1 ===\n名称：[题材名称]\n核心概念：[详细描述]\n市场潜力：[分析]\n目标读者：[读者群体]\n创作要点：[注意事项]\n成功案例：[参考作品]\n创新点：[突破建议]\n\n=== 题材2 ===\n...\n\n以此类推到第${genreCount}个题材。`
      break
    case 'brainstorm':
      const brainstormCount = toolForm.count || '5'
      prompt += `\n请提供${brainstormCount}个创意脑洞，每个都要：\n1. 独特有趣，避免俗套\n2. 具有可扩展性\n3. 符合所选创意程度\n4. 包含具体的设定细节\n5. 提供发展方向建议\n\n请按照以下格式输出：\n脑洞1：标题\n- 核心设定\n- 创意亮点\n- 发展方向\n脑洞2：标题\n- 核心设定\n- 创意亮点\n- 发展方向\n\n以此类推，直到第${brainstormCount}个脑洞...`
      break
    case 'synopsis':
      prompt +=
        '\n请根据上述小说信息生成吸引人的简介，要求：\n1. 突出故事亮点和悬念\n2. 介绍主角和核心冲突\n3. 体现故事的独特性\n4. 语言精炼有力\n5. 长度控制在100-200字\n6. 符合所选风格特点\n7. 与现有角色和世界观保持一致\n\n请直接输出简介内容。'
      break
    case 'worldview':
      prompt +=
        '\n请根据上述小说信息，扩展和完善世界观设定，包括：\n1. 世界的基本架构和地理环境\n2. 社会制度和政治结构\n3. 文化传统和价值观念\n4. 科技水平或魔法系统\n5. 历史背景和重要事件\n6. 独特的规则和法则\n7. 与现有故事情节和角色的结合点\n\n要求设定合理，富有创意，具有内在逻辑性，与现有设定协调。'
      break
    case 'character':
      const characterCount = parseInt(String(toolForm.count || '1'))
      if (characterCount === 1) {
        prompt +=
          '\n请生成详细的角色档案，包括：\n1. 基本信息（姓名、年龄、职业等）\n2. 外貌特征和穿着风格\n3. 性格特点和行为习惯\n4. 背景故事和成长经历\n5. 能力特长和弱点\n6. 人际关系和社会地位\n7. 内心动机和目标追求\n8. 与主线情节的关系\n\n要求人物立体丰满，符合角色定位。'
      } else {
        prompt += `\n请生成${characterCount}个详细的角色档案，每个角色都要包括：\n1. 基本信息（姓名、年龄、职业等）\n2. 外貌特征和穿着风格\n3. 性格特点和行为习惯\n4. 背景故事和成长经历\n5. 能力特长和弱点\n6. 人际关系和社会地位\n7. 内心动机和目标追求\n8. 与主线情节的关系\n\n要求：\n- 每个人物都要立体丰满，符合角色定位\n- 角色之间要有差异化，避免重复\n- 可以设计角色间的关系和互动\n- 如果生成的是同一类型角色，请在性格、背景、能力等方面做出明显区分\n- 按照以下格式输出：\n\n=== 角色1 ===\n姓名：[角色姓名]\n[详细信息]\n\n=== 角色2 ===\n姓名：[角色姓名]\n[详细信息]\n\n以此类推到第${characterCount}个角色...`
      }
      break
    case 'conflict':
      prompt +=
        '\n请根据上述小说信息设计合理的冲突情节，包括：\n1. 冲突的起因和背景\n2. 冲突各方的立场和动机\n3. 冲突的发展过程和升级\n4. 关键转折点和高潮设计\n5. 可能的解决方向和结果\n6. 对现有角色成长的影响\n7. 与整体故事和世界观的呼应\n\n要求冲突合理有力，推动情节发展，与现有设定协调。'
      break
  }

  return prompt
}
