// Runs the mock banner pages (tests/pages) in WebKit, Safari's engine, and checks that each one's
// __result().pass is true. Up to 6 pages run side by side in offscreen windows (~3 minutes for the suite).
// Each page is read once, after the extension has stopped watching it: WATCH_MS (read from content.js)
// after the page loads, plus a short margin. So a wrong click late in the watch still fails the page.
// WebKit counts an offscreen window as hidden and, a few seconds in, nearly stops its timers, so the watch
// would never run to its end. A private WebKit setting turns that check off (see keepTimersRunning).
//
// Serve the repository first:  python3 -m http.server 8765 --bind 127.0.0.1
// Then:                         swift tools/run_pages.swift [page.html ...]   (default: every page on tests/index.html)
// Exits with 1 if any page fails.
import Cocoa
import WebKit

let base = URL(string: "http://127.0.0.1:8765/tests/")!
let marginSeconds = 2.0   // after the watch ends, time for the extension's last step (a click it already started)
let parallel = 6
let occlusionSetting = "windowOcclusionDetectionEnabled"   // private WKWebView setting, read and set by key

// A file from the server, or exit with a hint to start it.
func served(_ path: String) -> String {
    guard let text = try? String(contentsOf: URL(string: path, relativeTo: base)!, encoding: .utf8) else {
        print("Can't reach \(base). Start the server first: python3 -m http.server 8765 --bind 127.0.0.1")
        exit(2)
    }
    return text
}

// How long content.js keeps watching a page after it's shown (its WATCH_MS), in seconds.
func watchSeconds() -> Double {
    let source = served("../extension/content.js")
    let line = try! NSRegularExpression(pattern: #"^ *const WATCH_MS = (\d+);"#, options: .anchorsMatchLines)
    guard let match = line.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
          let ms = Double(source[Range(match.range(at: 1), in: source)!]) else {
        print("Can't find \"const WATCH_MS = <milliseconds>;\" in extension/content.js.")
        exit(2)
    }
    return ms / 1000
}

func pageNames() -> [String] {
    let named = Array(CommandLine.arguments.dropFirst())
    if !named.isEmpty { return named }
    let index = served("index.html")
    let links = try! NSRegularExpression(pattern: #"href="pages/([^"]+\.html)""#)
    return links.matches(in: index, range: NSRange(index.startIndex..., in: index)).map {
        String(index[Range($0.range(at: 1), in: index)!])
    }
}

// Turn off WebKit's window-occlusion check for this web view, so its page's timers run at full speed.
// If this WebKit doesn't offer the setting, stop: throttled pages would make every result meaningless.
func keepTimersRunning(_ webView: WKWebView) {
    let setter = Selector("_set\(occlusionSetting.prefix(1).uppercased())\(occlusionSetting.dropFirst()):")
    let getter = Selector("_\(occlusionSetting)")
    if webView.responds(to: setter) && webView.responds(to: getter) {
        webView.setValue(false, forKey: occlusionSetting)
        if webView.value(forKey: occlusionSetting) as? Bool == false { return }
    }
    print("This WebKit has no \(occlusionSetting) setting to turn off, so offscreen pages would be throttled. Stopping.")
    exit(2)
}

final class PageRun: NSObject, WKNavigationDelegate {
    let name: String
    let window = NSWindow(contentRect: NSRect(x: -6000, y: -6000, width: 1024, height: 768),
                          styleMask: .borderless, backing: .buffered, defer: false)
    let webView: WKWebView
    let finished: (String, Bool, String) -> Void

    init(_ name: String, finished: @escaping (String, Bool, String) -> Void) {
        self.name = name
        self.finished = finished
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent() // no cache: always run the files as they are now
        // Offscreen pages count as hidden, and the extension waits until a page is shown. Say it is.
        let shown = "Object.defineProperty(Document.prototype, 'hidden', { get: () => false });" +
            "Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible' });"
        config.userContentController.addUserScript(
            WKUserScript(source: shown, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: config)
        super.init()
        keepTimersRunning(webView)
        webView.navigationDelegate = self
        window.contentView = webView
        window.orderBack(nil)
        webView.load(URLRequest(url: base.appendingPathComponent("pages/\(name)")))
    }

    // The extension starts its watch a few milliseconds after the page loads (once the harness has read the
    // cookie list), so the margin also covers that.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + watch + marginSeconds) { self.check() }
    }

    // Read the page's result, once.
    func check() {
        webView.evaluateJavaScript("JSON.stringify(window.__result())") { value, error in
            let json = value as? String ?? "{\"error\": \"\(String(describing: error))\"}"
            let result = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
            self.window.close()
            self.finished(self.name, result?["pass"] as? Bool == true, json)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finished(name, false, "{\"error\": \"\(error.localizedDescription)\"}")
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let watch = watchSeconds()
let names = pageNames()
var queue = names
var runs: [PageRun] = []
var failures: [String] = []
var remaining = names.count

func startNext() {
    guard !queue.isEmpty else { return }
    let name = queue.removeFirst()
    runs.append(PageRun(name) { name, pass, json in
        print(pass ? "PASS  \(name)" : "FAIL  \(name)  \(json)")
        if !pass { failures.append(name) }
        remaining -= 1
        if remaining == 0 {
            print(failures.isEmpty ? "\nAll \(names.count) pages passed in WebKit."
                                   : "\n\(failures.count) of \(names.count) pages failed: \(failures.joined(separator: ", "))")
            exit(failures.isEmpty ? 0 : 1)
        }
        startNext()
    })
}
for _ in 0..<min(parallel, names.count) { startNext() }
DispatchQueue.main.asyncAfter(deadline: .now() + 300) {
    print("Timed out with \(remaining) pages unfinished.")
    exit(1)
}
app.run()
