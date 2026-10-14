/**
 * Database & Persistence Layer for Public Service Queue & Wait-Time Optimizer (SC-03)
 * Supports relational queries for Categories, Counters, Tokens, and Analytics Logs.
 * Uses atomic file persistence with auto-recovery and instant zero-dependency execution.
 */

const fs = require('fs');
const path = require('path');

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const LOCAL_DATA_DIR = path.join(__dirname, '../../data');
const LOCAL_DB_FILE = path.join(LOCAL_DATA_DIR, 'queue_store.json');
const DATA_DIR = isServerless ? '/tmp' : LOCAL_DATA_DIR;
const DB_FILE = isServerless ? path.join('/tmp', 'queue_store.json') : LOCAL_DB_FILE;

// Ensure data folder exists safely without crashing on read-only systems
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  // Directory might be read-only in serverless, will operate in-memory
}

// Default initial seed data matching specification
const INITIAL_STATE = {
  categories: [
    { id: 1, name: 'General Inquiries', code_prefix: 'A', avg_service_time_sec: 180, total_served: 12 },
    { id: 2, name: 'Billing & Payments', code_prefix: 'B', avg_service_time_sec: 120, total_served: 18 },
    { id: 3, name: 'Document Processing', code_prefix: 'C', avg_service_time_sec: 300, total_served: 8 }
  ],
  counters: [
    { id: 1, counter_number: 1, status: 'OPEN', assigned_staff_name: 'Sarah Jenkins', current_token_id: null, categories_handled: [1, 2, 3] },
    { id: 2, counter_number: 2, status: 'OPEN', assigned_staff_name: 'David Miller', current_token_id: null, categories_handled: [1, 2] },
    { id: 3, counter_number: 3, status: 'OPEN', assigned_staff_name: 'Elena Rostova', current_token_id: null, categories_handled: [2, 3] },
    { id: 4, counter_number: 4, status: 'PAUSED', assigned_staff_name: 'Marcus Vance', current_token_id: null, categories_handled: [1, 2, 3] }
  ],
  tokens: [],
  logs: [],
  counters_sequence: {
    A: 100,
    B: 200,
    C: 300
  }
};

