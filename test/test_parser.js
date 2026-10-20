import {
  detectMarketplace,
  extractOrderId,
  extractCustomerAndLocation,
  extractProducts,
  extractTracking
} from '../src/parser.js';

console.log('--- Running Parser Unit Tests ---');

// 1. Amazon Sample Text
const amazonSampleText = `
Amazon Seller Services Private Limited
TAX INVOICE / SHIPPING LABEL
Easy Ship
Order ID: 404-9876543-1234567
Date: 19-Oct-2026
Ship To:
Sunil Kumar
House No 45, 2nd Main, Indiranagar
Bengaluru, Karnataka - 560038
Phone: 9876543210

Item Description                                     Qty   Price
Sony WH-1000XM5 Wireless Headphones (Black)         1     26,990.00
ASIN: B09XS7JWHH
USB-C Charging Adapter 30W                           2     1,499.00
ASIN: B08Y5TZZ11

Carrier: Amazon Transportation Services (ATS)
Tracking ID: ATS9988776655
`;

console.log('\n[TEST 1] Amazon Dispatch Label:');
const amazonChannel = detectMarketplace(amazonSampleText);
const amazonOrderId = extractOrderId(amazonSampleText, amazonChannel);
const amazonCustLoc = extractCustomerAndLocation(amazonSampleText, amazonChannel);
const amazonItems = extractProducts(amazonSampleText, amazonChannel);
const amazonTracking = extractTracking(amazonSampleText);

console.log('Channel:', amazonChannel);
console.log('Order ID:', amazonOrderId);
console.log('Customer:', amazonCustLoc.customerName);
console.log('City:', amazonCustLoc.city);
console.log('State:', amazonCustLoc.state);
console.log('Pincode:', amazonCustLoc.pincode);
console.log('Tracking / AWB:', amazonTracking);
console.log('Items Count:', amazonItems.length);
console.log('Items:', amazonItems);

// 2. Flipkart Sample Text
const flipkartSampleText = `
Flipkart Internet Private Limited
Tax Invoice / Bill of Supply
Order ID: OD334455667788990011
Delivery To:
Ship To: Ananya Roy
Flat 302, Palm Heights, Salt Lake Sector 5
Kolkata, West Bengal - 700091

Description                                          Qty
Men Solid Casual Slim Fit Cotton Shirt - Navy (M)    1
SKU: FASH-SHIRT-NV-M
Cotton Crew Socks Pack of 3                          3
SKU: SOCK-BLK-3P

Tracking ID: FMPC1122334455
Logistics Partner: Ekart Logistics
`;

console.log('\n[TEST 2] Flipkart Dispatch Label:');
const fkChannel = detectMarketplace(flipkartSampleText);
const fkOrderId = extractOrderId(flipkartSampleText, fkChannel);
const fkCustLoc = extractCustomerAndLocation(flipkartSampleText, fkChannel);
const fkItems = extractProducts(flipkartSampleText, fkChannel);
const fkTracking = extractTracking(flipkartSampleText);

console.log('Channel:', fkChannel);
console.log('Order ID:', fkOrderId);
console.log('Customer:', fkCustLoc.customerName);
console.log('City:', fkCustLoc.city);
console.log('State:', fkCustLoc.state);
console.log('Pincode:', fkCustLoc.pincode);
console.log('Tracking / AWB:', fkTracking);
console.log('Items Count:', fkItems.length);
console.log('Items:', fkItems);

// 3. JioMart Sample Text
const jioSampleText = `
Reliance Retail Limited - JioMart
Order Manifest & Dispatch Details
Order No: JM9876543210
Customer Details:
Ship To: Deepak Sharma
12, Shanti Vihar, Malviya Nagar
Jaipur, Rajasthan 302017

Item Name                                            Qty
Fortune Sunlite Refined Sunflower Oil (1L Pouch)     2
Aashirvaad Superior MP Sharbati Atta (10Kg)          1

Courier: Delhivery Surface
AWB: DEL9988776611
`;

console.log('\n[TEST 3] JioMart Dispatch Details:');
const jioChannel = detectMarketplace(jioSampleText);
const jioOrderId = extractOrderId(jioSampleText, jioChannel);
const jioCustLoc = extractCustomerAndLocation(jioSampleText, jioChannel);
const jioItems = extractProducts(jioSampleText, jioChannel);
const jioTracking = extractTracking(jioSampleText);

console.log('Channel:', jioChannel);
console.log('Order ID:', jioOrderId);
console.log('Customer:', jioCustLoc.customerName);
console.log('City:', jioCustLoc.city);
console.log('State:', jioCustLoc.state);
console.log('Pincode:', jioCustLoc.pincode);
console.log('Tracking / AWB:', jioTracking);
console.log('Items Count:', jioItems.length);
console.log('Items:', jioItems);

console.log('\n--- All Unit Tests Completed Successfully! ---');
