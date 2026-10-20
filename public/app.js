// DispatchPro Frontend Logic

let state = {
  orders: [],
  currentStatus: 'pending', // default to "To Pack"
  currentChannel: 'all',
  searchQuery: '',
  stats: { totalOrders: 0, pending: 0, packed: 0, dispatched: 0 },
  selectedOrderForDispatch: null,
  waPollInterval: null
};

// Sound alerts using Web Audio API synthesis (works reliably in all browsers)
function playAudioTone(freq1 = 587.33, freq2 = 880, duration = 0.15) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq1, ctx.currentTime);
    osc.frequency.setValueAtTime(freq2, ctx.currentTime + duration / 2);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupSSE();
  fetchStats();
  fetchOrders();
  fetchWhatsAppStatus();
  lucide.createIcons();
});

// Setup DOM Event Listeners
function setupEventListeners() {
  // Status tabs
  document.querySelectorAll('.status-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-tab').forEach(b => {
        b.classList.remove('active');
        b.classList.add('text-slate-600');
      });
      btn.classList.add('active');
      btn.classList.remove('text-slate-600');
      state.currentStatus = btn.dataset.status;
      renderOrders();
    });
  });

  // Channel filters
  document.querySelectorAll('.channel-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.channel-filter').forEach(b => {
        b.classList.remove('active', 'bg-slate-900', 'text-white');
        b.classList.add('bg-slate-100', 'text-slate-700');
      });
      btn.classList.add('active', 'bg-slate-900', 'text-white');
      btn.classList.remove('bg-slate-100', 'text-slate-700');
      state.currentChannel = btn.dataset.channel;
      renderOrders();
    });
  });

  // Search input
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderOrders();
  });

  // Refresh button
  document.getElementById('btnRefresh').addEventListener('click', () => {
    fetchOrders();
    fetchStats();
  });

  // Test demo order generator
  document.getElementById('btnCreateDemo').addEventListener('click', async () => {
    const btn = document.getElementById('btnCreateDemo');
    btn.disabled = true;
    try {
      const res = await fetch('/api/demo/generate', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        playAudioTone(440, 880, 0.2);
        // Switch to "To Pack" tab to immediately view the created order
        document.querySelector('.status-tab[data-status="pending"]').click();
      }
    } catch (err) {
      console.error('Demo error:', err);
    } finally {
      btn.disabled = false;
    }
  });

  // WhatsApp Modal toggles
  document.getElementById('btnWhatsappModal').addEventListener('click', () => {
    openModal('modalWhatsapp');
    fetchWhatsAppStatus();
    startWaPolling();
  });

  document.getElementById('btnCloseWaModal').addEventListener('click', () => {
    closeModal('modalWhatsapp');
    stopWaPolling();
  });

  document.getElementById('btnReconnectWa').addEventListener('click', async () => {
    await fetch('/api/whatsapp/connect', { method: 'POST' });
    fetchWhatsAppStatus();
  });

  document.getElementById('btnLogoutWa').addEventListener('click', async () => {
    if (confirm('Disconnect WhatsApp session? You will need to rescan the QR code.')) {
      await fetch('/api/whatsapp/logout', { method: 'POST' });
      fetchWhatsAppStatus();
    }
  });

  document.getElementById('btnSaveWaSettings').addEventListener('click', async () => {
    const groupName = document.getElementById('targetGroupNameInput').value.trim();
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsapp_group_name: groupName })
    });
    alert('Settings saved successfully!');
    fetchWhatsAppStatus();
  });

  // Upload Modal toggles
  const modalUpload = document.getElementById('modalUpload');
  const dropZone = document.getElementById('dropZone');
  const pdfFileInput = document.getElementById('pdfFileInput');

  document.getElementById('btnUploadModal').addEventListener('click', () => {
    openModal('modalUpload');
  });

  document.getElementById('btnCloseUploadModal').addEventListener('click', () => {
    closeModal('modalUpload');
  });

  dropZone.addEventListener('click', () => pdfFileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-600', 'bg-indigo-50');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-600', 'bg-indigo-50');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-600', 'bg-indigo-50');
    if (e.dataTransfer.files.length > 0) {
      handlePdfUpload(e.dataTransfer.files[0]);
    }
  });

  pdfFileInput.addEventListener('change', () => {
    if (pdfFileInput.files.length > 0) {
      handlePdfUpload(pdfFileInput.files[0]);
    }
  });

  // Dispatch Confirmation Modal
  document.getElementById('btnCloseDispatchModal').addEventListener('click', () => {
    closeModal('modalDispatch');
    state.selectedOrderForDispatch = null;
  });

  document.getElementById('btnCancelDispatch').addEventListener('click', () => {
    closeModal('modalDispatch');
    state.selectedOrderForDispatch = null;
  });

  document.getElementById('btnConfirmDispatch').addEventListener('click', async () => {
    if (!state.selectedOrderForDispatch) return;
    const courier = document.getElementById('courierSelect').value;
    await executeDispatch(state.selectedOrderForDispatch, courier);
    closeModal('modalDispatch');
    state.selectedOrderForDispatch = null;
  });

  // Export to Excel Button
  const btnExport = document.getElementById('btnExportExcel');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      window.location.href = '/api/orders/export/excel';
    });
  }

  // Mobile / Factory Access Modal
  const btnMobile = document.getElementById('btnMobileModal');
  if (btnMobile) {
    btnMobile.addEventListener('click', async () => {
      openModal('modalMobile');
      try {
        const res = await fetch('/api/network/info');
        const data = await res.json();
        if (data.success) {
          document.getElementById('mobileUrlInput').value = data.networkUrl;
          const container = document.getElementById('mobileQrContainer');
          if (window.QRCode) {
            QRCode.toDataURL(data.networkUrl, { width: 180, margin: 1 }, (err, url) => {
              if (!err && url) {
                container.innerHTML = `<img src="${url}" alt="Mobile Access QR" class="w-44 h-44 rounded-lg shadow-xs" />`;
              }
            });
          }
        }
      } catch (e) {
        console.error('Network info error:', e);
      }
    });

    document.getElementById('btnCloseMobileModal').addEventListener('click', () => {
      closeModal('modalMobile');
    });

    document.getElementById('btnCopyMobileUrl').addEventListener('click', () => {
      const input = document.getElementById('mobileUrlInput');
      input.select();
      navigator.clipboard.writeText(input.value);
      alert('Mobile link copied: ' + input.value);
    });
  }
}

