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

/** Tolerance (in seconds) for triggering ad breaks near target times */
const AD_TRIGGER_TOLERANCE = 0.5;

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

/** Index of the last triggered ad break (prevents re-triggering) */
let lastTriggeredBreakIndex = -1;

/** Current playback time of the ad (used for tracking) */
let adPlaybackStartTime = 0;

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
    .map((br) => ({
      time: br.timeInSeconds,
      text: br.breakId || `Ad ${br.index + 1}`,
    }));
  
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
// AD PLAYBACK CONTROL
// =============================================================================

/**
 * Triggers an ad break by fetching and playing the VAST ad
 * 
 * @param {Object} breakInfo - Ad break information from VMAP
 */
function triggerAdBreak(breakInfo) {
  console.log('[TRIGGER AD] Ad break triggered', { 
    breakId: breakInfo.breakId, 
    timeInSeconds: breakInfo.timeInSeconds,
    hasCurrentAd: !!currentAd 
  });
  
  // Don't trigger if already playing an ad
  if (currentAd) {
    console.warn('[TRIGGER AD] Already playing an ad, skipping');
    return;
  }
  
  // Mark this break as triggered
  lastTriggeredBreakIndex = breakInfo.index;
  const vastUrl = breakInfo.vastUrl;

  console.log('[TRIGGER AD] Fetching VAST from', vastUrl);
  
  // Fetch and parse VAST XML
  const vastClient = new VASTClient(0, 0);
  vastClient
    .get(vastUrl)
    .then((vastResponse) => {
      console.log('[TRIGGER AD] VAST response received', { adsCount: vastResponse.ads.length });
      
      // Find a valid ad with creatives
      const validAd = vastResponse.ads.find((a) => a.creatives && a.creatives.length);
      if (!validAd) {
        console.warn('[TRIGGER AD] No valid ad found in VAST response');
        return;
      }
      
      // Get the linear creative (video ad)
      const creative = getLinearCreative(validAd);
      if (!creative) {
        console.warn('[TRIGGER AD] No linear creative found');
        return;
      }
      
      // Get the media file URL
      const mediaUrl = getMediaFileUrl(creative);
      if (!mediaUrl) {
        console.warn('[TRIGGER AD] No media URL found');
        return;
      }

      // Extract ad properties
      const duration = creative.duration > 0 ? creative.duration : 15;
      const skipOffset = creative.skipDelay != null && creative.skipDelay >= 0 ? creative.skipDelay : 5;
      
      // Try multiple locations for clickthrough URL
      // Different VAST parsers may store it in different places
      let clickThrough = null;
      
      // Check creative level first
      if (creative.videoClickThroughURLTemplate) {
        clickThrough = creative.videoClickThroughURLTemplate.url || creative.videoClickThroughURLTemplate;
      }
      // Check ad level (some parsers store it here)
      else if (validAd.videoClickThroughURLTemplate) {
        clickThrough = validAd.videoClickThroughURLTemplate.url || validAd.videoClickThroughURLTemplate;
      }
      // Check for videoClicks object
      else if (creative.videoClicks && creative.videoClicks.clickThroughURLTemplate) {
        clickThrough = creative.videoClicks.clickThroughURLTemplate.url || creative.videoClicks.clickThroughURLTemplate;
      }

      console.log('[TRIGGER AD] Ad details', { 
        mediaUrl, 
        duration, 
        skipOffset, 
        hasClickThrough: !!clickThrough,
        clickThroughUrl: clickThrough,
        // Debug info to help find where it is
        creativeProps: Object.keys(creative),
        hasVideoClicks: !!creative.videoClicks,
        adProps: Object.keys(validAd)
      });
      
      if (!clickThrough) {
        console.warn('[TRIGGER AD] ⚠️ No clickThrough URL found in VAST creative. "Learn More" button will not work.');
        console.log('[TRIGGER AD] Check your VAST XML for <VideoClicks><ClickThrough> tag');
        console.log('[TRIGGER AD] Debug - Creative object:', creative);
        console.log('[TRIGGER AD] Debug - Ad object:', validAd);
      }

      // Store current ad information
      currentAd = {
        breakInfo,
        ad: validAd,
        creative,
        duration,
        skipOffset,
        clickThrough,
        mediaUrl,
        startContentTime: breakInfo.timeInSeconds,
      };

      // Initialize VAST tracker for analytics
      vastTracker = new VASTTracker(null, validAd, creative);
      vastTracker.trackImpression();

      // Show ad overlay UI
      showAdOverlay();
      adPlaybackStartTime = 0;

      // Pause content and switch to ad
      console.log('[TRIGGER AD] Pausing content and loading ad');
      player.pause();
      
      // Temporarily remove content timeupdate listener to prevent false triggers
      player.off('timeupdate', handleContentTimeUpdate);
      
      contentSource = player.currentSource();
      player.src({ src: mediaUrl, type: 'video/mp4' });
      
      // Play ad when ready
      player.one('canplay', () => {
        if (!vastTracker || !currentAd) {
          console.warn('[TRIGGER AD] Ad was cleaned up before canplay event');
          return;
        }
        console.log('[TRIGGER AD] Ad ready to play');
        vastTracker.load();
        
        // Set up ad event listeners AFTER the ad is ready to avoid stale timeupdate events
        player.one('ended', onAdEnded);
        player.on('timeupdate', onAdTimeUpdate);
        
        player.play()
          .then(() => console.log('[TRIGGER AD] Ad playback started'))
          .catch((err) => console.error('[TRIGGER AD] Failed to play ad', err));
      });
    })
    .catch((err) => {
      console.error('[TRIGGER AD] VAST error', err);
      lastTriggeredBreakIndex = -1;
    });
}

