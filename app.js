/**
 * =============================================================================
 * Ad Demo - VMAP/VAST Ad Integration with Video.js
 * =============================================================================
 * 
 * This application demonstrates how to integrate VMAP (Video Multiple Ad Playlist)
 * and VAST (Video Ad Serving Template) ads into a video player using Video.js.
 * 
 * Architecture:
 * - VMAPService: Fetches and parses VMAP/VAST documents
 * - AdBreakManager: Manages ad break scheduling and state
 * - AdTracker: Handles VAST tracking (impressions, clicks, quartiles)
 * - AdOverlayController: Manages UI overlay and skip button
 * - VideoPlayerManager: Controls Video.js player instance
 * - AdDemoApp: Main application coordinator
 * 
 * Key Features:
 * - Pre-roll, mid-roll, and post-roll ad breaks
 * - Ad skip functionality with countdown
 * - Click-through tracking
 * - Visual ad break markers on the timeline
 * - MediaTailor server-side ad stitching support
 */

// =============================================================================
// IMPORTS
// =============================================================================

import VMAP from '@dailymotion/vmap';
import { VASTClient, VASTTracker } from '@dailymotion/vast-client';

const videojs = window.videojs;

// =============================================================================
// CONSTANTS
// =============================================================================

/** Configuration constants */
const CONFIG = {
  VMAP_INTERVAL: 300, // Interval (in seconds) between ad breaks for VMAP generation
  DEFAULT_AD_DURATION: 30, // Default ad duration if not specified in VAST
  DEFAULT_SKIP_OFFSET: 5, // Default skip offset if not specified in VAST
};

// =============================================================================
// VMAP/VAST SERVICE
// =============================================================================

/**
 * Service for fetching and parsing VMAP/VAST documents
 * Handles all interactions with ad serving endpoints
 */
class VMAPService {
  /**
   * Converts a VMAP time offset string to seconds
   * @param {string} timeOffset - Time offset (e.g., "start", "end", "00:01:30")
   * @param {number} totalDuration - Total duration of content in seconds
   * @returns {number} Time in seconds
   */
  static parseTimeOffset(timeOffset, totalDuration) {
    if (timeOffset === 'start') return 0;
    if (timeOffset === 'end') return totalDuration;
    
    const parts = String(timeOffset).trim().split(':');
    if (parts.length === 3) {
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      const s = parseFloat(parts[2]) || 0;
      return h * 3600 + m * 60 + s;
    }
    
    return 0;
  }

  /**
   * Extracts the VAST URL from a VMAP ad break
   * @param {Object} adBreak - VMAP ad break object
   * @returns {string|null} VAST URL or null if not found
   */
  static extractVastUrl(adBreak) {
    if (!adBreak.adSource || !adBreak.adSource.adTagURI) return null;
    const uri = adBreak.adSource.adTagURI;
    return (typeof uri === 'object' && uri.uri) ? uri.uri : uri;
  }

  /**
   * Fetches and parses a VMAP document from the server
   * @param {string} vmapBaseUrl - Base URL for VMAP endpoint
   * @param {number} duration - Content duration in seconds
   * @param {string} userId - User ID for personalization
   * @returns {Promise<VMAP>} Parsed VMAP object
   */
  static async fetchVMAP(vmapBaseUrl, duration, userId) {
    const url = `${vmapBaseUrl}?duration=${duration}&interval=${CONFIG.VMAP_INTERVAL}&userId=${encodeURIComponent(userId || 'guest')}`;
    const response = await fetch(url, { headers: { Accept: 'application/xml' } });
    
    if (!response.ok) {
      throw new Error(`VMAP request failed with status ${response.status}`);
    }
    
    const text = await response.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    
    if (doc.querySelector('parsererror')) {
      throw new Error('Invalid VMAP XML');
    }
    
    return new VMAP(doc);
  }

