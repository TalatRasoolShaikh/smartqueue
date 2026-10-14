/**
 * Dynamic Wait-Time Estimator & Analytics Engine (SC-03 - Module D)
 * Provides:
 * 1. Interactive visualization of the Queueing Wait-Time Formula:
 *    Wait Time = (Tokens Ahead * Category Avg Service Time) / Active Counters
 * 2. Real-Time KPI Metric Cards.
 * 3. Chart.js Graphs (Counter Efficiency & Queue Volume Breakdown).
 */

class AnalyticsView {
  constructor() {
    this.chartEfficiency = null;
    this.chartCategories = null;
  }

  init() {
    this.refreshAnalytics();

    // Listen to real-time events
    window.api.on('analytics_updated', (data) => {
      this.renderAnalytics(data);
    });

    window.api.on('queue_updated', () => {
      this.refreshAnalytics();
    });
  }

  async refreshAnalytics() {
    const res = await window.api.getAnalytics();
    if (res && res.success && res.analytics) {
      this.renderAnalytics(res.analytics);
    }
  }

  renderAnalytics(analytics) {
    const { kpis, counter_efficiency, category_breakdown } = analytics;

    // Render KPI Cards
    this.renderKPI('kpi-issued', kpis.total_issued);
    this.renderKPI('kpi-waiting', kpis.currently_waiting);
    this.renderKPI('kpi-serving', kpis.currently_serving);
    this.renderKPI('kpi-completed', kpis.total_completed);
    this.renderKPI('kpi-avg-wait', `${kpis.avg_wait_time_min} <span class="text-xs text-gray-400 font-normal">min</span>`);
    this.renderKPI('kpi-avg-service', `${kpis.avg_service_time_min} <span class="text-xs text-gray-400 font-normal">min</span>`);

    // Render Interactive Formula Calculator Live Card
    this.renderFormulaLiveVariables(analytics);

    // Render Charts
    this.renderEfficiencyChart(counter_efficiency || []);
    this.renderCategoryChart(category_breakdown || []);
  }

  renderKPI(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = value;
  }

  renderFormulaLiveVariables(analytics) {
    const container = document.getElementById('formula-live-variables');
    if (!container) return;

    const kpis = analytics.kpis;
    const activeCounters = (analytics.counter_efficiency || []).filter(c => c.status === 'OPEN').length || 1;
    const avgSec = Math.round(kpis.avg_service_time_min * 60);
    const waiting = kpis.currently_waiting;
    const estimatedWait = Math.round((waiting * avgSec) / activeCounters / 60 * 10) / 10;

    container.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs">
        <div class="p-3 rounded-xl bg-gray-900/60 border border-gray-800">
          <div class="text-gray-400">Tokens Ahead (N)</div>
          <div class="text-xl font-bold text-blue-400 font-mono mt-1">${waiting}</div>
        </div>
        <div class="p-3 rounded-xl bg-gray-900/60 border border-gray-800">
          <div class="text-gray-400">Avg Service Time (S̄)</div>
          <div class="text-xl font-bold text-amber-400 font-mono mt-1">${kpis.avg_service_time_min}m</div>
        </div>
        <div class="p-3 rounded-xl bg-gray-900/60 border border-gray-800">
          <div class="text-gray-400">Open Counters (C)</div>
          <div class="text-xl font-bold text-emerald-400 font-mono mt-1">${activeCounters}</div>
        </div>
        <div class="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30">
          <div class="text-blue-300 font-medium">Computed Wait (Wq)</div>
          <div class="text-xl font-black text-white font-mono mt-1">~${estimatedWait}m</div>
        </div>
      </div>
    `;
  }

  renderEfficiencyChart(counters) {
    const canvas = document.getElementById('chart-counter-efficiency');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = counters.map(c => `Counter ${c.counter_number} (${c.staff || 'Desk'})`);
    const data = counters.map(c => c.served_count);

    if (this.chartEfficiency) {
      this.chartEfficiency.data.labels = labels;
      this.chartEfficiency.data.datasets[0].data = data;
      this.chartEfficiency.update();
      return;
    }

    const ctx = canvas.getContext('2d');
    this.chartEfficiency = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Completed Tokens',
          data: data,
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1.5,
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: '#9ca3af', stepSize: 2 },
            grid: { color: 'rgba(75, 85, 99, 0.2)' }
          },
          x: {
            ticks: { color: '#9ca3af' },
            grid: { display: false }
          }
        }
      }
    });
  }

  renderCategoryChart(categories) {
    const canvas = document.getElementById('chart-category-breakdown');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = categories.map(c => c.name);
    const data = categories.map(c => c.total);

    if (this.chartCategories) {
      this.chartCategories.data.labels = labels;
      this.chartCategories.data.datasets[0].data = data;
      this.chartCategories.update();
      return;
    }

    const ctx = canvas.getContext('2d');
    this.chartCategories = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: [
            'rgba(59, 130, 246, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(168, 85, 247, 0.8)'
          ],
          borderColor: '#111827',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#d1d5db', boxWidth: 12, font: { size: 11 } }
          }
        },
        cutout: '68%'
      }
    });
  }
}

const analyticsView = new AnalyticsView();
window.analyticsView = analyticsView;
