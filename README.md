# Ad Demo - VMAP/VAST Integration

A demonstration of integrating VMAP (Video Multiple Ad Playlist) and VAST (Video Ad Serving Template) ads with Video.js, featuring AWS MediaTailor server-side ad stitching support.

## Features

- ✅ Pre-roll, mid-roll, and post-roll ad support
- ✅ AWS MediaTailor server-side ad stitching integration
- ✅ Ad skip functionality with countdown timer
- ✅ Click-through tracking with VAST events
- ✅ Visual ad break markers on timeline
- ✅ Comprehensive logging for debugging
- ✅ VAST impression and quartile event tracking
- ✅ Clean class-based architecture (Angular-ready)

## Architecture Overview

The application uses a clean, class-based architecture designed for maintainability and easy migration to Angular. Each class has a single responsibility and clear interfaces.

```
┌─────────────────────────────────────────────────────────────────┐
│                         AdDemoApp                                │
│                  (Main Application Controller)                   │
│  - Coordinates all components                                    │
│  - Handles user interactions                                     │
│  - Manages application lifecycle                                 │
└────────┬────────────────────────────────────────────────────────┘
         │
         ├──> VideoPlayerManager
         │    - Manages Video.js player instance
         │    - Controls playback and seeking
         │    - Initializes timeline markers
         │
         ├──> AdBreakManager
         │    - Manages ad break scheduling
         │    - Detects active ad breaks
         │    - Calculates cumulative ad durations
         │    │
         │    ├──> AdOverlayController
         │    │    - Controls ad overlay UI
         │    │    - Updates skip button
         │    │    - Renders ad break info
         │    │
         │    └──> AdTracker
         │         - Handles VAST tracking
         │         - Fires impression/click pixels
         │         - Tracks quartile events
         │
         └──> VMAPService (Static utility class)
              - Fetches and parses VMAP
              - Parses VAST responses
              - Time offset conversions
```

## Class Responsibilities

### **AdDemoApp**
The main application coordinator that acts as the "controller" layer.

**Responsibilities:**
- Initialize all components
- Handle user interactions (load, skip, click)
- Coordinate between components
- Manage application state transitions

**Key Methods:**
- `loadVideo()` - Loads HLS stream and VMAP
- `skipAd()` - Handles skip button click
- `clickAd()` - Handles learn more button click

---

### **VideoPlayerManager**
Manages the Video.js player instance and playback control.

**Responsibilities:**
- Initialize/dispose Video.js player
- Control playback (seek, play, pause)
- Add timeline markers for ad breaks
- Provide playback time information

**Key Methods:**
- `initialize(contentUrl, duration)` - Creates player with HLS stream
- `initializeMarkers(adBreaks, getCumulativeDuration)` - Adds visual markers
- `getCurrentTime()` - Returns current playback time
- `seek(time)` - Seeks to specific time

---

### **AdBreakManager**
Manages ad break scheduling, detection, and state coordination.

**Responsibilities:**
- Store and manage ad break schedule
- Detect when entering/exiting ad breaks
- Calculate cumulative ad durations (for MediaTailor timeline adjustment)
- Coordinate overlay and tracker during ad playback
- Handle skip and click actions

**Key Methods:**
- `setAdBreaks(adBreaks)` - Sets the ad schedule from VMAP
- `update(hlsTime)` - Called on timeupdate to detect ad transitions
- `detectActiveBreak(hlsTime)` - Finds active ad break at given time
- `startAdBreak(breakInfo)` - Enters ad break, shows overlay, starts tracking
- `endAdBreak()` - Exits ad break, hides overlay, completes tracking
- `skipCurrentAd(player)` - Seeks past current ad
- `clickCurrentAd()` - Handles click-through

---

### **AdOverlayController**
Controls the visual ad overlay UI elements.

**Responsibilities:**
- Show/hide ad overlay
- Update skip button with countdown
- Render ad break information panel
- Manage overlay DOM elements