  /**
   * Builds a sorted list of ad breaks from VMAP
   * @param {VMAP} vmap - Parsed VMAP object
   * @param {number} contentDuration - Content duration in seconds
   * @returns {Array} Sorted array of ad break objects
   */
  static buildAdBreakList(vmap, contentDuration) {
    const list = [];
    
    for (let i = 0; i < vmap.adBreaks.length; i++) {
      const br = vmap.adBreaks[i];
      const timeOffset = br.timeOffset || 'start';
      const seconds = VMAPService.parseTimeOffset(timeOffset, contentDuration);
      const vastUrl = VMAPService.extractVastUrl(br);
      
      if (vastUrl != null) {
        list.push({
          index: i,
          timeOffset: timeOffset,
          timeInSeconds: seconds,
          breakId: br.breakId || `break_${i}`,
          vastUrl: vastUrl,
          duration: CONFIG.DEFAULT_AD_DURATION,
          skipOffset: CONFIG.DEFAULT_SKIP_OFFSET,
        });
      }
    }
    
    // Sort by time to ensure ads play in chronological order
    return list.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
  }

  /**
   * Finds the linear creative in a VAST ad
   * @param {Object} ad - VAST ad object
   * @returns {Object|null} Linear creative or null
   */
  static getLinearCreative(ad) {
    if (!ad || !ad.creatives) return null;
    return ad.creatives.find((c) => c.type === 'linear' && c.mediaFiles && c.mediaFiles.length) || null;
  }

  /**
   * Extracts the media file URL from a creative
   * @param {Object} creative - VAST creative object
   * @returns {string|null} Media file URL or null
   */
  static getMediaFileUrl(creative) {
    if (!creative || !creative.mediaFiles || !creative.mediaFiles.length) return null;
    const file = creative.mediaFiles.find((f) => f.fileURL);
    return file ? file.fileURL : null;
  }
}

// =============================================================================
// AD OVERLAY CONTROLLER
// =============================================================================

/**
 * Controls the ad overlay UI (skip button, learn more button)
 * Manages overlay visibility and skip countdown
 */
class AdOverlayController {
  constructor() {
    this.overlayElement = document.getElementById('adOverlay');
    this.skipButton = document.getElementById('skipBtn');
    this.learnMoreButton = document.getElementById('learnMoreBtn');
  }

  /**
   * Shows the ad overlay
   */
  show() {
    console.log('[OVERLAY] Showing ad overlay');
    this.overlayElement.classList.add('active');
    this.overlayElement.setAttribute('aria-hidden', 'false');
  }

  /**
   * Hides the ad overlay
   */
  hide() {
    console.log('[OVERLAY] Hiding ad overlay');
    this.overlayElement.classList.remove('active');
    this.overlayElement.setAttribute('aria-hidden', 'true');
  }

  /**
   * Updates the skip button UI based on ad progress
   * @param {number} elapsed - Time elapsed in the ad (seconds)
   * @param {number} duration - Total ad duration (seconds)
   * @param {number} skipOffset - Time when skip becomes available (seconds)
   */
  updateSkipButton(elapsed, duration, skipOffset) {
    const wasDisabled = this.skipButton.disabled;
    
    if (elapsed >= skipOffset) {
      // Skip is now available
      this.skipButton.disabled = false;
      this.skipButton.innerHTML = 'Skip Ad';
      
      if (wasDisabled) {
        console.log('[OVERLAY] Skip button enabled', { elapsed, skipOffset });
      }
    } else {
      // Still counting down to skip
      this.skipButton.disabled = true;
      const countdown = Math.ceil(skipOffset - elapsed);
      this.skipButton.innerHTML = `Skip in <span id="skipCounter">${countdown}</span>s`;
    }
  }

  /**
   * Renders ad break information in the UI panel
   * @param {Array} adBreaks - List of ad breaks
   */
  renderAdBreakInfo(adBreaks) {
    const el = document.getElementById('markerInfo');
    
    if (!adBreaks.length) {
      el.textContent = 'No ad breaks from VMAP.';
      return;
    }
    
    const lines = adBreaks.map(
      (br) => `${br.breakId}: ${br.timeOffset} (${br.timeInSeconds.toFixed(1)}s)`
    );
    el.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }
}

// =============================================================================
// AD TRACKER
// =============================================================================

