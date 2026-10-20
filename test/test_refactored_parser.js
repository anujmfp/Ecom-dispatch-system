import fs from 'fs';
import path from 'path';
import os from 'os';
import PDFParser from 'pdf2json';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
  'Dadra and Nagar Haveli', 'Daman and Diu', 'Andaman and Nicobar', 'Lakshadweep'
];

const MAJOR_INDIAN_CITIES = [
  'Mumbai', 'Delhi', 'Bengaluru', 'Bangalore', 'Hyderabad', 'Ahmedabad', 'Chennai',
  'Kolkata', 'Surat', 'Pune', 'Jaipur', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore',
  'Thane', 'Bhopal', 'Visakhapatnam', 'Patna', 'Vadodara', 'Ghaziabad', 'Ludhiana',
  'Agra', 'Nashik', 'Faridabad', 'Meerut', 'Rajkot', 'Varanasi', 'Srinagar',
  'Aurangabad', 'Dhanbad', 'Amritsar', 'Navi Mumbai', 'Allahabad', 'Prayagraj',
  'Ranchi', 'Howrah', 'Coimbatore', 'Jabalpur', 'Gwalior', 'Vijayawada', 'Jodhpur',
  'Madurai', 'Raipur', 'Kota', 'Chandigarh', 'Guwahati', 'Solapur', 'Hubli',
  'Mysore', 'Tiruchirappalli', 'Bareilly', 'Aligarh', 'Tiruppur', 'Gurgaon',
  'Gurugram', 'Moradabad', 'Jalandhar', 'Bhubaneswar', 'Salem', 'Warangal',
  'Jalgaon', 'Guntur', 'Noida', 'Umbergaon', 'Dehradun', 'Kochi', 'Kolhapur',
  'Jamnagar', 'Ujjain', 'Jammu', 'Sangli', 'Mangalore', 'Udaipur', 'Kalyan',
  'Ambegaon', 'Pimpri', 'Chinchwad', 'Panvel', 'Karnal', 'Panipat', 'Rohtak'
];

function extractTextPdf2Json(pdfBuffer) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    try {
      fs.writeFileSync(tempFile, pdfBuffer);
      const parser = new PDFParser();
      parser.on('pdfParser_dataReady', (data) => {
        try {
          const lines = [];
          for (const page of data.Pages || []) {
            const sortedTexts = (page.Texts || []).sort((a, b) => {
              if (Math.abs(a.y - b.y) > 0.4) return a.y - b.y;
              return a.x - b.x;
            });

            for (const t of sortedTexts) {
              let str = '';
              const raw = (t.R || []).map(r => r.T).join('');
              try {
                str = decodeURIComponent(raw);
              } catch (e) {
                try {
                  str = unescape(raw);
                } catch (e2) {
                  str = raw;
                }
              }
              if (str.trim()) lines.push(str.trim());
            }
          }
          try { fs.unlinkSync(tempFile); } catch (e) {}
          resolve(lines.join('\n'));
        } catch (e) {
          try { fs.unlinkSync(tempFile); } catch (e) {}
          reject(e);
        }
      });
      parser.on('pdfParser_dataError', (err) => {
        try { fs.unlinkSync(tempFile); } catch (e) {}
        reject(err.parserError || err);
      });
      parser.loadPDF(tempFile);
    } catch (err) {
      try { fs.unlinkSync(tempFile); } catch (e) {}
      reject(err);
    }
  });
}

function detectMarketplace(text) {
  const lower = text.toLowerCase();
  if (lower.includes('amazon') || lower.includes('easy ship') || lower.includes('amazon seller') || lower.includes('amazon.in') || /\b\d{3}-\d{7}-\d{7}\b/.test(text)) {
    return 'Amazon';
  }
  if (lower.includes('flipkart') || lower.includes('ekart') || lower.includes('fbf') || /\bOD\d{16,18}\b/i.test(text)) {
    return 'Flipkart';
  }
  if (lower.includes('jiomart') || lower.includes('reliance retail') || lower.includes('jio mart') || lower.includes('relianceretail')) {
    return 'JioMart';
  }
  return 'Other Marketplace';
}

