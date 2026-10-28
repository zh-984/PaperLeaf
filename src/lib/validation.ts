import { z } from 'zod';
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/, '无效的记录 ID');
export const bookshelfSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '书架名称不能为空')
    .max(60)
    .regex(/^[^\r\n\x00-\x1f]+$/, '书架名称不能包含控制字符'),
});
export const bookshelfPatchSchema = bookshelfSchema
  .partial()
  .extend({ collapsed: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, '没有需要修改的字段');
export const preferencesSchema = z
  .object({
    theme: z.enum(['green', 'blue', 'yellow', 'white']).optional(),
    defaultView: z.enum(['report', 'original']).optional(),
    showAiNotice: z.boolean().optional(),
    autoInterpret: z.boolean().optional(),
    reduceMotion: z.boolean().optional(),
    readerFitWidth: z.boolean().optional(),
    defaultShelfCollapsed: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '没有需要修改的字段');
export const paperPatchSchema = z
  .object({
    title: z.string().trim().min(1, '标题不能为空').max(500).optional(),
    lastPage: z.number().int().positive().optional(),
    lastPosition: z.number().min(0).max(1).optional(),
    shelfId: idSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '没有需要修改的字段');
export const anchorSchema = z.object({
  version: z.literal(1),
  locations: z
    .array(
      z.object({
        page: z.number().int().positive(),
        position: z.number().min(0).max(1).optional(),
        rects: z
          .array(
            z
              .tuple([
                z.number().min(0).max(1),
                z.number().min(0).max(1),
                z.number().min(0).max(1),
                z.number().min(0).max(1),
              ])
              .refine(
                ([x, y, w, h]) => w > 0 && h > 0 && x + w <= 1.002 && y + h <= 1.002,
                '选区位置无效',
              ),
          )
          .max(300),
      }),
    )
    .min(1)
    .max(10),
});
export const noteSchema = z.object({
  content: z.string().max(100000),
  page: z.number().int().positive().nullable().default(null),
  selectedText: z.string().max(30000).default(''),
  source: z.enum(['manual', 'ai', 'excerpt']).default('manual'),
  anchor: anchorSchema.nullable().optional(),
});
export const notePatchSchema = noteSchema.extend({ version: z.number().int().nonnegative() });
export const askSchema = z
  .object({
    page: z.number().int().positive(),
    selectedText: z.string().trim().max(12000).default(''),
    action: z.enum(['translate', 'explain', 'term', 'question']),
    question: z.string().trim().max(2000).default(''),
    anchor: anchorSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.action === 'question' ? value.question.length > 0 : value.selectedText.length > 0,
    '请先选中文字或输入问题',
  );
export const reportInputSchema = z.object({ force: z.boolean().default(false) });
export const modelSectionSchema = z.object({
  conclusion: z.string().trim().min(1).max(2000),
  points: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(3000),
        page: z.number().int().positive().nullable().default(null),
        quote: z.string().max(1000).default(''),
      }),
    )
    .min(2)
    .max(10),
});
