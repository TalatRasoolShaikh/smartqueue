/**
 * Staff / Operator Dashboard Module (SC-03 - Module C)
 * Counter Controller & Real-Time Queue Operations.
 * Actions:
 * - Counter Selection & Status Toggle (OPEN, PAUSED, CLOSED)
 * - Call Next Token (FIFO Priority)
 * - Mark Completed (Calculates service duration and adjusts rolling average)
 * - Mark No-Show / Skip
 * - Transfer Token to another category
 */

class StaffView {
  constructor() {
    this.selectedCounterId = 1;
    this.currentCounter = null;
    this.serviceTimerInterval = null;
    this.serviceStartTime = null;
  }

  init() {
    this.loadCounters();

    // Subscribe to socket queue events
    window.api.on('queue_updated', () => {
      this.refreshDashboard();
    });

    // Transfer Modal Category Options
    this.loadTransferCategories();
  }

  async loadCounters() {
    const res = await window.api.getCounters();
    if (!res || !res.counters) return;

    const selectEl = document.getElementById('staff-counter-select');
    if (selectEl) {
      selectEl.innerHTML = res.counters.map(c => `
        <option value="${c.id}" ${c.id === this.selectedCounterId ? 'selected' : ''}>
          Counter ${c.counter_number} (${c.status}) - ${c.assigned_staff_name || 'Unassigned'}
        </option>
      `).join('');

      selectEl.onchange = (e) => {
        this.selectedCounterId = Number(e.target.value);
        this.refreshDashboard();
      };
    }

    this.refreshDashboard();
  }

  async refreshDashboard() {
    const res = await window.api.getCounters();
    if (!res || !res.counters) return;

    const counter = res.counters.find(c => c.id === this.selectedCounterId);
    if (!counter) return;

    this.currentCounter = counter;
    this.renderCounterHeader(counter);
    this.renderCurrentServing(counter);
    this.renderWaitingQueue(counter);
  }

  renderCounterHeader(counter) {
    const staffNameInput = document.getElementById('staff-name-input');
    if (staffNameInput && document.activeElement !== staffNameInput) {
      staffNameInput.value = counter.assigned_staff_name || '';
    }

    const badge = document.getElementById('staff-counter-status-badge');
    if (badge) {
      if (counter.status === 'OPEN') {
        badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
        badge.innerText = 'STATUS: OPEN';
      } else if (counter.status === 'PAUSED') {
        badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40';
        badge.innerText = 'STATUS: PAUSED';
      } else {
        badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/40';
        badge.innerText = 'STATUS: CLOSED';
      }
    }
  }

  renderCurrentServing(counter) {
    const cardContainer = document.getElementById('staff-serving-card');
    const token = counter.currentToken;

    if (!token) {
      // Idle state
      if (this.serviceTimerInterval) clearInterval(this.serviceTimerInterval);
      this.serviceStartTime = null;

      cardContainer.innerHTML = `
        <div class="p-8 text-center border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/30">
          <div class="w-14 h-14 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto mb-3">
            <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
          </div>
          <h4 class="text-lg font-semibold text-white">Counter is Idle</h4>
          <p class="text-xs text-gray-400 mt-1 max-w-sm mx-auto">Ready to serve the next waiting citizen. Click below to fetch the highest priority token.</p>
          <div class="mt-6 flex justify-center gap-3">
            <button onclick="window.staffView.callNext()" class="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-600/30 flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
              Call Next Token
            </button>
          </div>
        </div>
      `;
      return;
    }

    // Active serving state
    if (!this.serviceStartTime) {
      this.serviceStartTime = token.called_at ? new Date(token.called_at).getTime() : Date.now();
    }

    cardContainer.innerHTML = `
      <div class="glass-card rounded-2xl p-6 border border-emerald-500/40 bg-emerald-950/20 relative overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-4 border-b border-gray-800 pb-4">
          <div>
            <span class="text-xs font-semibold uppercase tracking-wider text-emerald-400">CURRENT CITIZEN TRANSACTION</span>
            <div class="font-display font-black text-5xl text-white token-badge tracking-wider mt-1">${token.token_number}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-gray-400 font-medium">Service Duration</div>
            <div id="staff-service-timer" class="font-mono text-2xl font-bold text-emerald-400 mt-0.5">00:00</div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 my-5 text-sm">
          <div class="p-3 rounded-xl bg-gray-900/60 border border-gray-800">
            <div class="text-xs text-gray-400">Citizen Name</div>
            <div class="font-semibold text-white mt-0.5">${token.citizen_name || 'Guest Citizen'}</div>
          </div>
          <div class="p-3 rounded-xl bg-gray-900/60 border border-gray-800">
            <div class="text-xs text-gray-400">Contact</div>
            <div class="font-semibold text-white mt-0.5">${token.citizen_phone || 'None provided'}</div>
          </div>
          <div class="p-3 rounded-xl bg-gray-900/60 border border-gray-800">
            <div class="text-xs text-gray-400">Category</div>
            <div class="font-semibold text-blue-400 mt-0.5">Category ${token.category_id}</div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-wrap items-center gap-3 pt-2">
          <button onclick="window.staffView.completeToken()" class="flex-1 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            Mark as Completed
          </button>

          <button onclick="window.staffView.recallToken()" class="px-4 py-3 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-semibold text-sm transition-all flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
            Re-Announce
          </button>

          <button onclick="window.staffView.openTransferModal()" class="px-4 py-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-semibold text-sm transition-all flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
            Transfer
          </button>

          <button onclick="window.staffView.skipToken()" class="px-4 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 font-semibold text-sm transition-all flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            No-Show / Skip
          </button>
        </div>
      </div>
    `;

    // Start ticker
    this.startServiceTimer();
  }

