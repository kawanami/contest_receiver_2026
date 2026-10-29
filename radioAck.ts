// **未使用!!**
// 通常のRadio通信において，ACKを追加する
// Tello-Bridgeとの互換ないため，ボツ

namespace radioAck {
    enum Mode {
        None = 0,
        Controller = 1,
        Server = 2
    }

    let mode: Mode = Mode.None
    let started = false

    const RETRY_MAX = 3
    const ACK_TIMEOUT_MS = 200

    let seq = 0

    // ACK待ち状態（送信側）
    let waiting = false
    let waitingSeq = 0
    let acked = false

    // Serverモード用受信ハンドラ
    let rxHandler: (payload: string) => void = null

    // ===== Logging =====
    let DEBUG = true

    function log(s: string) {
        if (DEBUG) serial.writeLine("[radioAck] " + s)
    }

    export function _setDebug(enabled: boolean) {
        DEBUG = enabled
        if (DEBUG) serial.writeLine("[radioAck] DEBUG ON")
    }

    function initIfNeeded() {
        if (started) return
        started = true
        radio.onReceivedString(onRx)
        log("init ok (radio.onReceivedString registered)")
    }

    function onRx(msg: string) {
        log("RX raw: " + msg)

        const parts = msg.split(",")
        if (parts.length < 2) {
            log("RX ignored (too short)")
            return
        }

        const kind = parts[0]
        const s = parseInt(parts[1])

        // ACK受信
        if (kind == "A") {
            log("RX ACK seq=" + s)

            if (waiting && s == waitingSeq) {
                acked = true
                log("ACK matched! seq=" + s)
            } else {
                log("ACK ignored (not waiting or seq mismatch)")
            }
            return
        }

        // DATA受信
        if (kind == "D") {
            log("RX DATA seq=" + s)

            // ACK返信（必ず返す）
            radio.sendString(`A,${s}`)
            log("TX ACK seq=" + s)

            // Serverモードなら payload を上へ渡す
            if (mode == Mode.Server && rxHandler) {
                const payload = parts.slice(2).join(",")
                log("PASS payload to handler: " + payload)
                rxHandler(payload)
            } else {
                log("payload ignored (mode=" + mode + ")")
            }

            return
        }

        log("RX ignored (unknown kind=" + kind + ")")
    }

    // =========================
    // 開発者用 API（ブロックに出さない）
    // =========================

    export function _setModeController() {
        initIfNeeded()
        mode = Mode.Controller
        rxHandler = null
        log("mode set: Controller")
    }

    export function _setModeServer(handler: (payload: string) => void) {
        initIfNeeded()
        mode = Mode.Server
        rxHandler = handler
        log("mode set: Server")
    }

    // =========================
    // 開発者用：ACK付き送信
    // =========================

    export function _sendWithAck(payload: string): boolean {
        initIfNeeded()

        if (waiting) {
            log("SEND rejected (already waiting)")
            return false
        }

        seq = (seq + 1) & 0xffff
        waiting = true
        waitingSeq = seq
        acked = false

        log("SEND start seq=" + waitingSeq + " payload=" + payload)

        for (let i = 0; i < RETRY_MAX; i++) {
            log("TX DATA try=" + (i + 1) + " seq=" + waitingSeq)
            radio.sendString(`D,${waitingSeq},${payload}`)

            const t0 = control.millis()
            while (control.millis() - t0 < ACK_TIMEOUT_MS) {
                if (acked) {
                    waiting = false
                    log("SEND success seq=" + waitingSeq)
                    return true
                }
                basic.pause(5)
            }

            log("TIMEOUT waiting ACK seq=" + waitingSeq)
        }

        waiting = false
        log("SEND failed seq=" + waitingSeq)
        return false
    }
}