/**
 * Handles VAST tracking events (impressions, clicks, quartiles)
 * Wraps the VASTTracker library with application-specific logic
 */
class AdTracker {
  constructor() {
    this.vastTracker = null;
    this.vastClient = new VASTClient(0, 0);
  }

  /**
   * Initializes VAST tracking for an ad break
   * @param {Object} breakInfo - Ad break information with vastUrl
   * @returns {Promise<Object|null>} Ad metadata (clickThrough, duration, skipOffset) or null
   */
  async initialize(breakInfo) {
    const vastUrl = breakInfo.vastUrl;
    
    if (!vastUrl) {
      console.warn('[TRACKER] No VAST URL available');
      return null;
    }
    
    try {
      const vastResponse = await this.vastClient.get(vastUrl);
      
      const validAd = vastResponse.ads.find(a => a.creatives && a.creatives.length);
      if (!validAd) return null;
      
      const creative = VMAPService.getLinearCreative(validAd);
      if (!creative) return null;
      
      // Extract ad metadata
      const metadata = {
        clickThrough: creative.videoClickThroughURLTemplate?.url || creative.videoClickThroughURLTemplate || null,
        duration: creative.duration || CONFIG.DEFAULT_AD_DURATION,
        skipOffset: creative.skipDelay || CONFIG.DEFAULT_SKIP_OFFSET,
      };
      
      // Create tracker
      this.vastTracker = new VASTTracker(null, validAd, creative);
      this.vastTracker.trackImpression();
      
      console.log('[TRACKER] Initialized', metadata);
      return metadata;
    } catch (err) {
      console.error('[TRACKER] Failed to initialize', err);
      return null;
    }
  }

  /**
   * Updates tracker progress for quartile tracking
   * @param {number} elapsed - Seconds elapsed in the ad
   */
  setProgress(elapsed) {
    if (this.vastTracker) {
      this.vastTracker.setProgress(elapsed);
    }
  }

  /**
   * Tracks a skip event
   */
  trackSkip() {
    if (this.vastTracker) {
      this.vastTracker.skip();
    }
  }

  /**
   * Tracks a click event
   * @returns {Promise<string|null>} Click-through URL if available
   */
  trackClick() {
    return new Promise((resolve) => {
      if (!this.vastTracker) {
        resolve(null);
        return;
      }
      
      this.vastTracker.once('clickthrough', (url) => {
        console.log('[TRACKER] Click-through URL:', url);
        resolve(url);
      });
      
      this.vastTracker.click();
    });
  }

  /**
   * Tracks ad completion
   */
  trackComplete() {
    if (this.vastTracker) {
      this.vastTracker.complete();
    }
  }

  /**
   * Resets the tracker
   */
  reset() {
    this.vastTracker = null;
  }

  /**
   * Checks if tracker is active
   * @returns {boolean} True if tracker is initialized
   */
  isActive() {
    return this.vastTracker !== null;
  }
}

// =============================================================================
// AD BREAK MANAGER
// =============================================================================

/**
 * Manages ad break scheduling, detection, and playback coordination
 * Handles MediaTailor server-side ad stitching
 */
class AdBreakManager {
  constructor(overlayController, tracker) {
    this.overlayController = overlayController;
    this.tracker = tracker;
    this.adBreaks = [];
    this.currentAdBreak = null;
    this.isInAdBreak = false;
  }

  /**
   * Sets the list of ad breaks from VMAP
   * @param {Array} adBreaks - Array of ad break objects
   */
  setAdBreaks(adBreaks) {
    this.adBreaks = adBreaks;
  }

  /**
   * Gets the current list of ad breaks
   * @returns {Array} Array of ad break objects
   */
  getAdBreaks() {
    return this.adBreaks;
  }

  /**
   * Calculates cumulative ad duration up to a specific index
   * @param {number} upToIndex - Calculate duration up to (not including) this index
   * @returns {number} Total duration in seconds
   */
  getCumulativeAdDuration(upToIndex) {
    let total = 0;
    for (let i = 0; i < upToIndex && i < this.adBreaks.length; i++) {
      total += this.adBreaks[i].duration || CONFIG.DEFAULT_AD_DURATION;
    }
    return total;
  }

