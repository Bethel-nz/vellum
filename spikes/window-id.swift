// Prints the CGWindowID of the largest window owned by process id argv[1], for `screencapture -l`.
import CoreGraphics
import Foundation
let pid = Int(CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "") ?? -1
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
var best: (Int, Double)? = nil
for w in list {
  guard (w[kCGWindowOwnerPID as String] as? NSNumber)?.intValue == pid,
        let id = (w[kCGWindowNumber as String] as? NSNumber)?.intValue,
        let b = w[kCGWindowBounds as String] as? [String: Any],
        let wd = (b["Width"] as? NSNumber)?.doubleValue, let ht = (b["Height"] as? NSNumber)?.doubleValue else { continue }
  if best == nil || wd * ht > best!.1 { best = (id, wd * ht) }
}
if let b = best { print(b.0) }
