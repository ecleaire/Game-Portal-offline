import Foundation
import Network
import Darwin

func desktopLoopbackParameters(port: UInt16?) -> NWParameters {
    let parameters = NWParameters.tcp
    // This server never needs a Wi-Fi, Ethernet or Internet route. In particular,
    // a Mac with disconnected network interfaces must still launch offline.
    parameters.requiredInterfaceType = .loopback
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port.flatMap { NWEndpoint.Port(rawValue: $0) } ?? .any)
    // Do not enable endpoint sharing: two editions/processes must not serve
    // different pages on the same saved origin.
    return parameters
}

func desktopListenerMessage(_ error: NWError) -> String {
    let reason: String
    let guidance: String
    switch error {
    case .posix(let code):
        reason = "POSIX \(code.rawValue): \(String(cString: strerror(code.rawValue)))"
        guidance = code == .EADDRINUSE
            ? "別のGAME PORTALが起動している場合は閉じて、少し待ってから開き直してください。"
            : "Mac内の接続（127.0.0.1）を開始できません。Macを再起動してから開き直してください。"
    case .dns(let code):
        reason = "DNS \(code)"
        guidance = "Mac内の接続（127.0.0.1）を開始できません。Macを再起動してから開き直してください。"
    case .tls(let code):
        reason = "TLS \(code)"
        guidance = "Mac内の接続（127.0.0.1）を開始できません。Macを再起動してから開き直してください。"
    @unknown default:
        reason = String(describing: error)
        guidance = "Mac内の接続（127.0.0.1）を開始できません。Macを再起動してから開き直してください。"
    }
    return guidance + "\nゲームやセーブは削除せず、そのままにしてください。\n接続エラー: " + reason
}
