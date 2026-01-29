/**
 * =============================================================================
 * Ad Demo - VMAP/VAST Ad Integration with Video.js
 * =============================================================================
 * 
 * This application demonstrates how to integrate VMAP (Video Multiple Ad Playlist)
 * and VAST (Video Ad Serving Template) ads into a video player using Video.js.
 * 
 * Key Features:
 * - Pre-roll, mid-roll, and post-roll ad breaks
 * - Ad skip functionality
 * - Click-through tracking
 * - Visual ad break markers on the timeline
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

/** Interval (in seconds) between ad breaks for VMAP generation */
const VMAP_INTERVAL = 300;

// =============================================================================
// GLOBAL STATE
// =============================================================================

/** Video.js player instance */
let player = null;

/** List of ad breaks parsed from VMAP */
let adBreaks = [];

/** Total duration of the content video (in seconds) */
let contentDuration = 0;

/** Original content video source (to restore after ads) */
let contentSource = null;

/** Currently playing ad information (null when no ad is playing) */
let currentAd = null;

/** VAST tracker for the current ad (tracks impressions, clicks, etc.) */
let vastTracker = null;

/** Flag indicating if currently in an ad break (for MediaTailor) */
let isInAdBreak = false;

/** Current ad break being played (for MediaTailor tracking) */
let currentAdBreak = null;

// =============================================================================
// VMAP/VAST UTILITIES
// =============================================================================

/**
 * Converts a VMAP time offset string to seconds
 * 
 * @param {string} timeOffset - Time offset (e.g., "start", "end", "00:01:30")
 * @param {number} totalDuration - Total duration of content in seconds
 * @returns {number} Time in seconds
 */
