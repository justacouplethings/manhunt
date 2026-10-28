package com.manhunt.gpsgame;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.view.Window;
import android.view.WindowManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

public class MainActivity extends Activity {
    private WebView webView;
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static MainActivity instance;

    public static MainActivity getInstance() {
        return instance;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        // Immersive full-screen window
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF07090E);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                // Automatically grant geolocation access to the app
                callback.invoke(origin, true, false);
            }
        });

        // Add JavaScript bridge for permissions, background services & notifications
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidNative");

        // Initial permissions check on launch
        requestAllPermissionsInternal();

        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Keep timers running in background so WebSocket and location loop do not freeze
        if (webView != null) {
            webView.resumeTimers();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (instance == this) {
            instance = null;
        }
    }

    public void onNativeLocationReceived(final double lat, final double lng, final float speed, final float heading, final float accuracy) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    String script = String.format(
                        "if(typeof Geo !== 'undefined' && Geo.processNativeLocation){ Geo.processNativeLocation(%f, %f, %f, %f, %f); }",
                        lat, lng, speed, heading, accuracy
                    );
                    webView.evaluateJavascript(script, null);
                }
            }
        });
    }

    public void startForegroundTrackingService() {
        Intent intent = new Intent(this, LocationService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
    }

    public void stopForegroundTrackingService() {
        Intent intent = new Intent(this, LocationService.class);
        stopService(intent);
    }

    public void requestAllPermissionsInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.ArrayList<String> perms = new java.util.ArrayList<>();
            if (checkSelfPermission("android.permission.ACCESS_FINE_LOCATION") != PackageManager.PERMISSION_GRANTED) {
                perms.add("android.permission.ACCESS_FINE_LOCATION");
                perms.add("android.permission.ACCESS_COARSE_LOCATION");
            }
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                perms.add("android.permission.POST_NOTIFICATIONS");
            }
            if (!perms.isEmpty()) {
                requestPermissions(perms.toArray(new String[0]), PERMISSION_REQUEST_CODE);
            }
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public boolean isNative() {
            return true;
        }

        @JavascriptInterface
        public void startBackgroundService() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    startForegroundTrackingService();
                }
            });
        }

        @JavascriptInterface
        public void stopBackgroundService() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    stopForegroundTrackingService();
                }
            });
        }

        @JavascriptInterface
        public void showNotification(final String title, final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    LocationService service = LocationService.getInstance();
                    if (service != null) {
                        service.showCriticalEventNotification(title, message);
                    }
                }
            });
        }

        @JavascriptInterface
        public void requestLocationPermissions() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    requestAllPermissionsInternal();
                }
            });
        }

        @JavascriptInterface
        public boolean isBatteryOptimizationIgnored() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    return pm.isIgnoringBatteryOptimizations(getPackageName());
                }
            }
            return true;
        }

        @JavascriptInterface
        public void requestBatteryOptimization() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Intent intent = new Intent();
                            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                                intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                                intent.setData(Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                            }
                        } catch (Exception e) {
                            try {
                                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                                startActivity(fallback);
                            } catch (Exception ex) {}
                        }
                    }
                });
            }
        }

        @JavascriptInterface
        public String checkPermissionsStatus() {
            boolean hasLocation = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                hasLocation = checkSelfPermission("android.permission.ACCESS_FINE_LOCATION") == PackageManager.PERMISSION_GRANTED;
            } else {
                hasLocation = true;
            }
            boolean batteryExempt = isBatteryOptimizationIgnored();
            boolean hasNotifications = true;
            if (Build.VERSION.SDK_INT >= 33) {
                hasNotifications = checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
            }
            return String.format("{\"location\":%b,\"battery\":%b,\"notifications\":%b}", hasLocation, batteryExempt, hasNotifications);
        }

        @JavascriptInterface
        public void exitApp() {
            finish();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