**Key Methods:**
- `show()` - Shows the ad overlay
- `hide()` - Hides the ad overlay
- `updateSkipButton(elapsed, duration, skipOffset)` - Updates skip countdown
- `renderAdBreakInfo(adBreaks)` - Displays ad break schedule

---

### **AdTracker**
Handles VAST tracking events (impressions, clicks, quartiles).

**Responsibilities:**
- Initialize VAST tracking for ad breaks
- Fire impression pixels
- Track quartile events (25%, 50%, 75%, 100%)
- Track skip and click events
- Extract ad metadata from VAST

**Key Methods:**
- `initialize(breakInfo)` - Fetches VAST and creates tracker
- `setProgress(elapsed)` - Updates progress for quartile tracking
- `trackSkip()` - Fires skip tracking pixels
- `trackClick()` - Fires click tracking pixels
- `trackComplete()` - Fires completion tracking pixels

---

### **VMAPService**
Static utility class for VMAP/VAST parsing (no state).

**Responsibilities:**
- Fetch and parse VMAP XML documents
- Build ad break schedule from VMAP
- Parse time offsets (HH:MM:SS format)
- Extract VAST URLs from VMAP
- Find linear creatives in VAST responses

**Key Methods:**
- `fetchVMAP(vmapBaseUrl, duration, userId)` - Fetches VMAP from server
- `buildAdBreakList(vmap, contentDuration)` - Parses VMAP into ad breaks
- `parseTimeOffset(timeOffset, totalDuration)` - Converts time strings to seconds
- `getLinearCreative(ad)` - Extracts video creative from VAST

---

## How It Works

### Overall Application Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. INITIALIZATION (User clicks "Load video & VMAP")             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ AdDemoApp.loadVideo()                   │
        │ - Get form values (URL, duration, etc)  │
        │ - Validate input                        │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ VideoPlayerManager.initialize()         │
        │ - Create Video.js player                │
        │ - Load MediaTailor HLS stream           │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ VMAPService.fetchVMAP()                 │
        │ - Fetch VMAP XML from server            │
        │ - Parse into ad break schedule          │
        │ - Sort by chronological order           │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdBreakManager.setAdBreaks()            │
        │ - Store ad break schedule               │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ UI Initialization                       │
        │ - Add timeline markers                  │
        │ - Render ad break info panel            │
        │ - Set up timeupdate listener            │
        └─────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 2. PLAYBACK MONITORING (Every timeupdate event)                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ VideoPlayerManager.getCurrentTime()     │
        │ - Get current HLS playback time         │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdBreakManager.update(hlsTime)          │
        │ - Detect if in ad break range           │
        └──────────────┬──────────────────────────┘
                       ↓
                  Decision Point
                       ↓
        ┌──────────────┴──────────────┐
        │                             │
    Entering Ad               Not in Ad
        │                             │
        ↓                             ↓
  startAdBreak()              Continue monitoring