  /**
   * Detects if playback is currently in an ad break
   * @param {number} hlsTime - Current HLS stream time
   * @returns {Object|null} Active ad break or null
   */
  detectActiveBreak(hlsTime) {
    return this.adBreaks.find((br, index) => {
      const adDuration = br.duration || CONFIG.DEFAULT_AD_DURATION;
      const cumulativeAdDuration = this.getCumulativeAdDuration(index);
      const startTime = br.timeInSeconds + cumulativeAdDuration;
      const endTime = startTime + adDuration;
      
      return hlsTime >= startTime && hlsTime < endTime;
    });
  }

  /**
   * Monitors playback and manages ad break transitions
   * @param {number} hlsTime - Current HLS stream time
   */
  update(hlsTime) {
    if (this.adBreaks.length === 0) return;
    
    const activeBreak = this.detectActiveBreak(hlsTime);
    
    if (activeBreak && !this.isInAdBreak) {
      // Entering ad break
      this.startAdBreak(activeBreak);
    } else if (!activeBreak && this.isInAdBreak) {
      // Exiting ad break
      this.endAdBreak();
    } else if (activeBreak && this.isInAdBreak && this.currentAdBreak) {
      // During ad break - update progress
      const breakIndex = this.adBreaks.findIndex(b => b.breakId === this.currentAdBreak.breakId);
      const cumulativeAdDuration = this.getCumulativeAdDuration(breakIndex);
      const adjustedStartTime = this.currentAdBreak.timeInSeconds + cumulativeAdDuration;
      const elapsed = hlsTime - adjustedStartTime;
      this.updateProgress(elapsed);
    }
  }

  /**
   * Starts an ad break (entering ad)
   * @param {Object} breakInfo - Ad break information
   */
  async startAdBreak(breakInfo) {
    console.log('[AD BREAK] Starting', breakInfo.breakId);
    
    this.isInAdBreak = true;
    this.currentAdBreak = breakInfo;
    
    // Show overlay
    this.overlayController.show();
    
    // Initialize VAST tracking
    const metadata = await this.tracker.initialize(breakInfo);
    if (metadata) {
      // Update break info with VAST metadata
      this.currentAdBreak.clickThrough = metadata.clickThrough;
      this.currentAdBreak.duration = metadata.duration;
      this.currentAdBreak.skipOffset = metadata.skipOffset;
      
      // Update the master list
      const breakIndex = this.adBreaks.findIndex(b => b.breakId === breakInfo.breakId);
      if (breakIndex !== -1) {
        this.adBreaks[breakIndex].duration = metadata.duration;
        this.adBreaks[breakIndex].skipOffset = metadata.skipOffset;
      }
    }
  }

  /**
   * Ends an ad break (exiting ad)
   */
  endAdBreak() {
    console.log('[AD BREAK] Ending');
    
    // Complete tracking
    this.tracker.trackComplete();
    this.tracker.reset();
    
    this.isInAdBreak = false;
    this.currentAdBreak = null;
    
    // Hide overlay
    this.overlayController.hide();
  }

  /**
   * Updates ad progress during playback
   * @param {number} elapsed - Seconds elapsed in current ad
   */
  updateProgress(elapsed) {
    if (!this.currentAdBreak) return;
    
    const duration = this.currentAdBreak.duration || CONFIG.DEFAULT_AD_DURATION;
    const skipOffset = this.currentAdBreak.skipOffset || CONFIG.DEFAULT_SKIP_OFFSET;
    
    // Update UI
    this.overlayController.updateSkipButton(elapsed, duration, skipOffset);
    
    // Track quartiles
    this.tracker.setProgress(elapsed);
  }

