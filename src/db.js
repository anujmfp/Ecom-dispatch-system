import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'storage');
const DB_FILE = path.join(DATA_DIR, 'dispatch_data.json');

// Ensure storage directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory data store backed by persistent atomic JSON
let db = {
  orders: [],
  settings: {
    whatsapp_group_name: '',
    auto_print_enabled: false,
    sound_alerts: true,
    filter_group: true
  },
  logs: []
};

// Lazy import Supabase to avoid hard dependencies if not configured
let supabaseModule = null;
async function getSupabase() {
  if (!supabaseModule) {
    try {
      supabaseModule = await import('./supabase.js');
    } catch (e) {}
  }
  return supabaseModule;
}

// Load existing database from disk
export function initDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      db.orders = parsed.orders || [];
      db.settings = { ...db.settings, ...(parsed.settings || {}) };
      db.logs = parsed.logs || [];
      console.log(`[DB] Loaded ${db.orders.length} orders from storage.`);
    } else {
      saveDb();
      console.log('[DB] Initialized new storage database.');
    }
  } catch (err) {
    console.error('[DB] Error initializing database:', err);
  }
}

// Atomic save to disk
function saveDb() {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[DB] Failed to persist data:', err);
  }
}

// Log listeners for real-time broadcasts
const logListeners = new Set();
export function onLog(callback) {
  logListeners.add(callback);
  return () => logListeners.delete(callback);
}

// Log internal activities with date, timestamp, and category
export function addLog(message, type = 'info', metadata = {}) {
  const now = new Date();
  const logEntry = {
    id: Date.now() + Math.random().toString(36).substring(2, 6),
    timestamp: now.toISOString(),
    formattedTime: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    formattedDate: now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    message,
    type, // 'order', 'packed', 'dispatched', 'deleted', 'revert', 'system', 'info', 'error'
    metadata
  };
  db.logs.unshift(logEntry);
  if (db.logs.length > 1000) db.logs.pop();
  saveDb();

  // Notify listeners (e.g. SSE stream)
  for (const listener of logListeners) {
    try {
      listener(logEntry);
    } catch (err) {
      console.error('[DB] Log listener error:', err);
    }
  }

  return logEntry;
}

// Get all logs
export function getLogs(limit = 300) {
  return db.logs.slice(0, limit);
}

// Clear all logs
export function clearLogs() {
  db.logs = [];
  saveDb();
  addLog('Activity logs cleared by user', 'system');
  return true;
}

// Create or update order
export function saveOrder(orderData) {
  const now = new Date().toISOString();
  const existingIndex = db.orders.findIndex(o => o.orderId === orderData.orderId);

  const orderRecord = {
    id: existingIndex !== -1 ? db.orders[existingIndex].id : Date.now().toString(),
    orderId: orderData.orderId,
    channel: orderData.channel || 'Other Marketplace',
    customerName: orderData.customerName || 'Unknown Customer',
    city: orderData.city || 'Unknown City',
    state: orderData.state || 'Unknown State',
    pincode: orderData.pincode || '',
    address: orderData.address || '',
    items: orderData.items || [],
    itemsSummary: orderData.itemsSummary || '',
    totalAmount: orderData.totalAmount !== undefined ? orderData.totalAmount : (existingIndex !== -1 ? db.orders[existingIndex].totalAmount : 0),
    trackingNumber: orderData.trackingNumber || '',
    pdfFilename: orderData.pdfFilename || '',
    pdfPath: orderData.pdfPath || '',
    status: existingIndex !== -1 ? db.orders[existingIndex].status : 'pending', // 'pending' | 'packed' | 'dispatched'
    source: orderData.source || 'whatsapp', // 'whatsapp' | 'manual_upload'
    createdAt: existingIndex !== -1 ? db.orders[existingIndex].createdAt : now,
    updatedAt: now,
    packedAt: existingIndex !== -1 ? db.orders[existingIndex].packedAt : null,
    packedBy: existingIndex !== -1 ? db.orders[existingIndex].packedBy : null,
    dispatchedAt: existingIndex !== -1 ? db.orders[existingIndex].dispatchedAt : null,
    courierName: existingIndex !== -1 ? db.orders[existingIndex].courierName : null,
    notes: orderData.notes || ''
  };

  if (existingIndex !== -1) {
    db.orders[existingIndex] = orderRecord;
  } else {
    db.orders.unshift(orderRecord);
  }

  saveDb();
  if (existingIndex !== -1) {
    addLog(`Order ${orderRecord.orderId} (${orderRecord.channel}) details updated`, 'order', { orderId: orderRecord.orderId, channel: orderRecord.channel });
  } else {
    addLog(`New order received: ${orderRecord.orderId} (${orderRecord.channel}) for ${orderRecord.customerName} - ${orderRecord.city}`, 'order', { orderId: orderRecord.orderId, channel: orderRecord.channel, customer: orderRecord.customerName });
  }

  // Sync to Supabase in background if configured
  getSupabase().then(sb => {
    if (sb && sb.isSupabaseConfigured()) {
      sb.saveOrderToSupabase(orderRecord).catch(err => {
        console.error('[Supabase Sync Error]', err.message);
      });
    }
  });

  return orderRecord;
}

// Retrieve all orders raw (for Excel export)
export function getAllOrders() {
  return [...db.orders];
}