┌─────────────────────────────────────────────────────────────────┐
│ 3. ENTERING AD BREAK                                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ AdBreakManager.startAdBreak()           │
        │ - Set isInAdBreak = true                │
        │ - Store currentAdBreak                  │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdOverlayController.show()              │
        │ - Display ad overlay                    │
        │ - Show skip button (disabled)           │
        │ - Show "Learn More" button              │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdTracker.initialize(breakInfo)         │
        │ - Fetch VAST XML for this ad            │
        │ - Extract ad metadata:                  │
        │   * Duration (e.g., 30s)                │
        │   * Skip offset (e.g., 5s)              │
        │   * Click-through URL                   │
        │ - Create VASTTracker                    │
        │ - Fire impression pixel                 │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ Update Ad Break Info                    │
        │ - Store duration/skipOffset in break    │
        │ - Update master adBreaks array          │
        └─────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 4. DURING AD PLAYBACK (Every timeupdate while in ad)            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ AdBreakManager.updateProgress(elapsed)  │
        │ - Calculate elapsed time in ad          │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdOverlayController.updateSkipButton()  │
        │ - If elapsed < skipOffset:              │
        │   Show "Skip in Xs"                     │
        │ - If elapsed >= skipOffset:             │
        │   Enable "Skip Ad" button               │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdTracker.setProgress(elapsed)          │
        │ - Track quartile events:                │
        │   * 25% (firstQuartile)                 │
        │   * 50% (midpoint)                      │
        │   * 75% (thirdQuartile)                 │
        └─────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 5A. EXITING AD BREAK (Natural completion)                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ AdBreakManager.endAdBreak()             │
        │ - Set isInAdBreak = false               │
        │ - Clear currentAdBreak                  │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdTracker.trackComplete()               │
        │ - Fire complete tracking pixel          │
        │ - Reset tracker                         │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdOverlayController.hide()              │
        │ - Hide ad overlay                       │
        │ - Content continues playing             │
        └─────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 5B. SKIP AD (User clicks skip button)                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ AdDemoApp.skipAd()                      │
        │ - User clicked skip button              │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdBreakManager.skipCurrentAd(player)    │
        │ - Calculate HLS time after ad           │
        │ - Account for cumulative ad duration    │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdTracker.trackSkip()                   │
        │ - Fire skip tracking pixel              │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ VideoPlayerManager.seek(endTime)        │
        │ - Seek to end of ad break               │
        │ - Stays in same HLS stream              │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdBreakManager.endAdBreak()             │
        │ - Detected we've exited ad range        │
        │ - Hide overlay and cleanup              │
        └─────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 5C. CLICK AD (User clicks "Learn More")                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ AdDemoApp.clickAd()                     │
        │ - User clicked learn more               │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdBreakManager.clickCurrentAd()         │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ AdTracker.trackClick()                  │
        │ - Fire click tracking pixel             │
        │ - Get click-through URL from VAST       │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │ Open URL in new tab                     │
        │ - Ad continues playing                  │
        └─────────────────────────────────────────┘
