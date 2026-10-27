# Manhunt iOS Deployment & Play Guide

This guide covers all the viable methods to run **Manhunt** on iPhone and iPad devices, ranked from the fastest, 100% free zero-setup method to advanced native sideloading and App Store distribution.

---

## Quick Comparison of iOS Methods

| Feature / Criteria | 🥇 Method 1: PWA (Add to Home Screen) | 🥈 Method 2: Sideloaded IPA (Sideloadly / AltStore) | 🥉 Method 3: TestFlight / App Store |
| :--- | :--- | :--- | :--- |
| **Cost** | **100% Free Forever ($0)** | **100% Free ($0 with personal Apple ID)** | $99 / year (Apple Developer Program) |
| **Computer / Mac Required?** | **None** (install directly in Safari) | PC or Mac (1-time USB setup) | Mac with Xcode |
| **Setup Time** | **30 seconds** | 10 – 15 minutes | 1 – 3 days (App Store review) |
| **Full-Screen UI** | Standalone (no browser address bar) | Native iOS Window | Native iOS Window |
| **Cross-Play with Android** | Instant (same room code via MQTT/WebSockets) | Instant (same room code) | Instant (same room code) |
| **High-Precision GPS** | Satellite GPS via Web Geolocation | Native `CLLocationManager` | Native `CLLocationManager` |
| **Hardware Compass** | Gyroscope / Compass via iOS WebKit | Native CoreMotion | Native CoreMotion |
| **Screen Auto-Lock Prevention** | Screen Wake Lock API (`navigator.wakeLock`) | Native `idleTimerDisabled = true` | Native `idleTimerDisabled = true` |
| **Tracking with Screen Off** | Requires screen kept awake / on | Background mode (`UIBackgroundModes: location`) | Background mode (`UIBackgroundModes: location`) |
| **Expiration** | **Never expires** | 7-day cert refresh (auto via AltStore) | 90 days (TestFlight) / Permanent (Store) |

---

## 🥇 Method 1: Instant PWA via Safari "Add to Home Screen" (Recommended)

### Why this is the best option for 99% of players:
- **Zero cables, zero downloads, zero app store restrictions**.
- Looks and feels like a native app: runs in **standalone full-screen mode** with custom app icon, high-speed ArcGIS maps, and real-time compass without Safari URL bars or navigation buttons.
- Any iPhone user on the field can join your game in **under 30 seconds**.

### ⚠️ The One Critical Rule for iOS Safari GPS:
Apple enforces that `navigator.geolocation` **only functions over a Secure Context (HTTPS or localhost)**. If an iPhone opens a plain `http://192.168.x.x` link, iOS Safari blocks GPS coordinates.

### How to get a Free HTTPS URL in 1 Minute:

#### Option A: Free GitHub Pages (Permanent & 100% Free)
1. Push this `APKs/Manhunt` folder to a GitHub repository (e.g. `https://github.com/your-username/manhunt`).
2. Go to your repository **Settings** → **Pages** → Source: **Deploy from a branch** (`main` / root).
3. GitHub automatically generates an encrypted HTTPS link:  
   `https://your-username.github.io/manhunt/`
4. Anyone with an iPhone can open this link worldwide!

#### Option B: Instant Local Tunnel from your PC (For instant field testing)
If your development PC is running `node server.js`, open a new PowerShell terminal and run:
```powershell
npx localtunnel --port 8080
```
This gives you an instant, secure HTTPS URL (e.g. `https://manhunt-tactical.loca.lt`) that you can open on any iPhone right away.