// Modal helper
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Setup Server-Sent Events (SSE) for Real-Time Live Sync
function setupSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('new_order', (e) => {
    const newOrder = JSON.parse(e.data);
    console.log('[SSE] New order received:', newOrder);

    // Audio chime
    playAudioTone(523.25, 659.25, 0.25);

    // Insert at front of orders
    const exists = state.orders.some(o => o.orderId === newOrder.orderId);
    if (!exists) {
      state.orders.unshift(newOrder);
      renderOrders();
    }
    fetchStats();
  });

  eventSource.addEventListener('order_updated', (e) => {
    const updated = JSON.parse(e.data);
    const idx = state.orders.findIndex(o => o.orderId === updated.orderId);
    if (idx !== -1) {
      state.orders[idx] = updated;
      renderOrders();
    }
    fetchStats();
  });

  eventSource.addEventListener('order_deleted', (e) => {
    const { orderId } = JSON.parse(e.data);
    state.orders = state.orders.filter(o => o.orderId !== orderId);
    renderOrders();
    fetchStats();
  });

  eventSource.addEventListener('stats_update', (e) => {
    const stats = JSON.parse(e.data);
    updateStatsUI(stats);
  });
}

// Fetch Orders from API
async function fetchOrders() {
  try {
    const res = await fetch('/api/orders?limit=200');
    const data = await res.json();
    if (data.success) {
      state.orders = data.orders;
      renderOrders();
    }
  } catch (err) {
    console.error('Fetch orders error:', err);
  }
}

// Fetch Stats from API
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      updateStatsUI(data.stats);
    }
  } catch (err) {
    console.error('Fetch stats error:', err);
  }
}

function updateStatsUI(stats) {
  state.stats = stats;
  document.getElementById('statTotal').innerText = stats.totalOrders || 0;
  document.getElementById('statPending').innerText = stats.pending || 0;
  document.getElementById('statPacked').innerText = stats.packed || 0;
  document.getElementById('statDispatched').innerText = stats.dispatched || 0;

  document.getElementById('tabBadgePending').innerText = stats.pending || 0;
  document.getElementById('tabBadgePacked').innerText = stats.packed || 0;
  document.getElementById('tabBadgeDispatched').innerText = stats.dispatched || 0;
}

