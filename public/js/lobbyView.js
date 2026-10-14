/**
 * Public Display / Lobby Board Module (SC-03 - Module B)
 * Full-screen high-contrast TV display for civic centers, hospitals, and public service halls.
 * Displays:
 * 1. Active Counters matrix with currently served tokens.
 * 2. Next 5 upcoming tokens in queue per category.
 * 3. Audio Chime ("Ding-Dong") + Vocal Speech announcement on calls.
 */

class LobbyView {
  constructor() {
    this.clockInterval = null;
    this.lastCalledTokenId = null;
  }

  init() {
    this.startClock();
    this.refreshLobby();

    // Listen to real-time events
    window.api.on('queue_updated', () => {
      this.refreshLobby();
    });

    window.api.on('token_called', (data) => {
      this.handleTokenCalled(data);
    });
  }

  startClock() {
    const updateTime = () => {
      const clockEl = document.getElementById('lobby-live-clock');
      const dateEl = document.getElementById('lobby-live-date');
      if (clockEl) {
        const now = new Date();
        clockEl.innerText = now.toLocaleTimeString('en-US', { hour12: false });
      }
      if (dateEl) {
        const now = new Date();
        dateEl.innerText = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      }
    };

    updateTime();
    if (this.clockInterval) clearInterval(this.clockInterval);
    this.clockInterval = setInterval(updateTime, 1000);
  }

  async refreshLobby() {
    const res = await window.api.getLobbyData();
    if (!res || !res.success) return;

    this.renderCounters(res.counters || []);
    this.renderUpcoming(res.upcomingByCategory || []);
  }