```

### MediaTailor Integration

This application supports **AWS MediaTailor** server-side ad stitching:

#### **How MediaTailor Works:**
1. MediaTailor receives a single HLS manifest URL from the client
2. Server-side, it stitches ads directly into the video stream at specified times
3. The client receives a **single continuous HLS stream** containing both content and ads
4. No source switching is required - ads are part of the stream

#### **Timeline Adjustment:**
Since ads are stitched into the stream, the timeline shifts. For example:
- Content starts at `00:00`
- Pre-roll ad (30s) plays from `00:00` to `00:30`
- Content actually starts at `00:30` (not `00:00`)
- Mid-roll ad at 5:00 content time plays at `05:30` HLS time (5:00 + 30s pre-roll)

#### **Cumulative Duration Calculation:**
The `AdBreakManager` calculates cumulative ad duration to properly position markers and detect ad breaks in the HLS timeline:

```javascript
// Example: Finding ad at 5:00 content time with 30s pre-roll
contentTime = 300s (5:00)
cumulativeAdDuration = 30s (pre-roll)
hlsTime = 300 + 30 = 330s (5:30 in actual stream)
```

### Skip Functionality

The skip button becomes enabled after the `skipOffset` time (from VAST, typically 5 seconds):

1. **Before skip offset**: Button shows "Skip in Xs" countdown
2. **After skip offset**: Button enabled, shows "Skip Ad"
3. **When clicked**:
   - Calculates HLS time after ad (content time + cumulative ads + ad duration)
   - Fires VAST skip tracking pixel
   - Seeks forward in HLS stream (no source switching needed)
   - `AdBreakManager.update()` detects we've exited ad range
   - Overlay hides automatically

## Key Implementation Details

### State Management

Each class manages its own state:
- **AdBreakManager**: Current ad break, ad schedule, in-break flag
- **AdTracker**: VAST tracker instance
- **VideoPlayerManager**: Player instance, content duration
- **AdOverlayController**: DOM element references
- **AdDemoApp**: Component instances and coordination

### Dependency Injection Pattern

Classes receive dependencies via constructor:
```javascript
// AdBreakManager depends on overlay and tracker
constructor(overlayController, tracker) {
  this.overlayController = overlayController;
  this.tracker = tracker;
}
```

This makes testing easier and allows for mock implementations.

### Timeline Synchronization (MediaTailor)

The `AdBreakManager` maintains timeline synchronization:
1. Each ad break shifts the timeline by its duration
2. `getCumulativeAdDuration(upToIndex)` calculates total shift
3. All time calculations account for this shift
4. Markers and detection use adjusted HLS times

### VAST Metadata Extraction

When an ad break starts, the `AdTracker`:
1. Fetches VAST XML from the ad server
2. Extracts metadata (duration, skip offset, click-through URL)
3. Returns metadata to `AdBreakManager`
4. Manager updates the ad break schedule with actual values
5. This ensures accurate skip timing and UI display

### Event Flow

The application uses a reactive event flow:
1. Video.js fires `timeupdate` events
2. `VideoPlayerManager` captures current time
3. `AdBreakManager.update()` checks for ad transitions
4. Manager triggers overlay and tracker as needed
5. UI updates reflect current state

No global event bus - communication happens through method calls.

## Debugging

All classes log their operations with prefixed tags:

- `[APP]` - Application-level operations (AdDemoApp)
- `[PLAYER]` - Video player operations (VideoPlayerManager)
- `[AD BREAK]` - Ad break management (AdBreakManager)
- `[TRACKER]` - VAST tracking events (AdTracker)
- `[OVERLAY]` - UI overlay changes (AdOverlayController)

Open the browser console (F12) to see detailed logs.

### Example Log Output:

```
[APP] Loading video { contentUrl: "...", duration: 596, ... }
[PLAYER] Creating new player
[APP] Ad breaks loaded { count: 3, breaks: [...] }
[AD BREAK] Starting break_0
[OVERLAY] Showing ad overlay
[TRACKER] Initialized { duration: 30, skipOffset: 5 }
[OVERLAY] Skip button enabled { elapsed: 5, skipOffset: 5 }
[TRACKER] Click-through URL: https://example.com
[AD BREAK] Ending
[OVERLAY] Hiding ad overlay
```

## Migrating to Angular

The class-based architecture is designed for easy Angular migration. Here's the mapping:

### Class → Angular Service/Component Mapping

| Current Class | Angular Implementation | Decorator |
|--------------|------------------------|-----------|
| `VMAPService` | `VMAPService` | `@Injectable()` |
| `AdTracker` | `AdTrackerService` | `@Injectable()` |
| `AdBreakManager` | `AdBreakManagerService` | `@Injectable()` |
| `VideoPlayerManager` | `VideoPlayerService` | `@Injectable()` |
| `AdOverlayController` | `AdOverlayComponent` | `@Component()` |
| `AdDemoApp` | `VideoPlayerComponent` | `@Component()` |

### Migration Steps

#### 1. Convert Services

```typescript
// vmap.service.ts
import { Injectable } from '@angular/core';
import VMAP from '@dailymotion/vmap';

@Injectable({
  providedIn: 'root'
})
export class VMAPService {
  static async fetchVMAP(vmapBaseUrl: string, duration: number, userId: string): Promise<VMAP> {
    // ... existing implementation
  }
  
