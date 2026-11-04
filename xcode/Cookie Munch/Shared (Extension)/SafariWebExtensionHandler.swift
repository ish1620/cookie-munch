//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//

import Foundation

// Safari needs this class to load the extension, but Cookie Munch doesn't use native messaging
// (no "nativeMessaging" permission, no sendNativeMessage), so every request gets an empty answer.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [], completionHandler: nil)
    }

}
