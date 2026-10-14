/**
 * API & Real-Time Socket Layer (SC-03)
 * Provides seamless integration with backend REST endpoints & Socket.io events.
 * Features instant mock fallback if running as a static standalone client.
 */

class ApiService {
  constructor() {
    this.socket = null;
    this.isServerConnected = false;
    this.listeners = new Map();
    this.fallbackPollTimer = null;
    this.initSocket();
    this.startFallbackPolling();
  }

  initSocket() {
    if (typeof io !== 'undefined') {
      try {
        this.socket = io({
          reconnectionAttempts: 5,
          timeout: 4000,
          transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
          this.isServerConnected = true;
          this.emitLocal('connection_status', { connected: true });
        });

        this.socket.on('disconnect', () => {
          this.isServerConnected = false;
          this.emitLocal('connection_status', { connected: false });
        });

        this.socket.on('QUEUE_UPDATED', (data) => {
          this.emitLocal('queue_updated', data);
        });

        this.socket.on('TOKEN_CALLED', (data) => {
          this.emitLocal('token_called', data);
        });

        this.socket.on('ANALYTICS_UPDATED', (data) => {
          this.emitLocal('analytics_updated', data);
        });

        this.socket.on('SIMULATION_LOG', (data) => {
          this.emitLocal('simulation_log', data);
        });
      } catch (err) {
        console.warn('[Socket] Could not connect to Socket.io server:', err);
      }
    }
  }

  startFallbackPolling() {
    if (this.fallbackPollTimer) clearInterval(this.fallbackPollTimer);
    this.fallbackPollTimer = setInterval(async () => {
      // If WebSockets are connected, real-time events handle updates
      if (this.isServerConnected) return;

      try {
        const lobby = await this.getLobbyData();
        if (lobby && lobby.success) {
          this.emitLocal('queue_updated', { reason: 'POLL_SYNC', ...lobby });
        }
        const analytics = await this.getAnalytics();
        if (analytics && analytics.success && analytics.analytics) {
          this.emitLocal('analytics_updated', analytics.analytics);
        }
      } catch (e) {
        // Silently catch network issues in background poll
      }
    }, 3500);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emitLocal(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    }
  }