// Render Orders List
function renderOrders() {
  const container = document.getElementById('ordersContainer');
  const emptyState = document.getElementById('emptyState');
  const resultsCount = document.getElementById('resultsCount');

  // Filter orders
  let filtered = state.orders.filter(order => {
    // Status filter
    if (state.currentStatus !== 'all' && order.status !== state.currentStatus) {
      return false;
    }
    // Channel filter
    if (state.currentChannel !== 'all' && order.channel.toLowerCase() !== state.currentChannel.toLowerCase()) {
      return false;
    }
    // Search query
    if (state.searchQuery) {
      const q = state.searchQuery;
      const haystack = [
        order.orderId,
        order.customerName,
        order.city,
        order.state,
        order.trackingNumber,
        order.itemsSummary
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  resultsCount.innerText = `${filtered.length} order${filtered.length === 1 ? '' : 's'} displayed`;

  if (filtered.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  container.innerHTML = filtered.map(order => createOrderCardHtml(order)).join('');
  lucide.createIcons();
}

// Generate HTML for a single order card
function createOrderCardHtml(order) {
  const channelClass = getChannelBadgeClass(order.channel);
  const statusBadge = getStatusBadgeHtml(order.status);

  // Format products list
  const itemsHtml = (order.items || []).map(item => `
    <div class="flex items-start justify-between text-xs py-1 border-b border-slate-100 last:border-0">
      <div class="font-medium text-slate-800 pr-2">
        <span>${escapeHtml(item.title)}</span>
        ${item.sku ? `<span class="text-slate-400 font-mono text-[11px] block">SKU: ${escapeHtml(item.sku)}</span>` : ''}
      </div>
      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-slate-900 text-white shrink-0">
        Qty: ${item.quantity || 1}
      </span>
    </div>
  `).join('');

  // Primary action button based on order status
  let actionButtonsHtml = '';

  if (order.status === 'pending') {
    actionButtonsHtml = `
      <button onclick="printOrderLabel('${order.orderId}')" class="inline-flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold transition shadow-xs">
        <i data-lucide="printer" class="w-3.5 h-3.5 text-slate-500"></i>
        <span>Print Label</span>
      </button>

      <button onclick="markOrderPacked('${order.orderId}')" class="inline-flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition shadow-sm shadow-amber-200">
        <i data-lucide="package-check" class="w-4 h-4"></i>
        <span>Mark as Packed</span>
      </button>

      <button onclick="openDispatchModal('${order.orderId}')" class="inline-flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm shadow-emerald-200">
        <i data-lucide="truck" class="w-4 h-4"></i>
        <span>Mark as Dispatched</span>
      </button>
    `;
  } else if (order.status === 'packed') {
    actionButtonsHtml = `
      <button onclick="printOrderLabel('${order.orderId}')" class="inline-flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold transition shadow-xs">
        <i data-lucide="printer" class="w-3.5 h-3.5 text-slate-500"></i>
        <span>Re-Print</span>
      </button>

      <button onclick="openDispatchModal('${order.orderId}')" class="inline-flex items-center justify-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm shadow-emerald-200">
        <i data-lucide="truck" class="w-4 h-4"></i>
        <span>Mark as Dispatched</span>
      </button>

      <button onclick="revertOrderStatus('${order.orderId}', 'pending')" title="Revert to Pending" class="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
        <i data-lucide="undo-2" class="w-4 h-4"></i>
      </button>
    `;
  } else if (order.status === 'dispatched') {
    actionButtonsHtml = `
      <button onclick="printOrderLabel('${order.orderId}')" class="inline-flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold transition shadow-xs">
        <i data-lucide="printer" class="w-3.5 h-3.5 text-slate-500"></i>
        <span>Print</span>
      </button>

      <div class="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-semibold">
        <i data-lucide="check-check" class="w-4 h-4 text-emerald-600"></i>
        <span>Picked by ${escapeHtml(order.courierName || 'Courier')}</span>
      </div>

      <button onclick="revertOrderStatus('${order.orderId}', 'packed')" title="Revert to Packed" class="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
        <i data-lucide="undo-2" class="w-4 h-4"></i>
      </button>
    `;
  }

  // Format date
  const dateFormatted = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' (' + new Date(order.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')';

  return `
    <div class="order-card bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs relative">
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        
        <!-- Left: Order Identity & Destination -->
        <div class="flex-1 min-w-0">
          
          <!-- Badges & ID -->
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold ${channelClass}">
              ${escapeHtml(order.channel)}
            </span>

            <span class="font-mono text-sm font-bold text-slate-900 tracking-tight">
              ${escapeHtml(order.orderId)}
            </span>

            ${order.totalAmount ? `
              <span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-extrabold text-xs border border-emerald-200">
                ₹${Number(order.totalAmount).toFixed(2)}
              </span>
            ` : ''}

            ${statusBadge}

            <span class="text-[11px] text-slate-400 font-medium ml-auto sm:ml-0">
              <i data-lucide="clock" class="w-3 h-3 inline mr-0.5"></i> ${dateFormatted}
            </span>
          </div>

          <!-- Customer & Location -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 mb-3 bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
            <div>
              <p class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Customer</p>
              <p class="font-bold text-slate-900 text-sm flex items-center">
                <i data-lucide="user" class="w-3.5 h-3.5 text-slate-400 mr-1 shrink-0"></i>
                <span class="truncate">${escapeHtml(order.customerName)}</span>
              </p>
            </div>
            <div>
              <p class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Destination</p>
              <p class="font-semibold text-slate-800 flex items-center">
                <i data-lucide="map-pin" class="w-3.5 h-3.5 text-indigo-500 mr-1 shrink-0"></i>
                <span class="truncate">${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${order.pincode ? `(${escapeHtml(order.pincode)})` : ''}</span>
              </p>
            </div>
          </div>

          <!-- Products List -->
          <div class="bg-white rounded-lg border border-slate-100 p-2.5">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Items to Pack (${(order.items || []).length})
            </div>
            <div class="space-y-1">
              ${itemsHtml}
            </div>
          </div>

          ${order.trackingNumber ? `
            <div class="mt-2 text-[11px] font-mono text-slate-500 flex items-center">
              <i data-lucide="barcode" class="w-3.5 h-3.5 mr-1 text-slate-400"></i>
              AWB: <span class="font-bold text-slate-700 ml-1">${escapeHtml(order.trackingNumber)}</span>
            </div>
          ` : ''}

        </div>

        <!-- Right: Actions -->
        <div class="flex sm:flex-row lg:flex-col items-center justify-end gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
          ${actionButtonsHtml}
        </div>

      </div>
    </div>
  `;
}

// Helpers for CSS badges
function getChannelBadgeClass(channel) {
  const lower = (channel || '').toLowerCase();
  if (lower.includes('amazon')) return 'badge-amazon';
  if (lower.includes('flipkart')) return 'badge-flipkart';
  if (lower.includes('jio')) return 'badge-jiomart';
  if (lower.includes('meesho')) return 'badge-meesho';
  return 'badge-other';
}

function getStatusBadgeHtml(status) {
  if (status === 'pending') {
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold status-pill-pending flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1"></span>To Pack</span>`;
  }
  if (status === 'packed') {
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold status-pill-packed flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1"></span>Ready for Pickup</span>`;
  }
  if (status === 'dispatched') {
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold status-pill-dispatched flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1"></span>Dispatched</span>`;
  }
  return '';
}

// Actions

// Print PDF or Shipping Label
window.printOrderLabel = function(orderId) {
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  if (order.pdfPath) {
    // Open the PDF in a clean print window
    const printWindow = window.open(order.pdfPath, '_blank');
    if (printWindow) {
      printWindow.focus();
    }
  } else {
    // Printable view fallback
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
      <head>
        <title>Dispatch Label - ${order.orderId}</title>
        <style>
          body { font-family: sans-serif; padding: 20px; line-height: 1.4; }
          .header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
          .bold { font-weight: bold; }
          .badge { border: 1px solid #000; padding: 2px 6px; font-size: 12px; }
          .items { margin-top: 15px; width: 100%; border-collapse: collapse; }
          .items th, .items td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>${order.channel} Dispatch Slip</h2>
          <p>Order ID: <span class="bold">${order.orderId}</span></p>
          ${order.trackingNumber ? `<p>AWB Tracking: <span class="bold">${order.trackingNumber}</span></p>` : ''}
        </div>
        <div>
          <h3>Deliver To:</h3>
          <p class="bold" style="font-size: 18px;">${order.customerName}</p>
          <p>${order.address || (order.city + ', ' + order.state + ' - ' + order.pincode)}</p>
        </div>
        <table class="items">
          <thead><tr><th>Item Description</th><th>SKU</th><th>Qty</th></tr></thead>
          <tbody>
            ${(order.items || []).map(i => `<tr><td>${i.title}</td><td>${i.sku || '-'}</td><td><b>${i.quantity || 1}</b></td></tr>`).join('')}
          </tbody>
        </table>
        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }
};

// Mark as Packed
window.markOrderPacked = async function(orderId) {
  try {
    const res = await fetch(`/api/orders/${orderId}/pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packedBy: 'Packing Team' })
    });
    const data = await res.json();
    if (data.success) {
      playAudioTone(659.25, 880, 0.15); // Happy pack chime
      // Switch to Ready for Pickup view or re-render
      renderOrders();
    }
  } catch (err) {
    console.error('Pack error:', err);
  }
};

// Open Dispatch Modal
window.openDispatchModal = function(orderId) {
  state.selectedOrderForDispatch = orderId;
  document.getElementById('dispatchOrderSubtitle').innerText = `Order: ${orderId}`;
  openModal('modalDispatch');
};

// Confirm Dispatch Handover
async function executeDispatch(orderId, courierName) {
  try {
    const res = await fetch(`/api/orders/${orderId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courierName })
    });
    const data = await res.json();
    if (data.success) {
      playAudioTone(440, 659.25, 0.2); // Delivery confirmation chime
      renderOrders();
    }
  } catch (err) {
    console.error('Dispatch error:', err);
  }
}

// Revert Status
window.revertOrderStatus = async function(orderId, targetStatus) {
  try {
    const res = await fetch(`/api/orders/${orderId}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetStatus })
    });
    const data = await res.json();
    if (data.success) {
      renderOrders();
    }
  } catch (err) {
    console.error('Revert error:', err);
  }
};

// Manual PDF Upload Handler
async function handlePdfUpload(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please upload a valid PDF document.');
    return;
  }

  const statusText = document.getElementById('uploadStatusText');
  statusText.innerText = `Uploading and parsing "${file.name}"...`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/orders/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      statusText.innerText = `✅ Order ${data.order.orderId} parsed successfully!`;
      playAudioTone(523.25, 659.25, 0.2);
      closeModal('modalUpload');
      // Switch to "To Pack" tab
      document.querySelector('.status-tab[data-status="pending"]').click();
    } else {
      statusText.innerText = `❌ Error: ${data.error || 'Failed to parse PDF'}`;
    }
  } catch (err) {
    statusText.innerText = `❌ Upload failed: ${err.message}`;
  }
}

// WhatsApp Status & QR Code Handling
async function fetchWhatsAppStatus() {
  try {
    const res = await fetch('/api/whatsapp/status');
    const data = await res.json();
    if (!data.success) return;

    const dot = document.getElementById('waStatusDot');
    const text = document.getElementById('waStatusText');
    const qrBox = document.getElementById('waQrBox');
    const connectedBox = document.getElementById('waConnectedBox');
    const qrContainer = document.getElementById('waQrContainer');
    const groupInput = document.getElementById('targetGroupNameInput');

    if (data.configuredGroup && !groupInput.value) {
      groupInput.value = data.configuredGroup === 'All Groups' ? '' : data.configuredGroup;
    }

    if (data.status === 'connected') {
      dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
      text.innerText = `WhatsApp: Online (${data.configuredGroup || 'All'})`;
      qrBox.classList.add('hidden');
      connectedBox.classList.remove('hidden');
      document.getElementById('waConnectedUser').innerText =
        `Connected as ${data.userInfo?.name || data.userInfo?.id || 'Primary User'}. Monitoring: ${data.configuredGroup || 'All Groups'}`;
    } else if (data.status === 'qr_ready' && data.qrCode) {
      dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse';
      text.innerText = 'WhatsApp: Scan QR';
      qrBox.classList.remove('hidden');
      connectedBox.classList.add('hidden');
      qrContainer.innerHTML = `<img src="${data.qrCode}" alt="WhatsApp QR Code" class="w-52 h-52 object-contain rounded-md" />`;
    } else {
      dot.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
      text.innerText = 'WhatsApp: Click to Connect';
      qrBox.classList.remove('hidden');
      connectedBox.classList.add('hidden');
      qrContainer.innerHTML = `
        <div class="text-center p-4">
          <p class="text-xs text-slate-500 mb-2">WhatsApp service is idle.</p>
          <button onclick="document.getElementById('btnReconnectWa').click()" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold">
            Start & Show QR Code
          </button>
        </div>
      `;
    }
  } catch (err) {
    console.error('WhatsApp status error:', err);
  }
}

function startWaPolling() {
  if (state.waPollInterval) clearInterval(state.waPollInterval);
  state.waPollInterval = setInterval(fetchWhatsAppStatus, 4000);
}

function stopWaPolling() {
  if (state.waPollInterval) {
    clearInterval(state.waPollInterval);
    state.waPollInterval = null;
  }
}

// XSS Sanitizer Helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
