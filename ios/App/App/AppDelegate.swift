import UIKit
import CoreLocation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Prepare persistent location manager and request background authorization
        let locationMgr = LocationManager.shared
        locationMgr.requestAlwaysAuthorization()
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Keep background location active for screen-off execution
        LocationManager.shared.startTracking()
    }
}
