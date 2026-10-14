/**
 * Citizen Interface Module (SC-03 - Module A)
 * 1. Check-In & Token Generation with Dynamic QR Code
 * 2. Live Token Tracking Page (Position, Wait Time, Counter Info, Proximity Alert)
 */

class CitizenView {
  constructor() {
    this.activeTokenNumber = null;
    this.trackingInterval = null;
    this.hasAlertedProximity = false;
    this.hasAlertedServing = false;
  }

  init() {
    // Check URL parameters for existing token
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      this.activeTokenNumber = tokenFromUrl;
      this.showTrackingMode();
    } else {
      this.loadCategories();
    }

    // Subscribe to socket queue updates
    window.api.on('queue_updated', () => {
      if (this.activeTokenNumber) {
        this.refreshTracking();
      }
    });

    window.api.on('token_called', (data) => {
      if (this.activeTokenNumber && data.token && data.token.token_number === this.activeTokenNumber) {
        this.handleCalledAlert(data);
      }
    });
  }

  async loadCategories() {
    const res = await window.api.getCategories();
    const container = document.getElementById('citizen-category-list');
    if (!container) return;

    if (!res || !res.categories) {
      container.innerHTML = '<p class="text-gray-400">Loading service categories...</p>';
      return;
    }

    container.innerHTML = res.categories.map(cat => `
      <label class="category-card relative flex items-center p-4 border border-gray-700/60 rounded-xl cursor-pointer hover:border-blue-500/80 transition-all bg-gray-900/40 hover:bg-blue-950/20 group">
        <input type="radio" name="selected_category" value="${cat.id}" class="sr-only peer" ${cat.id === 1 ? 'checked' : ''}>
        <div class="w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center font-bold text-xl text-blue-400 mr-4 group-hover:scale-105 transition-transform peer-checked:bg-blue-600 peer-checked:text-white">
          ${cat.code_prefix}
        </div>
        <div class="flex-1">
          <div class="flex items-center justify-between">
            <h4 class="font-semibold text-white text-base">${cat.name}</h4>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Prefix [${cat.code_prefix}]</span>
          </div>
          <p class="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Avg. Service: ~${Math.round(cat.avg_service_time_sec / 60)} mins
          </p>
        </div>
        <div class="absolute right-4 w-5 h-5 rounded-full border-2 border-gray-600 peer-checked:border-blue-500 peer-checked:bg-blue-500 flex items-center justify-center transition-all">
          <svg class="w-3 h-3 text-white hidden peer-checked:block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
        </div>
      </label>
    `).join('');
  }

  async handleIssueToken(e) {
    if (e) e.preventDefault();

    const selectedRadio = document.querySelector('input[name="selected_category"]:checked');
    if (!selectedRadio) {
      alert('Please select a service category.');
      return;
    }

    const categoryId = Number(selectedRadio.value);
    const citizenName = document.getElementById('citizen-name-input')?.value.trim() || 'Citizen';
    const citizenPhone = document.getElementById('citizen-phone-input')?.value.trim() || '';

    const btn = document.getElementById('btn-issue-token');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="inline-block animate-spin mr-2">⟳</span> Generating Digital Token...`;
    }

    try {
      const res = await window.api.createToken(categoryId, citizenName, citizenPhone);
      if (res && res.success) {
        this.activeTokenNumber = res.token.token_number;
        // Request notification permission smoothly
        if (window.audioEngine) {
          window.audioEngine.requestNotificationPermission();
          window.audioEngine.playChime();
        }
        this.showTrackingMode();
      } else {
        alert(res?.error || 'Could not issue token.');
      }
    } catch (err) {
      console.error(err);
      alert('Network error while issuing token.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `🎫 Generate Digital Token`;
      }
    }
  }

  showTrackingMode() {
    const kioskSection = document.getElementById('citizen-kiosk-section');
    const trackerSection = document.getElementById('citizen-tracker-section');
    if (kioskSection) kioskSection.classList.add('hidden');
    if (trackerSection) trackerSection.classList.remove('hidden');

    this.refreshTracking();
    if (this.trackingInterval) clearInterval(this.trackingInterval);
    this.trackingInterval = setInterval(() => this.refreshTracking(), 5000);
  }

  showKioskMode() {
    if (this.trackingInterval) clearInterval(this.trackingInterval);
    this.activeTokenNumber = null;
    this.hasAlertedProximity = false;
    this.hasAlertedServing = false;

    const kioskSection = document.getElementById('citizen-kiosk-section');
    const trackerSection = document.getElementById('citizen-tracker-section');
    if (kioskSection) kioskSection.classList.remove('hidden');
    if (trackerSection) trackerSection.classList.add('hidden');
    this.loadCategories();
  }

  async refreshTracking() {
    if (!this.activeTokenNumber) return;

    const res = await window.api.getTokenStatus(this.activeTokenNumber);
    if (!res || !res.success || !res.tracking) {
      const posTextEl = document.getElementById('tracker-position-text');
      if (posTextEl) {
        posTextEl.innerHTML = '<span class="text-red-400 font-semibold">Token not found or already completed.</span>';
      }
      return;
    }

    const t = res.tracking;
    this.renderTrackingUI(t);
  }

  renderTrackingUI(data) {
    const { token, category, position, tokensAhead, estimated_wait_min, now_serving_token, now_serving_counter, is_proximity_alert, is_serving_now } = data;

    // Token Header
    const numberEl = document.getElementById('tracker-token-number');
    if (numberEl) numberEl.innerText = token.token_number;

    const catEl = document.getElementById('tracker-category-name');
    if (catEl) catEl.innerText = category ? `${category.name} (${category.code_prefix})` : 'Public Service';

    const citizenEl = document.getElementById('tracker-citizen-name');
    if (citizenEl) citizenEl.innerText = token.citizen_name || 'Guest Citizen';

    // Position & Ahead
    const posBadge = document.getElementById('tracker-position-badge');
    const posText = document.getElementById('tracker-position-text');
    const waitTimeEl = document.getElementById('tracker-wait-time');
    const servingInfoEl = document.getElementById('tracker-now-serving-info');

    if (posBadge) {
      if (token.status === 'WAITING') {
        posBadge.innerText = position === 1 ? '1st in Line' : `#${position}`;
      } else if (token.status === 'SERVING') {
        posBadge.innerText = 'NOW SERVING';
      } else {
        posBadge.innerText = token.status;
      }
    }

    if (posText) {
      if (token.status === 'WAITING') {
        posText.innerHTML = tokensAhead === 0 
          ? `<span class="text-emerald-400 font-semibold">You're next in line!</span> Please stay near the counters.`
          : `<span class="text-blue-400 font-bold">${tokensAhead}</span> citizen${tokensAhead > 1 ? 's' : ''} ahead of you.`;
      } else if (token.status === 'SERVING') {
        posText.innerHTML = `<span class="text-emerald-400 font-bold">Please proceed to ${now_serving_counter}!</span>`;
      } else {
        posText.innerHTML = `Token status: <span class="uppercase font-semibold">${token.status}</span>`;
      }
    }

    if (waitTimeEl) {
      if (token.status === 'WAITING') {
        waitTimeEl.innerHTML = `~${estimated_wait_min} <span class="text-sm font-normal text-gray-400">mins</span>`;
      } else if (token.status === 'SERVING') {
        waitTimeEl.innerHTML = `<span class="text-emerald-400 text-lg">0 mins (Turn arrived)</span>`;
      } else {
        waitTimeEl.innerHTML = `<span class="text-gray-500 text-lg">Completed</span>`;
      }
    }

    if (servingInfoEl) {
      servingInfoEl.innerText = `${now_serving_counter} is serving ${now_serving_token}`;
    }

    // Render QR Code (scannable tracking URL)
    this.renderQRCode(token.token_number);

    // Dynamic Alert Banner Logic (Proximity Alert when position <= 2)
    const alertBanner = document.getElementById('tracker-proximity-alert');
    if (alertBanner) {
      if (is_serving_now) {
        alertBanner.className = 'p-4 rounded-xl border border-emerald-500/60 bg-emerald-950/40 text-emerald-300 flex items-center gap-3 glow-success';
        alertBanner.innerHTML = `
          <div class="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 text-emerald-400">
            <svg class="w-6 h-6 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
          </div>
          <div>
            <div class="font-bold text-base text-white">YOUR TOKEN IS BEING CALLED!</div>
            <div class="text-xs text-emerald-200">Please proceed directly to <strong>${now_serving_counter}</strong>.</div>
          </div>
        `;
        alertBanner.classList.remove('hidden');

        if (!this.hasAlertedServing) {
          this.hasAlertedServing = true;
          window.audioEngine?.announceToken(token.token_number, now_serving_counter.replace('Counter ', ''));
          window.audioEngine?.sendNotification('Turn Arrived!', `Token ${token.token_number}: Proceed to ${now_serving_counter}`);
        }
      } else if (is_proximity_alert) {
        alertBanner.className = 'p-4 rounded-xl border border-amber-500/60 bg-amber-950/40 text-amber-300 flex items-center gap-3 glow-amber';
        alertBanner.innerHTML = `
          <div class="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 text-amber-400">
            <svg class="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          </div>
          <div>
            <div class="font-bold text-base text-white">PROXIMITY ALERT: 2 POSITIONS AWAY!</div>
            <div class="text-xs text-amber-200">You are near the front of the queue. Please return to the waiting lounge area.</div>
          </div>
        `;
        alertBanner.classList.remove('hidden');

        if (!this.hasAlertedProximity) {
          this.hasAlertedProximity = true;
          window.audioEngine?.playProximityBeep();
          window.audioEngine?.sendNotification('Queue Proximity Alert', `Token ${token.token_number} is 2 positions away from your turn!`);
        }
      } else {
        alertBanner.classList.add('hidden');
      }
    }
  }

  renderQRCode(tokenNumber) {
    const qrContainer = document.getElementById('tracker-qrcode-canvas');
    if (!qrContainer) return;

    // Clear previous QR
    qrContainer.innerHTML = '';

    // Generate dynamic QR code if QRCode library is available
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrContainer, {
        text: `${window.location.origin}${window.location.pathname}?token=${encodeURIComponent(tokenNumber)}`,
        width: 125,
        height: 125,
        colorDark: '#090d16',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      // Clean fallback graphic if QRCode library is loading
      qrContainer.innerHTML = `
        <div class="w-[130px] h-[130px] border border-blue-500/30 rounded-lg p-2 bg-slate-900/90 flex flex-col items-center justify-center text-center">
          <div class="text-xs font-mono font-bold text-blue-400">${tokenNumber}</div>
          <div class="text-[9px] text-gray-400 mt-1">Mobile Scan Ready</div>
        </div>
      `;
    }
  }

  handleCalledAlert(data) {
    this.refreshTracking();
  }

  lookupToken() {
    const input = document.getElementById('citizen-lookup-input');
    const val = input ? input.value.trim().toUpperCase() : '';
    if (!val) {
      alert('Please enter a token number (e.g. A-101).');
      return;
    }
    this.activeTokenNumber = val;
    this.showTrackingMode();
  }
}

const citizenView = new CitizenView();
window.citizenView = citizenView;
