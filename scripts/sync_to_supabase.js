import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isSupabaseConfigured, saveOrderToSupabase, uploadPdfToSupabase } from '../src/supabase.js';
import { initDb, getAllOrders } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PDFS_DIR = path.join(__dirname, '..', 'storage', 'pdfs');

async function syncAll() {
  console.log('--- DispatchPro Supabase Sync Utility ---');

  if (!isSupabaseConfigured()) {
    console.error('❌ Supabase is not configured! Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.');
    process.exit(1);
  }

  initDb();
  const orders = getAllOrders();
  console.log(`Found ${orders.length} orders in local database.`);

  let successCount = 0;
  for (const order of orders) {
    console.log(`\nSyncing order ${order.orderId} (${order.channel})...`);

    // 1. Upload local PDF if exists and not already cloud URL
    if (order.pdfFilename && (!order.pdfPath || !order.pdfPath.startsWith('http'))) {
      const localPdfPath = path.join(PDFS_DIR, order.pdfFilename);
      if (fs.existsSync(localPdfPath)) {
        console.log(`  Uploading PDF ${order.pdfFilename} to Supabase Storage...`);
        const pdfBuf = fs.readFileSync(localPdfPath);
        const cloudUrl = await uploadPdfToSupabase(order.pdfFilename, pdfBuf);
        if (cloudUrl) {
          order.pdfPath = cloudUrl;
          console.log(`  ✅ PDF uploaded: ${cloudUrl}`);
        }
      }
    }

    // 2. Save order to Supabase PostgreSQL table
    const result = await saveOrderToSupabase(order);
    if (result) {
      console.log(`  ✅ Order ${order.orderId} synced to Supabase!`);
      successCount++;
    } else {
      console.error(`  ❌ Failed to sync order ${order.orderId}`);
    }
  }

  console.log(`\n🎉 Sync complete! Successfully synced ${successCount} of ${orders.length} orders to Supabase.`);
}

syncAll().catch(console.error);
