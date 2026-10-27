import AppKit
import CoreServices
import Foundation
import UserNotifications

private func emit(_ value: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: value) else { return }
    data.append(0x0a)
    FileHandle.standardOutput.write(data)
}

private let parentPID: pid_t? = {
    guard let index = CommandLine.arguments.firstIndex(of: "--parent"),
          CommandLine.arguments.indices.contains(index + 1) else { return nil }
    return Int32(CommandLine.arguments[index + 1])
}()

private func parentIsActive() -> Bool {
    guard let parentPID else { return false }
    return NSRunningApplication(processIdentifier: parentPID)?.isActive == true
}

private struct Notice {
    let id: String
    let title: String
    let subtitle: String
    let body: String
    let note: String
}

private final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    private var queued: [Notice] = []
    private var owned: Set<String> = []
    private var authorizing = false

    override init() {
        super.init()
        center.delegate = self
        let open = UNNotificationAction(identifier: "open", title: "Open note", options: [.foreground])
        center.setNotificationCategories([UNNotificationCategory(identifier: "vellum", actions: [open], intentIdentifiers: [])])
    }

    private func status(_ settings: UNNotificationSettings) -> String {
        switch settings.authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        @unknown default: return "unknown"
        }
    }

    func reportStatus(exitAfter: Bool = false) {
        center.getNotificationSettings { settings in
            emit(["type": "status", "status": self.status(settings)])
            if exitAfter { exit(0) }
        }
    }

    private func flush(_ allowed: Bool) {
        let notices = queued
        queued.removeAll()
        guard allowed else { return }
        for notice in notices {
            if parentIsActive() { emit(["type": "suppressed", "id": notice.id]); continue }
            let content = UNMutableNotificationContent()
            content.title = notice.title
            content.subtitle = notice.subtitle
            content.body = notice.body
            content.threadIdentifier = notice.note
            content.categoryIdentifier = "vellum"
            content.sound = .default
            let request = UNNotificationRequest(identifier: notice.id, content: content, trigger: nil)
            center.add(request) { error in
                if let error { emit(["type": "error", "id": notice.id, "message": error.localizedDescription]) }
                else { emit(["type": "posted", "id": notice.id]) }
            }
        }
    }

    private func authorize() {
        center.getNotificationSettings { settings in
            DispatchQueue.main.async {
                if settings.authorizationStatus == .notDetermined {
                    guard !self.authorizing else { return }
                    self.authorizing = true
                    self.center.requestAuthorization(options: [.alert, .sound]) { allowed, error in
                        DispatchQueue.main.async {
                            self.authorizing = false
                            if let error { emit(["type": "error", "message": error.localizedDescription]) }
                            self.reportStatus()
                            self.flush(allowed)
                        }
                    }
                } else {
                    emit(["type": "status", "status": self.status(settings)])
                    self.flush(settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional)
                }
            }
        }
    }

    func handle(_ message: [String: Any]) {
        switch message["command"] as? String {
        case "status": reportStatus()
        case "authorize": authorize()
        case "show":
            guard let id = message["id"] as? String, let title = message["title"] as? String,
                  let body = message["body"] as? String else { return }
            owned.insert(id)
            queued.removeAll { $0.id == id }
            queued.append(Notice(id: id, title: title, subtitle: message["subtitle"] as? String ?? "",
                                 body: body, note: message["note"] as? String ?? ""))
            authorize()
        case "dismiss":
            guard let id = message["id"] as? String else { return }
            owned.remove(id)
            queued.removeAll { $0.id == id }
            center.removePendingNotificationRequests(withIdentifiers: [id])
            center.removeDeliveredNotifications(withIdentifiers: [id])
        case "quit": stop()
        default: emit(["type": "error", "message": "Unknown notification command"])
        }
    }

    func stop() {
        queued.removeAll()
        let identifiers = Array(owned)
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
        owned.removeAll()
        NSApplication.shared.terminate(nil)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier != UNNotificationDismissActionIdentifier {
            if let parentPID {
                NSRunningApplication(processIdentifier: parentPID)?.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            }
            emit(["type": "response", "id": response.notification.request.identifier])
        }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler(parentIsActive() ? [] : [.banner, .list, .sound])
    }
}

if CommandLine.arguments.contains("--self-check") {
    emit(["bundleId": Bundle.main.bundleIdentifier ?? "", "name": Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") ?? ""])
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
private let service = NotificationService()
let statusOnly = CommandLine.arguments.contains("--status")
service.reportStatus(exitAfter: statusOnly)
if !statusOnly {
    DispatchQueue.global(qos: .utility).async {
        while let line = readLine() {
            guard let data = line.data(using: .utf8),
                  let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            DispatchQueue.main.async { service.handle(message) }
        }
        DispatchQueue.main.async { service.stop() }
    }
}
app.run()
