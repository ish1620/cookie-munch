// Runs the mock banner pages (tests/pages) in WebKit, Safari's engine, and checks that each one's
// __result().pass is true. Pages run side by side in offscreen windows, so the whole suite takes ~15 s.
//
// Serve the repository first:  python3 -m http.server 8765 --bind 127.0.0.1
// Then:                         swift tools/run_pages.swift [page.html ...]   (default: every page on tests/index.html)
// Exits with 1 if any page fails.
import Cocoa
import WebKit

let base = URL(string: "http://127.0.0.1:8765/tests/")!
let defaultWait = 6.5                                     // seconds after the page loads
let waits = ["settings-flow.html": 7.5, "late-settings.html": 9.5]

func pageNames() -> [String] {
    let named = Array(CommandLine.arguments.dropFirst())
    if !named.isEmpty { return named }
    guard let index = try? String(contentsOf: base.appendingPathComponent("index.html"), encoding: .utf8) else {
        print("Can't reach \(base). Start the server first: python3 -m http.server 8765 --bind 127.0.0.1")
        exit(2)
    }
    let links = try! NSRegularExpression(pattern: #"href="pages/([^"]+\.html)""#)
    return links.matches(in: index, range: NSRange(index.startIndex..., in: index)).map {
        String(index[Range($0.range(at: 1), in: index)!])
    }
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
        // Offscreen pages count as hidden, and the extension waits until a page is shown. Say it is.
        let shown = "Object.defineProperty(Document.prototype, 'hidden', { get: () => false });" +
            "Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible' });"
        config.userContentController.addUserScript(
            WKUserScript(source: shown, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: config)
        super.init()
        webView.navigationDelegate = self
        window.contentView = webView
        window.orderBack(nil)
        webView.load(URLRequest(url: base.appendingPathComponent("pages/\(name)")))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + (waits[name] ?? defaultWait)) {
            webView.evaluateJavaScript("JSON.stringify(window.__result())") { value, error in
                let json = value as? String ?? "{\"error\": \"\(String(describing: error))\"}"
                let result = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
                self.finished(self.name, result?["pass"] as? Bool == true, json)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finished(name, false, "{\"error\": \"\(error.localizedDescription)\"}")
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let names = pageNames()
var runs: [PageRun] = []
var failures: [String] = []
var remaining = names.count
for name in names {
    runs.append(PageRun(name) { name, pass, json in
        print(pass ? "PASS  \(name)" : "FAIL  \(name)  \(json)")
        if !pass { failures.append(name) }
        remaining -= 1
        if remaining == 0 {
            print(failures.isEmpty ? "\nAll \(names.count) pages passed in WebKit."
                                   : "\n\(failures.count) of \(names.count) pages failed: \(failures.joined(separator: ", "))")
            exit(failures.isEmpty ? 0 : 1)
        }
    })
}
DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
    print("Timed out with \(remaining) pages unfinished.")
    exit(1)
}
app.run()
