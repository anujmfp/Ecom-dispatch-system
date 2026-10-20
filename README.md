# 📦 DispatchPro - Automated E-Commerce Dispatch Management System

An automated dispatch and packing station web application built for multi-marketplace sellers (**Amazon**, **Flipkart**, **JioMart**, **Meesho**).

It monitors your WhatsApp packing group, automatically downloads incoming dispatch/invoice PDFs, extracts order and destination details, allows your warehouse team to print labels in 1-click, tick orders as packed, and log dispatch handovers to delivery personnel.

---

## 🚀 Key Features

1. **Automatic WhatsApp Group PDF Ingestion**
   - Connects to WhatsApp via **Linked Devices QR Code** (no expensive Meta API or verification needed).
   - Automatically listens to your designated packing group (e.g. *"Dispatch Team"*).
   - Detects incoming PDFs, downloads them immediately, and parses order details in real-time.

2. **Multi-Marketplace Smart PDF Parser**
   - **Amazon**: Extracts Order ID (`402-XXXXXXX-XXXXXXX`), Buyer Name, City, State, PIN, items, quantities, and ATS tracking numbers.
   - **Flipkart**: Extracts Order ID (`ODXXXXXXXXXXXXXXXX`), Customer Details, Ekart Logistics AWB, items, and quantities.
   - **JioMart / Reliance Retail**: Extracts Order No, Customer, Destination, items, and quantities.
   - **Meesho / Others**: Robust fallback regex and keyword extraction for any Indian shipping label.

3. **Packing & Dispatch Station Dashboard**
   - **High-contrast, warehouse-ready UI**: Optimized for mobile phones, tablets, barcode PCs, and thermal printer desks.
   - **1-Click Print Label**: Direct print preview with auto-formatted shipping slips.
   - **Tick "Mark as Packed"**: Visual and audible confirmation chime; moves order to *Ready for Pickup*.
   - **"Mark as Dispatched"**: One-click handover logging with delivery partner selection (Amazon EasyShip, Ekart, Delhivery, BlueDart, etc.) and timestamp.
   - **Manual PDF Upload Zone**: Drag-and-drop backup if someone uploads directly from PC/phone without WhatsApp.
   - **Real-Time Live Sync**: Uses Server-Sent Events (SSE) so all packing station screens update instantly without refreshing.

---

## 🛠️ Project Structure

```
dispatch-management-system/
├── server.js              # Express API, SSE real-time stream & static file server
├── src/
│   ├── parser.js          # Multi-channel PDF parser (Amazon, Flipkart, JioMart)
│   ├── whatsapp.js        # Baileys WhatsApp Web client & group listener
│   └── db.js              # Atomic persistent database & audit logs
├── public/
│   ├── index.html         # Packing station dashboard UI
│   ├── app.js             # Real-time state management & printer trigger
│   └── style.css          # Responsive styling & print overrides
├── storage/
│   ├── pdfs/              # Saved dispatch PDFs (for re-printing & archive)
│   └── auth_baileys/      # Persistent WhatsApp session keys
├── Dockerfile             # Container configuration for Cloud VPS
├── docker-compose.yml     # 1-click deployment on Ubuntu / Cloud VPS
└── package.json           # Dependencies
```

---

## 💻 How to Run Locally (Windows / Mac / Linux)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The application will launch at:
👉 **`http://localhost:3000`**

---

## ☁️ Deploying to a Cloud Server / VPS (Ubuntu, DigitalOcean, AWS EC2)

You can easily deploy DispatchPro on any \$5/mo VPS using Docker or PM2.

### Option A: Using Docker Compose (Recommended)

1. Clone or copy this folder to your cloud VPS:
   ```bash
   git clone <your-repo> /opt/dispatch-pro
   cd /opt/dispatch-pro
   ```
2. Start the container in background:
   ```bash
   docker-compose up -d --build
   ```
3. Open your browser at `http://YOUR_SERVER_IP:3000`!

### Option B: Using PM2 (Direct Node.js on Ubuntu)

1. Install Node.js 20+ and PM2:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```
2. In the project directory:
   ```bash
   npm install
   pm2 start server.js --name "dispatch-pro"
   pm2 save
   pm2 startup
   ```

---

## 📲 WhatsApp Group Linking Guide

1. Open the dashboard at `http://localhost:3000` (or your Cloud VPS IP).
2. Click the **WhatsApp: Click to Connect** button in the top right.
3. A modal with a **QR Code** will appear.
4. On your mobile phone:
   - Open **WhatsApp**
   - Tap **Settings / 3 Dots** > **Linked Devices**
   - Tap **Link a Device** and scan the QR code on your screen.
5. In the modal, type your **Target WhatsApp Group Name** (e.g. `Packing Team`) and click **Save Settings**.
6. That's it! Every time an order PDF is sent to that group, DispatchPro immediately downloads it, extracts the details, and puts it in the packing queue with an audio chime.

---

## 📦 Daily Packing Team Workflow

1. **Order Arrives**: Seller shares the PDF to the WhatsApp group from the seller app.
2. **Auto-Queued**: Order instantly appears under the **To Pack** tab on the warehouse screen.
3. **Print Label**: Packer clicks **Print Label** to print the shipping label on their thermal or A4 printer.
4. **Pack & Tick**: Team packs the goods and clicks **Mark as Packed**.
5. **Courier Pickup**: When the delivery driver (Amazon EasyShip / Ekart / Delhivery) arrives, packer clicks **Mark as Dispatched**.
