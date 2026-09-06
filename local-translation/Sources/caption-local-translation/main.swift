import AppKit
import Combine
import Foundation
import SwiftUI
#if canImport(NaturalLanguage) && canImport(Translation)
import NaturalLanguage
import Translation
#endif

private struct Command: Decodable {
    let command: String
    let source_language: String?
    let target_language: String?
    let request_id: Int?
    let text: String?
}

private struct Event: Encodable {
    let type: String
    var detail: String? = nil
    var request_id: Int? = nil
    var translation: String? = nil
    var message: String? = nil
    var installed: Bool? = nil
    var supported: Bool? = nil
    var languages: [String]? = nil
}

private final class EventWriter: @unchecked Sendable {
    private let lock = NSLock()
    private let encoder = JSONEncoder()

    func send(_ event: Event) {
        guard let payload = try? encoder.encode(event) else { return }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(payload)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    func log(_ message: String) {
        guard let data = "[local-translation] \(message)\n".data(using: .utf8) else { return }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardError.write(data)
    }
}

private enum LocalTranslationError: LocalizedError {
    case invalidCommand
    case unavailable(String)
    case unsupportedPair(String, String)

    var errorDescription: String? {
        switch self {
        case .invalidCommand:
            return "Invalid local translation command"
        case .unavailable(let detail):
            return detail
        case .unsupportedPair(let source, let target):
            return "Apple Translation does not support \(source) to \(target) on this Mac"
        }
    }
}

#if canImport(NaturalLanguage) && canImport(Translation)
@available(macOS 15.0, *)
@MainActor
private final class TranslationHostModel: ObservableObject {
    private static let memoLimit = 256

    private struct LanguagePair: Hashable {
        let source: String
        let target: String
    }

    private enum PendingOperation {
        case prepare(Int, LanguagePair, CheckedContinuation<Void, Error>)
        case translate(Int, LanguagePair, String, CheckedContinuation<String, Error>)

        var generation: Int {
            switch self {
            case .prepare(let generation, _, _), .translate(let generation, _, _, _):
                return generation
            }
        }

        var pair: LanguagePair {
            switch self {
            case .prepare(_, let pair, _), .translate(_, let pair, _, _):
                return pair
            }
        }
    }

    @Published private(set) var configuration: TranslationSession.Configuration?
    @Published private(set) var statusText = "Preparing local translation…"
    @Published private(set) var languagePairText = ""

    var showHostWindow: ((Bool) -> Void)?
    var hideHostWindow: (() -> Void)?

    private let writer: EventWriter
    private let operationSignals: AsyncStream<Void>
    private let operationSignal: AsyncStream<Void>.Continuation
    private var configuredSource = ""
    private var configuredTarget = ""
    private var detectedSource: String?
    private var currentPair: LanguagePair?
    private var generation = 0
    private var pendingOperations: [PendingOperation] = []
    private var memo: [String: String] = [:]
    private var memoOrder: [String] = []

    init(writer: EventWriter) {
        self.writer = writer
        let stream = AsyncStream.makeStream(of: Void.self, bufferingPolicy: .bufferingNewest(1))
        operationSignals = stream.stream
        operationSignal = stream.continuation
    }

    func handle(_ command: Command) async -> Bool {
        switch command.command {
        case "languages":
            await reportLanguages(source: command.source_language)
        case "availability":
            await reportAvailability(source: command.source_language, target: command.target_language)
        case "start":
            await start(source: command.source_language, target: command.target_language)
        case "translate":
            await translate(requestID: command.request_id, text: command.text)
        case "quit":
            reset()
            return false
        default:
            writer.send(Event(type: "error", request_id: command.request_id, message: LocalTranslationError.invalidCommand.localizedDescription))
        }
        return true
    }

    private func reportLanguages(source: String?) async {
        let availability = LanguageAvailability()
        let languages = await availability.supportedLanguages
        guard let source else {
            writer.send(Event(type: "languages", languages: languages.map(\.minimalIdentifier)))
            return
        }
        let sourceLanguage = Locale.Language(identifier: translationLocaleIdentifier(for: source))
        var supported: [String] = []
        for language in languages where !sameLanguage(source, language.minimalIdentifier) {
            let status = await availability.status(from: sourceLanguage, to: language)
            if status != .unsupported { supported.append(language.minimalIdentifier) }
        }
        writer.send(Event(type: "languages", languages: supported))
    }

