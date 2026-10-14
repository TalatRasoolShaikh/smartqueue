/**
 * Queue Engine & Wait-Time Optimizer (SC-03)
 * 
 * Mathematical Model:
 * Implements M/M/c Multi-Server Queue Approximation:
 * 
 *    Estimated Wait Time (sec) = (Tokens Ahead * Avg Service Time) / Active Open Counters
 * 
 * Dynamic Features:
 * 1. Rolling Average Service Time Adjustment using Exponential Moving Average (EMA).
 * 2. Real-time counter load balancing and category filtering.
 * 3. Proximity alerting when citizen is <= 2 positions away from their turn.
 */

const db = require('./db');

class QueueEngine {
  /**
   * Get count of active open counters capable of serving a given category.
   * @param {number|null} categoryId 
   * @returns {number}
   */
  getActiveCountersCount(categoryId = null) {
    const counters = db.getCounters();
    const openCounters = counters.filter(c => {
      if (c.status !== 'OPEN') return false;
      if (categoryId !== null && c.categories_handled && c.categories_handled.length > 0) {
        return c.categories_handled.includes(Number(categoryId));
      }
      return true;
    });
    return Math.max(1, openCounters.length);
  }

  /**
   * Calculate wait time for a new or existing token.
   * Formula: (Tokens Ahead * Avg Service Time per Category) / Active Open Counters
   * 
   * @param {number} categoryId 
   * @param {number} tokensAhead 
   * @returns {{ waitSec: number, waitMin: number, activeCounters: number, avgServiceSec: number }}
   */
  calculateWaitTime(categoryId, tokensAhead) {
    const category = db.getCategoryById(categoryId);
    const avgServiceSec = category ? category.avg_service_time_sec : 180;
    const activeCounters = this.getActiveCountersCount(categoryId);

    // Queueing formula:
    // If there are N people ahead, wait time is the time required for active counters
    // to process those N jobs in parallel.
    const waitSec = Math.round((tokensAhead * avgServiceSec) / activeCounters);
    
    // In minutes (minimum 1 minute if waiting, 0 if first up)
    const waitMin = tokensAhead === 0 ? 0 : Math.max(1, Math.round(waitSec / 60));

    return {
      waitSec,
      waitMin,
      activeCounters,
      avgServiceSec
    };
  }

  /**
   * Recalculate wait times for all waiting tokens in the system.
   * Called whenever a counter opens/closes, a token is served, or new arrivals occur.
   */
  recalculateAllWaitingTokens() {
    const categories = db.getCategories();
    let hasChanges = false;
    
    categories.forEach(cat => {
      const waiting = db.getWaitingTokens(cat.id);
      const activeCounters = this.getActiveCountersCount(cat.id);

      waiting.forEach((token, index) => {
        const tokensAhead = index; // 0 for the first one
        const waitSec = Math.round((tokensAhead * cat.avg_service_time_sec) / activeCounters);
        const waitMin = tokensAhead === 0 ? 1 : Math.max(1, Math.round(waitSec / 60));

        if (token.estimated_wait_min !== waitMin) {
          db.updateToken(token.id, {
            estimated_wait_min: waitMin
          }, false);
          hasChanges = true;
        }
      });
    });

    if (hasChanges) {
      db.save();
    }
  }

