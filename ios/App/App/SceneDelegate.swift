import UIKit
import Capacitor
import DeclaredAgeRange
import GoogleMobileAds

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ShapescraperBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// Local UMP reader registered alongside the packaged Capacitor plugins.
class ShapescraperBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AnalyticsConsentPlugin())
        bridge?.registerPluginInstance(RegionalAgePlugin())
    }
}

@objc(AnalyticsConsentPlugin)
public class AnalyticsConsentPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AnalyticsConsentPlugin"
    public let jsName = "AnalyticsConsent"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getConsentModes", returnType: CAPPluginReturnPromise)
    ]
    @objc func getConsentModes(_ call: CAPPluginCall) {
        call.resolve(["values": UserDefaults.standard.string(forKey: "UMP_consentModeValues") ?? ""])
    }
}
// Apple describes upperBound as an age gate exceeding the person's age.
// Accept both threshold bounds (18) and narrower regional bounds (17).
private func regionalAgeClassification(lower: Int?, upper: Int?) -> JSObject {
    if let lower, lower >= 18 {
        return ["status": "resolved", "minor": false, "childDirected": false]
    }
    if let upper, upper <= 18 {
        return ["status": "resolved", "minor": true, "childDirected": lower == nil || (lower ?? 0) < 13]
    }
    return ["status": "unresolved"]
}

// No age data is persisted or logged. Sharing is requested only after Apple's regional gate.
@objc(RegionalAgePlugin)
public class RegionalAgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RegionalAgePlugin"
    public let jsName = "RegionalAge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getRequirements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestRequiredAgeRange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkAnalyticsUpdate", returnType: CAPPluginReturnPromise)
    ]
    private var requesting = false

    @objc func getRequirements(_ call: CAPPluginCall) {
        Task { @MainActor in call.resolve(await self.requirements()) }
    }

    // This check never calls requestAgeRange and cannot present its sharing sheet.
    @MainActor private func requirements() async -> JSObject {
        guard #available(iOS 26.2, *) else { return ["status": "unsupported"] }
        do {
            let required: Bool
            if #available(iOS 26.4, *) {
                let features = try await AgeRangeService.shared.requiredRegulatoryFeatures
                required = features.contains(.declaredAgeRangeRequired)
            } else {
                required = try await AgeRangeService.shared.isEligibleForAgeFeatures
            }
            return ["status": required ? "required" : "notRequired"]
        } catch AgeRangeService.Error.notAvailable {
            return ["status": "unavailable"]
        } catch {
            return ["status": "error"]
        }
    }

    // Specific first gameplay-measurement update, not an app-version or UMP reset.
    // The affected feature is optional Analytics only. Known minors never receive it,
    // so this does not request permission to enable new processing for a child.
    @objc func checkAnalyticsUpdate(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard #available(iOS 26.2, *) else {
                call.resolve(["allowed": true]); return
            }
            do {
                guard #available(iOS 26.4, *) else {
                    // The older system cannot show the adult acknowledgement sheet.
                    // Keep this new measurement off in eligible accounts; core play remains.
                    let eligible = try await AgeRangeService.shared.isEligibleForAgeFeatures
                    call.resolve(["allowed": !eligible]); return
                }
                let features = try await AgeRangeService.shared.requiredRegulatoryFeatures
                if features.contains(.significantAppChangeRequiresParentalConsent) {
                    call.resolve(["allowed": false]); return
                }
                guard features.contains(.significantAppChangeRequiresAdultNotification) else {
                    call.resolve(["allowed": true]); return
                }
                let noticeKey = "BENO74.gameplay-measurement-v1.acknowledged"
                if UserDefaults.standard.bool(forKey: noticeKey) {
                    call.resolve(["allowed": true]); return
                }
                guard let controller = self.bridge?.viewController,
                      let scene = controller.viewIfLoaded?.window?.windowScene,
                      controller.presentedViewController == nil else {
                    call.resolve(["allowed": false]); return
                }
                try await AgeRangeService.shared.showSignificantUpdateAcknowledgment(
                    in: scene,
                    updateDescription: "Adds consent-managed gameplay measurement, including game progress, scores, results and purchase events, to improve the game. No account, birth date or saved game is sent. Optional gameplay analytics remains off for known minors. Advertising privacy choices are unchanged.")
                UserDefaults.standard.set(true, forKey: noticeKey)
                call.resolve(["allowed": true])
            } catch {
                // An unavailable/error result is not an exemption or consent.
                call.resolve(["allowed": false])
            }
        }
    }

    @objc func requestRequiredAgeRange(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !self.requesting else { call.resolve(["status": "unresolved"]); return }
            self.requesting = true
            defer { self.requesting = false }
            let current = await self.requirements()
            guard current["status"] as? String == "required" else { call.resolve(current); return }
            guard #available(iOS 26.2, *), let controller = self.bridge?.viewController,
                  controller.viewIfLoaded?.window != nil,
                  controller.presentedViewController == nil else {
                call.resolve(["status": "unresolved"])
                return
            }
            do {
                let response = try await AgeRangeService.shared.requestAgeRange(ageGates: 13, 16, 18, in: controller)
                switch response {
                case .declinedSharing:
                    call.resolve(["status": "declined"])
                case .sharing(let range):
                    let result = regionalAgeClassification(lower: range.lowerBound, upper: range.upperBound)
                    if result["status"] as? String == "resolved" {
                        // Current GMA distinguishes teen privacy treatment from child treatment.
                        // Configure it before JavaScript is allowed to initialize/load ads.
                        let config = MobileAds.shared.requestConfiguration
                        if result["minor"] as? Bool == true {
                            config.ageRestrictedTreatment = result["childDirected"] as? Bool == true ? .child : .teen
                        } else {
                            config.ageRestrictedTreatment = .unspecified
                        }
                    }
                    call.resolve(result)
                @unknown default:
                    call.resolve(["status": "unresolved"])
                }
            } catch AgeRangeService.Error.notAvailable {
                call.resolve(["status": "unavailable"])
            } catch {
                call.resolve(["status": "error"])
            }
        }
    }
}
