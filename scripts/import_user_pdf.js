import fs from 'fs';
import path from 'path';
import { parseDispatchPdf } from '../src/parser.js';
import { initDb, saveOrder, deleteOrder } from '../src/db.js';

async function run() {
  initDb();
  deleteOrder('406-2421719-9251540Invoice');
  
  const userPdf = 'C:/Users/anujd/.gemini/antigravity/brain/7d08e175-284e-4b52-bab6-a48b8d832b31/.user_uploaded/media_1792479350447_9b0b0026.pdf';
  if (!fs.existsSync(userPdf)) {
    console.log('PDF not found at', userPdf);
    return;
  }
  console.log('Parsing user PDF from:', userPdf);
  const pdfBuffer = fs.readFileSync(userPdf);
  const parsed = await parseDispatchPdf(pdfBuffer, 'amazon_order.pdf');
  console.log('Parsed successfully:', JSON.stringify(parsed, null, 2));

  // Copy to storage/pdfs
  const pdfStorageDir = path.resolve('./storage/pdfs');
  if (!fs.existsSync(pdfStorageDir)) fs.mkdirSync(pdfStorageDir, { recursive: true });
  const filename = `${parsed.orderId}_${Date.now()}.pdf`;
  const destPath = path.join(pdfStorageDir, filename);
  fs.copyFileSync(userPdf, destPath);

  const orderRecord = saveOrder({
    ...parsed,
    pdfFilename: filename,
    pdfPath: `/api/orders/pdf/${filename}`,
    source: 'whatsapp'
  });
  console.log('Order added to DB successfully:', orderRecord.orderId);
}

run().catch(console.error);
