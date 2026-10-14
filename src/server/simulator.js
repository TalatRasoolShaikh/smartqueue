/**
 * Arrival & Service Simulator Module (SC-03)
 * 
 * Simulates real-time public service arrivals and dynamic queue load handling.
 * Demonstrates how wait times react to:
 * 1. Customer arrival surges (5 to 50 arrivals/min).
 * 2. Service speed adjustments (0.5x - 3.0x).
 * 3. Dynamic counter opening / closing (load balancing).
 */

const db = require('./db');
const queueEngine = require('./queueEngine');

class QueueSimulator {
  constructor() {
    this.isRunning = false;
    this.arrivalRatePerMin = 15; // default 15 arrivals/min
    this.serviceSpeedMultiplier = 1.0; // 1.0x normal
    this.autoServeEnabled = true;
    this.activeCountersCount = 3;

    this.arrivalTimer = null;
    this.serveTimer = null;
    this.eventEmitterCallback = null;
    
    // Sample citizen names for realistic generation
    this.sampleNames = [
      'Alex Morgan', 'Jordan Lee', 'Taylor Smith', 'Morgan Freeman', 'Casey Jones',
      'Riley Evans', 'Avery Patel', 'Dakota Johnson', 'Cameron Diaz', 'Sam Rivera',
      'Jamie Chen', 'Chris Walker', 'Drew Barry', 'Jesse Pinkman', 'Robin Hood',
      'Quinn Fabray', 'Skyler White', 'Kendall Roy', 'Logan Roy', 'Siobhan Roy'
    ];
  }

  setBroadcaster(callback) {
    this.eventEmitterCallback = callback;
  }

  emitUpdate(event, data) {
    if (this.eventEmitterCallback) {
      this.eventEmitterCallback(event, data);
    }
  }

  /**
   * Configure simulation parameters
   */
  configure({ arrivalRatePerMin, serviceSpeedMultiplier, autoServeEnabled, activeCountersCount }) {
    if (arrivalRatePerMin !== undefined) this.arrivalRatePerMin = Math.max(2, Math.min(60, Number(arrivalRatePerMin)));
    if (serviceSpeedMultiplier !== undefined) this.serviceSpeedMultiplier = Math.max(0.5, Math.min(5.0, Number(serviceSpeedMultiplier)));
    if (autoServeEnabled !== undefined) this.autoServeEnabled = Boolean(autoServeEnabled);
    if (activeCountersCount !== undefined) {
      this.activeCountersCount = Math.max(1, Math.min(6, Number(activeCountersCount)));
      this.syncActiveCounters(this.activeCountersCount);
    }

    // Reset arrival timer cadence if running
    if (this.isRunning) {
      this.rescheduleArrivalTimer();
    }

    this.emitUpdate('SIMULATION_CONFIG_CHANGED', this.getStatus());
  }

  /**
   * Adjust counter open/closed states to match the desired count
   */
  syncActiveCounters(targetCount) {
    const counters = db.getCounters();
    counters.forEach((c, idx) => {
      const shouldBeOpen = idx < targetCount;
      const newStatus = shouldBeOpen ? 'OPEN' : 'CLOSED';
      if (c.status !== newStatus) {
        db.updateCounter(c.id, { status: newStatus });
      }
    });
    queueEngine.recalculateAllWaitingTokens();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.syncActiveCounters(this.activeCountersCount);
    this.rescheduleArrivalTimer();
    this.startServeLoop();
    this.emitUpdate('SIMULATION_STARTED', this.getStatus());
  }

  stop() {
    this.isRunning = false;
    if (this.arrivalTimer) clearInterval(this.arrivalTimer);
    if (this.serveTimer) clearInterval(this.serveTimer);
    this.arrivalTimer = null;
    this.serveTimer = null;
    this.emitUpdate('SIMULATION_STOPPED', this.getStatus());
  }

  rescheduleArrivalTimer() {
    if (this.arrivalTimer) clearInterval(this.arrivalTimer);
    
    // Arrival rate: arrivals per minute -> interval in ms
    // e.g. 15 arrivals/min = 60000 / 15 = 4000ms (4 seconds per arrival)
    // In demo mode, scaled for interactive demonstration
    const intervalMs = Math.max(1500, Math.round(60000 / this.arrivalRatePerMin));

    this.arrivalTimer = setInterval(() => {
      if (this.isRunning) {
        this.generateRandomArrival();
      }
    }, intervalMs);
  }

