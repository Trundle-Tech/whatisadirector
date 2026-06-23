export interface VertexAPI {
  generateEmbedding: (text: string) => Promise<number[]>;
  getSimilarity: (vecA: number[], vecB: number[]) => Promise<number>;
  getVectorGraph: (documents: {
    id: string;
    title: string;
    type: string;
    tags?: string[];
    relatedDocuments?: string[];
    embedding?: number[];
  }[]) => Promise<{
    nodes: { id: string; title: string; type: string; tags: string[] }[];
    edges: { id: string; source: string; target: string; type: 'semantic' | 'taxonomic' | 'relational'; value?: number; label?: string }[];
  }>;
  chat: (messages: { role: string; content: string }[]) => Promise<string>;
}

declare global {
  interface Window {
    vertex: VertexAPI;
  }
}