  /**
   * Skips the current ad
   * @param {Object} player - Video.js player instance
   */
  skipCurrentAd(player) {
    if (!this.currentAdBreak || !player) {
      console.warn('[AD BREAK] Cannot skip - no active ad break');
      return;
    }
    
    const breakIndex = this.adBreaks.findIndex(b => b.breakId === this.currentAdBreak.breakId);
    const cumulativeAdDuration = this.getCumulativeAdDuration(breakIndex);
    const adDuration = this.currentAdBreak.duration || CONFIG.DEFAULT_AD_DURATION;
    const endTime = this.currentAdBreak.timeInSeconds + cumulativeAdDuration + adDuration;
    
    console.log('[AD BREAK] Skipping to', { endTime });
    
    // Track skip
    this.tracker.trackSkip();
    
    // Seek to end of ad
    player.currentTime(endTime);
  }

  /**
   * Handles click on current ad
   */
  async clickCurrentAd() {
    if (!this.currentAdBreak) {
      console.warn('[AD BREAK] No active ad to click');
      return;
    }
    
    console.log('[AD BREAK] Processing click', {
      hasClickThrough: !!this.currentAdBreak.clickThrough,
      clickThroughUrl: this.currentAdBreak.clickThrough
    });
    
    // Track click and get URL from tracker
    const trackerUrl = await this.tracker.trackClick();
    
    // Open click-through URL
    const url = trackerUrl || this.currentAdBreak.clickThrough;
    if (url) {
      window.open(url, '_blank');
    } else {
      console.warn('[AD BREAK] No click-through URL available');
    }
  }

  /**
   * Checks if currently in an ad break
   * @returns {boolean} True if in ad break
   */
  isInAd() {
    return this.isInAdBreak;
  }

  /**
   * Gets the current ad break
   * @returns {Object|null} Current ad break or null
   */
  getCurrentAdBreak() {
    return this.currentAdBreak;
  }

  /**
   * Resets the manager state
   */
  reset() {
    this.adBreaks = [];
    this.currentAdBreak = null;
    this.isInAdBreak = false;
    this.tracker.reset();
  }
}

// =============================================================================
// VIDEO PLAYER MANAGER
// =============================================================================

/**
 * Manages the Video.js player instance and timeline markers
 */
class VideoPlayerManager {
  constructor() {
    this.player = null;
    this.contentDuration = 0;
  }

  /**
   * Initializes the Video.js player
   * @param {string} contentUrl - HLS stream URL
   * @param {number} duration - Content duration in seconds
   */
  initialize(contentUrl, duration) {
    // Dispose of existing player if any
    if (this.player) {
      console.log('[PLAYER] Disposing existing player');
      this.player.dispose();
      this.player = null;
    }

    this.contentDuration = duration;

    // Create new Video.js player with HLS support
    console.log('[PLAYER] Creating new player');
    this.player = videojs('videoPlayer', {
      controls: true,
      preload: 'auto',
      responsive: true,
      fluid: true,
      html5: {
        vhs: {
          overrideNative: true  // Use Video.js HLS implementation
        }
      }
    });

    // Load HLS stream
    this.player.src({ src: contentUrl, type: 'application/x-mpegURL' });
  }

  /**
   * Initializes timeline markers for ad breaks
   * @param {Array} adBreaks - Array of ad break objects
   * @param {Function} getCumulativeDuration - Function to calculate cumulative ad duration
   */
  initializeMarkers(adBreaks, getCumulativeDuration) {
    if (!this.player.markers) return;
    
    // Only show markers for mid-roll ads (not pre/post-roll)
    const markers = adBreaks
      .filter((br) => br.timeInSeconds > 0 && br.timeInSeconds < this.contentDuration)
      .map((br) => {
        const originalIndex = adBreaks.findIndex(b => b.breakId === br.breakId);
        const cumulativeAdDuration = getCumulativeDuration(originalIndex);
        const hlsTime = br.timeInSeconds + cumulativeAdDuration;
        
        return {
          time: hlsTime,
          text: br.breakId || `Ad ${originalIndex + 1}`,
        };
      });
    
    this.player.markers({
      markers,
      markerStyle: { width: '6px', 'background-color': '#ff9800' },
    });
  }

  /**
   * Adds a time update listener
   * @param {Function} callback - Callback function to call on timeupdate
   */
  onTimeUpdate(callback) {
    if (this.player) {
      this.player.on('timeupdate', callback);
    }
  }

