# 🏛️ Public Service Queue and Wait-Time Optimizer (SC-03)
> **Production-Ready Real-Time Queue Management System & Dynamic Demand Simulator**

---

## 📋 Executive Overview

**SmartQueue (SC-03)** is a modern, real-time civic queue management solution designed for public service halls, healthcare centers, municipal offices, and revenue departments. 

It replaces static ticket printers and opaque waiting rooms with:
1. **Digital Tokens & Instant QR Mobile Passes**
2. **Dynamic Queue Wait-Time Estimator** based on Queueing Theory
3. **Airport/Hospital-Style Public Lobby Board** with Web Audio dual-tone chime and Web Speech vocal announcements
4. **Staff Operator Dashboard** with counter controllers and transfer workflows
5. **Real-Time Analytics & Dynamic Surge Simulation Studio** to test and visualize sudden demand spikes and load-balancing recovery

---

## 🏗️ Architecture & File Structure

```text
openhack--SC03/
├── package.json               # Project manifest, dependencies, and start scripts
├── server.js                  # Express + Socket.io real-time server & REST API
├── src/
│   └── server/
│       ├── db.js              # Relational data layer (Categories, Counters, Tokens, Logs)
│       ├── queueEngine.js     # M/M/c wait-time estimation engine & state machine
│       └── simulator.js       # Real-time arrival & virtual staff surge simulator
├── public/
│   ├── index.html             # High-aesthetic responsive web app (Tailwind CSS, Inter/Outfit)
│   ├── css/
│   │   └── styles.css         # Glassmorphism, animations, high-contrast lobby styling
│   └── js/
│       ├── audio.js           # Web Audio API synthetic chime + Web Speech API vocal announcer
│       ├── api.js             # REST & Socket.io client wrapper with fallback
│       ├── citizenView.js     # Module A: Kiosk, Token generation, QR code, live tracking
│       ├── lobbyView.js       # Module B: Fullscreen public display board
│       ├── staffView.js       # Module C: Operator dashboard & queue management
│       ├── analyticsView.js   # Module D: Real-time KPI cards & Chart.js visualizations
│       ├── simulatorView.js   # Module E: Interactive simulation control panel
│       └── app.js             # Application orchestrator & tab routing
└── README.md                  # System manual and mathematical documentation
```

---

## 🧮 Mathematical Model: Dynamic Wait-Time Formula

The estimation engine implements the **Multi-Server Queue Approximation ($M/M/c$ model)**:

$$\hat{W}_q = \frac{N_{\text{ahead}} \cdot \bar{S}_c}{C_{\text{active}}}$$

Where:
- $N_{\text{ahead}}$ = Number of active waiting tokens ahead in category $c$
- $\bar{S}_c$ = Rolling average service duration for category $c$
- $C_{\text{active}}$ = Number of currently `OPEN` counters qualified to process category $c$

### Dynamic Rolling Average Recalibration (EMA)
Whenever a token is marked completed by counter staff, the actual service duration $\Delta t = t_{\text{completed}} - t_{\text{called}}$ is recorded. The rolling average $\bar{S}_c$ is updated dynamically using an **Exponential Moving Average (EMA)** with smoothing factor $\alpha = 0.25$:

$$\bar{S}_{\text{new}} = (\alpha \cdot \Delta t) + ((1 - \alpha) \cdot \bar{S}_{\text{previous}})$$

This dynamically adapts to:
- Complex transactions during rush hours
- Speed variations between staff members
- Instant counter open/close rebalancing (when an extra counter opens, $C_{\text{active}}$ increases, cutting the wait times for all waiting citizens in real time!)

---

## 🚀 Core Modules

### 🎫 Module A: Citizen Interface (Public / Web View)
- **Service Categories**:
  - `[A]` **General Inquiries** (Average ~3 mins)
  - `[B]` **Billing & Payments** (Average ~2 mins)
  - `[C]` **Document Processing** (Average ~5 mins)
- **Token Generation**: Issues formatted token (e.g., `A-101`, `B-205`) with citizen details.
- **Dynamic QR Code**: Generates an interactive scannable QR code linking to `?token=A-101` so citizens can scan it on their mobile phone and roam freely.
- **Live Tracking Pass**:
  - Real-time queue position counter (e.g. *"3 people ahead of you"*).
  - Dynamically recalculating wait time estimate.
  - Desk activity indicator (e.g. *"Counter 2 is serving A-100"*).
  - **Proximity Alert**: When the citizen is **$\le 2$ positions away**, an alert banner appears, triggers browser push notification via Web Notification API, and sounds an alert tone.

### 📺 Module B: Public Display / Lobby Board
- Full-screen high-contrast board for lobby TV monitors.
- **Active Counters Matrix**: Real-time display of Counter 1 to 4 with huge typography and pulsing glow when newly called.
- **Next 5 Upcoming Tokens** displayed per service category.
- **Acoustic & Voice Broadcast**:
  - **Synthesized Dual-Tone Chime**: Built using the Web Audio API ($659.25\text{ Hz}$ followed by $523.25\text{ Hz}$) with zero audio file dependencies.
  - **Natural Speech Announcement**: Uses the browser's Web Speech API: *"Token A-101, please proceed to Counter 2"*.

### 💼 Module C: Staff / Operator Dashboard
- **Counter Controller**: Staff selects counter number (1 to 4), assigns staff name, and toggles counter state (`OPEN`, `PAUSED`, `CLOSED`).
- **Live Stopwatch**: Real-time elapsed service timer during active citizen consultation.
- **Operator Actions**:
  - **Call Next Token** (fetches next token in FIFO queue).
  - **Re-Announce / Recall** (replays chime and vocal call).
  - **Mark as Completed** (records service duration and recalculates rolling average).
  - **Mark as No-Show / Skip** (records abandoned citizen).
  - **Transfer Token** (routes citizen to another department with reason).

### 📊 Module D: Dynamic Wait-Time & Analytics Engine
- **Interactive Formula Inspector**: Real-time breakdown displaying current $N$, $\bar{S}$, and $C$ variables plugged into the queueing equation.
- **Real-Time KPIs**: Total Issued, Currently Waiting, Currently Serving, Completed, Average Wait Time, Average Service Time, and No-Show Rate.
- **Chart.js Visualizations**:
  - Counter processing efficiency (throughput comparison across desks).
  - Department demand distribution.

### ⚡ Module E: Dynamic Arrival & Surge Simulator
- **Interactive Sliders**:
  - Customer Arrival Rate ($5$ to $60$ arrivals/min).
  - Service Speed Multiplier ($0.5\times$ to $3.0\times$).
  - Active Counters ($1$ to $4$ desks).
- **Peak Hour Surge Trigger**: Injects a sudden burst of $10$ arrivals to simulate morning or lunchtime spikes and observe wait-time recovery.
- **Virtual Staff Auto-Processing**: Automated loop that calls and completes tokens so you can observe the queueing mechanics live without manual clicking.
- **Real-Time Event Stream Log**: Live feed of simulation events and load adjustments.

---

## 🛠️ Getting Started

### Prerequisites
- Node.js (version 16 or newer)
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```

### 3. Open Application
Navigate to:
```text
http://localhost:3000
```
- Click the navigation tabs at the top to switch between **Citizen Kiosk**, **Lobby Board**, **Staff Desk**, **Analytics**, and **Simulator**.
- Open a second browser window to `http://localhost:3000` to watch the Lobby Board and Staff Desk synchronize via WebSockets in real time!