/**
 * Handles time updates during ad playback
 * Updates UI and checks if ad is complete
 */
function onAdTimeUpdate() {
  if (!currentAd || !player || !vastTracker) {
    // State was cleared, stop processing
    return;
  }
  
  const elapsed = player.currentTime();
  adPlaybackStartTime = elapsed;
  
  // Track progress for VAST analytics
  vastTracker.setProgress(elapsed);
  
  // Update skip button UI
  updateAdUI(elapsed, currentAd.duration, currentAd.skipOffset);

  // Check if ad duration reached
  if (elapsed >= currentAd.duration) {
    console.log('[AD TIME UPDATE] Ad duration reached, completing ad');
    vastTracker.complete();
    cleanupAdAndResume(false);
  }
}

/**
 * Handles the ad video 'ended' event
 */
function onAdEnded() {
  console.log('[AD ENDED] Ad video ended event fired');
  
  if (!currentAd) {
    console.warn('[AD ENDED] No current ad');
    return;
  }
  
  if (vastTracker) {
    console.log('[AD ENDED] Tracking completion');
    vastTracker.complete();
  }
  
  cleanupAdAndResume(false);
}

/**
 * Cleans up ad state and resumes content playback
 * 
 * @param {boolean} wasSkipped - Whether the ad was skipped by the user
 */
function cleanupAdAndResume(wasSkipped = false) {
  console.log('[AD CLEANUP] Starting cleanup', { wasSkipped, hasCurrentAd: !!currentAd });
  
  if (!currentAd) {
    console.warn('[AD CLEANUP] No current ad to cleanup');
    return;
  }

  // Store values before clearing state
  const startContentTime = currentAd.startContentTime;
  const adDuration = currentAd.duration;
  const adId = currentAd.breakInfo?.breakId || 'unknown';
  
  console.log('[AD CLEANUP] Ad details', { adId, startContentTime, adDuration, wasSkipped });
  
  // Remove event listeners to prevent further ad operations
  player.off('timeupdate', onAdTimeUpdate);
  player.off('ended', onAdEnded);
  
  // Track skip or completion for VAST analytics
  if (wasSkipped && vastTracker) {
    console.log('[AD CLEANUP] Tracking skip event');
    vastTracker.skip();
  } else if (vastTracker) {
    console.log('[AD CLEANUP] Ad completed normally');
  }
  
  // Clear state immediately to prevent race conditions
  currentAd = null;
  vastTracker = null;
  
  // Hide ad overlay
  hideAdOverlay();
  
  // Resume content playback
  console.log('[AD CLEANUP] Resuming content playback');
  seekContentPastAd(startContentTime, adDuration);
}