function parseTimeOffsetToSeconds(timeOffset, totalDuration) {
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
 * Extracts the VAST URL from an ad break
 * 
 * @param {Object} adBreak - VMAP ad break object
 * @returns {string|null} VAST URL or null if not found
 */
function getVastUrlFromBreak(adBreak) {
  if (!adBreak.adSource || !adBreak.adSource.adTagURI) return null;
  const uri = adBreak.adSource.adTagURI;
  return (typeof uri === 'object' && uri.uri) ? uri.uri : uri;
}

/**
 * Fetches and parses a VMAP document from the server
 * 
 * @param {string} vmapBaseUrl - Base URL for VMAP endpoint
 * @param {number} duration - Content duration in seconds
 * @param {string} userId - User ID for personalization
 * @returns {Promise<VMAP>} Parsed VMAP object
 */
async function fetchAndParseVMAP(vmapBaseUrl, duration, userId) {
  const url = `${vmapBaseUrl}?duration=${duration}&interval=${VMAP_INTERVAL}&userId=${encodeURIComponent(userId || 'guest')}`;
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
 * 
 * @param {VMAP} vmap - Parsed VMAP object
 * @param {number} contentDurationSec - Content duration in seconds
 * @returns {Array} Sorted array of ad break objects
 */
function buildAdBreakList(vmap, contentDurationSec) {
  const list = [];
  
  for (let i = 0; i < vmap.adBreaks.length; i++) {
    const br = vmap.adBreaks[i];
    const timeOffset = br.timeOffset || 'start';
    const seconds = parseTimeOffsetToSeconds(timeOffset, contentDurationSec);
    const vastUrl = getVastUrlFromBreak(br);
    
    if (vastUrl != null) {
      list.push({
        index: i,
        timeOffset: timeOffset,
        timeInSeconds: seconds,
        breakId: br.breakId || `break_${i}`,
        vastUrl: vastUrl,
        duration: 30, // Default, will be updated from VAST response
        skipOffset: 5, // Default, will be updated from VAST response
      });
    }
  }
  
  // Sort by time to ensure ads play in chronological order
  return list.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
}

/**
 * Finds the linear creative in a VAST ad
 * (Linear ads are video ads that play in the main player)
 * 
 * @param {Object} ad - VAST ad object
 * @returns {Object|null} Linear creative or null
 */
function getLinearCreative(ad) {
  if (!ad || !ad.creatives) return null;
  return ad.creatives.find((c) => c.type === 'linear' && c.mediaFiles && c.mediaFiles.length) || null;
}

/**
 * Extracts the media file URL from a creative
 * 
 * @param {Object} creative - VAST creative object
 * @returns {string|null} Media file URL or null
 */
function getMediaFileUrl(creative) {
  if (!creative || !creative.mediaFiles || !creative.mediaFiles.length) return null;
  const file = creative.mediaFiles.find((f) => f.fileURL);
  return file ? file.fileURL : null;
}

// =============================================================================
// UI MANAGEMENT
// =============================================================================

/**
 * Shows the ad overlay with skip button and "Learn More" button
 */
function showAdOverlay() {
  console.log('[OVERLAY] Showing ad overlay');
  document.getElementById('adOverlay').classList.add('active');
  document.getElementById('adOverlay').setAttribute('aria-hidden', 'false');
}

/**
 * Hides the ad overlay
 */
function hideAdOverlay() {
  console.log('[OVERLAY] Hiding ad overlay');
  document.getElementById('adOverlay').classList.remove('active');
  document.getElementById('adOverlay').setAttribute('aria-hidden', 'true');
}

/**
 * Updates the skip button UI based on ad progress
 * 
 * @param {number} adElapsed - Time elapsed in the ad (seconds)
 * @param {number} adDuration - Total ad duration (seconds)
 * @param {number} skipOffset - Time when skip becomes available (seconds)
 */
function updateAdUI(adElapsed, adDuration, skipOffset) {
  const skipBtn = document.getElementById('skipBtn');
  const wasDisabled = skipBtn.disabled;
  
  if (adElapsed >= skipOffset) {
    // Skip is now available
    skipBtn.disabled = false;
    skipBtn.innerHTML = 'Skip Ad';
    
    if (wasDisabled) {
      console.log('[AD UI] Skip button enabled', { adElapsed, skipOffset });
    }
  } else {
    // Still counting down to skip
    skipBtn.disabled = true;
    const countdown = Math.ceil(skipOffset - adElapsed);
    skipBtn.innerHTML = `Skip in <span id="skipCounter">${countdown}</span>s`;
  }
}

/**
 * Initializes visual markers on the video timeline for ad breaks
 */
function initMarkers() {
  if (!player.markers) return;
  
  // Only show markers for mid-roll ads (not pre/post-roll)
  const markers = adBreaks
    .filter((br) => br.timeInSeconds > 0 && br.timeInSeconds < contentDuration)
    .map((br) => {
      // Find the original index of this break in the full adBreaks array
      const originalIndex = adBreaks.findIndex(b => b.breakId === br.breakId);
      
      // Calculate cumulative ad duration from all previous ad breaks
      const cumulativeAdDuration = getCumulativeAdDuration(originalIndex);
      
      // Adjust marker position to HLS stream time
      const hlsTime = br.timeInSeconds + cumulativeAdDuration;
      
      return {
        time: hlsTime,
        text: br.breakId || `Ad ${originalIndex + 1}`,
      };
    });
  
  player.markers({
    markers,
    markerStyle: { width: '6px', 'background-color': '#ff9800' },
  });
}

/**
 * Renders ad break information in the UI panel
 */
function renderMarkerInfo() {
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

// =============================================================================
// AD PLAYBACK CONTROL (Legacy - kept for backwards compatibility)
// =============================================================================

// NOTE: Old client-side ad functions removed for MediaTailor:
// - triggerAdBreak() - MediaTailor handles ad playback server-side
// - onAdTimeUpdate() - Replaced by updateAdProgress() in MediaTailor section
// - onAdEnded() - Not needed, detectAdPlayback() monitors time
// - cleanupAdAndResume() - Replaced by endAdBreak() in MediaTailor section
// - seekContentPastAd() - Not needed, single HLS stream (no source switching)
//
// New ad detection is done via detectAdPlayback() which monitors currentTime against VMAP schedule

/**
 * Skips the current ad (called when user clicks skip button)
 * For MediaTailor: seeks forward in the stream instead of source switching
 */
function skipAd() {
  console.log('[SKIP AD] Skip button clicked', { 
    hasCurrentAd: !!currentAd,
    hasCurrentAdBreak: !!currentAdBreak,
    hasTracker: !!vastTracker,
    hasPlayer: !!player,
    playerTime: player ? player.currentTime() : 'N/A'
  });
  
  // For old client-side ads (if currentAd exists)
  if (currentAd && !currentAdBreak) {
    console.warn('[SKIP AD] Using old client-side skip logic');
    if (!player) {
      console.error('[SKIP AD] Cannot skip - no player');
      return;
    }
    player.pause();
    cleanupAdAndResume(true);
    return;
  }
  
  // For MediaTailor server-stitched ads
  if (!currentAdBreak || !player) {
    console.warn('[SKIP AD] Cannot skip - no active ad break');
    return;
  }
  
  // Calculate cumulative ad duration from all previous ad breaks
  const breakIndex = adBreaks.findIndex(b => b.breakId === currentAdBreak.breakId);
  const cumulativeAdDuration = getCumulativeAdDuration(breakIndex);
  
  // Adjust end time to HLS stream time (content time + cumulative ads + current ad)
  const adDuration = currentAdBreak.duration || 30; // Use actual duration from VAST
  const endTime = currentAdBreak.timeInSeconds + cumulativeAdDuration + adDuration;
  
  console.log('[SKIP AD] Skipping to HLS time', { 
    contentTime: currentAdBreak.timeInSeconds,
    cumulativeAds: cumulativeAdDuration,
    adDuration,
    hlsEndTime: endTime 
  });
  
  // Track skip event
  if (vastTracker) {
    vastTracker.skip();
  }
  
  // Seek to end of ad break (stays in same stream)
  player.currentTime(endTime);
  
  // detectAdPlayback() will handle cleanup
}

/**
 * Handles ad click-through (when user clicks "Learn More")
 */
function clickAd() {
  // Support both old client-side ads and new MediaTailor ads
  const adInfo = currentAdBreak || currentAd;
  
  if (!adInfo) {
    console.warn('[CLICK AD] No active ad');
    return;
  }
  
  console.log('[CLICK AD] Processing click', {
    hasClickThrough: !!adInfo.clickThrough,
    clickThroughUrl: adInfo.clickThrough,
    adId: adInfo.breakId || adInfo.breakInfo?.breakId
  });
  
  // Track click event with VAST tracker
  if (vastTracker) {
    vastTracker.once('clickthrough', (url) => {
      console.log('[CLICK AD] VAST tracker returned clickthrough URL:', url);
      if (url) {
        window.open(url, '_blank');
      }
    });
    vastTracker.click();
  }
  
  // Open click-through URL if available in our stored data
  if (adInfo.clickThrough) {
    console.log('[CLICK AD] Opening stored clickThrough URL:', adInfo.clickThrough);
    window.open(adInfo.clickThrough, '_blank');
  } else {
    console.warn('[CLICK AD] ⚠️ No click-through URL available in VAST creative');
    console.log('[CLICK AD] This means your VAST XML is missing <ClickThrough> tag');
  }
}

// CONTENT PLAYBACK CONTROL section removed - no source switching needed for MediaTailor
// Single HLS stream contains both content and ads

// =============================================================================
// MEDIATAILOR AD DETECTION AND TRACKING
// =============================================================================

/**
 * Calculate cumulative ad duration up to a specific ad break index
 * Uses actual durations from VAST when available, defaults to 30s
 * @param {number} upToIndex - Calculate cumulative duration up to (but not including) this index
 * @returns {number} Total duration in seconds
 */
function getCumulativeAdDuration(upToIndex) {
  let total = 0;
  for (let i = 0; i < upToIndex && i < adBreaks.length; i++) {
    total += adBreaks[i].duration || 30; // Use actual duration or default to 30s
  }
  return total;
}

/**
 * Monitors playback time against VMAP ad schedule
 * Shows/hides overlay when entering/exiting ad breaks
 * (For MediaTailor server-stitched ads)
 */
function detectAdPlayback() {
  if (!player || adBreaks.length === 0) return;
  
  const hlsTime = player.currentTime();
  
  // Find if we're currently in an ad break
  // Need to account for MediaTailor ad stitching: each ad shifts the timeline
  const activeBreak = adBreaks.find((br, index) => {
    const adDuration = br.duration || 30; // Use actual duration from VAST or default to 30s
    
    // Calculate cumulative ad duration from all previous ad breaks
    const cumulativeAdDuration = getCumulativeAdDuration(index);
    
    // Adjust the break time by adding cumulative ad duration
    // This converts content time to HLS stream time
    const startTime = br.timeInSeconds + cumulativeAdDuration;
    const endTime = startTime + adDuration;
    
    return hlsTime >= startTime && hlsTime < endTime;
  });
  
  if (activeBreak && !isInAdBreak) {
    // Entering ad break
    startAdBreak(activeBreak);
  } else if (!activeBreak && isInAdBreak) {
    // Exiting ad break
    endAdBreak();
  } else if (activeBreak && isInAdBreak && currentAdBreak) {
    // During ad break - update UI
    // Calculate adjusted start time accounting for previous ads
    const breakIndex = adBreaks.findIndex(b => b.breakId === currentAdBreak.breakId);
    const cumulativeAdDuration = getCumulativeAdDuration(breakIndex);
    const adjustedStartTime = currentAdBreak.timeInSeconds + cumulativeAdDuration;
    const elapsed = hlsTime - adjustedStartTime;
    updateAdProgress(elapsed);
  }
}

/**
 * Called when entering an ad break
 * Initializes UI overlay and VAST tracking
 */
function startAdBreak(breakInfo) {
  console.log('[AD START] Entering ad break', breakInfo.breakId);
  
  isInAdBreak = true;
  currentAdBreak = breakInfo;
  
  // Show overlay
  showAdOverlay();
  
  // Initialize VAST tracking (for pixels, not playback)
  initializeAdTracking(breakInfo);
}

/**
 * Called when exiting an ad break
 * Completes tracking and hides UI overlay
 */
function endAdBreak() {
  console.log('[AD END] Exiting ad break');
  
  // Complete tracking
  if (vastTracker) {
    vastTracker.complete();
    vastTracker = null;
  }
  
  isInAdBreak = false;
  currentAdBreak = null;
  
  // Hide overlay
  hideAdOverlay();
}

/**
 * Updates UI and tracking during ad playback
 * @param {number} elapsed - Seconds elapsed in current ad
 */
function updateAdProgress(elapsed) {
  if (!currentAdBreak) return;
  
  const duration = currentAdBreak.duration || 30; // Use actual duration from VAST
  const skipOffset = currentAdBreak.skipOffset || 5; // Use actual skip offset from VAST
  
  // Update skip button UI
  updateAdUI(elapsed, duration, skipOffset);
  
  // Track quartiles
  if (vastTracker) {
    vastTracker.setProgress(elapsed);
  }
}

/**
 * Initialize VAST tracking for server-stitched ad
 * MediaTailor plays the ad - we just fire tracking pixels
 * @param {Object} breakInfo - Ad break information from VMAP
 */
async function initializeAdTracking(breakInfo) {
  const vastUrl = breakInfo.vastUrl;
  
  if (!vastUrl) {
    console.warn('[TRACKING] No VAST URL available');
    return;
  }
  
  try {
    const vastClient = new VASTClient(0, 0);
    const vastResponse = await vastClient.get(vastUrl);
    
    const validAd = vastResponse.ads.find(a => a.creatives && a.creatives.length);
    if (!validAd) return;
    
    const creative = getLinearCreative(validAd);
    if (!creative) return;
    
    // Store ad metadata from VAST
    if (creative.videoClickThroughURLTemplate) {
      currentAdBreak.clickThrough = creative.videoClickThroughURLTemplate.url || creative.videoClickThroughURLTemplate;
    }
    
    // Store duration and skip offset from VAST
    currentAdBreak.duration = creative.duration || 30; // Default to 30s if not available
    currentAdBreak.skipOffset = creative.skipDelay || 5; // Default to 5s if not available
    
    // Update the adBreaks array with actual duration for this break
    const breakIndex = adBreaks.findIndex(b => b.breakId === breakInfo.breakId);
    if (breakIndex !== -1) {
      adBreaks[breakIndex].duration = currentAdBreak.duration;
      adBreaks[breakIndex].skipOffset = currentAdBreak.skipOffset;
    }
    
    // Create tracker (MediaTailor plays the video, we just track)
    vastTracker = new VASTTracker(null, validAd, creative);
    vastTracker.trackImpression();
    
    console.log('[TRACKING] VAST tracker initialized', { 
      duration: currentAdBreak.duration, 
      skipOffset: currentAdBreak.skipOffset 
    });
  } catch (err) {
    console.error('[TRACKING] Failed to initialize VAST tracker', err);
  }
}

// handleContentTimeUpdate() removed - replaced by detectAdPlayback() for MediaTailor

// =============================================================================
// INITIALIZATION AND SETUP
// =============================================================================

/**
 * Main initialization function - loads video and VMAP
 * For MediaTailor: loads HLS stream and fetches VMAP for ad schedule
 */
function loadVideoAndVMAP() {
  // Get form values
  const contentUrl = document.getElementById('contentVideoUrl').value.trim();
  const durationInput = document.getElementById('contentDuration').value;
  const vmapBaseUrl = document.getElementById('vmapBaseUrl').value.trim().replace(/\/$/, '');
  const userId = document.getElementById('userId').value.trim() || 'guest';

  console.log('[LOAD VIDEO] Loading MediaTailor stream and VMAP', { 
    contentUrl, 
    duration: durationInput, 
    vmapBaseUrl, 
    userId 
  });

  // Validate MediaTailor URL
  if (!contentUrl) {
    alert('Enter MediaTailor HLS URL');
    return;
  }

  contentDuration = parseInt(durationInput, 10) || 596;

  // Dispose of existing player if any
  if (player) {
    console.log('[LOAD VIDEO] Disposing existing player');
    player.dispose();
    player = null;
  }

  // Create new Video.js player with HLS support
  console.log('[LOAD VIDEO] Creating new player');
  player = videojs('videoPlayer', {
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

  // Reset state
  adBreaks = [];
  isInAdBreak = false;
  currentAdBreak = null;

  // Fetch VMAP (same one MediaTailor uses)
  fetchAndParseVMAP(vmapBaseUrl, contentDuration, userId)
    .then((vmap) => {
      adBreaks = buildAdBreakList(vmap, contentDuration);
      console.log('[LOAD VIDEO] Ad breaks loaded from VMAP', { 
        count: adBreaks.length, 
        breaks: adBreaks.map(b => ({ id: b.breakId, time: b.timeInSeconds })) 
      });
      
      // Initialize UI markers and info
      initMarkers();
      renderMarkerInfo();
    })
    .catch((err) => {
      console.error('[LOAD VIDEO] VMAP error', err);
      document.getElementById('markerInfo').textContent = `VMAP error: ${err.message}`;
    });

  // Load MediaTailor HLS stream (pre-stitched with ads)
  player.src({ src: contentUrl, type: 'application/x-mpegURL' });
  contentSource = { src: contentUrl, type: 'application/x-mpegURL' };

  // Monitor playback for ad detection
  console.log('[LOAD VIDEO] Adding ad detection listener');
  player.on('timeupdate', detectAdPlayback);
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

/**
 * Load button - initializes video and VMAP
 */
document.getElementById('loadBtn').addEventListener('click', loadVideoAndVMAP);

/**
 * Skip button - skips the current ad
 */
document.getElementById('skipBtn').addEventListener('click', () => {
  console.log('[SKIP BUTTON] Skip button clicked', { 
    hasCurrentAdBreak: !!currentAdBreak,
    hasCurrentAd: !!currentAd,
    buttonDisabled: document.getElementById('skipBtn').disabled 
  });
  
  // Support both MediaTailor (currentAdBreak) and old client-side (currentAd)
  if (!currentAdBreak && !currentAd) {
    console.warn('[SKIP BUTTON] No current ad to skip');
    return;
  }
  
  skipAd();
});

/**
 * Learn More button - opens ad click-through URL
 */
document.getElementById('learnMoreBtn').addEventListener('click', () => {
  console.log('[LEARN MORE] Learn more button clicked', { 
    hasCurrentAdBreak: !!currentAdBreak,
    hasCurrentAd: !!currentAd 
  });
  
  // Support both MediaTailor (currentAdBreak) and old client-side (currentAd)
  if (!currentAdBreak && !currentAd) {
    console.warn('[LEARN MORE] No current ad');
    return;
  }
  
  clickAd();
});
