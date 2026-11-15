import { parentPort, workerData } from 'node:worker_threads';
import { TextDecoder } from 'node:util';
import yauzl from 'yauzl';
import mammoth from 'mammoth';
const buffer = Buffer.from(workerData.buffer);
async function checkDocx() {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(new Error('DOCX 压缩包无效'));
      let count = 0, size = 0, document = false;
      const stop = message => { zip.close(); reject(new Error(message)); };
      zip.on('error', () => stop('DOCX 结构损坏'));
      zip.on('entry', entry => {
        count++; size += entry.uncompressedSize;
        if ((entry.generalPurposeBitFlag & 1) || count > 2000 || size > 30 * 1024 * 1024) return stop('DOCX 超过安全解析限制或已加密');
        if (entry.fileName === 'word/document.xml') document = true;
        zip.readEntry();
      });
      zip.on('end', () => document ? resolve() : reject(new Error('不是有效的 DOCX 文件')));
      zip.readEntry();
    });
  });
}
try {
  let text = '';
  if (workerData.ext === '.txt') {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.includes('\0')) throw new Error('TXT 包含二进制内容，请保存为 UTF-8 文本');
  } else if (workerData.ext === '.docx') {
    await checkDocx();
    text = (await mammoth.extractRawText({ buffer })).value;
  } else {
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF 文件头无效');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true }); const doc = await task.promise;
    if (doc.numPages > 100) { await task.destroy(); throw new Error('PDF 不得超过 100 页'); }
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') + '\n';
      page.cleanup();
      if (text.length > 500000) throw new Error('简历文字超过 50 万字解析限制');
    }
    await task.destroy();
  }
  text = text.replace(/\r/g, '').trim();
  if (text.length < 10) throw new Error('没有可读取的文字；扫描件请先进行 OCR 后重新上传');
  if (text.length > 500000) throw new Error('简历文字超过 50 万字解析限制');
  parentPort.postMessage({ text });
} catch (error) { parentPort.postMessage({ error: error.message?.slice(0, 250) || '简历解析失败' }); }
