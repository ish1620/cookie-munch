//
//  ViewController.swift
//  Shared (App)
//

import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

// The extension sits inside the app and shares its ID, plus ".Extension".
let extensionBundleIdentifier = (Bundle.main.bundleIdentifier ?? "") + ".Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

#if os(iOS)
        self.webView.scrollView.isScrollEnabled = false
#endif

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    // The page translates itself into the first language the person prefers (English, Japanese or Spanish).
    private let language = Locale.preferredLanguages.first?.filter { $0.isLetter || $0 == "-" } ?? "en"

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(iOS)
        webView.evaluateJavaScript("show('ios', null, true, '\(language)')")
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac', null, true, '\(language)')")

        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                return // The page keeps showing the setup steps without an on/off line.
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), true, '\(self.language)')")
                } else {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), false, '\(self.language)')")
                }
            }
        }
#endif
    }

    // The window only ever shows the bundled page. A clicked https link (the repository link) opens
    // in the browser; anything else is refused.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if url.isFileURL { return .allow }
        if navigationAction.navigationType == .linkActivated, url.scheme == "https" {
#if os(iOS)
            _ = await UIApplication.shared.open(url)
#elseif os(macOS)
            NSWorkspace.shared.open(url)
#endif
        }
        return .cancel
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
#if os(macOS)
        guard message.body as? String == "open-preferences" else { return }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            guard error == nil else {
                return // Safari didn't open its settings; stay open so the steps remain visible.
            }

            DispatchQueue.main.async {
                NSApp.terminate(self)
            }
        }
#endif
    }

}