    private func reportAvailability(source: String?, target: String?) async {
        guard let source, let target else {
            writer.send(Event(type: "error", message: LocalTranslationError.invalidCommand.localizedDescription))
            return
        }
        let sourceLanguage = Locale.Language(identifier: translationLocaleIdentifier(for: source))
        let targetLanguage = Locale.Language(identifier: translationLocaleIdentifier(for: target))
        let availability = await LanguageAvailability().status(from: sourceLanguage, to: targetLanguage)
        writer.send(Event(
            type: "availability",
            installed: availability == .installed,
            supported: availability != .unsupported
        ))
    }

    func run(using session: TranslationSession) async {
        guard let pair = currentPair else { return }
        let runnerGeneration = generation
        var signalIterator = operationSignals.makeAsyncIterator()
        writer.log("translationTask runner started for \(pair.source) -> \(pair.target)")

        while !Task.isCancelled, generation == runnerGeneration, currentPair == pair {
            if let index = pendingOperations.firstIndex(where: {
                $0.generation == runnerGeneration && $0.pair == pair
            }) {
                let operation = pendingOperations.remove(at: index)
                switch operation {
                case .prepare(_, _, let continuation):
                    do {
                        writer.log("preparing translation models")
                        try await session.prepareTranslation()
                        writer.log("translation models prepared")
                        continuation.resume()
                    } catch {
                        continuation.resume(throwing: error)
                    }
                case .translate(_, _, let text, let continuation):
                    do {
                        writer.log("translating request")
                        let response = try await session.translate(text)
                        writer.log("translation request completed")
                        let translation = response.targetText.trimmingCharacters(in: .whitespacesAndNewlines)
                        continuation.resume(returning: translation.isEmpty ? text : translation)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
                continue
            }
            guard await signalIterator.next() != nil else { return }
        }
    }

    private func start(source: String?, target: String?) async {
        guard let source, let target else {
            writer.send(Event(type: "error", message: LocalTranslationError.invalidCommand.localizedDescription))
            return
        }
        reset()
        configuredSource = source
        configuredTarget = target

        if source == "auto" {
            writer.send(Event(type: "status", detail: "Local translation will prepare after detecting the first complete caption"))
            writer.send(Event(type: "ready"))
            return
        }

        do {
            try await prepare(pair: LanguagePair(source: source, target: target))
            writer.send(Event(type: "ready"))
        } catch {
            hideHostWindow?()
            writer.send(Event(type: "error", message: preparationErrorMessage(error)))
        }
    }

    private func translate(requestID: Int?, text: String?) async {
        guard let requestID, let text else {
            writer.send(Event(type: "error", request_id: requestID, message: LocalTranslationError.invalidCommand.localizedDescription))
            return
        }
        let sourceText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sourceText.isEmpty else {
            writer.send(Event(type: "translation", request_id: requestID, translation: ""))
            return
        }

        do {
            let source = try resolvedSource(for: sourceText)
            guard !sameLanguage(source, configuredTarget) else {
                writer.send(Event(type: "translation", request_id: requestID, translation: sourceText))
                return
            }
            let pair = LanguagePair(source: source, target: configuredTarget)
            let key = "\(source)\u{001F}\(configuredTarget)\u{001F}\(sourceText)"
            if let cached = memo[key] {
                writer.send(Event(type: "translation", request_id: requestID, translation: cached))
                return
            }
            if currentPair != pair { try await prepare(pair: pair) }
            let translation = try await enqueueTranslation(sourceText, pair: pair)
            remember(translation, for: key)
            writer.send(Event(type: "translation", request_id: requestID, translation: translation))
        } catch {
            hideHostWindow?()
            writer.send(Event(type: "error", request_id: requestID, message: preparationErrorMessage(error)))
        }
    }

    private func prepare(pair: LanguagePair) async throws {
        guard !sameLanguage(pair.source, pair.target) else { return }
        let sourceLanguage = Locale.Language(identifier: translationLocaleIdentifier(for: pair.source))
        let targetLanguage = Locale.Language(identifier: translationLocaleIdentifier(for: pair.target))
        let availabilityService = LanguageAvailability()
        let availability = await availabilityService.status(from: sourceLanguage, to: targetLanguage)
        guard availability != .unsupported else {
            throw LocalTranslationError.unsupportedPair(pair.source, pair.target)
        }

        statusText = availability == .installed
            ? "Preparing the installed Apple Translation models…"
            : "macOS needs permission to download the translation models."
        languagePairText = "\(displayName(for: sourceLanguage)) → \(displayName(for: targetLanguage))"
        writer.send(Event(type: "status", detail: availability == .installed
            ? "Preparing installed Apple Translation models"
            : "Waiting for permission to download Apple Translation models"))
        showHostWindow?(availability != .installed)

        activate(pair: pair, source: sourceLanguage, target: targetLanguage)
        do {
            try await enqueuePreparation(pair: pair)
            let refreshedAvailability = await availabilityService.status(
                from: sourceLanguage,
                to: targetLanguage
            )
            guard refreshedAvailability == .installed else {
                throw LocalTranslationError.unavailable(
                    "The Apple Translation models are not installed yet. Approve the download, or install both languages in System Settings > General > Language & Region > Translation Languages."
                )
            }
            statusText = "Local translation is ready."
            hideHostWindow?()
        } catch {
            hideHostWindow?()
            throw error
        }
    }

    private func enqueuePreparation(pair: LanguagePair) async throws {
        try await withCheckedThrowingContinuation { continuation in
            pendingOperations.append(.prepare(generation, pair, continuation))
            operationSignal.yield()
        }
    }

    private func enqueueTranslation(_ text: String, pair: LanguagePair) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            pendingOperations.append(.translate(generation, pair, text, continuation))
            operationSignal.yield()
        }
    }

