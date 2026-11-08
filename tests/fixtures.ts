import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createRequire } from 'node:module';
export async function makeDocx(paragraphs: string[]) {
  const require = createRequire(import.meta.url);
  const JSZip = createRequire(require.resolve('mammoth/package.json'))('jszip') as new () => {
    file: (name: string, value: string) => void;
    generateAsync: (options: { type: 'nodebuffer' }) => Promise<Buffer>;
  };
  const zip = new JSZip();
  const escape = (text: string) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${escape(p)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
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
