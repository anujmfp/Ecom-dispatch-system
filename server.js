// Handle network proxies / self-signed inspection certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Global error handlers to prevent unhandled socket drop crashes
process.on('uncaughtException', (err) => {
  console.error('[Process Warning - Handled uncaughtException]:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Warning - Handled unhandledRejection]:', reason?.message || reason);
});

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

import { initDb, saveOrder, getOrders, getOrderById, getAllOrders, markAsPacked, markAsDispatched, revertStatus, deleteOrder, getStats, getSettings, updateSettings, getLogs, clearLogs, onLog } from './src/db.js';
import { whatsappService } from './src/whatsapp.js';
import { parseDispatchPdf } from './src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Storage folders
const PDFS_DIR = path.join(__dirname, 'storage', 'pdfs');
if (!fs.existsSync(PDFS_DIR)) fs.mkdirSync(PDFS_DIR, { recursive: true });

// Multer setup for manual PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/storage/pdfs', express.static(PDFS_DIR));

// SSE (Server-Sent Events) clients for live updates
const sseClients = new Set();

function broadcastEvent(eventType, data) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Subscribe to WhatsApp incoming order events
whatsappService.onOrderReceived((order) => {
  broadcastEvent('new_order', order);
  broadcastEvent('stats_update', getStats());
});

// Subscribe to real-time activity log events
onLog((logEntry) => {
  broadcastEvent('new_log', logEntry);
});

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.add(client);

  // Send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Live stream connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(client);
  });
});

// API Routes

