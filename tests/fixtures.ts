import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export async function makePdf(title = 'A Clearer Way to Read', pageCount = 3) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor('Paperleaf Test');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = pdf.addPage([600, 780]);
    page.drawText(`${i === 1 ? 'Introduction' : i === 2 ? 'Methods' : 'Results and Discussion'}`, {
      x: 55,
      y: 710,
      size: 22,
      font,
      color: rgb(0.15, 0.2, 0.16),
    });
    const lines = [
      'The study asks how structured reading supports understanding.',
      'The method uses a controlled experiment.',
      'Participants read scientific papers with a structured guide.',
      'The evidence supports improved comprehension in this sample.',
      'The sample is small and external validity remains uncertain.',
      'Future work should test the method in different disciplines.',
      `This is page ${i} of the local test document.`,
    ];
    lines.forEach((text, index) =>
      page.drawText(text, { x: 55, y: 660 - index * 30, size: 12, font }),
    );
  }
  return Buffer.from(await pdf.save());
}
