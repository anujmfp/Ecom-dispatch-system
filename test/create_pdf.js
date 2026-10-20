import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createAmazonPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const textLines = [
    { text: 'Amazon Seller Services Private Limited', font: fontBold, size: 14, y: 760 },
    { text: 'TAX INVOICE / SHIPPING LABEL (Easy Ship)', font: fontBold, size: 12, y: 740 },
    { text: 'Order ID: 402-8877665-1122334', font: fontBold, size: 12, y: 710 },
    { text: 'Date: 19-Oct-2026', font: font, size: 10, y: 690 },
    { text: 'Ship To:', font: fontBold, size: 11, y: 660 },
    { text: 'Vikramaditya Sharma', font: fontBold, size: 12, y: 642 },
    { text: 'House No 104, Royal Palms, Sector 21', font: font, size: 10, y: 624 },
    { text: 'Chandigarh, Punjab - 160022', font: font, size: 10, y: 606 },
    { text: 'Phone: 9811223344', font: font, size: 10, y: 588 },
    { text: '---------------------------------------------------------------------------------', font: font, size: 10, y: 565 },
    { text: 'Item Description                                     Qty   Price', font: fontBold, size: 10, y: 550 },
    { text: 'Wireless Bluetooth ANC Over-Ear Headphones (Silver)   1     14,999.00', font: font, size: 10, y: 530 },
    { text: 'ASIN: B09XY99881', font: font, size: 9, y: 515 },
    { text: 'Fast USB-C GaN Wall Charger 65W                       2     1,899.00', font: font, size: 10, y: 495 },
    { text: 'ASIN: B08AB11223', font: font, size: 9, y: 480 },
    { text: '---------------------------------------------------------------------------------', font: font, size: 10, y: 455 },
    { text: 'Carrier: Amazon Transportation Services (ATS)', font: fontBold, size: 11, y: 430 },
    { text: 'Tracking / AWB: ATS7766554433', font: fontBold, size: 11, y: 410 }
  ];

  for (const line of textLines) {
    page.drawText(line.text, {
      x: 50,
      y: line.y,
      size: line.size,
      font: line.font,
      color: rgb(0.1, 0.1, 0.1)
    });
  }

  const pdfBytes = await pdfDoc.save();
  const filePath = path.join(__dirname, 'sample_amazon_real.pdf');
  fs.writeFileSync(filePath, pdfBytes);
  console.log('Real compliant Amazon PDF created at:', filePath);
  return filePath;
}

createAmazonPdf();
