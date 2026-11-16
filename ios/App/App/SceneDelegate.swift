import UIKit
import Capacitor

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
