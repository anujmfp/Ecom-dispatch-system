process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import pino from 'pino';
import { parseDispatchPdf } from './parser.js';
import { saveOrder, addLog, getSettings } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = path.join(__dirname, '..', 'storage', 'auth_baileys');
const PDFS_DIR = path.join(__dirname, '..', 'storage', 'pdfs');

// Ensure necessary directories exist
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(PDFS_DIR)) fs.mkdirSync(PDFS_DIR, { recursive: true });

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrCodeDataUrl = null;
    this.qrCodeRaw = null;
    this.userInfo = null;
    this.listeners = new Set();
    this.knownGroups = new Map(); // jid -> groupName
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.reconnectTimer = null;
  }

  // Register callback for live notifications
  onOrderReceived(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  notifyListeners(order) {
    for (const listener of this.listeners) {
      try {
        listener(order);
      } catch (err) {
        console.error('[WhatsApp] Listener callback error:', err);
      }
    }
  }

  // Get current status summary
  getStatus() {
    return {
      status: this.status,
      hasQr: !!this.qrCodeDataUrl,
      qrCode: this.qrCodeDataUrl,
      userInfo: this.userInfo,
      knownGroups: Array.from(this.knownGroups.entries()).map(([jid, name]) => ({ jid, name })),
      configuredGroup: getSettings().whatsapp_group_name || 'All Groups'
    };
  }

  async initialize() {
    if (this.isConnecting) {
      console.log('[WhatsApp] Connection attempt already in progress, skipping duplicate.');
      return;
    }

    try {
      this.isConnecting = true;
      clearTimeout(this.reconnectTimer);
      this.status = 'connecting';
      addLog('WhatsApp Service: Starting connection...', 'info');

      // Clean up previous socket if existing
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners('connection.update');
          this.sock.ev.removeAllListeners('messages.upsert');
          this.sock.ev.removeAllListeners('creds.update');
          this.sock.end();
        } catch (e) {}
        this.sock = null;
      }

      // Dynamically import Baileys
      const baileys = await import('@whiskeysockets/baileys');
      const {
        default: makeWASocket,
        DisconnectReason,
        useMultiFileAuthState,
        downloadMediaMessage,
        fetchLatestBaileysVersion,
        makeCacheableSignalKeyStore
      } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        logger: pino({ level: 'warn' }),
        printQRInTerminal: false,
        browser: ['DispatchPro', 'Desktop', '1.0.0'],
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        fireInitQueries: false,
        markOnlineOnConnect: true,
        emitOwnEvents: true,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2000,
        options: {
          rejectUnauthorized: false
        }
      });

      // Handle credentials update
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates & QR generation
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = 'qr_ready';
          this.qrCodeRaw = qr;
          this.qrCodeDataUrl = await QRCode.toDataURL(qr);
          console.log('[WhatsApp] New QR code generated for pairing.');
        }

        if (connection === 'close') {
          this.status = 'disconnected';
          this.qrCodeDataUrl = null;
          this.isConnecting = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsApp] Connection closed. Reason code: ${statusCode}. Reconnecting: ${shouldReconnect}`);
          addLog(`WhatsApp disconnected (${statusCode}). Attempting reconnect...`, 'warn');

          if (shouldReconnect) {
            this.reconnectAttempts++;
            const delay = Math.min(Math.max(this.reconnectAttempts * 3000, 4000), 30000);
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.initialize(), delay);
          } else {
            addLog('WhatsApp logged out. Please rescan QR code.', 'warn');
          }
        } else if (connection === 'open') {
          this.status = 'connected';
          this.qrCodeDataUrl = null;
          this.reconnectAttempts = 0;
          this.isConnecting = false;
          this.userInfo = this.sock.user;
          console.log('[WhatsApp] Connected successfully! Logged in as:', this.sock.user?.id || 'User');
          addLog(`WhatsApp connected successfully as ${this.sock.user?.name || this.sock.user?.id || 'User'}`, 'info');

          // Fetch group names safely
          try {
            const groups = await this.sock.groupFetchAllParticipating();
            for (const jid in groups) {
              this.knownGroups.set(jid, groups[jid].subject);
            }
            console.log(`[WhatsApp] Loaded ${this.knownGroups.size} participating groups.`);
          } catch (e) {
            console.warn('[WhatsApp] Could not fetch groups list:', e.message);
          }
        }
      });

      // Handle incoming messages (including messages sent from user's own phone)
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        console.log(`[WhatsApp Event] messages.upsert fired: count=${messages.length}, type=${type}`);
        for (const msg of messages) {
          if (!msg.message) continue;
          await this.handleIncomingMessage(msg, downloadMediaMessage);
        }
      });

    } catch (err) {
      console.error('[WhatsApp] Initialization error:', err);
      this.status = 'disconnected';
      this.isConnecting = false;
      addLog(`WhatsApp initialization failed: ${err.message}`, 'error');
    }
  }

  async handleIncomingMessage(msg, downloadMediaMessage) {
    try {
      const fromJid = msg.key.remoteJid;
      const isGroup = fromJid.endsWith('@g.us');

      // Check configured group filter
      const settings = getSettings();
      const targetGroupName = (settings.whatsapp_group_name || '').trim().toLowerCase();

      let groupSubject = '';
      if (isGroup) {
        if (!this.knownGroups.has(fromJid)) {
          try {
            const metadata = await this.sock.groupMetadata(fromJid);
            this.knownGroups.set(fromJid, metadata.subject);
          } catch (e) {}
        }
        groupSubject = this.knownGroups.get(fromJid) || '';
      }

      // Unwrap any nested message structures (ephemeral, view-once, documentWithCaption)
      let content = msg.message;
      if (content?.ephemeralMessage) content = content.ephemeralMessage.message;
      if (content?.viewOnceMessage) content = content.viewOnceMessage.message;
      if (content?.viewOnceMessageV2) content = content.viewOnceMessageV2.message;
      if (content?.documentWithCaptionMessage) content = content.documentWithCaptionMessage.message;

      const keysPresent = Object.keys(content || {});
      console.log(`[WhatsApp Message] JID: ${fromJid}, Group: "${groupSubject}", fromMe: ${msg.key.fromMe}, Content: [${keysPresent.join(', ')}]`);

      // If user specified a group filter and this message is from another group, skip
      if (isGroup && targetGroupName) {
        const matchesTarget = (groupSubject && groupSubject.toLowerCase().includes(targetGroupName)) ||
                              fromJid === '120363404360190930@g.us';
        if (!matchesTarget) {
          return;
        }
      }

      const docMessage = content?.documentMessage;

      if (!docMessage) {
        return;
      }

      const fileName = docMessage.fileName || 'dispatch_order.pdf';
      const mimeType = docMessage.mimetype || '';

      if (!mimeType.includes('pdf') && !fileName.toLowerCase().endsWith('.pdf')) {
        console.log(`[WhatsApp] Ignored non-PDF attachment: "${fileName}" (${mimeType})`);
        return;
      }

      console.log(`[WhatsApp] Incoming PDF detected: "${fileName}" from group "${groupSubject || fromJid}"`);
      addLog(`Received PDF "${fileName}" in WhatsApp group "${groupSubject || 'Direct Chat'}"`);

      // Download PDF buffer using unwrapped content
      const buffer = await downloadMediaMessage(
        { key: msg.key, message: content },
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }),
          reuploadRequest: this.sock.updateMediaMessage
        }
      );

      if (!buffer || buffer.length === 0) {
        console.error('[WhatsApp] Failed to download PDF document buffer.');
        return;
      }

      // Process and parse PDF
      await this.processIncomingPdf(buffer, fileName, 'whatsapp');

      // Optionally send a checkmark reaction or confirmation
      try {
        await this.sock.sendMessage(fromJid, {
          react: { text: '📦', key: msg.key }
        });
      } catch (e) {}

    } catch (err) {
      console.error('[WhatsApp] Error handling incoming message:', err);
      addLog(`Error processing WhatsApp message: ${err.message}`, 'error');
    }
  }

  // Process PDF buffer (used by both WhatsApp and Manual Dashboard Upload)
  async processIncomingPdf(buffer, originalFilename, source = 'whatsapp') {
    // 1. Extract details using smart parser
    const extracted = await parseDispatchPdf(buffer, originalFilename);

    // 2. Save PDF file to storage with a clean, identifiable name
    const timestamp = Date.now();
    const safeOrderId = (extracted.orderId || 'ORD').replace(/[^a-zA-Z0-9_-]/g, '_');
    const savedFilename = `${safeOrderId}_${timestamp}.pdf`;
    const savedFilePath = path.join(PDFS_DIR, savedFilename);

    fs.writeFileSync(savedFilePath, buffer);

    // If Supabase Storage is configured, upload to cloud bucket
    let pdfUrl = `/api/orders/pdf/${savedFilename}`;
    try {
      const { isSupabaseConfigured, uploadPdfToSupabase } = await import('./supabase.js');
      if (isSupabaseConfigured()) {
        const cloudUrl = await uploadPdfToSupabase(savedFilename, buffer);
        if (cloudUrl) {
          pdfUrl = cloudUrl;
        }
      }
    } catch (e) {
      console.warn('[Supabase Storage] Fallback to local PDF URL:', e.message);
    }

    // 3. Save order record to database
    const orderData = {
      orderId: extracted.orderId,
      channel: extracted.channel,
      customerName: extracted.customerName,
      city: extracted.city,
      state: extracted.state,
      pincode: extracted.pincode,
      address: extracted.address,
      items: extracted.items,
      itemsSummary: extracted.itemsSummary,
      totalAmount: extracted.totalAmount || 0,
      trackingNumber: extracted.trackingNumber,
      pdfFilename: savedFilename,
      pdfPath: pdfUrl,
      source
    };

    const savedOrder = saveOrder(orderData);

    // 4. Notify live dashboard clients
    this.notifyListeners(savedOrder);

    return savedOrder;
  }

  // Disconnect & logout
  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
        this.sock = null;
      }
      this.status = 'disconnected';
      this.qrCodeDataUrl = null;
      this.userInfo = null;

      // Clean auth files
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
      addLog('WhatsApp account logged out successfully.');
      return true;
    } catch (err) {
      console.error('[WhatsApp] Logout error:', err);
      return false;
    }
  }
}

export const whatsappService = new WhatsAppService();