function extractOrderId(text) {
  const amazonMatch = text.match(/\b(\d{3}-\d{7}-\d{7})/);
  if (amazonMatch) return amazonMatch[1];
  const flipkartMatch = text.match(/\b(OD\d{16,18})/i);
  if (flipkartMatch) return flipkartMatch[1];
  const orderKwMatch = text.match(/(?:Order\s*(?:ID|No|Number|#)[\s:-]*)\s*([A-Za-z0-9\-]+)/i);
  if (orderKwMatch && orderKwMatch[1].length >= 5) {
    const rawId = orderKwMatch[1].trim();
    const amz = rawId.match(/(\d{3}-\d{7}-\d{7})/);
    if (amz) return amz[1];
    return rawId;
  }
  return `ORD-${Date.now().toString().slice(-6)}`;
}

function extractCustomerAndLocation(text) {
  let customerName = 'Unknown Customer';
  let city = 'Unknown City';
  let state = 'Unknown State';
  let pincode = '';
  let address = '';

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Look for Shipping Address section index
  let shipIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (
      l.startsWith('shipping address') ||
      l.startsWith('ship to:') ||
      l.startsWith('ship to') ||
      l.startsWith('deliver to:') ||
      l.startsWith('deliver to') ||
      l.startsWith('dispatch to')
    ) {
      shipIndex = i;
      break;
    }
  }

  // If shipping address found, extract exclusively within the shipping block
  if (shipIndex !== -1) {
    const blockLines = [];
    for (let i = shipIndex + 1; i < Math.min(lines.length, shipIndex + 12); i++) {
      const line = lines[i];
      const low = line.toLowerCase();
      if (
        low.startsWith('order number') ||
        low.startsWith('invoice number') ||
        low.startsWith('billing address') ||
        low.startsWith('sold by') ||
        low.startsWith('sl.') ||
        low.startsWith('description')
      ) {
        break;
      }
      blockLines.push(line);
    }

    const blockText = blockLines.join('\n');

    // Customer Name: first valid name line in block (ignore keywords)
    for (const line of blockLines) {
      const low = line.toLowerCase();
      if (
        low.includes('dynamic qr') ||
        low.includes('state/ut') ||
        low.includes('fssai') ||
        low.includes('place of') ||
        low === 'in' ||
        /^\d+$/.test(line)
      ) {
        continue;
      }
      if (/^[A-Za-z\s.]{3,35}$/.test(line)) {
        customerName = line.trim();
        break;
      }
    }

    // Pincode in block
    const pinMatch = blockText.match(/\b([1-9][0-9]{5})\b/);
    if (pinMatch) pincode = pinMatch[1];

    // State in block
    for (const s of INDIAN_STATES) {
      if (new RegExp(`\\b${s}\\b`, 'i').test(blockText)) {
        state = s;
        break;
      }
    }

    // City in block
    for (const c of MAJOR_INDIAN_CITIES) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(blockText)) {
        city = c;
        break;
      }
    }

    // Clean address
    address = blockLines
      .filter(l => !l.toLowerCase().includes('dynamic qr') && !l.toLowerCase().includes('state/ut code') && !l.toLowerCase().includes('fssai'))
      .join(', ');
  } else {
    // Fallback: whole text
    const pinMatch = text.match(/\b([1-9][0-9]{5})\b/);
    if (pinMatch) pincode = pinMatch[1];
    for (const s of INDIAN_STATES) {
      if (new RegExp(`\\b${s}\\b`, 'i').test(text)) {
        state = s;
        break;
      }
    }
    for (const c of MAJOR_INDIAN_CITIES) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(text)) {
        city = c;
        break;
      }
    }
  }

  return { customerName, city, state, pincode, address };
}

function extractProducts(text) {
  const items = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const isHeaderLine = (l) => {
    const low = l.toLowerCase();
    return (
      low.includes('tax invoice') || low.includes('shipping label') ||
      low.includes('order id') || low.includes('date:') || low.includes('phone:') ||
      low.includes('customer') || low.includes('deliver') || low.includes('ship to') ||
      low.includes('seller services') || low.includes('description') || low.includes('total')
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/B0[A-Z0-9]{8}/.test(line)) {
      const asinMatch = line.match(/B0[A-Z0-9]{8}/);
      let title = line.replace(asinMatch[0], '').replace(/asin[\s:-]*/i, '').trim();
      title = title.replace(/^\d+\s+/, '').trim();
      title = title.replace(/(?:\s*HSN:|\s*(?:₹|Rs\.?|INR)\s*[\d,.]+).*$/i, '').trim();
      title = title.replace(/\s*\(\s*[A-Z0-9-]+\s*\)\s*$/i, '').trim();
      title = title.replace(/\|\s*$/, '').trim();

      if (!title || title.length < 3) {
        const precedingTitles = [];
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          const prev = lines[j].trim();
          if (isHeaderLine(prev) || /^\d+$/.test(prev) || /^[₹Rs.]/.test(prev)) {
            if (precedingTitles.length > 0) break;
            continue;
          }
          precedingTitles.unshift(prev);
        }
        if (precedingTitles.length > 0) {
          title = precedingTitles.join(' ').replace(/\|\s*$/, '').trim();
        }
      }

      // Quantity check
      let quantity = 1;
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 4); j++) {
        if (/^[1-9][0-9]?$/.test(lines[j])) {
          quantity = parseInt(lines[j], 10);
          break;
        }
      }

      items.push({
        title: title || 'Amazon Product',
        quantity,
        sku: asinMatch[0]
      });
    }
  }

  return items;
}

async function test() {
  const buf = fs.readFileSync('C:/Users/anujd/.gemini/antigravity/brain/7d08e175-284e-4b52-bab6-a48b8d832b31/.user_uploaded/media_1792479350447_9b0b0026.pdf');
  const text = await extractTextPdf2Json(buf);
  const marketplace = detectMarketplace(text);
  const orderId = extractOrderId(text);
  const custLoc = extractCustomerAndLocation(text);
  const items = extractProducts(text);

  console.log({
    orderId,
    marketplace,
    ...custLoc,
    items
  });
}

test();
