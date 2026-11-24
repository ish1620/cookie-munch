// Runs the mock banner pages (tests/pages) and the standalone demo page (docs/demo/index.html) in WebKit,
// Safari's engine, and checks that each one's __result().pass is true. Up to 6 pages run side by side in
// offscreen windows (~5-8 minutes for the suite).
// Each mock page is read once, after the extension has stopped watching it: WATCH_MS (read from content.js)
// after the page loads, plus a short margin. So a wrong click late in the watch still fails the page.
// A page that loads another page (a decline that loads a new one) is read once too, after the watch of
// the page it loads; pages loaded after that don't move the reading, and the harness counts them.
// The demo page does not load content.js itself, so it runs twice: once with browser-stub.js + content.js
// injected (expecting a decline), and once with no extension (expecting its fallback message after TIMEOUT_MS).
// WebKit counts an offscreen window as hidden and, a few seconds in, nearly stops its timers, so the watch
// would never run to its end. A private WebKit setting turns that check off (see keepTimersRunning).
//
// Serve the repository first:  python3 -m http.server 8765 --bind 127.0.0.1
// Then:                         swift tools/run_pages.swift [page.html | demo ...]
// Exits with 1 if any page fails.
import Cocoa
import WebKit

let base = URL(string: "http://127.0.0.1:8765/tests/")!
let demoURL = URL(string: "../docs/demo/", relativeTo: base)!.absoluteURL
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

