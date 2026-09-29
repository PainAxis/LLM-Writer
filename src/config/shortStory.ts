import type { ShortStoryConfig } from '@/types/shortStory'

export function createDefaultShortStoryConfig(): ShortStoryConfig {
  return {
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
}
