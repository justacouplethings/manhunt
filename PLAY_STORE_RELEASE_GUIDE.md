# Google Play Store & iOS Production Release Guide

This guide details everything required to release **Manhunt: Real-Life GPS Pursuit** on Google Play Store as an APK/AAB and deploy to iOS devices.

---

## 1. Quick Local Test & Demonstration
The app comes with a zero-dependency server and a built-in simulation suite:
```bash
# From C:\Users\H\Desktop\kyns-playground\useful\APKs\Manhunt
npm start
```
- Open `http://localhost:8080` on your desktop or `http://<YOUR_LAN_IP>:8080` on any phone on the same Wi-Fi.
- In Settings, toggle **"Sandbox / Simulation Bots"** to test 5-minute runner pings, live seeker telemetry, and 15m tag captures right inside your room without needing to go outdoors!

---

## 2. Generating the Android APK & Google Play App Bundle (.aab)

### Option A: Standalone 1-Command Automated Build (Includes Modern Android 14+ Target & v2/v3 Signing)
The project now includes an automated build tool that handles compilation, 4-byte zip alignment, and modern APK Signature Schemes v1, v2, and v3:
```bash
# From C:\Users\H\Desktop\kyns-playground\useful\APKs\Manhunt
python build-apk.py
```
This automatically produces a signed, aligned, modern Android 14+ APK (`Manhunt.apk`) ready for direct installation on modern Android devices without any "deprecated SDK" warnings or installation failures.

### Option B: Direct Capacitor CLI Build
```bash
# 1. Install Capacitor dependencies if not already installed
npm install

# 2. Sync web assets into Android project
npx cap sync android

# 3. Open Android Studio to build the signed Bundle/APK
npx cap open android
```
Inside Android Studio:
1. Navigate to **Build** → **Generate Signed Bundle / APK**.
2. Select **Android App Bundle** (required by Google Play Store) or **APK** (for direct sideloading).
3. Create or select your `keystore.jks`, enter your passwords, and choose **Release**.
4. The output `.aab` file will be generated in `android/app/release/app-release.aab`.

### Option B: Command-Line Keystore & Gradle Build
```bash
# Generate release keystore (run once)
keytool -genkey -v -keystore manhunt-release.keystore -alias manhunt -keyalg RSA -keysize 2048 -validity 10000

# Build release bundle with Gradle
cd android
./gradlew bundleRelease
```

---

## 3. Google Play Console Listing Checklist

| Section | Required Value / Action | Status |
| :--- | :--- | :--- |
| **App Title** | `Manhunt - Real-Life GPS Game` (28 chars) | Ready (`play-store-metadata.json`) |
| **Short Description** | `Outdoor real-life Manhunt game with live seeker radar and periodic runner pings.` (79 chars) | Ready |
| **Full Description** | Included in `play-store-metadata.json` | Ready |
| **App Icon** | 512 × 512 PNG, 32-bit color, no alpha channel | Included at `assets/icon.png` |
| **Feature Graphic** | 1024 × 500 PNG / JPEG | Generate from banner template |
| **Category** | Games → Action / Sports | Set |
| **Content Rating** | PEGI 3 / Everyone (no violence, no bad language, no gambling) | Questionnaire ready |
| **Privacy Policy URL** | Host `privacy-policy.html` on your GitHub Pages or domain | Included at `privacy-policy.html` |
| **Location Permission Declaration** | See Location Policy Disclosure below | Ready |

---

## 4. Google Play Location Policy Prominent Disclosure
Google Play requires a specific in-app disclosure and justification form when using `ACCESS_BACKGROUND_LOCATION` and `FOREGROUND_SERVICE_LOCATION`:

> **Declaration Statement for Play Console:**  
> *"Manhunt is a physical social chase game. ACCESS_FINE_LOCATION and FOREGROUND_SERVICE_LOCATION are required to continuously broadcast Seeker positions and periodically snapshot Runner locations at scheduled intervals (default every 5 minutes). Background location ensures the timer and GPS telemetry continue reliably while the phone is carried in the player's pocket during active running rounds. No location data is stored permanently or sold."*

The built-in prompt dialog inside `privacy-policy.html` and `index.html` satisfies Google Play's Prominent Disclosure guideline.

---

## 5. iOS Deployment Guide

### Option 1: Instant Zero-Cost PWA (Installable on iOS Safari)
Because Apple charges \$99/year for the App Store developer license, Manhunt is fully configured with an Apple PWA manifest:
1. Open the hosted URL in **Safari** on any iPhone or iPad.
2. Tap the **Share** button (box with upward arrow).
3. Tap **"Add to Home Screen"**.
4. The app installs with full-screen tactical view, standalone icon, offline service worker, and high-accuracy GPS tracking!

### Option 2: Native iOS IPA via Capacitor
```bash
npx cap add ios
npx cap sync ios
npx cap open ios
```
In Xcode:
1. Select your Apple Developer Team.
2. Verify `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription` in `Info.plist`.
3. Select **Product** → **Archive** to upload to **TestFlight** or the **Apple App Store**.