  /**
   * Get real-time status of a specific token including position and alert proximity.
   * @param {string|number} tokenIdOrNumber 
   */
  getTokenStatus(tokenIdOrNumber) {
    let token = null;
    if (typeof tokenIdOrNumber === 'number' || (/^\d+$/.test(String(tokenIdOrNumber)))) {
      token = db.getTokenById(Number(tokenIdOrNumber));
    }
    if (!token && typeof tokenIdOrNumber === 'string') {
      token = db.getTokenByNumber(tokenIdOrNumber);
    }

    if (!token) return null;

    const category = db.getCategoryById(token.category_id);
    let position = 0;
    let tokensAhead = 0;
    let nowServingToken = null;
    let nowServingCounter = null;

    if (token.status === 'WAITING') {
      const waitingTokens = db.getWaitingTokens(token.category_id);
      const index = waitingTokens.findIndex(t => t.id === token.id);
      if (index !== -1) {
        position = index + 1;
        tokensAhead = index;
      }

      // Check who is currently serving in this category
      const counters = db.getCounters();
      const servingCounter = counters.find(c => {
        if (!c.current_token_id) return false;
        const currentToken = db.getTokenById(c.current_token_id);
        return currentToken && currentToken.category_id === token.category_id;
      });

      if (servingCounter) {
        nowServingCounter = servingCounter;
        nowServingToken = db.getTokenById(servingCounter.current_token_id);
      }
    } else if (token.status === 'SERVING') {
      position = 0;
      tokensAhead = 0;
      nowServingCounter = db.getCounterById(token.counter_id);
      nowServingToken = token;
    }

    const waitEst = this.calculateWaitTime(token.category_id, tokensAhead);

    return {
      token,
      category,
      position,
      tokensAhead,
      estimated_wait_min: token.status === 'WAITING' ? waitEst.waitMin : 0,
      estimated_wait_sec: token.status === 'WAITING' ? waitEst.waitSec : 0,
      active_counters: waitEst.activeCounters,
      now_serving_token: nowServingToken ? nowServingToken.token_number : 'None',
      now_serving_counter: nowServingCounter ? `Counter ${nowServingCounter.counter_number}` : 'None',
      // User is 2 positions away if position === 2, or next if position === 1
      is_proximity_alert: token.status === 'WAITING' && position <= 2 && position > 0,
      is_serving_now: token.status === 'SERVING'
    };
  }

  /**
   * Update category rolling average service time upon token completion.
   * Uses Exponential Moving Average (EMA) with smoothing factor alpha = 0.25
   * 
   *    EMA_new = (alpha * Duration_actual) + ((1 - alpha) * EMA_previous)
   * 
   * @param {number} categoryId 
   * @param {number} durationSec 
   */
  updateRollingAverageServiceTime(categoryId, durationSec) {
    if (durationSec <= 5) return; // ignore trivial skips
    const category = db.getCategoryById(categoryId);
    if (!category) return;

    const currentAvg = category.avg_service_time_sec || 180;
    const alpha = 0.25; // 25% weight to newest completed service
    const newAvg = (alpha * durationSec) + ((1 - alpha) * currentAvg);

    // Keep within reasonable bounds (30s to 1200s)
    const boundedAvg = Math.max(30, Math.min(1200, Math.round(newAvg)));
    db.updateCategoryAvgServiceTime(categoryId, boundedAvg);
    
    // Recalculate remaining wait times with the updated service speed
    this.recalculateAllWaitingTokens();
  }

