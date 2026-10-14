/**
 * Arrival & Service Simulator Control Panel (SC-03 - Module E)
 * Demonstrates real-time dynamic queue demand handling:
 * - Sliders: Arrival Rate, Service Speed, Active Counters Count
 * - Peak Surge Hour trigger
 * - Virtual Staff auto-service simulation
 * - Live Event Stream Log
 */

class SimulatorView {
  constructor() {
    this.logs = [];
    this.status = {
      isRunning: false,
      arrivalRatePerMin: 15,
      serviceSpeedMultiplier: 1.0,
      autoServeEnabled: true,
      activeCountersCount: 3
    };
  }

  init() {
    this.fetchStatus();

    // Listen to real-time events
    window.api.on('SIMULATION_STARTED', (status) => this.updateUIStatus(status));
    window.api.on('SIMULATION_STOPPED', (status) => this.updateUIStatus(status));
    window.api.on('SIMULATION_CONFIG_CHANGED', (status) => this.updateUIStatus(status));
    
    window.api.on('simulation_log', (entry) => {
      this.addLog(entry.message, entry.type);
    });

    window.api.on('token_called', (data) => {
      if (this.status.isRunning && data.token && data.counter) {
        this.addLog(`Counter ${data.counter.counter_number} called Token ${data.token.token_number}`, 'CALLED');
      }
    });

    window.api.on('queue_updated', (data) => {
      if (data.reason === 'SIM_TOKEN_COMPLETED' && data.completedData) {
        this.addLog(`Completed Token ${data.completedData.token?.token_number} (${data.completedData.serviceDurationSec}s)`, 'COMPLETED');
      }
    });
  }

  async fetchStatus() {
    const res = await window.api.getSimulationStatus();
    if (res && res.success && res.status) {
      this.updateUIStatus(res.status);
    }
  }

  updateUIStatus(status) {
    this.status = { ...this.status, ...status };

    const badge = document.getElementById('sim-status-badge');
    const startBtn = document.getElementById('btn-sim-toggle');
    const arrivalSlider = document.getElementById('sim-slider-arrival');
    const arrivalVal = document.getElementById('sim-val-arrival');
    const speedSlider = document.getElementById('sim-slider-speed');
    const speedVal = document.getElementById('sim-val-speed');
    const countersSlider = document.getElementById('sim-slider-counters');
    const countersVal = document.getElementById('sim-val-counters');
    const autoServeCheck = document.getElementById('sim-check-autoserve');

    if (badge) {
      if (this.status.isRunning) {
        badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse';
        badge.innerHTML = '● SIMULATOR ACTIVE';
      } else {
        badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-gray-700/40 text-gray-400 border border-gray-600/40';
        badge.innerHTML = '○ SIMULATOR PAUSED';
      }
    }

    if (startBtn) {
      startBtn.innerHTML = this.status.isRunning ? '⏸ Pause Simulation' : '▶ Start Simulation';
      startBtn.className = this.status.isRunning 
        ? 'px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm transition-all shadow-lg shadow-amber-600/30'
        : 'px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all shadow-lg shadow-emerald-600/30';
    }

    if (arrivalSlider) arrivalSlider.value = this.status.arrivalRatePerMin;
    if (arrivalVal) arrivalVal.innerText = `${this.status.arrivalRatePerMin} arrivals / min`;

    if (speedSlider) speedSlider.value = this.status.serviceSpeedMultiplier;
    if (speedVal) speedVal.innerText = `${this.status.serviceSpeedMultiplier}x`;

    if (countersSlider) countersSlider.value = this.status.activeCountersCount;
    if (countersVal) countersVal.innerText = `${this.status.activeCountersCount} Counters Open`;

    if (autoServeCheck) autoServeCheck.checked = this.status.autoServeEnabled;
  }

  async toggleSimulation() {
    if (this.status.isRunning) {
      await window.api.stopSimulation();
      this.addLog('Simulation paused by operator.', 'SYSTEM');
    } else {
      await window.api.startSimulation();
      this.addLog('Simulation started. Virtual demand engine active.', 'SYSTEM');
    }
  }