  // ... other static methods
}
```

#### 2. Inject Dependencies

```typescript
// ad-break-manager.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AdBreakManagerService {
  constructor(
    private tracker: AdTrackerService,
    // Note: OverlayController becomes a component
  ) {}
  
  // ... existing implementation
}
```

#### 3. Create Components

```typescript
// video-player.component.ts
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-video-player',
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit {
  constructor(
    private vmapService: VMAPService,
    private adBreakManager: AdBreakManagerService,
    private videoPlayerManager: VideoPlayerService
  ) {}
  
  async loadVideo(contentUrl: string, duration: number, vmapBaseUrl: string, userId: string) {
    // ... existing AdDemoApp.loadVideo() logic
  }
}
```

#### 4. Component Template

```html
<!-- video-player.component.html -->
<div class="video-container">
  <video id="videoPlayer" class="video-js"></video>
  
  <app-ad-overlay
    [isVisible]="adBreakManager.isInAd()"
    [skipEnabled]="skipButtonEnabled"
    [countdown]="skipCountdown"
    (skip)="skipAd()"
    (learnMore)="clickAd()">
  </app-ad-overlay>
</div>
```

#### 5. RxJS Integration (Optional)

You can enhance the services with RxJS for reactive state management:

```typescript
import { BehaviorSubject, Observable } from 'rxjs';

export class AdBreakManagerService {
  private currentAdBreak$ = new BehaviorSubject<AdBreak | null>(null);
  private isInAdBreak$ = new BehaviorSubject<boolean>(false);
  
  getCurrentAdBreak(): Observable<AdBreak | null> {
    return this.currentAdBreak$.asObservable();
  }
  
  isInAd(): Observable<boolean> {
    return this.isInAdBreak$.asObservable();
  }
}
```

### Benefits of Angular Migration

✅ **Type Safety** - Full TypeScript with interfaces for ad breaks, VAST responses  
✅ **Dependency Injection** - Angular's DI system manages service lifecycle  
✅ **Change Detection** - Automatic UI updates when ad state changes  
✅ **Testing** - TestBed for easy unit and integration testing  
✅ **Routing** - Integrate with Angular Router for multi-page apps  
✅ **Forms** - Use Reactive Forms for configuration inputs  
✅ **HTTP Client** - Replace fetch with Angular's HttpClient  

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

## Data Flow

### Component Interaction Pattern

The application uses a hierarchical communication pattern:

```
User Action (DOM Event)
    ↓
AdDemoApp (handles event)
    ↓
Calls appropriate manager/service method
    ↓
Manager coordinates between services
    ↓
Services update their internal state
    ↓
UI components reflect state changes
```

### Example: Skip Ad Flow

```typescript
1. User clicks skip button
   → DOM event listener in AdDemoApp

2. AdDemoApp.skipAd()
   → app.adBreakManager.skipCurrentAd(player)

3. AdBreakManager.skipCurrentAd(player)
   → this.tracker.trackSkip()              // Track event
   → player.seek(endTime)                   // Seek forward
   → (timeupdate triggers detectActiveBreak)

4. AdBreakManager.update(hlsTime)
   → detectActiveBreak() returns null       // No longer in ad
   → this.endAdBreak()                      // Cleanup

5. AdBreakManager.endAdBreak()
   → this.tracker.trackComplete()           // Final tracking
   → this.overlayController.hide()          // Hide UI
```

### State Synchronization

State flows downward, actions flow upward:

```
┌─────────────────────────────────────────┐
│            AdDemoApp                     │
│  (owns all component instances)          │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ↓             ↓             ↓
VideoPlayer  AdBreakManager  (other components)
    │             │
    │    ┌────────┼────────┐
    │    ↓                 ↓
    │  Tracker        Overlay
    │    ↓                 ↓
    └──> State flows down
         Actions/events flow up