  /**
   * Call next token for a counter.
   * Priority: FIFO from the counter's assigned categories.
   * @param {number} counterId 
   */
  callNextToken(counterId) {
    const counter = db.getCounterById(counterId);
    if (!counter) throw new Error(`Counter ${counterId} not found`);

    if (counter.status !== 'OPEN') {
      throw new Error(`Counter ${counter.counter_number} is currently ${counter.status}. Open it first.`);
    }

    // If counter is already serving a token, mark it completed or error
    if (counter.current_token_id) {
      const activeToken = db.getTokenById(counter.current_token_id);
      if (activeToken && activeToken.status === 'SERVING') {
        throw new Error(`Counter ${counter.counter_number} is already serving ${activeToken.token_number}. Please complete or skip it first.`);
      }
    }

    // Get waiting tokens that this counter is allowed to handle
    const allWaiting = db.getWaitingTokens();
    const candidateTokens = allWaiting.filter(t => {
      if (!counter.categories_handled || counter.categories_handled.length === 0) return true;
      return counter.categories_handled.includes(t.category_id);
    });

    if (candidateTokens.length === 0) {
      return null; // Queue is empty
    }

    const nextToken = candidateTokens[0];
    const now = new Date().toISOString();

    // Calculate wait time experienced
    const waitDurationSec = Math.round((new Date(now) - new Date(nextToken.created_at)) / 1000);

    // Transition token state: WAITING -> SERVING
    const updatedToken = db.updateToken(nextToken.id, {
      status: 'SERVING',
      counter_id: counter.id,
      called_at: now
    });

    // Update counter's current token
    db.updateCounter(counter.id, {
      current_token_id: nextToken.id
    });

    db.addLog({
      event_type: 'TOKEN_CALLED',
      token_id: nextToken.id,
      token_number: nextToken.token_number,
      category_id: nextToken.category_id,
      counter_id: counter.id,
      wait_time_sec: waitDurationSec
    });

    // Recalculate remaining tokens in queue
    this.recalculateAllWaitingTokens();

    return {
      token: updatedToken,
      counter: counter,
      category: db.getCategoryById(nextToken.category_id)
    };
  }

  /**
   * Mark token as COMPLETED.
   * Calculates service duration and updates dynamic rolling average.
   * @param {number} counterId 
   */
  completeCurrentToken(counterId, overrideDurationSec = null) {
    const counter = db.getCounterById(counterId);
    if (!counter || !counter.current_token_id) {
      throw new Error('Counter has no active token to complete.');
    }

    const token = db.getTokenById(counter.current_token_id);
    if (!token) throw new Error('Active token not found.');

    const now = new Date().toISOString();
    const serviceDurationSec = overrideDurationSec
      ? Number(overrideDurationSec)
      : (token.called_at 
          ? Math.max(10, Math.round((new Date(now) - new Date(token.called_at)) / 1000))
          : 120);

    const completedToken = db.updateToken(token.id, {
      status: 'COMPLETED',
      completed_at: now
    });

    // Clear counter
    db.updateCounter(counter.id, {
      current_token_id: null
    });

    // Update rolling average for category
    this.updateRollingAverageServiceTime(token.category_id, serviceDurationSec);

    db.addLog({
      event_type: 'TOKEN_COMPLETED',
      token_id: token.id,
      token_number: token.token_number,
      category_id: token.category_id,
      counter_id: counter.id,
      service_time_sec: serviceDurationSec
    });

    return {
      token: completedToken,
      counter,
      serviceDurationSec
    };
  }

  /**
   * Mark current token as NO_SHOW (Skip).
   * @param {number} counterId 
   */
  skipCurrentToken(counterId) {
    const counter = db.getCounterById(counterId);
    if (!counter || !counter.current_token_id) {
      throw new Error('Counter has no active token to skip.');
    }

    const token = db.getTokenById(counter.current_token_id);
    const now = new Date().toISOString();

    const skippedToken = db.updateToken(token.id, {
      status: 'NO_SHOW',
      completed_at: now
    });

    db.updateCounter(counter.id, {
      current_token_id: null
    });

    db.addLog({
      event_type: 'TOKEN_SKIPPED',
      token_id: token.id,
      token_number: token.token_number,
      category_id: token.category_id,
      counter_id: counter.id
    });

    this.recalculateAllWaitingTokens();

    return {
      token: skippedToken,
      counter
    };
  }

