import fs from 'fs';
import os from 'os';
import path from 'path';
import pdfParse from 'pdf-parse';
import PDFParser from 'pdf2json';

// Comprehensive list of Indian States & Union Territories
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
  'Dadra and Nagar Haveli', 'Daman and Diu', 'Andaman and Nicobar', 'Lakshadweep'
];

// Major Indian Cities for accurate destination detection
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
  'Ambegaon', 'Pimpri', 'Chinchwad', 'Panvel', 'Karnal', 'Panipat', 'Rohtak',
  'Mathura', 'Ajmer', 'Bikaner', 'Gaya', 'Muzaffarpur', 'Siliguri', 'Durgapur',
  'Udaipur', 'Asansol', 'Rourkela', 'Bhilai', 'Bilaspur', 'Nanded', 'Saharanpur'
];

/**
 * Clean and normalize text
 */
function cleanText(str) {
  if (!str) return '';
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/**
 * Identify marketplace from PDF text content
 */
export function detectMarketplace(text) {
  const lower = text.toLowerCase();
  
  // Amazon checks
  if (
    lower.includes('amazon') ||
    lower.includes('easy ship') ||
    lower.includes('amazon seller') ||
    lower.includes('amazon.in') ||
    /\b\d{3}-\d{7}-\d{7}\b/.test(text)
  ) {
    return 'Amazon';
  }

  // Flipkart checks
  if (
    lower.includes('flipkart') ||
    lower.includes('ekart') ||
    lower.includes('fbf') ||
    /\bOD\d{16,18}\b/i.test(text)
  ) {
    return 'Flipkart';
  }

  // JioMart / Reliance checks
  if (
    lower.includes('jiomart') ||
    lower.includes('reliance retail') ||
    lower.includes('jio mart') ||
    lower.includes('relianceretail')
  ) {
    return 'JioMart';
  }

  // Meesho checks
  if (
    lower.includes('meesho') ||
    lower.includes('fashnear')
  ) {
    return 'Meesho';
  }

  return 'Other Marketplace';
}

/**
 * Extract Order ID based on marketplace patterns
 */
export function extractOrderId(text, marketplace) {
  // Amazon: 402-1234567-8901234
  const amazonMatch = text.match(/\b(\d{3}-\d{7}-\d{7})/);
  if (amazonMatch) return amazonMatch[1];

  // Flipkart: OD123456789012345678
  const flipkartMatch = text.match(/\b(OD\d{16,18})/i);
  if (flipkartMatch) return flipkartMatch[1];

  // Order ID / Order No keywords
  const orderKwMatch = text.match(/(?:Order\s*(?:ID|No|Number|#)[\s:-]*)\s*([A-Za-z0-9\-]+)/i);
  if (orderKwMatch && orderKwMatch[1].length >= 5) {
    const rawId = orderKwMatch[1].trim();
    const amz = rawId.match(/(\d{3}-\d{7}-\d{7})/);
    if (amz) return amz[1];
    return rawId;
  }

  // Fallback: generate a unique dispatch reference
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${Date.now().toString().slice(-6)}-${randomSuffix}`;
}

/**
 * Extract Customer Name and Address details (City, State, Pincode)
 */
export function extractCustomerAndLocation(text, marketplace) {
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
    for (let i = shipIndex + 1; i < Math.min(lines.length, shipIndex + 14); i++) {
      const line = lines[i];
      const low = line.toLowerCase();
      if (
        low.startsWith('order number') ||
        low.startsWith('invoice number') ||
        low.startsWith('billing address') ||
        low.startsWith('sold by') ||
        low.startsWith('sl.') ||
        low.startsWith('description') ||
        low.startsWith('tax invoice')
      ) {
        break;
      }
      blockLines.push(line);
    }

    const blockText = blockLines.join('\n');

    // Customer Name: first valid name line in block (ignore system markers)
    for (const line of blockLines) {
      const low = line.toLowerCase();
      if (
        low.includes('dynamic qr') ||
        low.includes('state/ut') ||
        low.includes('fssai') ||
        low.includes('place of') ||
        low.includes('gst') ||
        low.includes('pan') ||
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

    // Pincode in shipping block
    const pinMatch = blockText.match(/\b([1-9][0-9]{5})\b/);
    if (pinMatch) pincode = pinMatch[1];

    // State in shipping block
    for (const s of INDIAN_STATES) {
      if (new RegExp(`\\b${s}\\b`, 'i').test(blockText)) {
        state = s;
        break;
      }
    }

    // City in shipping block
    for (const c of MAJOR_INDIAN_CITIES) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(blockText)) {
        city = c;
        break;
      }
    }

    // Clean address lines (exclude GST, PAN, FSSAI, Dynamic QR, State/UT Code)
    address = blockLines
      .filter(l => {
        const low = l.toLowerCase();
        return !low.includes('dynamic qr') &&
               !low.includes('state/ut code') &&
               !low.includes('fssai') &&
               !low.startsWith('gst') &&
               !low.startsWith('pan') &&
               !/^[0-9A-Z]{15}$/.test(l);
      })
      .join(', ');
  } else {
    // Fallback: search entire document if no shipping header identified
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

    const nameMatch = text.match(/(?:Name|Customer|Buyer)[\s:-]+([A-Za-z\s]{3,35})/i);
    if (nameMatch) {
      customerName = nameMatch[1].trim();
    }
  }

  // Priority B: Comma-separated city before state (e.g. "MATHURA, UTTAR PRADESH" or "PUNE, MAHARASHTRA")
  if (city === 'Unknown City' && state !== 'Unknown State') {
    const commaStateRegex = new RegExp(`([A-Za-z\\s]{3,25})\\s*,\\s*${state}`, 'i');
    const m = text.match(commaStateRegex);
    if (m) {
      const cand = m[1].trim();
      if (!customerName.toLowerCase().includes(cand.toLowerCase()) && cand.length >= 3) {
        city = cand.charAt(0).toUpperCase() + cand.slice(1).toLowerCase();
      }
    }
  }

  // Priority C: Check word before pincode (e.g. "PUNE 411046")
  if (city === 'Unknown City' && pincode) {
    const pinPreRegex = new RegExp(`([A-Za-z]{3,25})\\s*(?:-|,)?\\s*${pincode}`, 'i');
    const m = text.match(pinPreRegex);
    if (m && m[1].toLowerCase() !== state.toLowerCase()) {
      const cand = m[1].trim();
      if (!customerName.toLowerCase().includes(cand.toLowerCase()) && cand.length >= 3) {
        city = cand.charAt(0).toUpperCase() + cand.slice(1).toLowerCase();
      }
    }
  }

  // Clean customer name of common noise
  customerName = customerName.replace(/^(mr\.|mrs\.|ms\.|shri|smt)\s+/i, '');
  if (customerName.length > 40) {
    customerName = customerName.substring(0, 40) + '...';
  }

  // Ensure city does not match or appear in customerName
  if (customerName.toLowerCase().includes(city.toLowerCase()) || city.toLowerCase() === customerName.toLowerCase()) {
    city = 'Unknown City';
  }

  return { customerName, city, state, pincode, address };
}

/**
 * Extract Products / Items, SKU, and Quantity
 */
export function extractProducts(text, marketplace) {
  const items = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Helper to test if a string looks like a system header rather than a product
  const isHeaderLine = (l) => {
    const low = l.toLowerCase();
    return (
      low.includes('tax invoice') ||
      low.includes('shipping label') ||
      low.includes('manifest') ||
      low.includes('easy ship') ||
      low.includes('order id') ||
      low.includes('date:') ||
      low.includes('phone:') ||
      low.includes('customer') ||
      low.includes('deliver') ||
      low.includes('ship to') ||
      low.includes('courier') ||
      low.includes('tracking') ||
      low.includes('carrier') ||
      low.includes('seller services') ||
      low.includes('retail limited') ||
      low.includes('item description') ||
      low.includes('description') && low.includes('qty') ||
      low.includes('total') ||
      low.includes('sl.') ||
      low.includes('unit price')
    );
  };

  // Pattern 1: Lines with ASIN or SKU
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Amazon ASIN: B0...
    if (/B0[A-Z0-9]{8}/.test(line)) {
      const asinMatch = line.match(/B0[A-Z0-9]{8}/);

      const titleParts = [];
      // Look backward up to 6 lines for preceding product description lines
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const prev = lines[j].trim();
        if (isHeaderLine(prev) || /^\d+$/.test(prev) || /^[₹Rs.]/.test(prev)) {
          break;
        }
        titleParts.unshift(prev);
      }

      // Current line title portion
      let curTitle = line.replace(asinMatch[0], '').replace(/asin[\s:-]*/i, '').trim();
      curTitle = curTitle.replace(/(?:\s*HSN:|\s*(?:₹|Rs\.?|INR)\s*[\d,.]+).*$/i, '').trim();
      curTitle = curTitle.replace(/\s*\(\s*[A-Z0-9-]+\s*\)\s*$/i, '').trim();
      curTitle = curTitle.replace(/\|\s*$/, '').trim();
      if (curTitle && curTitle.length > 2) {
        titleParts.push(curTitle);
      }

      const fullDesc = titleParts.join(' ').replace(/\s+/g, ' ').trim();

      // Extract the primary product title (first segment before pipe |)
      let title = fullDesc;
      if (fullDesc.includes('|')) {
        const segments = fullDesc.split('|').map(s => s.trim()).filter(Boolean);
        title = segments[0] || fullDesc;
        // If first segment is just a number or too short, fallback
        if (title.length < 3 && segments.length > 1) {
          title = segments[1];
        }
      }
      title = title.replace(/^\d+\s+/, '').trim();

      // Extract quantity from line if present, or search adjacent lines
      let quantity = 1;
      const qtyMatch = line.match(/(?:qty|quantity)[\s:-]*([0-9]+)/i) ||
                        line.match(/[₹Rs.][\d,.]+\s+([1-9][0-9]?)\s+[₹Rs.]/);
      if (qtyMatch) {
        quantity = parseInt(qtyMatch[1], 10) || 1;
      } else {
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + 4); j++) {
          if (/^[1-9][0-9]?$/.test(lines[j])) {
            quantity = parseInt(lines[j], 10);
            break;
          }
        }
      }

      items.push({
        title: title || 'Amazon Product',
        quantity,
        sku: asinMatch[0]
      });
    }
    // SKU indicator
    else if (line.toLowerCase().includes('sku:') || line.toLowerCase().includes('sku -')) {
      const skuMatch = line.match(/sku[\s:-]+([A-Za-z0-9\-_]+)/i);
      let title = line.replace(/sku[\s:-]+[A-Za-z0-9\-_]+/i, '').trim();
      if (!title && i > 0 && !isHeaderLine(lines[i - 1])) {
        title = lines[i - 1];
      }
      // Strip trailing quantity or digits
      title = title.replace(/\s+\d+\s*$/, '').trim();
      items.push({
        title: title || 'Product Item',
        quantity: 1,
        sku: skuMatch ? skuMatch[1] : ''
      });
    }
  }

  // Pattern 2: Explicit Quantity indicator (e.g. "Qty: 2", "Quantity: 1")
  if (items.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const qtyMatch = line.match(/(?:qty|quantity)[\s:-]*([0-9]+)/i);
      if (qtyMatch) {
        const qty = parseInt(qtyMatch[1], 10) || 1;
        let title = line.replace(/(?:qty|quantity)[\s:-]*[0-9]+/i, '').trim();
        if ((!title || title.length < 3) && i > 0 && !isHeaderLine(lines[i - 1])) {
          title = lines[i - 1];
        }
        if (title && title.length > 3 && !isHeaderLine(title)) {
          items.push({
            title: title.substring(0, 80),
            quantity: qty,
            sku: ''
          });
        }
      }
    }
  }

  // Pattern 3: Table row with trailing quantity number (e.g. "Basmati Rice 5Kg   2")
  if (items.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isHeaderLine(line)) continue;

      const rowMatch = line.match(/^(.+?)\s{2,}(\d{1,3})$/);
      if (rowMatch) {
        const title = rowMatch[1].trim();
        const qty = parseInt(rowMatch[2], 10) || 1;
        if (title.length > 3 && !isHeaderLine(title)) {
          items.push({
            title: title.substring(0, 80),
            quantity: qty,
            sku: ''
          });
        }
      }
    }
  }

  // Fallback
  if (items.length === 0) {
    const candidates = lines.filter(l => l.length > 8 && !isHeaderLine(l));
    if (candidates.length > 0) {
      items.push({
        title: candidates[0].substring(0, 70),
        quantity: 1,
        sku: ''
      });
    } else {
      items.push({
        title: 'Dispatch Item',
        quantity: 1,
        sku: ''
      });
    }
  }

  return items;
}

/**
 * Extract Tracking / AWB Number if present on shipping label
 */
export function extractTracking(text) {
  // AWB / Tracking keywords
  const awbMatch = text.match(/(?:AWB|Tracking\s*(?:ID|No|Number)|Waybill)[\s:-]*([A-Za-z0-9]+)/i);
  if (awbMatch && awbMatch[1].length >= 6) {
    return awbMatch[1].trim();
  }

  // Amazon ATS: ATS followed by digits, or Delhivery / Ekart / BlueDart numbers
  const atsMatch = text.match(/\b(ATS\d{9,15})\b/i);
  if (atsMatch) return atsMatch[1];

  const ekartMatch = text.match(/\b(FMPC\d{10,14}|EKART\d{8,14})\b/i);
  if (ekartMatch) return ekartMatch[1];

  return '';
}

/**
 * Helper to extract text using pdf2json via temp file with natural coordinate sorting
 */
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
            // Sort text fragments by visual top-to-bottom (y) and left-to-right (x)
            const sortedTexts = (page.Texts || []).sort((a, b) => {
              if (Math.abs(a.y - b.y) > 0.4) {
                return a.y - b.y;
              }
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

/**
 * Extract Total Amount (e.g. ₹94.00)
 */
export function extractTotalAmount(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (/total/i.test(line) && !/sub-?total/i.test(line)) {
      const match = line.match(/(?:[₹Rs.]|INR)?\s*([0-9]{1,6}(?:\.[0-9]{2}))/g);
      if (match && match.length > 0) {
        const lastStr = match[match.length - 1].replace(/[₹Rs.INR\s]/g, '');
        const val = parseFloat(lastStr);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  }

  const amounts = [];
  const regex = /(?:₹|Rs\.?)\s*([0-9]{1,6}\.[0-9]{2})/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const val = parseFloat(m[1]);
    if (!isNaN(val)) amounts.push(val);
  }
  if (amounts.length > 0) {
    return Math.max(...amounts);
  }

  return 0;
}

/**
 * Main parser function: accepts a Buffer of the PDF file and returns structured order details
 */
export async function parseDispatchPdf(pdfBuffer, originalFilename = '') {
  let rawText = '';
  let totalPages = 1;

  // 1. Try modern pdf2json parser first
  try {
    rawText = await extractTextPdf2Json(pdfBuffer);
  } catch (err1) {
    // 2. Fallback to pdf-parse
    try {
      const data = await pdfParse(pdfBuffer);
      rawText = data.text;
      totalPages = data.numpages || 1;
    } catch (err2) {
      console.error('All PDF parsing engines failed:', err2.message || err2);
    }
  }

  rawText = cleanText(rawText);

  if (!rawText || rawText.length < 5) {
    // Graceful fallback so the PDF can still be processed, printed, and packed
    const fallbackId = `ORD-${Date.now().toString().slice(-6)}`;
    return {
      orderId: fallbackId,
      channel: 'Other Marketplace',
      customerName: 'Customer (Review PDF)',
      city: 'Unknown City',
      state: 'Unknown State',
      pincode: '',
      address: '',
      items: [{ title: 'Order Item (View attached PDF)', quantity: 1, sku: '' }],
      itemsSummary: 'Order Item (View attached PDF) (x1)',
      trackingNumber: '',
      totalPages: 1,
      rawTextPreview: ''
    };
  }

  const channel = detectMarketplace(rawText);
  const orderId = extractOrderId(rawText, channel);
  const { customerName, city, state, pincode, address } = extractCustomerAndLocation(rawText, channel);
  const items = extractProducts(rawText, channel);
  const trackingNumber = extractTracking(rawText);
  const totalAmount = extractTotalAmount(rawText);

  // Create a readable summary of items
  const itemsSummary = items
    .map(item => `${item.title} (x${item.quantity})`)
    .join(', ');

  return {
    orderId,
    channel,
    customerName,
    city,
    state,
    pincode,
    address,
    items,
    itemsSummary,
    trackingNumber,
    totalAmount,
    totalPages,
    rawTextPreview: rawText.substring(0, 300)
  };
}
