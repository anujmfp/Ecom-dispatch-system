import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  console.log('[Supabase] Initialized cloud client with endpoint:', SUPABASE_URL);
}

export function isSupabaseConfigured() {
  return Boolean(supabase);
}

export function getSupabaseClient() {
  return supabase;
}

/**
 * Upload PDF to Supabase Storage Bucket 'dispatch-labels'
 */
export async function uploadPdfToSupabase(filename, buffer) {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.storage
      .from('dispatch-labels')
      .upload(filename, buffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (error) {
      console.error('[Supabase Storage] Upload error:', error.message);
      return null;
    }

    const { data: publicData } = supabase.storage
      .from('dispatch-labels')
      .getPublicUrl(filename);

    console.log(`[Supabase Storage] Uploaded ${filename} -> ${publicData.publicUrl}`);
    return publicData.publicUrl;
  } catch (err) {
    console.error('[Supabase Storage] Unexpected upload error:', err.message);
    return null;
  }
}

/**
 * Save Order to Supabase DB (Upsert)
 */
export async function saveOrderToSupabase(order) {
  if (!supabase) return null;

  try {
    const row = {
      id: order.id || Date.now().toString(),
      order_id: order.orderId,
      channel: order.channel || 'Other Marketplace',
      customer_name: order.customerName || '',
      city: order.city || '',
      state: order.state || '',
      pincode: order.pincode || '',
      address: order.address || '',
      items: order.items || [],
      items_summary: order.itemsSummary || '',
      total_amount: order.totalAmount || 0,
      tracking_number: order.trackingNumber || '',
      pdf_filename: order.pdfFilename || '',
      pdf_url: order.pdfPath || '',
      status: order.status || 'pending',
      source: order.source || 'whatsapp',
      created_at: order.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      packed_at: order.packedAt || null,
      packed_by: order.packedBy || null,
      dispatched_at: order.dispatchedAt || null,
      courier_name: order.courierName || null,
      notes: order.notes || ''
    };

    const { data, error } = await supabase
      .from('orders')
      .upsert(row, { onConflict: 'order_id' })
      .select()
      .single();

    if (error) {
      console.error('[Supabase DB] Error saving order:', error.message);
      return null;
    }

    return mapDbRowToOrder(data);
  } catch (err) {
    console.error('[Supabase DB] Save exception:', err.message);
    return null;
  }
}

/**
 * Query orders from Supabase with pagination & filters
 */
export async function getOrdersFromSupabase({ status, channel, search, page = 1, limit = 100 } = {}) {
  if (!supabase) return null;

  try {
    let query = supabase.from('orders').select('*', { count: 'exact' });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (channel && channel !== 'all') {
      query = query.ilike('channel', channel);
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query = query.or(`order_id.ilike.${q},customer_name.ilike.${q},city.ilike.${q},state.ilike.${q},items_summary.ilike.${q}`);
    }

    query = query.order('created_at', { ascending: false });

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) {
      console.error('[Supabase DB] Query error:', error.message);
      return null;
    }

    return {
      orders: (data || []).map(mapDbRowToOrder),
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit) || 1
    };
  } catch (err) {
    console.error('[Supabase DB] Query exception:', err.message);
    return null;
  }
}

/**
 * Fetch all orders for Excel export
 */
export async function getAllOrdersFromSupabase() {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Supabase DB] Export query error:', error.message);
      return [];
    }

    return (data || []).map(mapDbRowToOrder);
  } catch (err) {
    console.error('[Supabase DB] Export exception:', err.message);
    return [];
  }
}

/**
 * Update order status (pack, dispatch, revert)
 */
export async function updateOrderStatusInSupabase(orderId, updateFields) {
  if (!supabase) return null;

  try {
    const payload = {
      updated_at: new Date().toISOString()
    };

    if (updateFields.status) payload.status = updateFields.status;
    if ('packedAt' in updateFields) payload.packed_at = updateFields.packedAt;
    if ('packedBy' in updateFields) payload.packed_by = updateFields.packedBy;
    if ('dispatchedAt' in updateFields) payload.dispatched_at = updateFields.dispatchedAt;
    if ('courierName' in updateFields) payload.courier_name = updateFields.courierName;

    const { data, error } = await supabase
      .from('orders')
      .update(payload)
      .eq('order_id', orderId)
      .select()
      .single();

    if (error) {
      console.error('[Supabase DB] Update error:', error.message);
      return null;
    }

    return mapDbRowToOrder(data);
  } catch (err) {
    console.error('[Supabase DB] Update exception:', err.message);
    return null;
  }
}

function mapDbRowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    channel: row.channel,
    customerName: row.customer_name,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    address: row.address,
    items: row.items,
    itemsSummary: row.items_summary,
    totalAmount: parseFloat(row.total_amount) || 0,
    trackingNumber: row.tracking_number,
    pdfFilename: row.pdf_filename,
    pdfPath: row.pdf_url,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    packedAt: row.packed_at,
    packedBy: row.packed_by,
    dispatchedAt: row.dispatched_at,
    courierName: row.courier_name,
    notes: row.notes || ''
  };
}