  /**
   * Transfer token to another department/category.
   * @param {number} counterId 
   * @param {number} targetCategoryId 
   * @param {string} reason 
   */
  transferCurrentToken(counterId, targetCategoryId, reason = 'Department Transfer') {
    const counter = db.getCounterById(counterId);
    if (!counter || !counter.current_token_id) {
      throw new Error('No active token on counter to transfer.');
    }

    const token = db.getTokenById(counter.current_token_id);
    const targetCat = db.getCategoryById(targetCategoryId);
    if (!targetCat) throw new Error('Target category invalid.');

    // Release counter
    db.updateCounter(counter.id, {
      current_token_id: null
    });

    // Place back into WAITING in the new category
    const transferredToken = db.updateToken(token.id, {
      category_id: Number(targetCategoryId),
      status: 'WAITING',
      counter_id: null,
      called_at: null,
      transfer_reason: reason
    });

    db.addLog({
      event_type: 'TOKEN_TRANSFERRED',
      token_id: token.id,
      token_number: token.token_number,
      from_counter_id: counter.id,
      target_category_id: targetCategoryId,
      reason
    });

    this.recalculateAllWaitingTokens();

    return {
      token: transferredToken,
      counter
    };
  }

  /**
   * Compile high-level real-time analytics summary
   */
  getAnalytics() {
    const allTokens = db.getAllTokens();
    const categories = db.getCategories();
    const counters = db.getCounters();
    const logs = db.getLogs(500);

    const totalIssued = allTokens.length;
    const completedTokens = allTokens.filter(t => t.status === 'COMPLETED');
    const waitingTokens = allTokens.filter(t => t.status === 'WAITING');
    const servingTokens = allTokens.filter(t => t.status === 'SERVING');
    const noShowTokens = allTokens.filter(t => t.status === 'NO_SHOW');

    // Calculate Average Wait Time from completed tokens
    let totalWaitSec = 0;
    let completedWithWaitCount = 0;
    completedTokens.forEach(t => {
      if (t.created_at && t.called_at) {
        const sec = (new Date(t.called_at) - new Date(t.created_at)) / 1000;
        if (sec >= 0) {
          totalWaitSec += sec;
          completedWithWaitCount++;
        }
      }
    });

    const avgWaitMin = completedWithWaitCount > 0 
      ? Math.round((totalWaitSec / completedWithWaitCount / 60) * 10) / 10 
      : 4.2;

    // Calculate Average Service Time
    let totalServiceSec = 0;
    let completedWithServiceCount = 0;
    completedTokens.forEach(t => {
      if (t.called_at && t.completed_at) {
        const sec = (new Date(t.completed_at) - new Date(t.called_at)) / 1000;
        if (sec > 0) {
          totalServiceSec += sec;
          completedWithServiceCount++;
        }
      }
    });

    const avgServiceMin = completedWithServiceCount > 0 
      ? Math.round((totalServiceSec / completedWithServiceCount / 60) * 10) / 10 
      : 3.1;

    // Counter efficiency
    const counterEfficiency = counters.map(c => {
      const servedCount = allTokens.filter(t => t.counter_id === c.id && t.status === 'COMPLETED').length;
      return {
        counter_id: c.id,
        counter_number: c.counter_number,
        staff: c.assigned_staff_name,
        status: c.status,
        served_count: servedCount
      };
    });

    // Category breakdown
    const categoryBreakdown = categories.map(cat => {
      const count = allTokens.filter(t => t.category_id === cat.id).length;
      const waiting = allTokens.filter(t => t.category_id === cat.id && t.status === 'WAITING').length;
      return {
        id: cat.id,
        name: cat.name,
        prefix: cat.code_prefix,
        total: count,
        waiting: waiting,
        avg_service_sec: cat.avg_service_time_sec
      };
    });

    return {
      kpis: {
        total_issued: totalIssued,
        currently_waiting: waitingTokens.length,
        currently_serving: servingTokens.length,
        total_completed: completedTokens.length,
        total_no_show: noShowTokens.length,
        avg_wait_time_min: avgWaitMin,
        avg_service_time_min: avgServiceMin,
        no_show_rate_pct: totalIssued > 0 ? Math.round((noShowTokens.length / totalIssued) * 100) : 0
      },
      counter_efficiency: counterEfficiency,
      category_breakdown: categoryBreakdown,
      recent_logs: logs.slice(0, 20)
    };
  }
}

const queueEngine = new QueueEngine();
module.exports = queueEngine;
