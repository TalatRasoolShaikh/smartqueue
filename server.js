/**
 * Public Service Queue and Wait-Time Optimizer (SC-03)
 * Full-Stack Real-Time Server (Express + Socket.io + Relational Queue Engine)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const db = require('./src/server/db');
const queueEngine = require('./src/server/queueEngine');
const simulator = require('./src/server/simulator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to broadcast global queue state update to all connected clients
function broadcastQueueUpdate(reason = 'UPDATE', extraData = {}) {
  const categories = db.getCategories();
  const counters = db.getCounters();
  const allTokens = db.getAllTokens();
  const waitingTokens = db.getWaitingTokens();

  const payload = {
    reason,
    timestamp: new Date().toISOString(),
    categories,
    counters: counters.map(c => {
      const currentToken = c.current_token_id ? db.getTokenById(c.current_token_id) : null;
      return {
        ...c,
        currentToken
      };
    }),
    waitingCount: waitingTokens.length,
    activeCounters: counters.filter(c => c.status === 'OPEN').length,
    upcomingByCategory: categories.map(cat => ({
      categoryId: cat.id,
      categoryName: cat.name,
      prefix: cat.code_prefix,
      tokens: db.getWaitingTokens(cat.id).slice(0, 5)
    })),
    ...extraData
  };

  io.emit('QUEUE_UPDATED', payload);
  io.emit('ANALYTICS_UPDATED', queueEngine.getAnalytics());
}

// Hook simulator broadcaster into Socket.io
simulator.setBroadcaster((event, data) => {
  if (event === 'TOKEN_CALLED') {
    io.emit('TOKEN_CALLED', data);
    broadcastQueueUpdate('SIM_TOKEN_CALLED', { calledData: data });
  } else if (event === 'TOKEN_COMPLETED') {
    broadcastQueueUpdate('SIM_TOKEN_COMPLETED', { completedData: data });
  } else if (event === 'SIMULATION_ARRIVAL') {
    broadcastQueueUpdate('SIM_ARRIVAL', { arrival: data });
    io.emit('SIMULATION_LOG', {
      type: 'ARRIVAL',
      message: `Simulated Arrival: Token ${data.token.token_number} (${data.category.name}) - Est. Wait ${data.estimated_wait_min}m`
    });
  } else if (event === 'SIMULATION_SURGE') {
    broadcastQueueUpdate('SIM_SURGE', { surgeCount: data.count });
    io.emit('SIMULATION_LOG', {
      type: 'SURGE',
      message: `Peak Surge Triggered: ${data.count} citizens arrived at once!`
    });
  } else {
    io.emit(event, data);
  }
});

// ==========================================
// REST API ENDPOINTS
// ==========================================

// 1. Categories
app.get('/api/categories', (req, res) => {
  res.json({ success: true, categories: db.getCategories() });
});

// 2. Counters
app.get('/api/counters', (req, res) => {
  const counters = db.getCounters().map(c => ({
    ...c,
    currentToken: c.current_token_id ? db.getTokenById(c.current_token_id) : null
  }));
  res.json({ success: true, counters });
});

app.put('/api/counters/:id', (req, res) => {
  try {
    const counterId = Number(req.params.id);
    const { status, assigned_staff_name, categories_handled } = req.body;
    const updates = {};
    if (status) updates.status = status;
    if (assigned_staff_name !== undefined) updates.assigned_staff_name = assigned_staff_name;
    if (categories_handled) updates.categories_handled = categories_handled;

    const updated = db.updateCounter(counterId, updates);
    queueEngine.recalculateAllWaitingTokens();
    broadcastQueueUpdate('COUNTER_UPDATED');

    res.json({ success: true, counter: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 3. Citizen Module: Token Generation
app.post('/api/tokens', (req, res) => {
  try {
    const { category_id, citizen_name, citizen_phone } = req.body;
    if (!category_id) {
      return res.status(400).json({ success: false, error: 'Category ID is required' });
    }

    const waitingTokens = db.getWaitingTokens(category_id);
    const waitEst = queueEngine.calculateWaitTime(category_id, waitingTokens.length);

    const token = db.createToken({
      category_id: Number(category_id),
      citizen_name: citizen_name || 'Guest Citizen',
      citizen_phone: citizen_phone || '',
      estimated_wait_min: waitEst.waitMin
    });

    queueEngine.recalculateAllWaitingTokens();
    broadcastQueueUpdate('NEW_TOKEN_CREATED');

    const status = queueEngine.getTokenStatus(token.id);
    res.status(201).json({ success: true, token, tracking: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Citizen & Queue Tokens
app.get('/api/tokens', (req, res) => {
  const { status, category_id } = req.query;
  let tokens = db.getAllTokens();
  if (status) {
    tokens = tokens.filter(t => t.status === status.toUpperCase());
  }
  if (category_id) {
    tokens = tokens.filter(t => t.category_id === Number(category_id));
  }
  res.json({ success: true, tokens });
});

// 4. Citizen Module: Token Tracking
app.get('/api/tokens/:idOrNumber', (req, res) => {
  try {
    const status = queueEngine.getTokenStatus(req.params.idOrNumber);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }
    res.json({ success: true, tracking: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Staff Module: Queue Actions
app.post('/api/staff/call-next', (req, res) => {
  try {
    const { counter_id } = req.body;
    if (!counter_id) {
      return res.status(400).json({ success: false, error: 'counter_id is required' });
    }

    const result = queueEngine.callNextToken(Number(counter_id));
    if (!result) {
      return res.json({ success: false, message: 'No waiting tokens for this counter.' });
    }

    // Emit audible chime and announcement event
    io.emit('TOKEN_CALLED', {
      token: result.token,
      counter: result.counter,
      category: result.category
    });

    broadcastQueueUpdate('TOKEN_CALLED');
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/staff/recall', (req, res) => {
  try {
    const { counter_id } = req.body;
    const counter = db.getCounterById(Number(counter_id));
    if (!counter || !counter.current_token_id) {
      return res.status(400).json({ success: false, error: 'Counter is not currently serving any token.' });
    }

    const token = db.getTokenById(counter.current_token_id);
    const category = db.getCategoryById(token.category_id);

    io.emit('TOKEN_CALLED', {
      token,
      counter,
      category,
      isRecall: true
    });

    res.json({ success: true, message: `Re-called token ${token.token_number}` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/staff/complete', (req, res) => {
  try {
    const { counter_id } = req.body;
    const result = queueEngine.completeCurrentToken(Number(counter_id));
    broadcastQueueUpdate('TOKEN_COMPLETED');
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/staff/skip', (req, res) => {
  try {
    const { counter_id } = req.body;
    const result = queueEngine.skipCurrentToken(Number(counter_id));
    broadcastQueueUpdate('TOKEN_SKIPPED');
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/staff/transfer', (req, res) => {
  try {
    const { counter_id, target_category_id, reason } = req.body;
    const result = queueEngine.transferCurrentToken(Number(counter_id), Number(target_category_id), reason);
    broadcastQueueUpdate('TOKEN_TRANSFERRED');
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6. Lobby Display Data
app.get('/api/lobby', (req, res) => {
  const categories = db.getCategories();
  const counters = db.getCounters().map(c => ({
    id: c.id,
    counter_number: c.counter_number,
    status: c.status,
    assigned_staff_name: c.assigned_staff_name,
    currentToken: c.current_token_id ? db.getTokenById(c.current_token_id) : null
  }));

  const upcomingByCategory = categories.map(cat => ({
    categoryId: cat.id,
    categoryName: cat.name,
    prefix: cat.code_prefix,
    tokens: db.getWaitingTokens(cat.id).slice(0, 5)
  }));

  res.json({
    success: true,
    counters,
    upcomingByCategory,
    serverTime: new Date().toISOString()
  });
});

// 7. Analytics Data
app.get('/api/analytics', (req, res) => {
  res.json({ success: true, analytics: queueEngine.getAnalytics() });
});

// 8. Simulation Controls
app.get('/api/simulation/status', (req, res) => {
  res.json({ success: true, status: simulator.getStatus() });
});

app.post('/api/simulation/start', (req, res) => {
  simulator.start();
  res.json({ success: true, status: simulator.getStatus() });
});

app.post('/api/simulation/stop', (req, res) => {
  simulator.stop();
  res.json({ success: true, status: simulator.getStatus() });
});

app.post('/api/simulation/config', (req, res) => {
  simulator.configure(req.body);
  res.json({ success: true, status: simulator.getStatus() });
});

app.post('/api/simulation/surge', (req, res) => {
  const count = Number(req.body.count) || 10;
  const tokens = simulator.triggerSurge(count);
  res.json({ success: true, count: tokens.length });
});

app.post('/api/system/reset', (req, res) => {
  simulator.stop();
  db.resetAll();
  queueEngine.recalculateAllWaitingTokens();
  broadcastQueueUpdate('SYSTEM_RESET');
  res.json({ success: true, message: 'Queue system reset to baseline seeds.' });
});

// Socket.io Connection Management
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Send initial state upon connection
  socket.emit('ANALYTICS_UPDATED', queueEngine.getAnalytics());
  
  socket.on('REQUEST_STATE', () => {
    broadcastQueueUpdate('CLIENT_REQUEST');
  });

  socket.on('disconnect', () => {
    // console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// SPA Catch-all: Send index.html for all non-API web routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server locally (Vercel invokes exported app as serverless handler)
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Queue & Wait-Time Optimizer Server (SC-03) running!`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`✨ Features: Web/QR Check-in, Staff Dashboard, Lobby Display,`);
    console.log(`   Real-Time Analytics & Live Surge Simulation`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
module.exports.server = server;
