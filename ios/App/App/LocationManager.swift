import Foundation
import CoreLocation

@objc public class LocationManager: NSObject, CLLocationManagerDelegate {
    @objc public static let shared = LocationManager()
    
    private let locationManager = CLLocationManager()
    @objc public var onLocationUpdate: ((CLLocation) -> Void)?
    
    private override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.activityType = .fitness
        
        // Critical: Enable continuous background tracking with screen locked
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.showsBackgroundLocationIndicator = true
    }
    
    @objc public func requestAlwaysAuthorization() {
        if CLLocationManager.locationServicesEnabled() {
            let status = locationManager.authorizationStatus
            if status == .notDetermined {
                locationManager.requestWhenInUseAuthorization()
            } else if status == .authorizedWhenInUse {
                locationManager.requestAlwaysAuthorization()
            }
        }
    }
    
    @objc public func startTracking() {
        requestAlwaysAuthorization()
        locationManager.startUpdatingLocation()
        locationManager.startUpdatingHeading()
    }
    
    @objc public func stopTracking() {
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
    }
    
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        onLocationUpdate?(location)
    }
    
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status == .authorizedWhenInUse {
            // Prompt to elevate to Always Allow for background screen-off gameplay
            manager.requestAlwaysAuthorization()
        }
    }
}