// Retrieve orders with search, filters, pagination
export function getOrders({ status, channel, search, limit = 100, page = 1 } = {}) {
  let filtered = [...db.orders];

  if (status && status !== 'all') {
    filtered = filtered.filter(o => o.status === status);
  }

  if (channel && channel !== 'all') {
    filtered = filtered.filter(o => o.channel.toLowerCase() === channel.toLowerCase());
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(o =>
      (o.orderId && o.orderId.toLowerCase().includes(q)) ||
      (o.customerName && o.customerName.toLowerCase().includes(q)) ||
      (o.city && o.city.toLowerCase().includes(q)) ||
      (o.state && o.state.toLowerCase().includes(q)) ||
      (o.trackingNumber && o.trackingNumber.toLowerCase().includes(q)) ||
      (o.itemsSummary && o.itemsSummary.toLowerCase().includes(q))
    );
  }

  const total = filtered.length;
  const startIndex = (page - 1) * limit;
  const paginated = filtered.slice(startIndex, startIndex + limit);

  return {
    orders: paginated,
    total,
    page,
    totalPages: Math.ceil(total / limit) || 1
  };
}

// Find single order by ID
export function getOrderById(orderId) {
  return db.orders.find(o => o.orderId === orderId || o.id === orderId);
}

// Mark order as Packed
export function markAsPacked(orderId, packedBy = 'Packing Team') {
  const order = getOrderById(orderId);
  if (!order) return null;

  order.status = 'packed';
  order.packedAt = new Date().toISOString();
  order.packedBy = packedBy;
  order.updatedAt = new Date().toISOString();

  saveDb();
  addLog(`Order ${order.orderId} (${order.channel}) marked as PACKED by ${packedBy}`, 'packed', { orderId: order.orderId, channel: order.channel, customer: order.customerName, packedBy });

  // Sync to Supabase in background
  getSupabase().then(sb => {
    if (sb && sb.isSupabaseConfigured()) {
      sb.updateOrderStatusInSupabase(order.orderId, {
        status: 'packed',
        packedAt: order.packedAt,
        packedBy
      }).catch(console.error);
    }
  });

  return order;
}

// Mark order as Dispatched
export function markAsDispatched(orderId, courierName = 'Courier Partner') {
  const order = getOrderById(orderId);
  if (!order) return null;

  order.status = 'dispatched';
  order.dispatchedAt = new Date().toISOString();
  order.courierName = courierName;
  order.updatedAt = new Date().toISOString();

  saveDb();
  addLog(`Order ${order.orderId} (${order.channel}) DISPATCHED — handed to ${courierName}`, 'dispatched', { orderId: order.orderId, channel: order.channel, customer: order.customerName, courierName });

  // Sync to Supabase in background
  getSupabase().then(sb => {
    if (sb && sb.isSupabaseConfigured()) {
      sb.updateOrderStatusInSupabase(order.orderId, {
        status: 'dispatched',
        dispatchedAt: order.dispatchedAt,
        courierName
      }).catch(console.error);
    }
  });

  return order;
}

// Revert order status (e.g. from dispatched to packed, or packed to pending)
export function revertStatus(orderId, targetStatus = 'pending') {
  const order = getOrderById(orderId);
  if (!order) return null;

  order.status = targetStatus;
  order.updatedAt = new Date().toISOString();
  if (targetStatus === 'pending') {
    order.packedAt = null;
    order.packedBy = null;
    order.dispatchedAt = null;
    order.courierName = null;
  } else if (targetStatus === 'packed') {
    order.dispatchedAt = null;
    order.courierName = null;
  }

  saveDb();
  addLog(`Order ${order.orderId} (${order.channel}) status reverted to ${targetStatus}`, 'revert', { orderId: order.orderId, targetStatus });
  return order;
}

// Delete order
export function deleteOrder(orderId) {
  const initialLength = db.orders.length;
  const target = db.orders.find(o => o.orderId === orderId || o.id === orderId);
  const actualOrderId = target ? target.orderId : orderId;
  const channel = target ? target.channel : '';
  const customer = target ? target.customerName : '';

  db.orders = db.orders.filter(o => o.orderId !== orderId && o.id !== orderId);
  if (db.orders.length !== initialLength) {
    saveDb();
    addLog(`Order ${actualOrderId} (${channel || 'General'}) for ${customer || 'Customer'} was permanently deleted`, 'deleted', { orderId: actualOrderId, channel, customer });

    // Sync deletion to Supabase
    getSupabase().then(sb => {
      if (sb && sb.isSupabaseConfigured() && typeof sb.deleteOrderFromSupabase === 'function') {
        sb.deleteOrderFromSupabase(actualOrderId).catch(err => {
          console.error('[Supabase Delete Sync Error]', err.message);
        });
      }
    });

    return true;
  }
  return false;
}

// Statistics for Dashboard
export function getStats() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const totalOrders = db.orders.length;
  const pending = db.orders.filter(o => o.status === 'pending').length;
  const packed = db.orders.filter(o => o.status === 'packed').length;
  const dispatched = db.orders.filter(o => o.status === 'dispatched').length;

  const todayOrders = db.orders.filter(o => o.createdAt && o.createdAt.startsWith(todayStr)).length;
  const todayDispatched = db.orders.filter(o => o.dispatchedAt && o.dispatchedAt.startsWith(todayStr)).length;

  // Breakdown by marketplace
  const channelBreakdown = {};
  for (const o of db.orders) {
    const ch = o.channel || 'Other';
    channelBreakdown[ch] = (channelBreakdown[ch] || 0) + 1;
  }

  return {
    totalOrders,
    pending,
    packed,
    dispatched,
    todayOrders,
    todayDispatched,
    channelBreakdown
  };
}

// Get and Update Settings
export function getSettings() {
  return db.settings;
}

export function updateSettings(newSettings) {
  db.settings = { ...db.settings, ...newSettings };
  saveDb();
  addLog('System settings updated');
  return db.settings;
}
