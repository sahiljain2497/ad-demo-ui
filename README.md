# Ad Demo - VMAP/VAST Integration

A demonstration of integrating VMAP (Video Multiple Ad Playlist) and VAST (Video Ad Serving Template) ads with Video.js.

## Features

- ✅ Pre-roll, mid-roll, and post-roll ad support
- ✅ Ad skip functionality with countdown timer
- ✅ Click-through tracking
- ✅ Visual ad break markers on timeline
- ✅ Comprehensive logging for debugging
- ✅ VAST impression and event tracking

## Code Organization

The `app.js` file is organized into clear sections:

### 1. **Imports and Constants**
- Third-party dependencies (VMAP, VAST, Video.js)
- Configuration constants (intervals, tolerances)

### 2. **Global State**
- Player instance and ad break data
- Current ad state and tracking information

### 3. **VMAP/VAST Utilities**
- `parseTimeOffsetToSeconds()` - Converts VMAP time offsets to seconds
- `fetchAndParseVMAP()` - Fetches and parses VMAP XML
- `buildAdBreakList()` - Builds sorted list of ad breaks
- `getLinearCreative()` - Extracts video ad creative from VAST
- `getMediaFileUrl()` - Gets video file URL from creative

### 4. **UI Management**
- `showAdOverlay()` / `hideAdOverlay()` - Controls ad overlay visibility
- `updateAdUI()` - Updates skip button countdown
- `initMarkers()` - Adds visual markers to timeline
- `renderMarkerInfo()` - Displays ad break information

### 5. **Ad Playback Control**
- `triggerAdBreak()` - Initiates an ad break
- `onAdTimeUpdate()` - Handles ad progress updates
- `onAdEnded()` - Handles ad completion
- `cleanupAdAndResume()` - Cleans up ad state and resumes content
- `skipAd()` - Handles ad skip action
- `clickAd()` - Handles ad click-through

### 6. **Content Playback Control**
- `seekContentPastAd()` - Resumes content after ad
- `handleContentTimeUpdate()` - Monitors content playback for ad triggers

### 7. **Initialization and Setup**
- `loadVideoAndVMAP()` - Main initialization function

### 8. **Event Listeners**
- Button click handlers (Load, Skip, Learn More)

## How It Works

### Ad Break Flow

```
1. User clicks "Load video & VMAP"
   ↓
2. VMAP is fetched and parsed
   ↓
3. Ad breaks are extracted and sorted
   ↓
4. Content video starts playing
   ↓
5. When content reaches an ad break time:
   a. Content pauses
   b. VAST is fetched for that break
   c. Ad video is loaded and plays
   d. Ad overlay shows (with skip button)
   ↓
6. When ad completes or is skipped:
   a. Ad state is cleaned up
   b. Content source is restored
   c. Playback resumes past the ad break
```

### Skip Functionality

The skip button becomes enabled after the `skipOffset` time (typically 5 seconds). When clicked:

1. Ad playback is **immediately paused**
2. Ad state is cleaned up (listeners removed, state cleared)
3. VAST skip event is tracked
4. Content source is restored
5. Content resumes past the ad break point

## Key Implementation Details

### Race Condition Prevention

The code prevents race conditions by:
- Clearing state immediately after storing necessary values
- Removing event listeners before cleanup
- Checking for null state in event handlers

### Proper Seeking

After an ad, the content is seeked to `adStartTime + adDuration + 0.5s` to ensure:
- The ad break point is passed
- No re-triggering of the same ad
- Smooth transition back to content

### VAST Duration

**Important**: The ad duration specified in the VAST XML `<Duration>` tag **must match** the actual video file length. If they don't match:
- The skip button will hide at the wrong time
- Content may resume too early or too late
- User experience will be degraded

## Debugging

All functions log their operations with prefixed tags:

- `[LOAD VIDEO]` - Video initialization
- `[TRIGGER AD]` - Ad break triggering
- `[AD TIME UPDATE]` - Ad playback progress
- `[SKIP AD]` - Skip button actions
- `[AD CLEANUP]` - State cleanup
- `[SEEK CONTENT]` - Content resumption
- `[OVERLAY]` - UI overlay changes
- `[CONTENT TIME]` - Content playback monitoring

Open the browser console (F12) to see detailed logs.

## Development

### Build

```bash
npm run build
```

This bundles `app.js` using esbuild into `dist/app.js`.

### Dev Server

```bash
npm run dev
```

Starts a live-reload development server at `http://127.0.0.1:8080`.

## Browser Compatibility

- Modern browsers with ES6+ support
- Requires HLS support for `.m3u8` content URLs
- Video.js handles cross-browser video playback

## VAST Requirements

Your VAST XML must include:

- `<Duration>` - **Must match actual video length**
- `<Linear skipoffset="HH:MM:SS">` - When skip becomes available
- `<MediaFile>` - Video file URL
- `<ClickThrough>` - Optional click-through URL

Example:
```xml
<Creative>
  <Linear skipoffset="00:00:05">
    <Duration>00:00:30</Duration>
    <MediaFiles>
      <MediaFile delivery="progressive" type="video/mp4">
        <![CDATA[https://example.com/ad.mp4]]>
      </MediaFile>
    </MediaFiles>
    <VideoClicks>
      <ClickThrough>
        <![CDATA[https://example.com/advertiser]]>
      </ClickThrough>
    </VideoClicks>
  </Linear>
</Creative>
```

## Troubleshooting

### Skip button disappears but ad keeps playing

**Cause**: VAST duration doesn't match actual video length  
**Solution**: Update VAST `<Duration>` to match the video file

### Ad doesn't trigger

**Cause**: Content time doesn't match ad break time  
**Solution**: Check ad break times in console logs, adjust `AD_TRIGGER_TOLERANCE`

### Content doesn't resume after ad

**Cause**: `contentSource` is null or invalid  
**Solution**: Ensure content URL is set before ad plays, check console logs

## License

ISC
# ad-demo-ui
