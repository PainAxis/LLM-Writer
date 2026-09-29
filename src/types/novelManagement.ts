export interface NovelMetadataDraft {
  title: string
  genre: string
  status?: string
  description: string
  cover: string
  tags: string[]
}

export interface NovelGenrePreset {
  name: string
  tags: string[]
  prompt: string
}