  startServeLoop() {
    if (this.serveTimer) clearInterval(this.serveTimer);

    // Virtual staff check loop: every 2.5 seconds, check if any open counter is idle or ready to complete
    this.serveTimer = setInterval(() => {
      if (this.isRunning && this.autoServeEnabled) {
        this.tickVirtualStaff();
      }
    }, 2500);
  }

  /**
   * Generates a single simulated citizen arrival
   */
  generateRandomArrival() {
    const categories = db.getCategories();
    // Weighted selection: General Inquiries 50%, Billing 35%, Documents 15%
    const rand = Math.random();
    let selectedCat = categories[0];
    if (rand > 0.85) selectedCat = categories[2] || categories[0];
    else if (rand > 0.50) selectedCat = categories[1] || categories[0];

    const randomName = this.sampleNames[Math.floor(Math.random() * this.sampleNames.length)];
    const waitingTokens = db.getWaitingTokens(selectedCat.id);
    const waitEst = queueEngine.calculateWaitTime(selectedCat.id, waitingTokens.length);

    const token = db.createToken({
      category_id: selectedCat.id,
      citizen_name: randomName,
      citizen_phone: '555-01' + Math.floor(10 + Math.random() * 89),
      estimated_wait_min: waitEst.waitMin
    });

    queueEngine.recalculateAllWaitingTokens();

    this.emitUpdate('SIMULATION_ARRIVAL', {
      token,
      category: selectedCat,
      estimated_wait_min: waitEst.waitMin
    });

    return token;
  }

  /**
   * Trigger an instant surge (Peak hour spike: 8-12 tokens at once)
   */
  triggerSurge(count = 10) {
    const generated = [];
    for (let i = 0; i < count; i++) {
      generated.push(this.generateRandomArrival());
    }
    queueEngine.recalculateAllWaitingTokens();
    this.emitUpdate('SIMULATION_SURGE', {
      count: generated.length,
      tokens: generated
    });
    return generated;
  }

  /**
   * Virtual staff automated service tick
   */
  tickVirtualStaff() {
    const counters = db.getCounters();
    const openCounters = counters.filter(c => c.status === 'OPEN');

    openCounters.forEach(counter => {
      // 1. If counter is currently serving, see if transaction is finished
      if (counter.current_token_id) {
        const token = db.getTokenById(counter.current_token_id);
        if (token && token.status === 'SERVING' && token.called_at) {
          const elapsedSec = (Date.now() - new Date(token.called_at).getTime()) / 1000;
          // Scaled service duration based on multiplier
          const cat = db.getCategoryById(token.category_id);
          const nominalSec = (cat ? cat.avg_service_time_sec : 180) / 20; // 20x demo compression
          const targetDuration = nominalSec / this.serviceSpeedMultiplier;

          if (elapsedSec >= targetDuration) {
            // Complete this token! Scale compressed demo duration back to real world seconds
            try {
              const simulatedDurationSec = Math.round(elapsedSec * 20);
              const res = queueEngine.completeCurrentToken(counter.id, simulatedDurationSec);
              this.emitUpdate('TOKEN_COMPLETED', res);
            } catch (e) {
              console.warn('[Sim] Error completing token:', e.message);
            }
          }
        }
      } 
      // 2. If counter is idle and there are waiting tokens, call next!
      else {
        const allWaiting = db.getWaitingTokens();
        if (allWaiting.length > 0) {
          try {
            const callRes = queueEngine.callNextToken(counter.id);
            if (callRes) {
              this.emitUpdate('TOKEN_CALLED', callRes);
            }
          } catch (e) {
            console.warn('[Sim] Error calling next token:', e.message);
          }
        }
      }
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      arrivalRatePerMin: this.arrivalRatePerMin,
      serviceSpeedMultiplier: this.serviceSpeedMultiplier,
      autoServeEnabled: this.autoServeEnabled,
      activeCountersCount: this.activeCountersCount
    };
  }
}

const simulator = new QueueSimulator();
module.exports = simulator;