// Read a millisecond constant from a served file, in seconds.
func servedSeconds(_ path: String, constant: String) -> Double {
    let source = served(path)
    let line = try! NSRegularExpression(pattern: #"^ *const \#(constant) = (\d+);"#, options: .anchorsMatchLines)
    guard let match = line.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
          let ms = Double(source[Range(match.range(at: 1), in: source)!]) else {
        print("Can't find \"const \(constant) = <milliseconds>;\" in \(path).")
        exit(2)
    }
    return ms / 1000
}

enum PageSpec {
    case mock(String)
    case demoDecline
    case demoNoExtension

    var label: String {
        switch self {
        case .mock(let name): return name
        case .demoDecline: return "docs/demo/index.html"
        case .demoNoExtension: return "docs/demo/index.html (no extension)"
        }
    }

    var url: URL {
        switch self {
        case .mock(let name): return base.appendingPathComponent("pages/\(name)")
        case .demoDecline, .demoNoExtension: return demoURL
        }
    }
}

func specsToRun() -> [PageSpec] {
    let named = Array(CommandLine.arguments.dropFirst())
    if !named.isEmpty {
        return named.flatMap { arg -> [PageSpec] in
            switch arg {
            case "demo": return [.demoDecline, .demoNoExtension]
            case "demo-decline": return [.demoDecline]
            case "demo-no-extension": return [.demoNoExtension]
            default: return [.mock(arg)]
            }
        }
    }
    let index = served("index.html")
    let links = try! NSRegularExpression(pattern: #"href="pages/([^"]+\.html)""#)
    let mocks = links.matches(in: index, range: NSRange(index.startIndex..., in: index)).map {
        PageSpec.mock(String(index[Range($0.range(at: 1), in: index)!]))
    }
    return [.demoNoExtension, .demoDecline] + mocks
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

// Injects browser-stub.js + content.js into docs/demo/index.html at document_start, captures the
// messages content.js sends, removes globalThis.browser, and defines window.__result() for the check.
func demoDeclineScript(stub: String, content: String) -> String {
    """
    (() => {
      const messages = [];
      const runContentScript = () => {
    \(stub)
        const send = globalThis.browser.runtime.sendMessage;
        globalThis.browser.runtime.sendMessage = async (message) => {
          messages.push(message);
          return send(message);
        };
    \(content)
        delete globalThis.browser;
      };
      if (document.documentElement) runContentScript();
      else new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        runContentScript();
      }).observe(document, { childList: true });
      window.__result = () => {
        const result = document.getElementById('result');
        const state = result?.dataset.state ?? null;
        const resultText = result?.textContent?.trim() ?? '';
        const bannerGone = !document.getElementById('z81');
        const helpHidden = Boolean(document.getElementById('help')?.hidden);
        const report = messages.filter((m) => m.type === 'declined').map((m) => m.how).join(',');
        return {
          page: 'docs/demo/index.html',
          pass: state === 'rejected' && bannerGone && helpHidden && report === 'rejected' && resultText.length > 0,
          state,
          bannerGone,
          helpHidden,
          report,
          resultText,
        };
      };
    })();
    """
}

let demoNoExtensionResultJS = """
JSON.stringify((() => {
  const result = document.getElementById('result');
  const help = document.getElementById('help');
  const banner = document.getElementById('z81');
  const state = result?.dataset.state ?? null;
  const resultText = result?.textContent?.trim() ?? '';
  const helpVisible = Boolean(help && !help.hidden && help.checkVisibility());
  const helpItems = help ? [...help.querySelectorAll('li')].filter((li) => li.textContent.trim().length > 0).length : 0;
  const bannerShowing = Boolean(banner && banner.checkVisibility());
  return {
    page: 'docs/demo/index.html (no extension)',
    pass: state === 'timeout' && helpVisible && helpItems >= 2 && bannerShowing && resultText.length > 0,
    state,
    helpVisible,
    helpItems,
    bannerShowing,
    resultText,
  };
})())
"""

final class PageRun: NSObject, WKNavigationDelegate {
    let spec: PageSpec
    let waitSeconds: Double
    let window = NSWindow(contentRect: NSRect(x: -6000, y: -6000, width: 1024, height: 768),
                          styleMask: .borderless, backing: .buffered, defer: false)
    let webView: WKWebView
    let finished: (String, Bool, String) -> Void
    var loads = 0                      // pages loaded in this web view so far
    var reading: DispatchWorkItem?     // the one reading of the result, once scheduled
    var done = false

    init(_ spec: PageSpec, waitSeconds: Double, demoScript: String?, finished: @escaping (String, Bool, String) -> Void) {
        self.spec = spec
        self.waitSeconds = waitSeconds
        self.finished = finished
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent() // no cache: always run the files as they are now
        // Offscreen pages count as hidden, and the extension waits until a page is shown. Say it is.
        let shown = "Object.defineProperty(Document.prototype, 'hidden', { get: () => false });" +
            "Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible' });"
        config.userContentController.addUserScript(
            WKUserScript(source: shown, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        if let demoScript = demoScript {
            config.userContentController.addUserScript(
                WKUserScript(source: demoScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: config)
        super.init()
        keepTimersRunning(webView)
        webView.navigationDelegate = self
        window.contentView = webView
        window.orderBack(nil)
        webView.load(URLRequest(url: spec.url))
    }

    // The extension starts its watch a few milliseconds after the page loads (once the harness has read the
    // cookie list), so the margin also covers that.
    // The first page, and the one it loads, each set the reading to their own watch's end.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loads += 1
        guard loads <= 2 else { return }
        reading?.cancel()
        let read = DispatchWorkItem { self.check() }
        reading = read
        DispatchQueue.main.asyncAfter(deadline: .now() + waitSeconds + marginSeconds, execute: read)
    }

    // Read the page's result, once.
    func check() {
        let js: String
        switch spec {
        case .demoNoExtension: js = demoNoExtensionResultJS
        case .mock, .demoDecline: js = "JSON.stringify(window.__result())"
        }
        webView.evaluateJavaScript(js) { value, error in
            let json = value as? String ?? "{\"error\": \"\(String(describing: error))\"}"
            let result = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
            self.end(result?["pass"] as? Bool == true, json)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        end(false, "{\"error\": \"\(error.localizedDescription)\"}")
    }

    // Report this page's result, once.
    func end(_ pass: Bool, _ json: String) {
        guard !done else { return }
        done = true
        reading?.cancel()
        window.close()
        finished(spec.label, pass, json)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let watch = servedSeconds("../extension/content.js", constant: "WATCH_MS")
let demoTimeout = servedSeconds("../docs/demo/index.html", constant: "TIMEOUT_MS")
let specs = specsToRun()
let needsDemoScript = specs.contains { if case .demoDecline = $0 { return true }; return false }
let demoScript = needsDemoScript
    ? demoDeclineScript(stub: served("live/browser-stub.js"), content: served("../extension/content.js"))
    : nil
var queue = specs
var runs: [PageRun] = []
var failures: [String] = []
var remaining = specs.count

func startNext() {
    guard !queue.isEmpty else { return }
    let spec = queue.removeFirst()
    let wait: Double
    let script: String?
    switch spec {
    case .mock:
        wait = watch
        script = nil
    case .demoDecline:
        wait = watch
        script = demoScript
    case .demoNoExtension:
        wait = demoTimeout
        script = nil
    }
    runs.append(PageRun(spec, waitSeconds: wait, demoScript: script) { name, pass, json in
        print(pass ? "PASS  \(name)" : "FAIL  \(name)  \(json)")
        if !pass { failures.append(name) }
        remaining -= 1
        if remaining == 0 {
            print(failures.isEmpty ? "\nAll \(specs.count) pages passed in WebKit."
                                   : "\n\(failures.count) of \(specs.count) pages failed: \(failures.joined(separator: ", "))")
            exit(failures.isEmpty ? 0 : 1)
        }
        startNext()
    })
}
for _ in 0..<min(parallel, specs.count) { startNext() }
// Give up after the time the pages need, six at a time, and a minute more.
let rounds = (Double(specs.count) / Double(parallel)).rounded(.up)
DispatchQueue.main.asyncAfter(deadline: .now() + rounds * (watch + marginSeconds) + 60) {
    print("Timed out with \(remaining) pages unfinished.")
    exit(1)
}
app.run()
