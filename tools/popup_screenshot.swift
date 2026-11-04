// Renders the popup preview with WebKit (Safari's engine), in light and dark, side by side at 2x,
// and saves it as a PNG with a transparent background. Used for docs/popup.png in the README.
//
// Serve the repository first:  python3 -m http.server 8765 --bind 127.0.0.1
// Then:                         swift tools/popup_screenshot.swift [output.png] [preview query]
// Default query: states=rejected&total=1284&repo=1 (see tests/popup-preview.html for the options).
import Cocoa
import WebKit

let arguments = CommandLine.arguments
let output = arguments.count > 1 ? arguments[1] : "docs/popup.png"
let query = arguments.count > 2 ? arguments[2] : "states=rejected&total=1284&repo=1"
let url = URL(string: "http://127.0.0.1:8765/tests/popup-preview.html?bare=1&" + query)!
let scale: CGFloat = 2

final class Shot: NSObject, WKNavigationDelegate {
    let window = NSWindow(contentRect: NSRect(x: -4000, y: -4000, width: 380, height: 700),
                          styleMask: .borderless, backing: .buffered, defer: false)
    let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 380, height: 700))
    var finished: ((NSImage) -> Void)?

    init(appearance: NSAppearance.Name) {
        super.init()
        webView.appearance = NSAppearance(named: appearance)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        window.backgroundColor = .clear
        window.isOpaque = false
        window.contentView = webView
        window.orderBack(nil)
    }

    func take(_ done: @escaping (NSImage) -> Void) {
        finished = done
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Let the popup load its translations, run, and finish its little animation.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            webView.evaluateJavaScript("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.right + 24, r.bottom + 32]; })()") { result, _ in
                let size = (result as? [Double]) ?? [348, 560]
                let config = WKSnapshotConfiguration()
                config.rect = NSRect(x: 0, y: 0, width: size[0], height: size[1])
                config.snapshotWidth = NSNumber(value: size[0] * Double(scale))
                webView.takeSnapshot(with: config) { image, error in
                    guard let image else { fatalError("Snapshot failed: \(String(describing: error))") }
                    image.size = config.rect.size   // CSS pixels; the bitmap inside is 2x
                    self.finished?(image)
                }
            }
        }
    }
}

func pngData(_ images: [NSImage], gap: CGFloat) -> Data {
    let width = images.reduce(0) { $0 + $1.size.width } + gap * CGFloat(images.count - 1)
    let height = images.map(\.size.height).max() ?? 0
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: width, height: height)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    var x: CGFloat = 0
    for image in images {
        image.draw(in: NSRect(x: x, y: height - image.size.height, width: image.size.width, height: image.size.height))
        x += image.size.width + gap
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let light = Shot(appearance: .aqua)
let dark = Shot(appearance: .darkAqua)
light.take { lightImage in
    dark.take { darkImage in
        let data = pngData([lightImage, darkImage], gap: -8)   // each shot has a 24 px margin; overlap them a bit
        try! FileManager.default.createDirectory(at: URL(fileURLWithPath: output).deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        try! data.write(to: URL(fileURLWithPath: output))
        print("Wrote \(output)")
        exit(0)
    }
}
app.run()