  async onArrivalRateChange(val) {
    const arrivalRate = Number(val);
    document.getElementById('sim-val-arrival').innerText = `${arrivalRate} arrivals / min`;
    await window.api.configureSimulation({ arrivalRatePerMin: arrivalRate });
    this.addLog(`Adjusted Arrival Rate to ${arrivalRate} arrivals/min.`, 'CONFIG');
  }

  async onSpeedChange(val) {
    const speed = parseFloat(val);
    document.getElementById('sim-val-speed').innerText = `${speed.toFixed(1)}x`;
    await window.api.configureSimulation({ serviceSpeedMultiplier: speed });
    this.addLog(`Adjusted Service Speed to ${speed.toFixed(1)}x.`, 'CONFIG');
  }

  async onCountersChange(val) {
    const count = Number(val);
    document.getElementById('sim-val-counters').innerText = `${count} Counters Open`;
    await window.api.configureSimulation({ activeCountersCount: count });
    this.addLog(`Dynamic Load Balancing: Now ${count} active counters open. Recalculating wait times.`, 'CONFIG');
  }

  async onAutoServeChange(checked) {
    await window.api.configureSimulation({ autoServeEnabled: checked });
    this.addLog(`Virtual Staff Auto-Serve ${checked ? 'Enabled' : 'Disabled'}.`, 'CONFIG');
  }

  async triggerSurge(count = 10) {
    const btn = document.getElementById('btn-sim-surge');
    if (btn) {
      btn.disabled = true;
      btn.innerText = '⚡ Generating Surge...';
    }

    await window.api.triggerSurge(count);
    this.addLog(`⚡ PEAK SURGE TRIGGERED: ${count} citizens joined the queue at once! Notice wait time spike.`, 'SURGE');

    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerText = '⚡ Trigger Peak Surge (10 arrivals)';
      }
    }, 1500);
  }

  async resetAll() {
    if (confirm('Reset entire queue system back to baseline demo state?')) {
      await window.api.resetSystem();
      this.logs = [];
      this.renderLogs();
      this.addLog('Queue state and counters restored to baseline seeds.', 'SYSTEM');
    }
  }

  addLog(message, type = 'INFO') {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.logs.unshift({ time, message, type });
    if (this.logs.length > 50) this.logs.pop();
    this.renderLogs();
  }

  renderLogs() {
    const container = document.getElementById('sim-events-log');
    if (!container) return;

    if (this.logs.length === 0) {
      container.innerHTML = '<div class="text-xs text-gray-500 py-4 text-center">No simulation events yet. Start the simulation or trigger a surge.</div>';
      return;
    }

    container.innerHTML = this.logs.map(log => {
      let badgeColor = 'bg-gray-800 text-gray-300';
      if (log.type === 'SURGE') badgeColor = 'bg-purple-900/60 text-purple-300 border border-purple-500/40';
      else if (log.type === 'ARRIVAL') badgeColor = 'bg-blue-900/60 text-blue-300 border border-blue-500/40';
      else if (log.type === 'CALLED') badgeColor = 'bg-emerald-900/60 text-emerald-300 border border-emerald-500/40';
      else if (log.type === 'COMPLETED') badgeColor = 'bg-teal-900/60 text-teal-300 border border-teal-500/40';
      else if (log.type === 'CONFIG') badgeColor = 'bg-amber-900/60 text-amber-300 border border-amber-500/40';

      return `
        <div class="flex items-start gap-2.5 py-1.5 border-b border-gray-800/60 text-xs font-mono">
          <span class="text-gray-500 shrink-0">[${log.time}]</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${badgeColor}">${log.type}</span>
          <span class="text-gray-300 flex-1">${log.message}</span>
        </div>
      `;
    }).join('');
  }
}

const simulatorView = new SimulatorView();
window.simulatorView = simulatorView;
