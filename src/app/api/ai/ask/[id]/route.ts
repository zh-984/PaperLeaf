import { askSchema, idSchema } from '@/lib/validation';
import { askPaper } from '@/server/ai/ask';
import { assertSameOrigin, errorResponse, jsonBody } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    idSchema.parse(id);
    return Response.json(
      await askPaper(id, askSchema.parse(await jsonBody(request)), request.signal),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