```

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

### Overlay not showing during ads

**Possible causes:**
- Ad break times don't match actual HLS timeline
- Cumulative duration calculation is incorrect
- VMAP fetch failed

**Debug steps:**
1. Check console for `[AD BREAK] Starting` logs
2. Verify ad breaks were loaded: `[APP] Ad breaks loaded`
3. Check if VMAP fetch succeeded (no VMAP error in console)
4. Verify HLS time calculation in `detectActiveBreak()`

### Skip button stays disabled

**Possible causes:**
- Skip offset from VAST is longer than expected
- Progress tracking not updating
- VAST fetch failed

**Debug steps:**
1. Check `[TRACKER] Initialized` log for skipOffset value
2. Look for `[OVERLAY] Skip button enabled` log
3. Verify `updateProgress()` is being called (check timeupdate events)

### Click-through not working

**Possible causes:**
- VAST XML missing `<ClickThrough>` tag
- Pop-up blocker preventing window.open
- VAST fetch failed

**Debug steps:**
1. Check `[TRACKER] Click-through URL` log
2. Look for "No click-through URL available" warning
3. Temporarily disable pop-up blocker
4. Verify VAST XML structure

### Timeline markers in wrong position

**Possible causes:**
- Cumulative duration not accounting for previous ads
- Ad durations not updated from VAST

**Debug steps:**
1. Check that VAST metadata is being extracted (`[TRACKER] Initialized`)
2. Verify `getCumulativeAdDuration()` calculations
3. Check if ad break array is being updated with actual durations

### Ads not detected (MediaTailor)

**Possible causes:**
- VMAP schedule doesn't match MediaTailor configuration
- HLS stream not properly stitched
- Time calculation mismatch

**Debug steps:**
1. Verify same VMAP URL is used by both client and MediaTailor
2. Check that MediaTailor is properly configured with VMAP endpoint
3. Compare expected ad times vs actual HLS timeline
4. Use MediaTailor CloudWatch logs to verify ad insertion

## Quick Reference

### Key Files

| File | Description |
|------|-------------|
| `app.js` | Main application code (all classes) |
| `index.html` | HTML structure and player container |
| `style.css` | Styling for player and overlay |
| `package.json` | Dependencies and scripts |

### Configuration Constants

```javascript
CONFIG = {
  VMAP_INTERVAL: 300,        // Ad break interval in seconds
  DEFAULT_AD_DURATION: 30,   // Default ad duration
  DEFAULT_SKIP_OFFSET: 5,    // Default skip offset
}
```

### Key Methods by Use Case

| Task | Class | Method |
|------|-------|--------|
| Load video | `AdDemoApp` | `loadVideo()` |
| Skip ad | `AdBreakManager` | `skipCurrentAd(player)` |
| Click ad | `AdBreakManager` | `clickCurrentAd()` |
| Fetch VMAP | `VMAPService` | `fetchVMAP()` |
| Track event | `AdTracker` | `trackSkip()`, `trackClick()` |
| Show overlay | `AdOverlayController` | `show()` |
| Get current time | `VideoPlayerManager` | `getCurrentTime()` |

### Adding New Features

**To add a new tracking event:**
1. Add method to `AdTracker` class
2. Call from appropriate place in `AdBreakManager`

**To add UI elements:**
1. Update `AdOverlayController` with new methods
2. Update HTML in `index.html`
3. Add styles in `style.css`

**To add new ad break types:**
1. Extend `VMAPService.buildAdBreakList()` parsing
2. Update `AdBreakManager.detectActiveBreak()` logic
3. Add UI indicators in `AdOverlayController`

## Performance Considerations

- **VMAP Caching**: Consider caching VMAP response to avoid repeated fetches
- **VAST Prefetching**: Could prefetch VAST for upcoming ads during playback
- **Timeline Markers**: Limit marker count for very long videos (>2 hours)
- **Event Throttling**: `timeupdate` fires frequently; consider throttling if needed

## Browser Compatibility

- ✅ Chrome/Edge (Chromium) 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

Requires:
- ES6+ support (classes, async/await, arrow functions)
- HLS support (native or Video.js VHS)
- CORS enabled on VMAP/VAST/media endpoints

## License

ISC