/**
 * Skips the current ad (called when user clicks skip button)
 */
function skipAd() {
  console.log('[SKIP AD] Skip button clicked', { 
    hasCurrentAd: !!currentAd, 
    hasTracker: !!vastTracker,
    hasPlayer: !!player,
    playerTime: player ? player.currentTime() : 'N/A'
  });
  
  if (!currentAd) {
    console.warn('[SKIP AD] Cannot skip - no current ad');
    return;
  }
  
  if (!player) {
    console.error('[SKIP AD] Cannot skip - no player');
    return;
  }
  
  // Immediately pause to stop ad playback
  console.log('[SKIP AD] Pausing ad playback immediately');
  player.pause();
  
  // Clean up and resume content
  cleanupAdAndResume(true);
}

/**
 * Handles ad click-through (when user clicks "Learn More")
 */
function clickAd() {
  if (!currentAd || !vastTracker) {
    console.warn('[CLICK AD] Cannot click - missing ad or tracker');
    return;
  }
  
  console.log('[CLICK AD] Processing click', {
    hasClickThrough: !!currentAd.clickThrough,
    clickThroughUrl: currentAd.clickThrough,
    adId: currentAd.breakInfo?.breakId
  });
  
  // Track click event with VAST tracker
  vastTracker.once('clickthrough', (url) => {
    console.log('[CLICK AD] VAST tracker returned clickthrough URL:', url);
    if (url) {
      window.open(url, '_blank');
    }
  });
  vastTracker.click();
  
  // Open click-through URL if available in our stored data
  if (currentAd.clickThrough) {
    console.log('[CLICK AD] Opening stored clickThrough URL:', currentAd.clickThrough);
    window.open(currentAd.clickThrough, '_blank');
  } else {
    console.warn('[CLICK AD] ⚠️ No click-through URL available in VAST creative');
    console.log('[CLICK AD] This means your VAST XML is missing <ClickThrough> tag');
  }
}

// =============================================================================
// CONTENT PLAYBACK CONTROL
// =============================================================================

/**
 * Seeks content video past the ad break and resumes playback
 * 
 * @param {number} adStartTime - Time when ad break started (seconds)
 * @param {number} adDuration - Duration of the ad (seconds)
 */
function seekContentPastAd(adStartTime, adDuration) {
  if (!player) {
    console.error('[SEEK CONTENT] No player available');
    return;
  }
  
  // Calculate where to resume (slightly past the ad break point)
  const seekTo = Math.min(adStartTime + adDuration + 0.5, contentDuration);
  
  console.log('[SEEK CONTENT] Switching back to content', { 
    adStartTime, 
    adDuration, 
    seekTo,
    contentDuration,
    currentSource: player.currentSource()
  });
  
  // Pause immediately
  player.pause();
  
  // Validate content source
  if (!contentSource || !contentSource.src) {
    console.error('[SEEK CONTENT] No content source available!');
    return;
  }
  
  // Switch back to content source
  player.src(contentSource);
  
  // Wait for content to load, then seek and play
  player.one('loadedmetadata', () => {
    console.log('[SEEK CONTENT] Content loaded, seeking to', seekTo);
    player.currentTime(seekTo);
    
    player.play()
      .then(() => {
        console.log('[SEEK CONTENT] Content playback resumed successfully');
        // Re-enable content timeupdate listener after seek completes
        player.on('timeupdate', handleContentTimeUpdate);
      })
      .catch((err) => {
        console.error('[SEEK CONTENT] Failed to resume content playback', err);
        // Re-enable even on error to maintain functionality
        player.on('timeupdate', handleContentTimeUpdate);
      });
  });
  
  // Handle loading errors
  player.one('error', (e) => {
    console.error('[SEEK CONTENT] Error loading content', e);
    // Re-enable content timeupdate listener even on error
    player.on('timeupdate', handleContentTimeUpdate);
  });
}

/**
 * Monitors content playback and triggers ad breaks at appropriate times
 */
