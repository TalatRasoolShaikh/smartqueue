/**
 * Audio & Notification Engine (SC-03)
 * Provides:
 * 1. Web Audio API synthesized "Ding-Dong" chime (zero external audio dependencies).
 * 2. Web Speech API vocal announcer for counter calls.
 * 3. Browser Web Notification API for proximity alerts.
 */

class AudioNotificationEngine {
  constructor() {
    this.audioCtx = null;
    this.soundEnabled = true;
    this.speechEnabled = true;
    this.notificationPermission = (typeof Notification !== 'undefined') ? Notification.permission : 'default';
  }

  initAudioContext() {
    if (!this.audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /**
   * Play realistic dual-tone lobby chime:
   * First tone: 659.25 Hz (E5)
   * Second tone: 523.25 Hz (C5)
   */
  playChime() {
    if (!this.soundEnabled) return;

    try {
      this.initAudioContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = this.audioCtx.createOscillator();
      const gain1 = this.audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.3, now + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc1.connect(gain1);
      gain1.connect(this.audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);

      // Note 2: C5 (523.25 Hz)
      const osc2 = this.audioCtx.createOscillator();
      const gain2 = this.audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(523.25, now + 0.35);

      gain2.gain.setValueAtTime(0, now + 0.35);
      gain2.gain.linearRampToValueAtTime(0.35, now + 0.40);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc2.connect(gain2);
      gain2.connect(this.audioCtx.destination);
      osc2.start(now + 0.35);
      osc2.stop(now + 1.2);
    } catch (err) {
      console.warn('[Audio] Could not play chime:', err);
    }
  }

  /**
   * Short alert beep for proximity notifications
   */
  playProximityBeep() {
    if (!this.soundEnabled) return;
    try {
      this.initAudioContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now); // A5

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {
      console.warn(e);
    }
  }

  /**
   * Synthesize natural speech announcement using Web Speech API
   * e.g. "Token A-101, please proceed to Counter 2"
   */
  announceToken(tokenNumber, counterNumber) {
    if (!this.speechEnabled || !('speechSynthesis' in window)) return;

    // First play the chime
    this.playChime();

    // After 600ms chime delay, speak announcement
    setTimeout(() => {
      try {
        window.speechSynthesis.cancel(); // clear queue
        
        // Split token characters for clear pronunciation: "A 1 0 1"
        const formattedToken = tokenNumber.replace('-', ' ');
        const text = `Token ${formattedToken}. Please proceed to Counter ${counterNumber}.`;
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Try to pick natural English voice
        const voices = window.speechSynthesis.getVoices();
        const englishVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
        if (englishVoice) {
          utterance.voice = englishVoice;
        }

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[Speech] Could not speak utterance:', err);
      }
    }, 650);
  }

  /**
   * Request browser push notification permissions
   */
  async requestNotificationPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    
    try {
      const permission = await Notification.requestPermission();
      this.notificationPermission = permission;
      return permission;
    } catch (e) {
      console.warn(e);
      return 'denied';
    }
  }

  /**
   * Trigger Desktop / Browser push notification
   */
  sendNotification(title, body, tag = 'queue-alert') {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    try {
      new Notification(title, {
        body,
        icon: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
        tag,
        renotify: true
      });
    } catch (e) {
      console.warn('[Notification] Could not display notification:', e);
    }
  }
}

const audioEngine = new AudioNotificationEngine();
window.audioEngine = audioEngine;