    private func activate(pair: LanguagePair, source: Locale.Language, target: Locale.Language) {
        if currentPair == pair, configuration != nil { return }
        generation &+= 1
        cancelPendingOperations()
        currentPair = pair
        configuration = TranslationSession.Configuration(source: source, target: target)
        operationSignal.yield()
    }

    private func resolvedSource(for text: String) throws -> String {
        if configuredSource != "auto" { return configuredSource }
        if let detectedSource { return detectedSource }
        guard let detected = detectedLanguage(for: text) else {
            throw LocalTranslationError.unavailable("Apple Translation could not detect the caption language. Choose a spoken language instead of Automatic detection.")
        }
        detectedSource = detected
        return detected
    }

    private func detectedLanguage(for text: String) -> String? {
        guard let language = NLLanguageRecognizer.dominantLanguage(for: text) else { return nil }
        switch language {
        case .japanese: return "ja-JP"
        case .english: return "en-US"
        case .simplifiedChinese: return "zh-CN"
        case .traditionalChinese: return "zh-TW"
        case .korean: return "ko-KR"
        default: return language.rawValue
        }
    }

    private func displayName(for language: Locale.Language) -> String {
        Locale.current.localizedString(forIdentifier: language.minimalIdentifier) ?? language.minimalIdentifier
    }

    private func sameLanguage(_ left: String, _ right: String) -> Bool {
        let leftLanguage = Locale.Language(identifier: left)
        let rightLanguage = Locale.Language(identifier: right)
        guard leftLanguage.languageCode == rightLanguage.languageCode else { return false }
        guard leftLanguage.languageCode?.identifier == "zh" else { return true }
        return translationLocaleIdentifier(for: left) == translationLocaleIdentifier(for: right)
    }

    private func translationLocaleIdentifier(for identifier: String) -> String {
        switch identifier {
        case "en-US": return "en"
        case "ja-JP": return "ja"
        case "ko-KR": return "ko"
        case "zh-CN": return "zh"
        default: return identifier
        }
    }

    private func preparationErrorMessage(_ error: Error) -> String {
        if error is CancellationError { return "The local translation download was cancelled" }
        if let localError = error as? LocalTranslationError { return localError.localizedDescription }
        return "Could not prepare Apple's local translation models: \(error.localizedDescription)"
    }