function handleContentTimeUpdate() {
  // Don't trigger ads if one is already playing
  if (currentAd) return;
  
  const t = player.currentTime();
  
  // Extra safety: ignore if current source is not the content (i.e., it's an ad)
  const currentSrc = player.currentSource();
  if (!contentSource || !currentSrc || currentSrc.src !== contentSource.src) {
    return;
  }
  
  // Check each ad break
  for (let i = 0; i < adBreaks.length; i++) {
    const br = adBreaks[i];
    
    // Skip if already triggered
    if (lastTriggeredBreakIndex === i) continue;
    
    // Pre-roll ad (at start)
    if (br.timeInSeconds <= 0) {
      if (t < AD_TRIGGER_TOLERANCE) {
        console.log('[CONTENT TIME] Triggering pre-roll ad at', t);
        triggerAdBreak(br);
        return;
      }
    } 
    // Post-roll ad (at end)
    else if (br.timeInSeconds >= contentDuration - AD_TRIGGER_TOLERANCE) {
      if (t >= contentDuration - AD_TRIGGER_TOLERANCE) {
        console.log('[CONTENT TIME] Triggering post-roll ad at', t);
        triggerAdBreak(br);
        return;
      }
    } 
    // Mid-roll ad (during playback)
    else if (Math.abs(t - br.timeInSeconds) <= AD_TRIGGER_TOLERANCE) {
      console.log('[CONTENT TIME] Triggering mid-roll ad at', t, 'for break at', br.timeInSeconds);
      triggerAdBreak(br);
      return;
    }
  }
}

// =============================================================================
// INITIALIZATION AND SETUP
// =============================================================================

/**
 * Main initialization function - loads video and VMAP
 */
function loadVideoAndVMAP() {
  // Get form values
  const contentUrl = document.getElementById('contentVideoUrl').value.trim();
  const durationInput = document.getElementById('contentDuration').value;
  const vmapBaseUrl = document.getElementById('vmapBaseUrl').value.trim().replace(/\/$/, '');
  const userId = document.getElementById('userId').value.trim() || 'guest';

  console.log('[LOAD VIDEO] Loading video and VMAP', { 
    contentUrl, 
    duration: durationInput, 
    vmapBaseUrl, 
    userId 
  });

  // Validate content URL
  if (!contentUrl) {
    alert('Enter content video URL');
    return;
  }

  contentDuration = parseInt(durationInput, 10) || 596;

  // Dispose of existing player if any
  if (player) {
    console.log('[LOAD VIDEO] Disposing existing player');
    player.dispose();
    player = null;
  }

  // Create new Video.js player
  console.log('[LOAD VIDEO] Creating new player');
  player = videojs('videoPlayer', {
    controls: true,
    preload: 'auto',
    responsive: true,
    fluid: true,
  });

  // Reset state
  lastTriggeredBreakIndex = -1;
  adBreaks = [];

  // Fetch and parse VMAP
  fetchAndParseVMAP(vmapBaseUrl, contentDuration, userId)
    .then((vmap) => {
      adBreaks = buildAdBreakList(vmap, contentDuration);
      console.log('[LOAD VIDEO] Ad breaks loaded', { 
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

  // Load content video
  player.src({ src: contentUrl, type: 'video/mp4' });
  contentSource = { src: contentUrl, type: 'video/mp4' };

  // Start monitoring for ad breaks
  console.log('[LOAD VIDEO] Content source set, adding timeupdate listener');
  player.on('timeupdate', handleContentTimeUpdate);
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
    hasCurrentAd: !!currentAd,
    buttonDisabled: document.getElementById('skipBtn').disabled 
  });
  
  if (!currentAd) {
    console.warn('[SKIP BUTTON] No current ad to skip');
    return;
  }
  
  skipAd();
});

/**
 * Learn More button - opens ad click-through URL
 */
document.getElementById('learnMoreBtn').addEventListener('click', () => {
  console.log('[LEARN MORE] Learn more button clicked', { hasCurrentAd: !!currentAd });
  
  if (!currentAd) {
    console.warn('[LEARN MORE] No current ad');
    return;
  }
  
  clickAd();
});