// 1. Get orders list with filter & search
app.get('/api/orders', (req, res) => {
  try {
    const { status, channel, search, page, limit } = req.query;
    const result = getOrders({
      status,
      channel,
      search,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 100
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get single order details
app.get('/api/orders/:id', (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  res.json({ success: true, order });
});

// 3. Mark as Packed
app.post('/api/orders/:id/pack', (req, res) => {
  try {
    const { packedBy } = req.body;
    const order = markAsPacked(req.params.id, packedBy || 'Packing Team');
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    broadcastEvent('order_updated', order);
    broadcastEvent('stats_update', getStats());

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Mark as Dispatched
app.post('/api/orders/:id/dispatch', (req, res) => {
  try {
    const { courierName } = req.body;
    const order = markAsDispatched(req.params.id, courierName || 'Delivery Partner');
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    broadcastEvent('order_updated', order);
    broadcastEvent('stats_update', getStats());

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Revert status (e.g. from Dispatched to Packed, or Packed to Pending)
app.post('/api/orders/:id/revert', (req, res) => {
  try {
    const { targetStatus } = req.body;
    const order = revertStatus(req.params.id, targetStatus || 'pending');
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    broadcastEvent('order_updated', order);
    broadcastEvent('stats_update', getStats());

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Delete order
app.delete('/api/orders/:id', (req, res) => {
  try {
    const success = deleteOrder(req.params.id);
    if (!success) return res.status(404).json({ success: false, error: 'Order not found' });

    broadcastEvent('order_deleted', { orderId: req.params.id });
    broadcastEvent('stats_update', getStats());

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Manual PDF Upload (Drag-and-Drop backup)
app.post('/api/orders/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No PDF file uploaded' });
    }

    const originalFilename = req.file.originalname;
    const buffer = req.file.buffer;

    const savedOrder = await whatsappService.processIncomingPdf(buffer, originalFilename, 'manual_upload');

    res.json({ success: true, order: savedOrder });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. View / Print PDF stream
app.get('/api/orders/pdf/:filename', (req, res) => {
  const filePath = path.join(PDFS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('PDF file not found on server.');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

// 9. Dashboard Statistics
app.get('/api/stats', (req, res) => {
  res.json({ success: true, stats: getStats() });
});

// 10. WhatsApp Service Status & QR Code
app.get('/api/whatsapp/status', (req, res) => {
  res.json({ success: true, ...whatsappService.getStatus() });
});

// 11. Connect / Reconnect WhatsApp
app.post('/api/whatsapp/connect', async (req, res) => {
  try {
    await whatsappService.initialize();
    res.json({ success: true, message: 'WhatsApp initialization started' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Logout WhatsApp
app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    await whatsappService.logout();
    res.json({ success: true, message: 'WhatsApp logged out' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. System Settings
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: getSettings() });
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = updateSettings(req.body);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Activity Logs (Real-time history with timestamps)
app.get('/api/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 300;
    res.json({ success: true, logs: getLogs(limit) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/logs/clear', (req, res) => {
  try {
    clearLogs();
    broadcastEvent('logs_cleared', {});
    res.json({ success: true, message: 'Activity logs cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Demo Generator: Create sample Amazon / Flipkart / JioMart orders for quick testing
app.post('/api/demo/generate', async (req, res) => {
  try {
    const samples = [
      {
        orderId: '408-' + Math.floor(1000000 + Math.random() * 9000000) + '-' + Math.floor(1000000 + Math.random() * 9000000),
        channel: 'Amazon',
        customerName: 'Pooja Sharma',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
        address: 'Flat 402, Green Glen Layout, Bellandur, Bengaluru, Karnataka - 560034',
        items: [
          { title: 'Wireless Bluetooth Earbuds with ANC (Black)', quantity: 1, sku: 'B08XYZ123' },
          { title: 'Type-C Fast Charging Cable 65W (1.5m)', quantity: 2, sku: 'B09ABC789' }
        ],
        itemsSummary: 'Wireless Bluetooth Earbuds with ANC (Black) (x1), Type-C Fast Charging Cable 65W (1.5m) (x2)',
        trackingNumber: 'ATS' + Math.floor(1000000000 + Math.random() * 9000000000),
        source: 'whatsapp'
      },
      {
        orderId: 'OD' + Math.floor(100000000000000000 + Math.random() * 900000000000000000),
        channel: 'Flipkart',
        customerName: 'Amit Verma',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400053',
        address: 'B-12, Sundar Nagar, Andheri West, Mumbai, Maharashtra - 400053',
        items: [
          { title: 'Men Slim Fit Casual Cotton Shirt - Navy Blue (Size 42)', quantity: 1, sku: 'SHIRT-NB-42' }
        ],
        itemsSummary: 'Men Slim Fit Casual Cotton Shirt - Navy Blue (Size 42) (x1)',
        trackingNumber: 'FMPC' + Math.floor(1000000000 + Math.random() * 9000000000),
        source: 'whatsapp'
      },
      {
        orderId: 'JM' + Math.floor(1000000000 + Math.random() * 9000000000),
        channel: 'JioMart',
        customerName: 'Sunita Patel',
        city: 'Ahmedabad',
        state: 'Gujarat',
        pincode: '380015',
        address: '15, Shanti Niketan Society, Satellite, Ahmedabad, Gujarat - 380015',
        items: [
          { title: 'Organic Cold Pressed Mustard Oil (1 Litre)', quantity: 2, sku: 'OIL-MUST-1L' },
          { title: 'Basmati Rice Premium Extra Long Grain (5 Kg)', quantity: 1, sku: 'RICE-BASM-5K' }
        ],
        itemsSummary: 'Organic Cold Pressed Mustard Oil (1 Litre) (x2), Basmati Rice Premium Extra Long Grain (5 Kg) (x1)',
        trackingNumber: 'DEL' + Math.floor(1000000000 + Math.random() * 9000000000),
        source: 'whatsapp'
      }
    ];

    const pick = samples[Math.floor(Math.random() * samples.length)];
    const saved = saveOrder(pick);

    broadcastEvent('new_order', saved);
    broadcastEvent('stats_update', getStats());

    res.json({ success: true, order: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15. Export All Orders to Excel (.xlsx)
app.get('/api/orders/export/excel', (req, res) => {
  try {
    const orders = getAllOrders();
    const rows = orders.map((o, idx) => ({
      'S.No': idx + 1,
      'Order ID': o.orderId,
      'Marketplace / Channel': o.channel,
      'Customer Name': o.customerName,
      'City': o.city,
      'State': o.state,
      'Pincode': o.pincode,
      'Delivery Address': o.address,
      'Items Ordered': o.itemsSummary || (o.items || []).map(i => `${i.title} (x${i.quantity || 1})`).join(', '),
      'Total Amount (INR)': o.totalAmount ? `₹${Number(o.totalAmount).toFixed(2)}` : 'N/A',
      'AWB / Tracking No': o.trackingNumber || 'N/A',
      'Status': (o.status || 'pending').toUpperCase(),
      'Source': o.source,
      'Order Received At': o.createdAt ? new Date(o.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
      'Packed At': o.packedAt ? new Date(o.packedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not Packed',
      'Packed By': o.packedBy || '',
      'Dispatched At': o.dispatchedAt ? new Date(o.dispatchedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not Dispatched',
      'Courier Partner': o.courierName || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 6 },  // S.No
      { wch: 25 }, // Order ID
      { wch: 15 }, // Channel
      { wch: 24 }, // Customer Name
      { wch: 16 }, // City
      { wch: 16 }, // State
      { wch: 10 }, // Pincode
      { wch: 45 }, // Address
      { wch: 55 }, // Items
      { wch: 18 }, // Amount
      { wch: 20 }, // AWB
      { wch: 14 }, // Status
      { wch: 12 }, // Source
      { wch: 22 }, // Received
      { wch: 22 }, // Packed
      { wch: 16 }, // Packed By
      { wch: 22 }, // Dispatched
      { wch: 24 }  // Courier
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Dispatch Orders');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Dispatch_Orders_${dateStr}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to get local IPv4 address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal && !alias.address.startsWith('169.254')) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

// 16. Network Info Endpoint (for mobile factory dashboard access)
app.get('/api/network/info', (req, res) => {
  const ip = getLocalIpAddress();
  res.json({
    success: true,
    localIp: ip,
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    networkUrl: `http://${ip}:${PORT}`
  });
});

// Start Express server and initialize database
initDb();

app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log(`=======================================================`);
  console.log(` 📦 DispatchPro - Dispatch Management System running!  `);
  console.log(` 💻 Local Dashboard:     http://localhost:${PORT}       `);
  console.log(` 📱 Mobile/Factory Link:  http://${localIp}:${PORT}     `);
  console.log(`=======================================================`);

  // Auto-start WhatsApp connection if credentials exist
  const authCredsFile = path.join(__dirname, 'storage', 'auth_baileys', 'creds.json');
  if (fs.existsSync(authCredsFile)) {
    console.log('[WhatsApp] Existing credentials detected. Auto-connecting...');
    whatsappService.initialize();
  }
});