  async request(endpoint, options = {}) {
    try {
      const res = await fetch(endpoint, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      return await res.json();
    } catch (err) {
      console.warn(`[API] Error contacting ${endpoint}:`, err.message);
      return this.handleFallback(endpoint, options);
    }
  }

  // --- REST Endpoints ---
  async getCategories() {
    return this.request('/api/categories');
  }

  async getCounters() {
    return this.request('/api/counters');
  }

  async updateCounter(id, data) {
    const res = await this.request(`/api/counters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    if (res && res.success) {
      this.emitLocal('queue_updated', { reason: 'COUNTER_UPDATED' });
    }
    return res;
  }

  async createToken(category_id, citizen_name = '', citizen_phone = '') {
    const res = await this.request('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ category_id, citizen_name, citizen_phone })
    });
    if (res && res.success) {
      this.emitLocal('queue_updated', { reason: 'NEW_TOKEN_CREATED' });
    }
    return res;
  }

  async getTokenStatus(idOrNumber) {
    return this.request(`/api/tokens/${encodeURIComponent(idOrNumber)}`);
  }

  async callNextToken(counter_id) {
    const res = await this.request('/api/staff/call-next', {
      method: 'POST',
      body: JSON.stringify({ counter_id })
    });
    if (res && res.success && res.data) {
      this.emitLocal('token_called', res.data);
      this.emitLocal('queue_updated', { reason: 'TOKEN_CALLED' });
    }
    return res;
  }

  async recallToken(counter_id) {
    return this.request('/api/staff/recall', {
      method: 'POST',
      body: JSON.stringify({ counter_id })
    });
  }

  async completeToken(counter_id) {
    const res = await this.request('/api/staff/complete', {
      method: 'POST',
      body: JSON.stringify({ counter_id })
    });
    if (res && res.success) {
      this.emitLocal('queue_updated', { reason: 'TOKEN_COMPLETED' });
    }
    return res;
  }

  async skipToken(counter_id) {
    const res = await this.request('/api/staff/skip', {
      method: 'POST',
      body: JSON.stringify({ counter_id })
    });
    if (res && res.success) {
      this.emitLocal('queue_updated', { reason: 'TOKEN_SKIPPED' });
    }
    return res;
  }

  async transferToken(counter_id, target_category_id, reason) {
    const res = await this.request('/api/staff/transfer', {
      method: 'POST',
      body: JSON.stringify({ counter_id, target_category_id, reason })
    });
    if (res && res.success) {
      this.emitLocal('queue_updated', { reason: 'TOKEN_TRANSFERRED' });
    }
    return res;
  }

  async getLobbyData() {
    return this.request('/api/lobby');
  }

  async getAnalytics() {
    return this.request('/api/analytics');
  }

  async getSimulationStatus() {
    return this.request('/api/simulation/status');
  }

  async startSimulation() {
    return this.request('/api/simulation/start', { method: 'POST' });
  }

  async stopSimulation() {
    return this.request('/api/simulation/stop', { method: 'POST' });
  }

  async configureSimulation(config) {
    return this.request('/api/simulation/config', {
      method: 'POST',
      body: JSON.stringify(config)
    });
  }

  async triggerSurge(count = 10) {
    return this.request('/api/simulation/surge', {
      method: 'POST',
      body: JSON.stringify({ count })
    });
  }

  async resetSystem() {
    const res = await this.request('/api/system/reset', { method: 'POST' });
    if (res && res.success) {
      this.emitLocal('queue_updated', { reason: 'SYSTEM_RESET' });
    }
    return res;
  }

  /**
   * Graceful fallback when user launches file directly in browser without server
   */
  handleFallback(endpoint, options) {
    console.info(`[API Fallback] Local mock response for ${endpoint}`);
    // Basic mock responses so all tabs render seamlessly
    if (endpoint.includes('/api/categories')) {
      return {
        success: true,
        categories: [
          { id: 1, name: 'General Inquiries', code_prefix: 'A', avg_service_time_sec: 180 },
          { id: 2, name: 'Billing & Payments', code_prefix: 'B', avg_service_time_sec: 120 },
          { id: 3, name: 'Document Processing', code_prefix: 'C', avg_service_time_sec: 300 }
        ]
      };
    }
    if (endpoint.includes('/api/counters')) {
      return {
        success: true,
        counters: [
          { id: 1, counter_number: 1, status: 'OPEN', assigned_staff_name: 'Sarah Jenkins', currentToken: { token_number: 'A-102' } },
          { id: 2, counter_number: 2, status: 'OPEN', assigned_staff_name: 'David Miller', currentToken: { token_number: 'B-204' } },
          { id: 3, counter_number: 3, status: 'OPEN', assigned_staff_name: 'Elena Rostova', currentToken: null },
          { id: 4, counter_number: 4, status: 'PAUSED', assigned_staff_name: 'Marcus Vance', currentToken: null }
        ]
      };
    }
    if (endpoint.includes('/api/analytics')) {
      return {
        success: true,
        analytics: {
          kpis: {
            total_issued: 48,
            currently_waiting: 7,
            currently_serving: 2,
            total_completed: 37,
            total_no_show: 2,
            avg_wait_time_min: 4.8,
            avg_service_time_min: 2.9,
            no_show_rate_pct: 4
          },
          counter_efficiency: [
            { counter_number: 1, staff: 'Sarah Jenkins', served_count: 15 },
            { counter_number: 2, staff: 'David Miller', served_count: 14 },
            { counter_number: 3, staff: 'Elena Rostova', served_count: 8 }
          ],
          category_breakdown: [
            { id: 1, name: 'General Inquiries', prefix: 'A', total: 22, waiting: 3, avg_service_sec: 180 },
            { id: 2, name: 'Billing & Payments', prefix: 'B', total: 18, waiting: 2, avg_service_sec: 120 },
            { id: 3, name: 'Document Processing', prefix: 'C', total: 8, waiting: 2, avg_service_sec: 300 }
          ]
        }
      };
    }
    return { success: false, fallback: true };
  }
}

const api = new ApiService();
window.api = api;