  renderCounters(counters) {
    const container = document.getElementById('lobby-counters-grid');
    if (!container) return;

    if (counters.length === 0) {
      container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-10">No active counters.</div>';
      return;
    }

    container.innerHTML = counters.map(c => {
      const isOpen = c.status === 'OPEN';
      const isPaused = c.status === 'PAUSED';
      const isServing = isOpen && c.currentToken;
      const isRecentlyCalled = isServing && c.currentToken.id === this.lastCalledTokenId;

      let statusBadge = '';
      if (isOpen) {
        statusBadge = isServing 
          ? `<span class="px-3 py-1 text-xs font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">● SERVING</span>`
          : `<span class="px-3 py-1 text-xs font-semibold rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">IDLE / READY</span>`;
      } else if (isPaused) {
        statusBadge = `<span class="px-3 py-1 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">PAUSED</span>`;
      } else {
        statusBadge = `<span class="px-3 py-1 text-xs font-semibold rounded-full bg-red-500/20 text-red-400 border border-red-500/30">CLOSED</span>`;
      }

      return `
        <div class="glass-card rounded-2xl p-6 border transition-all duration-300 relative overflow-hidden ${
          isRecentlyCalled ? 'border-emerald-400 glow-success called-pulse' : 'border-gray-800'
        } ${!isOpen ? 'opacity-50' : ''}">
          
          <div class="flex items-center justify-between mb-4 border-b border-gray-800/80 pb-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full ${isOpen ? 'bg-emerald-400' : isPaused ? 'bg-amber-400' : 'bg-red-500'}"></span>
              <h3 class="font-display font-bold text-2xl text-white tracking-wide">COUNTER ${c.counter_number}</h3>
            </div>
            ${statusBadge}
          </div>

          <div class="py-4 text-center">
            <div class="text-xs uppercase tracking-widest text-gray-400 mb-1 font-semibold">Now Serving</div>
            <div class="font-display font-extrabold text-5xl md:text-6xl text-white tracking-wider token-badge my-1">
              ${isServing ? c.currentToken.token_number : '<span class="text-gray-600 text-4xl">---</span>'}
            </div>
            <div class="text-xs text-gray-400 mt-2 flex items-center justify-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7 7z"></path></svg>
              <span>Staff: <strong class="text-gray-300">${c.assigned_staff_name || 'Desk Officer'}</strong></span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderUpcoming(upcomingByCategory) {
    const container = document.getElementById('lobby-upcoming-columns');
    if (!container) return;

    if (upcomingByCategory.length === 0) {
      container.innerHTML = '<div class="text-gray-500 text-sm">No upcoming tokens.</div>';
      return;
    }

    container.innerHTML = upcomingByCategory.map(cat => {
      const tokensList = cat.tokens && cat.tokens.length > 0 
        ? cat.tokens.map((t, idx) => `
            <div class="flex items-center justify-between p-3 rounded-lg bg-gray-900/60 border border-gray-800/80 hover:border-gray-700 transition-colors">
              <div class="flex items-center gap-3">
                <span class="w-6 h-6 rounded-md bg-blue-500/10 text-blue-400 text-xs font-bold flex items-center justify-center">${idx + 1}</span>
                <span class="font-mono font-bold text-lg text-white">${t.token_number}</span>
              </div>
              <span class="text-xs text-gray-400 font-medium">~${t.estimated_wait_min}m</span>
            </div>
          `).join('')
        : `<div class="p-6 text-center text-xs text-gray-500 border border-dashed border-gray-800 rounded-lg">No tokens waiting</div>`;

      return `
        <div class="glass-card rounded-2xl p-5 border border-gray-800 flex flex-col">
          <div class="flex items-center justify-between mb-4 border-b border-gray-800/80 pb-3">
            <div>
              <h4 class="font-bold text-white text-base">${cat.categoryName}</h4>
              <span class="text-xs text-blue-400">Prefix [${cat.prefix}]</span>
            </div>
            <span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              ${cat.tokens ? cat.tokens.length : 0} in line
            </span>
          </div>

          <div class="space-y-2.5 flex-1">
            ${tokensList}
          </div>
        </div>
      `;
    }).join('');
  }

  handleTokenCalled(data) {
    if (!data || !data.token || !data.counter) return;

    this.lastCalledTokenId = data.token.id;
    this.refreshLobby();

    // Trigger audible chime + Speech announcement
    const tokenNumber = data.token.token_number;
    const counterNumber = data.counter.counter_number;
    window.audioEngine?.announceToken(tokenNumber, counterNumber);

    // Show temporary overlay banner in the lobby board
    const banner = document.getElementById('lobby-call-flash-banner');
    if (banner) {
      banner.innerHTML = `
        <div class="flex items-center justify-center gap-4 py-3 px-6 bg-emerald-500 text-slate-950 font-bold text-lg md:text-xl rounded-xl shadow-2xl animate-bounce">
          <span>🔔 ATTENTION:</span>
          <span>Token <strong class="underline decoration-2">${tokenNumber}</strong></span>
          <span>➔ Proceed to <strong class="underline decoration-2">Counter ${counterNumber}</strong></span>
        </div>
      `;
      banner.classList.remove('hidden');

      setTimeout(() => {
        banner.classList.add('hidden');
      }, 7000);
    }
  }

  toggleAudio() {
    if (!window.audioEngine) return;
    window.audioEngine.soundEnabled = !window.audioEngine.soundEnabled;
    window.audioEngine.speechEnabled = window.audioEngine.soundEnabled;

    const btn = document.getElementById('btn-lobby-audio-toggle');
    if (btn) {
      btn.innerText = window.audioEngine.soundEnabled ? '🔊 Audio ON' : '🔇 Audio Muted';
      btn.className = window.audioEngine.soundEnabled 
        ? 'px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 text-xs font-semibold hover:bg-emerald-600/30'
        : 'px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-500/40 text-red-400 text-xs font-semibold hover:bg-red-600/30';
    }

    if (window.audioEngine.soundEnabled) {
      window.audioEngine.playChime();
    }
  }

  testAudioAnnouncement() {
    window.audioEngine?.announceToken('A-101', '1');
  }
}

const lobbyView = new LobbyView();
window.lobbyView = lobbyView;