  startServiceTimer() {
    if (this.serviceTimerInterval) clearInterval(this.serviceTimerInterval);
    const update = () => {
      const timerEl = document.getElementById('staff-service-timer');
      if (!timerEl || !this.serviceStartTime) return;
      const elapsedSec = Math.floor((Date.now() - this.serviceStartTime) / 1000);
      const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const secs = String(elapsedSec % 60).padStart(2, '0');
      timerEl.innerText = `${mins}:${secs}`;
    };
    update();
    this.serviceTimerInterval = setInterval(update, 1000);
  }

  async renderWaitingQueue(counter) {
    const queueTableBody = document.getElementById('staff-queue-table-body');
    if (!queueTableBody) return;

    // Fetch waiting tokens
    const allTokensRes = await window.api.request('/api/tokens');
    let waitingTokens = (allTokensRes && allTokensRes.tokens)
      ? allTokensRes.tokens.filter(t => t.status === 'WAITING')
      : [];

    // Filter to categories this counter handles
    if (counter && counter.categories_handled && counter.categories_handled.length > 0) {
      waitingTokens = waitingTokens.filter(t => counter.categories_handled.includes(t.category_id));
    }

    if (waitingTokens.length === 0) {
      queueTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-8 text-gray-500 text-sm">No citizens currently waiting in line.</td>
        </tr>
      `;
      return;
    }

    queueTableBody.innerHTML = waitingTokens.map((t, idx) => {
      const waitMinutes = Math.max(1, Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000));
      return `
        <tr class="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
          <td class="py-3 px-4 font-bold text-gray-400">#${idx + 1}</td>
          <td class="py-3 px-4 font-mono font-bold text-white">${t.token_number}</td>
          <td class="py-3 px-4 text-gray-300 text-xs">${t.citizen_name || 'Guest'}</td>
          <td class="py-3 px-4 text-xs text-amber-400 font-medium">${waitMinutes} mins ago</td>
          <td class="py-3 px-4 text-xs text-blue-400 font-semibold">~${t.estimated_wait_min}m est.</td>
        </tr>
      `;
    }).join('');
  }

  async setCounterStatus(status) {
    if (!this.currentCounter) return;
    await window.api.updateCounter(this.selectedCounterId, { status });
    this.refreshDashboard();
  }

  async saveStaffName() {
    const input = document.getElementById('staff-name-input');
    const name = input ? input.value.trim() : '';
    if (!name) return;
    await window.api.updateCounter(this.selectedCounterId, { assigned_staff_name: name });
    this.refreshDashboard();
  }

  async callNext() {
    const res = await window.api.callNextToken(this.selectedCounterId);
    if (!res || !res.success) {
      alert(res?.error || res?.message || 'Could not call next token.');
      return;
    }
    this.refreshDashboard();
  }

  async recallToken() {
    const res = await window.api.recallToken(this.selectedCounterId);
    if (res && res.success) {
      if (!window.api.isServerConnected && this.currentCounter?.currentToken) {
        window.audioEngine?.announceToken(this.currentCounter.currentToken.token_number, this.currentCounter.counter_number);
      }
    } else {
      alert(res?.error || 'Recall failed.');
    }
  }

  async completeToken() {
    const res = await window.api.completeToken(this.selectedCounterId);
    if (!res || !res.success) {
      alert(res?.error || 'Could not complete token.');
      return;
    }
    this.refreshDashboard();
  }

  async skipToken() {
    const res = await window.api.skipToken(this.selectedCounterId);
    if (!res || !res.success) {
      alert(res?.error || 'Could not skip token.');
      return;
    }
    this.refreshDashboard();
  }

  async loadTransferCategories() {
    const res = await window.api.getCategories();
    const selectEl = document.getElementById('transfer-category-select');
    if (!selectEl || !res || !res.categories) return;

    selectEl.innerHTML = res.categories.map(c => `
      <option value="${c.id}">${c.name} [Prefix ${c.code_prefix}]</option>
    `).join('');
  }

  openTransferModal() {
    const modal = document.getElementById('transfer-modal');
    if (modal) modal.classList.remove('hidden');
  }

  closeTransferModal() {
    const modal = document.getElementById('transfer-modal');
    if (modal) modal.classList.add('hidden');
  }

  async submitTransfer() {
    const targetCatId = document.getElementById('transfer-category-select')?.value;
    const reason = document.getElementById('transfer-reason-input')?.value || 'Department Referral';

    const res = await window.api.transferToken(this.selectedCounterId, targetCatId, reason);
    this.closeTransferModal();
    if (!res || !res.success) {
      alert(res?.error || 'Could not transfer token.');
    } else {
      this.refreshDashboard();
    }
  }
}

const staffView = new StaffView();
window.staffView = staffView;