#### Option C: Free Vercel / Cloudflare Pages / Netlify
Drag and drop the `APKs/Manhunt` folder to [Vercel](https://vercel.com) or [Cloudflare Pages](https://pages.cloudflare.com) for a free custom domain with global CDN.

---

### How to Install on iPhone (Player Instructions):
1. Open the HTTPS game link in **Safari** on your iPhone.
2. Tap the **Share** button (the square with an upward arrow at the bottom of the screen).
3. Scroll down and tap **"Add to Home Screen"** (`➕`).
4. Tap **"Add"** in the top right corner.
5. The **Manhunt** icon appears on your home screen. Tap it to launch full-screen!

---

## 🥈 Method 2: Sideloading a Native `.ipa` via Sideloadly or AltStore

If you want a true native iOS `.ipa` binary with background location tracking (allowing runners to lock their phone and put it in their pocket), you can sideload it onto any iPhone using a standard **free personal Apple ID** (no $99/year developer fee required).

### Tools Needed:
- **Sideloadly** (Free app for Windows & Mac: [sideloadly.io](https://sideloadly.io)) OR **AltStore** ([altstore.io](https://altstore.io))
- A standard Lightning / USB-C cable to connect your iPhone to your PC.
- Any standard free Apple ID (your normal iCloud account).

### Steps to Sideload:
1. Download and install **Sideloadly** on your Windows PC.
2. Connect your iPhone to your PC via USB and tap "Trust this computer" on the iPhone.
3. Open Sideloadly — your iPhone will appear in the device dropdown.
4. Drag and drop your compiled `Manhunt.ipa` into Sideloadly.
5. Enter your Apple ID email (used strictly by Apple's servers to sign the certificate for your personal device).
6. Click **Start**. Sideloadly signs and installs the native app directly to your iPhone.
7. On your iPhone, go to **Settings** → **General** → **VPN & Device Management** → Tap your Apple ID → Tap **Trust "Manhunt"**.
8. Done! Manhunt is now running as a native iOS app.

*(Note: Free personal Apple IDs allow signing apps for 7 days. AltStore can automatically refresh this over your home Wi-Fi in the background without re-plugging).*

---

## 🥉 Method 3: Official Apple TestFlight (Public Link for up to 10,000 Players)

If you have an **Apple Developer Account** ($99/year):
1. Run `npx cap sync ios` in the project root.
2. Open `ios/App/App.xcworkspace` in Xcode on a Mac.
3. Select **Product** → **Archive**.
4. In the Xcode Organizer, click **Distribute App** → **TestFlight & App Store**.
5. Once uploaded, open **App Store Connect** → **TestFlight** → **Public Link**.
6. Share your public TestFlight link (e.g. `https://testflight.apple.com/join/xyz`).
7. Any iPhone user worldwide installs the free TestFlight app from the App Store, taps your link, and installs Manhunt with zero cables, zero PC connection, and no 7-day limits.

---

## ☁️ Method 4: Automated Cloud IPA Builder (No Mac Needed)

If you do not own a Mac, you can use **GitHub Actions** to build the iOS `.ipa` completely in the cloud for free using Apple Silicon cloud runners.

### GitHub Actions Workflow (`.github/workflows/build-ios.yml`):
```yaml
name: Build iOS IPA
on: [push, workflow_dispatch]

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Dependencies
        run: |
          npm install
          npx cap add ios
          npx cap sync ios

      - name: Build Xcode Archive
        run: |
          cd ios/App
          xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath build/App.xcarchive archive CODE_SIGNING_ALLOWED=NO

      - name: Package Payload to IPA
        run: |
          cd ios/App/build/App.xcarchive/Products/Applications
          mkdir Payload
          cp -r App.app Payload/
          zip -r Manhunt-unsigned.ipa Payload
          mv Manhunt-unsigned.ipa ../../../../../

      - name: Upload IPA Artifact
        uses: actions/upload-artifact@v4
        with:
          name: Manhunt-iOS-Package
          path: Manhunt-unsigned.ipa
```
This compiles the native iOS app in the cloud and lets you download the unsigned `Manhunt-unsigned.ipa` straight from the GitHub Actions tab, ready to be signed via Sideloadly!

---

## 🛠️ Summary Recommendation: Which should you choose?

- **If you want to play right now with friends (iPhone + Android crossplay)**:  
  👉 **Use Method 1 (PWA via Safari "Add to Home Screen")**.  
  Deploy to GitHub Pages or use a quick local HTTPS tunnel. It takes 1 minute, costs $0, requires no computer cables, and both Android APK users and iPhone players join the same 4-letter room code instantly.

- **If you need GPS tracking while the iPhone is locked in a runner's pocket**:  
  👉 **Use Method 2 (Sideloading with Sideloadly)**.  
  It gives native iOS background location without paying Apple $99/year.

- **If you want a public link to distribute to hundreds of players without them plugging into a PC**:  
  👉 **Use Method 3 (TestFlight)**.