  /**
   * Gets the current playback time
   * @returns {number} Current time in seconds
   */
  getCurrentTime() {
    return this.player ? this.player.currentTime() : 0;
  }

  /**
   * Seeks to a specific time
   * @param {number} time - Time in seconds
   */
  seek(time) {
    if (this.player) {
      this.player.currentTime(time);
    }
  }

  /**
   * Gets the player instance
   * @returns {Object|null} Video.js player instance
   */
  getPlayer() {
    return this.player;
  }

  /**
   * Checks if player is initialized
   * @returns {boolean} True if player exists
   */
  isInitialized() {
    return this.player !== null;
  }
}

// =============================================================================
// AD DEMO APPLICATION
// =============================================================================

/**
 * Main application class that coordinates all components
 * This is the entry point and acts as the "controller" layer
 */
class AdDemoApp {
  constructor() {
    this.overlayController = new AdOverlayController();
    this.tracker = new AdTracker();
    this.adBreakManager = new AdBreakManager(this.overlayController, this.tracker);
    this.playerManager = new VideoPlayerManager();
    
    this.initializeEventListeners();
  }

  /**
   * Initializes DOM event listeners
   */
  initializeEventListeners() {
    // Load button
    document.getElementById('loadBtn').addEventListener('click', () => this.loadVideo());
    
    // Skip button
    document.getElementById('skipBtn').addEventListener('click', () => this.skipAd());
    
    // Learn More button
    document.getElementById('learnMoreBtn').addEventListener('click', () => this.clickAd());
  }

  /**
   * Main video loading function
   * Fetches VMAP and initializes player with HLS stream
   */
  async loadVideo() {
    // Get form values
    const contentUrl = document.getElementById('contentVideoUrl').value.trim();
    const durationInput = document.getElementById('contentDuration').value;
    const vmapBaseUrl = document.getElementById('vmapBaseUrl').value.trim().replace(/\/$/, '');
    const userId = document.getElementById('userId').value.trim() || 'guest';

    console.log('[APP] Loading video', { contentUrl, duration: durationInput, vmapBaseUrl, userId });

    // Validate input
    if (!contentUrl) {
      alert('Enter MediaTailor HLS URL');
      return;
    }

    const contentDuration = parseInt(durationInput, 10) || 596;

    // Reset state
    this.adBreakManager.reset();

    // Initialize player
    this.playerManager.initialize(contentUrl, contentDuration);

    // Fetch VMAP and set up ad breaks
    try {
      const vmap = await VMAPService.fetchVMAP(vmapBaseUrl, contentDuration, userId);
      const adBreaks = VMAPService.buildAdBreakList(vmap, contentDuration);
      
      console.log('[APP] Ad breaks loaded', { 
        count: adBreaks.length, 
        breaks: adBreaks.map(b => ({ id: b.breakId, time: b.timeInSeconds })) 
      });
      
      this.adBreakManager.setAdBreaks(adBreaks);
      
      // Initialize UI
      this.playerManager.initializeMarkers(
        adBreaks, 
        (index) => this.adBreakManager.getCumulativeAdDuration(index)
      );
      this.overlayController.renderAdBreakInfo(adBreaks);
    } catch (err) {
      console.error('[APP] VMAP error', err);
      document.getElementById('markerInfo').textContent = `VMAP error: ${err.message}`;
    }

    // Set up ad detection
    this.playerManager.onTimeUpdate(() => {
      const currentTime = this.playerManager.getCurrentTime();
      this.adBreakManager.update(currentTime);
    });
  }

  /**
   * Skips the current ad
   */
  skipAd() {
    console.log('[APP] Skip ad requested');
    const player = this.playerManager.getPlayer();
    this.adBreakManager.skipCurrentAd(player);
  }

  /**
   * Handles click on current ad
   */
  clickAd() {
    console.log('[APP] Ad click requested');
    this.adBreakManager.clickCurrentAd();
  }
}

// =============================================================================
// APPLICATION INITIALIZATION
// =============================================================================

/**
 * Initialize the application when DOM is ready
 */
let app = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    app = new AdDemoApp();
  });
} else {
  app = new AdDemoApp();
}
