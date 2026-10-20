import {
  detectMarketplace,
  extractOrderId,
  extractCustomerAndLocation,
  extractProducts,
  extractTracking
} from '../src/parser.js';

const ocrText = `
AWB 374595398324
SUR
0.20 kgs
Ship To:
Rupali Girme
Aasmant Society, Jambhulwadi Road,
Ambegaon Khurd B404 PUNE 411046
MAHARASHTRA
Landmark: Sidhivinayak sosayti
NDL: NONE
Order Id: 406-2421719-9251540
Ship Date: 22/10/2026
Ship From: Morella Farmpro LLP
amazon.in
Tax Invoice/Bill of Supply/Cash Memo
(Triplicate for Supplier)
Order Number:406-2421719-9251540
Invoice Number :IN-189
Order Date:19.10.2026
Invoice Date :19.10.2026
Sl. No Description Unit Price Qty Net Amount Tax Rate Tax Type Tax Amount Total Amount
1 truFLAVR Bombay Sandwich Masala | Chatpata & Tangy Blend of Spices | Perfect for Sandwiches, Toast, Chaats & Snacks | 60g | B0GW3DK5MF ( HC-2OWO-DQR2 ) HSN:21039040 ₹89.52 1 ₹89.52 5% IGST ₹4.48 ₹94.00
TOTAL: ₹4.48 ₹94.00
Amount in Words: Ninety-four only
Sold By : Morella Farmpro LLP
Billing Address :
Rupali Girme
Aasmant Society, Jambhulwadi Road, Ambegaon Khurd, B404
PUNE, MAHARASHTRA, 411046
Shipping Address :
Rupali Girme
Aasmant Society, Jambhulwadi Road, Ambegaon Khurd, B404
PUNE, MAHARASHTRA, 411046
State/UT Code:27
Place of supply:MAHARASHTRA
Place of delivery:MAHARASHTRA
`;

console.log('--- Testing User Amazon Dispatch Document ---');
const channel = detectMarketplace(ocrText);
const orderId = extractOrderId(ocrText, channel);
const custLoc = extractCustomerAndLocation(ocrText, channel);
const items = extractProducts(ocrText, channel);
const tracking = extractTracking(ocrText);

console.log('Detected Channel:', channel);
console.log('Detected Order ID:', orderId);
console.log('Customer Name:', custLoc.customerName);
console.log('City:', custLoc.city);
console.log('State:', custLoc.state);
console.log('Pincode:', custLoc.pincode);
console.log('Tracking AWB:', tracking);
console.log('Items:', items);