    private func remember(_ translation: String, for key: String) {
        if memo[key] == nil {
            memoOrder.append(key)
            if memoOrder.count > Self.memoLimit { memo.removeValue(forKey: memoOrder.removeFirst()) }
        }
        memo[key] = translation
    }

    private func reset() {
        generation &+= 1
        cancelPendingOperations()
        configuredSource = ""
        configuredTarget = ""
        detectedSource = nil
        currentPair = nil
        configuration = nil
        memo.removeAll()
        memoOrder.removeAll()
        operationSignal.yield()
        hideHostWindow?()
    }

    private func cancelPendingOperations() {
        let operations = pendingOperations
        pendingOperations.removeAll()
        for operation in operations {
            switch operation {
            case .prepare(_, _, let continuation): continuation.resume(throwing: CancellationError())
            case .translate(_, _, _, let continuation): continuation.resume(throwing: CancellationError())
            }
        }
    }
}

@available(macOS 15.0, *)
private struct TranslationHostView: View {
    @ObservedObject var model: TranslationHostModel

    var body: some View {
        VStack(spacing: 14) {
            ProgressView().controlSize(.large)
            Text("Preparing Local Translation").font(.headline)
            if !model.languagePairText.isEmpty {
                Text(model.languagePairText).font(.subheadline.weight(.medium))
            }
            Text(model.statusText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(width: 410, height: 170)
        .padding(20)
        .translationTask(model.configuration) { session in
            await model.run(using: session)
        }
    }
}

@available(macOS 15.0, *)
@MainActor
private final class TranslationHostWindowController {
    private let window: NSWindow

    init(model: TranslationHostModel) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 450, height: 210),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.title = "CCue"
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.moveToActiveSpace)
        window.contentView = NSHostingView(rootView: TranslationHostView(model: model))
        window.center()
    }

    func show(requiresUserInteraction: Bool) {
        window.alphaValue = 1
        window.ignoresMouseEvents = false
        window.center()
        if requiresUserInteraction {
            // A missing language model can trigger a macOS download prompt, so
            // this path must become interactive. moveToActiveSpace keeps the
            // prompt with the user instead of pulling them to an older Space.
            window.orderFrontRegardless()
            NSApplication.shared.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        } else {
            // Installed models only need a live SwiftUI view for translationTask.
            // Ordering it without activation avoids stealing focus or switching Spaces.
            window.orderFrontRegardless()
        }
    }

    func hide() {
        // TranslationSession is owned by the SwiftUI view. Keep its window
        // present after preparation so the task remains alive, but make the
        // accessory window invisible and non-interactive during live captions.
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.orderBack(nil)
    }
}
#endif

@main
private enum CaptionLocalTranslation {
    static func main() {
        #if canImport(NaturalLanguage) && canImport(Translation)
        if #available(macOS 15.0, *) {
            runTranslationHost()
            return
        }
        #endif
        runUnsupportedHost()
    }

    #if canImport(NaturalLanguage) && canImport(Translation)
    @available(macOS 15.0, *)
    @MainActor
    private static func runTranslationHost() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let writer = EventWriter()
        writer.log("bundle identifier: \(Bundle.main.bundleIdentifier ?? "none")")
        let model = TranslationHostModel(writer: writer)
        let windowController = TranslationHostWindowController(model: model)
        model.showHostWindow = { requiresUserInteraction in
            windowController.show(requiresUserInteraction: requiresUserInteraction)
        }
        model.hideHostWindow = { windowController.hide() }

        Task.detached {
            while let line = readLine() {
                do {
                    let command = try JSONDecoder().decode(Command.self, from: Data(line.utf8))
                    if await !model.handle(command) { break }
                } catch {
                    writer.send(Event(type: "error", message: error.localizedDescription))
                }
            }
            await MainActor.run { application.terminate(nil) }
        }
        application.run()
        _ = windowController
    }
    #endif

    private static func runUnsupportedHost() {
        let writer = EventWriter()
        while let line = readLine() {
            do {
                let command = try JSONDecoder().decode(Command.self, from: Data(line.utf8))
                if command.command == "quit" { break }
                writer.send(Event(type: "error", request_id: command.request_id, message: "Local translation requires macOS 15 or later"))
            } catch {
                writer.send(Event(type: "error", message: error.localizedDescription))
            }
        }
    }
}
