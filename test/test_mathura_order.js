import fs from 'fs';
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
  'Ambegaon', 'Pimpri', 'Chinchwad', 'Panvel', 'Karnal', 'Panipat', 'Rohtak',
  'Mathura', 'Ajmer', 'Bikaner', 'Gaya', 'Muzaffarpur', 'Siliguri', 'Durgapur'
];

function extractCustomerAndLocation(text) {
  let customerName = 'Unknown Customer';
  let city = 'Unknown City';
  let state = 'Unknown State';
  let pincode = '';
  let address = '';

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

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

    for (const line of blockLines) {
      const low = line.toLowerCase();
      if (
        low.includes('dynamic qr') || low.includes('state/ut') || low.includes('fssai') ||
        low.includes('place of') || low.includes('gst') || low.includes('pan') ||
        low === 'in' || /^\d+$/.test(line)
      ) continue;
      if (/^[A-Za-z\s.]{3,35}$/.test(line)) {
        customerName = line.trim();
        break;
      }
    }

    const pinMatch = blockText.match(/\b([1-9][0-9]{5})\b/);
    if (pinMatch) pincode = pinMatch[1];

    for (const s of INDIAN_STATES) {
      if (new RegExp(`\\b${s}\\b`, 'i').test(blockText)) {
        state = s;
        break;
      }
    }

    for (const c of MAJOR_INDIAN_CITIES) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(blockText)) {
        city = c;
        break;
      }
    }

    address = blockLines
      .filter(l => {
        const low = l.toLowerCase();
        return !low.includes('dynamic qr') && !low.includes('state/ut code') &&
               !low.includes('fssai') && !low.startsWith('gst') && !low.startsWith('pan') &&
               !/^[0-9A-Z]{15}$/.test(l);
      })
      .join(', ');
  }

  // Priority B: Comma-separated city before state (e.g. "MATHURA, UTTAR PRADESH")
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

  // Sanity check: ensure city is not part of customer name
  if (customerName.toLowerCase().includes(city.toLowerCase())) {
    city = 'Unknown City';
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
      low.includes('seller services') || low.includes('description') || low.includes('total') ||
      low.includes('sl.') || low.includes('unit price') || low.includes('qty')
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/B0[A-Z0-9]{8}/.test(line)) {
      const asinMatch = line.match(/B0[A-Z0-9]{8}/);
      
      const titleParts = [];
      // Look backward up to 5 lines for preceding product description lines
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

const parser = new PDFParser();
const buf = fs.readFileSync('storage/pdfs/403-9218248-5051553_1792481700354.pdf');
parser.on('pdfParser_dataReady', (data) => {
  const lines = [];
  for (const page of data.Pages || []) {
    const sortedTexts = (page.Texts || []).sort((a, b) => {
      if (Math.abs(a.y - b.y) > 0.4) return a.y - b.y;
      return a.x - b.x;
    });
    for (const t of sortedTexts) {
      let str = '';
      const raw = (t.R || []).map(r => r.T).join('');
      try { str = decodeURIComponent(raw); } catch (e) { try { str = unescape(raw); } catch (e2) { str = raw; } }
      if (str.trim()) lines.push(str.trim());
    }
  }
  const fullText = lines.join('\n');
  const custLoc = extractCustomerAndLocation(fullText);
  const items = extractProducts(fullText);
  console.log('TEST RESULT:');
  console.log('Customer:', custLoc.customerName);
  console.log('City:', custLoc.city);
  console.log('State:', custLoc.state);
  console.log('Pincode:', custLoc.pincode);
  console.log('Items:', JSON.stringify(items, null, 2));
});
parser.parseBuffer(buf);
