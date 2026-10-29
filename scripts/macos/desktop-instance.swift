import Foundation
import Darwin

// Lock the local profile, never the NAS library. Creator and Player use separate
// profiles; only duplicate runtimes sharing the same browser/save store conflict.
// The file stays in place. Kernel locks recover on crash without stale PID files.
final class DesktopInstanceLease {
    private let descriptor: Int32
    init(_ file: URL) throws {
        let fd = Darwin.open(file.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0o600)
        guard fd >= 0 else { throw DesktopHTTPError(operation: "instance-lock", code: errno) }
        var owned = false
        defer { if !owned { Darwin.close(fd) } }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), fcntl(fd, F_SETFD, FD_CLOEXEC) == 0 else {
            throw NSError(domain: "GAME PORTAL", code: 1, userInfo: [NSLocalizedDescriptionKey: "アプリの起動確認ファイルを確認してください。ゲームやセーブを削除する必要はありません。"])
        }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            let code = errno
            if code == EWOULDBLOCK {
                throw NSError(domain: "GAME PORTAL", code: 2, userInfo: [NSLocalizedDescriptionKey: "この用途のGAME PORTALはすでに開いています。開いているウィンドウを使用してください。プレイ用とクリエイター用は同時に使用できます。"])
            }
            throw DesktopHTTPError(operation: "instance-lock", code: code)
        }
        descriptor = fd; owned = true
    }
    deinit { Darwin.close(descriptor) }
}
