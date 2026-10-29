export const reportDefinitions = [
  ['summary', '一句话总结', '先抓住这篇论文的主线'],
  ['question', '研究问题', '作者究竟想解决什么'],
  ['background', '背景与动机', '为什么这个问题值得研究'],
  ['methods', '方法与数据', '研究是怎么做出来的'],
  ['findings', '核心结论', '证据支持了哪些发现'],
  ['contributions', '主要贡献', '相较已有研究，新在哪里'],
  ['limitations', '局限与可疑点', '哪些地方还需要保留判断'],
  ['terms', '关键术语表', '用日常语言理解专业概念'],
  ['route', '阅读路线', '带着问题回到原文'],
  ['questions', '可能的追问', '从理解走向自己的思考'],
] as const;
export type SectionKey = (typeof reportDefinitions)[number][0];
export type ReportStatus = 'idle' | 'running' | 'complete' | 'failed';
export interface EvidencePoint {
  text: string;
  page: number | null;
  quote: string;
  verified: boolean;
}
export interface ReportSection {
  key: SectionKey;
  title: string;
  conclusion: string;
  points: EvidencePoint[];
}
export interface InsightReport {
  status: ReportStatus;
  sections: ReportSection[];
  progress: string;
  error: string;
  model: string;
  tokenUsage: number;
  version: number;
  updatedAt: string;
}
export interface Paper {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  lastPage: number;
  lastPosition?: number;
  shelfId?: string | null;
  createdAt: string;
  updatedAt: string;
  report: InsightReport | null;
}
export interface ReferenceData {
  type: 'journal' | 'book' | 'thesis' | 'conference' | 'web' | 'other';
  title: string;
  authors: string;
  year: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  publisher: string;
}
export interface CitationSettings {
  markerTemplate: string;
  referenceTemplate: string;
}
export interface Bookshelf {
  id: string;
  name: string;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface AppPreferences {
  theme: 'green' | 'blue' | 'yellow' | 'white';
  defaultView: 'report' | 'original';
  showAiNotice: boolean;
  autoInterpret: boolean;
  reduceMotion: boolean;
  readerFitWidth: boolean;
  defaultShelfCollapsed: boolean;
}
export const defaultPreferences: AppPreferences = {
  defaultView: 'report',
  showAiNotice: true,
  autoInterpret: false,
  theme: 'green',
  reduceMotion: false,
  readerFitWidth: true,
  defaultShelfCollapsed: false,
};
export type AiAction = 'translate' | 'explain' | 'term' | 'question';
export interface AiHistory {
  id: string;
  paperId: string;
  page: number;
  selectedText: string;
  action: AiAction;
  question: string;
  answer: string;
  anchor?: ReadingAnchor | null;
  createdAt: string;
}
export interface Note {
  id: string;
  paperId: string;
  page: number | null;
  selectedText: string;
  content: string;
  source: 'manual' | 'ai' | 'excerpt';
  anchor?: ReadingAnchor | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface PaperDetail extends Paper {
  notes: Note[];
  history: AiHistory[];
}
export interface AppSettings {
  aiEnabled: boolean;
  aiModel: string;
  aiHost: string;
  maxUploadMB: number;
  maxUploadFiles: number;
  desktopMode?: boolean;
  aiBaseUrl?: string;
  aiHasKey?: boolean;
  aiVisionEnabled?: boolean;
  aiProfiles?: {
    slot: number;
    model: string;
    baseUrl: string;
    host: string;
    enabled: boolean;
    hasKey: boolean;
  }[];
}
export interface PageText {
  page: number;
  text: string;
}
export interface SelectionContext {
  text: string;
  page: number;
  anchor?: ReadingAnchor | null;
}
export interface ReadingAnchor {
  version: 1;
  locations: { page: number; rects: [number, number, number, number][]; position?: number }[];
}
export interface JumpTarget {
  page: number;
  quote: string;
  nonce: number;
  anchor?: ReadingAnchor | null;
}
export type ReportEvent =
  | { type: 'snapshot'; report: InsightReport }
  | { type: 'progress'; message: string }
  | { type: 'section'; section: ReportSection }
  | { type: 'done' }
  | { type: 'error'; message: string };
