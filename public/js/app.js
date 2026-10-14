/**
 * Main Application Orchestrator (SC-03)
 * Coordinates tab switching, role views, audio permissions, and global event routing.
 */

class App {
  constructor() {
    this.currentTab = 'citizen';
  }

  init() {
    // Check initial tab from hash or default to citizen
    const hash = window.location.hash.replace('#', '');
    if (['citizen', 'lobby', 'staff', 'analytics', 'simulator'].includes(hash)) {
      this.currentTab = hash;
    }

    this.switchTab(this.currentTab);

    // Initialize all modular views
    window.citizenView?.init();
    window.lobbyView?.init();
    window.staffView?.init();
    window.analyticsView?.init();
    window.simulatorView?.init();

    // Connection listener
    window.api?.on('connection_status', (status) => {
      this.updateConnectionBadge(status.connected);
    });

    // Global click listener to unlock Web Audio API on first user interaction
    document.addEventListener('click', () => {
      if (window.audioEngine) {
        window.audioEngine.initAudioContext();
      }
    }, { once: true });
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    window.location.hash = tabId;

    // Toggle tab navigation button styles
    const navButtons = document.querySelectorAll('.nav-tab-btn');
    navButtons.forEach(btn => {
      const target = btn.getAttribute('data-tab');
      if (target === tabId) {
        btn.classList.add('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-600/30');
        btn.classList.remove('text-gray-400', 'hover:text-white', 'hover:bg-gray-800/60');
      } else {
        btn.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-600/30');
        btn.classList.add('text-gray-400', 'hover:text-white', 'hover:bg-gray-800/60');
      }
    });

    // Toggle tab panels
    const tabPanels = document.querySelectorAll('.tab-panel');
    tabPanels.forEach(panel => {
      if (panel.id === `tab-${tabId}`) {
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    });

    // Trigger tab-specific refresh if needed
    if (tabId === 'lobby') {
      window.lobbyView?.refreshLobby();
    } else if (tabId === 'staff') {
      window.staffView?.refreshDashboard();
    } else if (tabId === 'analytics') {
      window.analyticsView?.refreshAnalytics();
    } else if (tabId === 'simulator') {
      window.simulatorView?.fetchStatus();
    }
  }

  updateConnectionBadge(isConnected) {
    const badge = document.getElementById('connection-status-pill');
    if (!badge) return;

    if (isConnected) {
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> <span class="text-xs text-emerald-400 font-semibold">Live Real-Time Sync</span>`;
      badge.className = 'flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-500/30';
    } else {
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span> <span class="text-xs text-blue-300 font-semibold">Live Auto-Sync (Cloud)</span>`;
      badge.className = 'flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950/40 border border-blue-500/30';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});
