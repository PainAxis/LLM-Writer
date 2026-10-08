import type {
  MemoryEmbeddingConfig, MemoryEvidence, MemoryRemoteOptions,
  MemoryRerankConfig, MemoryRetrievalDiagnostics,
} from '@/types/memory'
import type { VisibleFactRelation } from '@/types/factGraph'

/** UI-only route-session settings. Never store this object or include it in backup. */
export interface WriterMemoryProviders {
  embeddingEnabled: boolean
  rerankEnabled: boolean
  embedding: MemoryEmbeddingConfig
  rerank: MemoryRerankConfig
}

export interface WriterMemoryChapterChoice {
  id: string
  title: string
  ordinal: number
}

/** Presentation subset of the immutable, source-validated generation package. */
export interface WriterMemoryPreview {
  hits: MemoryEvidence[]
  relations: VisibleFactRelation[]
  diagnostics?: MemoryRetrievalDiagnostics
  prompt?: string
}

export function createWriterMemoryProviders(): WriterMemoryProviders {
  return {
    embeddingEnabled: false,
    rerankEnabled: false,
    embedding: {
      protocol: 'jina', endpoint: 'https://api.jina.ai/v1/embeddings',
      model: 'jina-embeddings-v3', apiKey: '', dimensions: 512,
    },
    rerank: {
      endpoint: 'https://api.jina.ai/v1/rerank',
      model: 'jina-reranker-v2-base-multilingual', apiKey: '',
    },
  }
}

/** Copy only explicitly enabled provider settings at the request boundary. */
export function writerMemoryRemoteOptions(providers: WriterMemoryProviders): MemoryRemoteOptions {
  return {
    ...(providers.embeddingEnabled ? { embedding: { ...providers.embedding } } : {}),
    ...(providers.rerankEnabled ? { rerank: { ...providers.rerank } } : {}),
  }
}