class Database {
  constructor() {
    this.state = this.load();
    // Seed sample tokens if starting completely fresh
    if (this.state.tokens.length === 0) {
      this.seedInitialTokens();
    }
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(raw);
      } else if (fs.existsSync(LOCAL_DB_FILE)) {
        const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('[DB] Could not load persisted data, using initial state:', err.message);
    }
    return JSON.parse(JSON.stringify(INITIAL_STATE));
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      // In serverless environments where disk write might fail, keep working in memory
      console.warn('[DB] Could not write to disk, maintaining in-memory state:', err.message);
    }
  }

  seedInitialTokens() {
    const now = Date.now();
    // Pre-populate realistic initial queue
    const sampleSeeds = [
      { prefix: 'A', catId: 1, name: 'Alice Walker', delaySec: 600, status: 'COMPLETED', counterId: 1, srvSec: 175 },
      { prefix: 'B', catId: 2, name: 'Bob Smith', delaySec: 480, status: 'COMPLETED', counterId: 2, srvSec: 110 },
      { prefix: 'A', catId: 1, name: 'Carlos Gomez', delaySec: 360, status: 'SERVING', counterId: 1, srvSec: null },
      { prefix: 'B', catId: 2, name: 'Diana Prince', delaySec: 240, status: 'SERVING', counterId: 2, srvSec: null },
      { prefix: 'C', catId: 3, name: 'Evan Wright', delaySec: 180, status: 'WAITING', counterId: null, srvSec: null },
      { prefix: 'A', catId: 1, name: 'Fiona Gallagher', delaySec: 120, status: 'WAITING', counterId: null, srvSec: null },
      { prefix: 'B', catId: 2, name: 'George Clark', delaySec: 60, status: 'WAITING', counterId: null, srvSec: null },
      { prefix: 'C', catId: 3, name: 'Hannah Abbott', delaySec: 20, status: 'WAITING', counterId: null, srvSec: null }
    ];

    sampleSeeds.forEach(seed => {
      this.state.counters_sequence[seed.prefix]++;
      const tokenNum = `${seed.prefix}-${this.state.counters_sequence[seed.prefix]}`;
      const createdAt = new Date(now - seed.delaySec * 1000).toISOString();
      let calledAt = null;
      let completedAt = null;

      if (seed.status === 'SERVING' || seed.status === 'COMPLETED') {
        calledAt = new Date(now - (seed.delaySec - 90) * 1000).toISOString();
      }
      if (seed.status === 'COMPLETED') {
        completedAt = new Date(now - (seed.delaySec - 90 - seed.srvSec) * 1000).toISOString();
      }

      const token = {
        id: this.state.tokens.length + 1,
        token_number: tokenNum,
        category_id: seed.catId,
        counter_id: seed.counterId,
        citizen_name: seed.name,
        citizen_phone: '555-01' + Math.floor(10 + Math.random() * 89),
        status: seed.status,
        created_at: createdAt,
        called_at: calledAt,
        completed_at: completedAt,
        estimated_wait_min: Math.max(1, Math.round((seed.delaySec / 60) * 10) / 10)
      };

      this.state.tokens.push(token);

      if (seed.status === 'SERVING' && seed.counterId) {
        const counter = this.state.counters.find(c => c.id === seed.counterId);
        if (counter) counter.current_token_id = token.id;
      }
    });

    this.save();
  }

  // --- Categories ---
  getCategories() {
    return this.state.categories;
  }

  getCategoryById(id) {
    return this.state.categories.find(c => c.id === Number(id));
  }

  updateCategoryAvgServiceTime(id, newAvgSec) {
    const cat = this.getCategoryById(id);
    if (cat) {
      cat.avg_service_time_sec = Math.round(newAvgSec);
      cat.total_served = (cat.total_served || 0) + 1;
      this.save();
    }
    return cat;
  }

  // --- Counters ---
  getCounters() {
    return this.state.counters;
  }

  getCounterById(id) {
    return this.state.counters.find(c => c.id === Number(id));
  }

  updateCounter(id, updates) {
    const counter = this.getCounterById(id);
    if (counter) {
      Object.assign(counter, updates);
      this.save();
    }
    return counter;
  }

  // --- Tokens ---
  getAllTokens() {
    return this.state.tokens;
  }

  getTokenById(id) {
    return this.state.tokens.find(t => t.id === Number(id));
  }

  getTokenByNumber(tokenNumber) {
    if (!tokenNumber) return null;
    return this.state.tokens.find(t => t.token_number.toUpperCase() === tokenNumber.trim().toUpperCase());
  }

  getWaitingTokens(categoryId = null) {
    return this.state.tokens.filter(t => {
      const isWaiting = t.status === 'WAITING';
      if (!isWaiting) return false;
      if (categoryId !== null && categoryId !== undefined) {
        return t.category_id === Number(categoryId);
      }
      return true;
    }).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  createToken({ category_id, citizen_name, citizen_phone, estimated_wait_min }) {
    const cat = this.getCategoryById(category_id);
    if (!cat) throw new Error(`Category ${category_id} not found`);

    if (!this.state.counters_sequence[cat.code_prefix]) {
      this.state.counters_sequence[cat.code_prefix] = 100;
    }
    this.state.counters_sequence[cat.code_prefix]++;
    const tokenNumber = `${cat.code_prefix}-${this.state.counters_sequence[cat.code_prefix]}`;

    const token = {
      id: this.state.tokens.length + 1,
      token_number: tokenNumber,
      category_id: Number(category_id),
      counter_id: null,
      citizen_name: citizen_name || 'Guest Citizen',
      citizen_phone: citizen_phone || '',
      status: 'WAITING',
      created_at: new Date().toISOString(),
      called_at: null,
      completed_at: null,
      estimated_wait_min: Number(estimated_wait_min) || 5
    };

    this.state.tokens.push(token);
    this.addLog({
      event_type: 'TOKEN_CREATED',
      token_id: token.id,
      token_number: token.token_number,
      category_id: token.category_id,
      counter_id: null
    });

    this.save();
    return token;
  }

  updateToken(id, updates, autoSave = true) {
    const token = this.getTokenById(id);
    if (token) {
      Object.assign(token, updates);
      if (autoSave) {
        this.save();
      }
    }
    return token;
  }

  // --- Logs & Analytics ---
  addLog(entry) {
    const log = {
      id: this.state.logs.length + 1,
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.state.logs.push(log);
    // Keep max 5000 logs in memory
    if (this.state.logs.length > 5000) {
      this.state.logs.shift();
    }
    this.save();
    return log;
  }

  getLogs(limit = 100) {
    return this.state.logs.slice(-limit).reverse();
  }

  resetAll(keepStructure = true) {
    if (keepStructure) {
      this.state.tokens = [];
      this.state.logs = [];
      this.state.counters_sequence = { A: 100, B: 200, C: 300 };
      this.state.counters.forEach(c => {
        c.current_token_id = null;
        c.status = 'OPEN';
      });
      this.seedInitialTokens();
    } else {
      this.state = JSON.parse(JSON.stringify(INITIAL_STATE));
    }
    this.save();
    return this.state;
  }
}

const db = new Database();
module.exports = db;
