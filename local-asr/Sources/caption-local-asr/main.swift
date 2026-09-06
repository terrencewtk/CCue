@preconcurrency import AVFoundation
import CoreMedia
import Foundation
#if compiler(>=6.2) && canImport(FoundationModels)
import FoundationModels
#endif
#if compiler(>=6.2) && canImport(Speech)
import Speech
#endif

private struct Command: Decodable {
    let command: String
    let language: String?
    let adaptive_hints_enabled: Bool?
    let debug_glossary: Bool?
    let pcm16: String?
    let start_ms: Double?
    let end_ms: Double?
}

private struct Event: Encodable {
    let type: String
    var detail: String? = nil
    var text: String? = nil
    var start_ms: Double? = nil
    var end_ms: Double? = nil
    var message: String? = nil
    var installed: Bool? = nil
    var supported: Bool? = nil
    var deletable: Bool? = nil
    var released: Bool? = nil
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
}

private enum LocalAsrError: LocalizedError {
    case invalidCommand
    case invalidAudio
    case unsupported(String)

    var errorDescription: String? {
        switch self {
        case .invalidCommand: return "Invalid local transcription command"
        case .invalidAudio: return "The local transcription helper received invalid PCM audio"
        case .unsupported(let detail): return detail
        }
    }
}

private func decodePcm16(_ base64: String) throws -> [Float] {
    guard let data = Data(base64Encoded: base64), data.count.isMultiple(of: 2) else {
        throw LocalAsrError.invalidAudio
    }
    return data.withUnsafeBytes { bytes in
        (0..<(data.count / 2)).map { index in
            let sample = bytes.loadUnaligned(fromByteOffset: index * 2, as: Int16.self)
            return Float(Int16(littleEndian: sample)) / 32_768.0
        }
    }
}

private func makeFloatBuffer(_ samples: [Float]) throws -> AVAudioPCMBuffer {
    guard
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        ),
        let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(samples.count)
        ),
        let channel = buffer.floatChannelData?[0]
    else { throw LocalAsrError.invalidAudio }
    buffer.frameLength = AVAudioFrameCount(samples.count)
    channel.update(from: samples, count: samples.count)
    return buffer
}

private func convert(_ input: AVAudioPCMBuffer, to outputFormat: AVAudioFormat) throws -> AVAudioPCMBuffer {
    if input.format == outputFormat { return input }
    guard let converter = AVAudioConverter(from: input.format, to: outputFormat) else {
        throw LocalAsrError.unsupported("Offline transcription could not create an audio converter")
    }
    let ratio = outputFormat.sampleRate / input.format.sampleRate
    let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * ratio)) + 32
    guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
        throw LocalAsrError.invalidAudio
    }
    final class ConversionInput: @unchecked Sendable {
        let buffer: AVAudioPCMBuffer
        var supplied = false
        init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
    }
    let source = ConversionInput(input)
    var conversionError: NSError?
    let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
        if source.supplied {
            inputStatus.pointee = .endOfStream
            return nil
        }
        source.supplied = true
        inputStatus.pointee = .haveData
        return source.buffer
    }
    if let conversionError { throw conversionError }
    guard status != .error else { throw LocalAsrError.invalidAudio }
    return output
}

#if compiler(>=6.2) && canImport(Speech)
private protocol AppleAsrSession: Sendable {
    func append(_ samples: [Float]) async throws
    func stop() async throws
}
#endif

enum AdaptiveGlossaryCandidateFilter {
    static let maximumTermCount = 60
    static let maximumPredictionsPerBatch = 8
    static let maximumTermLength = 40

    static func parse(_ response: String, transcript: String) -> [String] {
        guard
            let openingBracket = response.firstIndex(of: "["),
            let closingBracket = response.lastIndex(of: "]"),
            openingBracket <= closingBracket,
            let data = String(response[openingBracket...closingBracket]).data(using: .utf8),
            let candidates = try? JSONDecoder().decode([String].self, from: data)
        else {
            return []
        }

        var result: [String] = []
        var seen = Set<String>()
        for candidate in candidates {
            let term = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            guard isEligiblePrediction(term, for: transcript) else { continue }
            let normalized = normalize(term)
            guard seen.insert(normalized).inserted else { continue }
            result.append(term)
            if result.count >= maximumPredictionsPerBatch { break }
        }
        return result
    }

    static func merge(existing: [String], candidates: [String]) -> [String] {
        var result: [String] = []
        var seen = Set<String>()
        for term in existing + candidates {
            let normalized = normalize(term)
            guard !normalized.isEmpty, seen.insert(normalized).inserted else { continue }
            result.append(term)
            if result.count >= maximumTermCount { break }
        }
        return result
    }

    private static func isEligiblePrediction(_ term: String, for transcript: String) -> Bool {
        guard
            !term.isEmpty,
            term.count <= maximumTermLength,
            term.split(whereSeparator: { $0.isWhitespace }).count <= 5,
            !transcriptContains(term, transcript: transcript)
        else {
            return false
        }
        return term.unicodeScalars.contains { CharacterSet.alphanumerics.contains($0) }
    }

    private static func transcriptContains(_ term: String, transcript: String) -> Bool {
        let escaped = NSRegularExpression.escapedPattern(for: term)
        let leading = term.unicodeScalars.first.map(isBoundaryRelevantScalar) == true
            ? "(?<!\(nonCJKWordCharacterClass))"
            : ""
        let trailing = term.unicodeScalars.last.map(isBoundaryRelevantScalar) == true
            ? "(?!\(nonCJKWordCharacterClass))"
            : ""
        guard let regex = try? NSRegularExpression(
            pattern: leading + escaped + trailing,
            options: [.caseInsensitive]
        ) else { return false }
        return regex.firstMatch(
            in: transcript,
            range: NSRange(location: 0, length: (transcript as NSString).length)
        ) != nil
    }

    private static let nonCJKWordCharacterClass =
        "[\\p{L}\\p{N}&&[^\\p{Han}\\p{Hiragana}\\p{Katakana}\\p{Hangul}]]"

    private static func isBoundaryRelevantScalar(_ scalar: Unicode.Scalar) -> Bool {
        CharacterSet.alphanumerics.contains(scalar) && !isCJKScalar(scalar)
    }

    private static func isCJKScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x1100...0x11FF,
             0x2E80...0x30FF,
             0x3400...0x4DBF,
             0x4E00...0x9FFF,
             0xA960...0xA97F,
             0xAC00...0xD7FF,
             0xF900...0xFAFF,
             0xFE30...0xFE6F,
             0xFF00...0xFFEF:
            return true
        default:
            return false
        }
    }

    private static func normalize(_ term: String) -> String {
        term.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    }
}

private actor LocalAsrSession {
    private let writer: EventWriter
    #if compiler(>=6.2) && canImport(Speech)
    private var appleSession: (any AppleAsrSession)?
    #endif

    init(writer: EventWriter) {
        self.writer = writer
    }

    func handle(_ command: Command) async throws -> Bool {
        switch command.command {
        case "languages":
            try await reportLanguages()
        case "availability":
            try await reportAvailability(language: command.language)
        case "release":
            try await release(language: command.language)
        case "start":
            try await start(
                language: command.language,
                adaptiveHintsEnabled: command.adaptive_hints_enabled ?? true,
                debugGlossary: command.debug_glossary ?? false
            )
        case "audio":
            try await append(command)
        case "stop":
            try await stop()
            writer.send(Event(type: "stopped"))
        case "quit":
            try await stop()
            return false
        default:
            throw LocalAsrError.invalidCommand
        }
        return true
    }

    private func reportLanguages() async throws {
        #if compiler(>=6.2) && canImport(Speech)
        guard #available(macOS 26.0, *) else {
            throw LocalAsrError.unsupported("Offline transcription requires macOS 26 or later")
        }
        guard SpeechTranscriber.isAvailable else {
            throw LocalAsrError.unsupported("Offline transcription is not available on this Mac")
        }
        let identifiers = await SpeechTranscriber.supportedLocales.map {
            $0.identifier(.bcp47)
        }
        writer.send(Event(type: "languages", languages: identifiers))
        #else
        throw LocalAsrError.unsupported("Offline transcription is unavailable in this build")
        #endif
    }

    private func reportAvailability(language: String?) async throws {
        #if compiler(>=6.2) && canImport(Speech)
        guard #available(macOS 26.0, *) else {
            throw LocalAsrError.unsupported("Offline transcription requires macOS 26 or later")
        }
        guard SpeechTranscriber.isAvailable else {
            throw LocalAsrError.unsupported("Offline transcription is not available on this Mac")
        }
        let requested = language == "auto" ? Locale.current : Locale(identifier: language ?? "en-US")
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
            writer.send(Event(type: "availability", installed: false, supported: false))
            return
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
        let status = await AssetInventory.status(forModules: [transcriber])
        let reservedLocales = await AssetInventory.reservedLocales
        writer.send(Event(
            type: "availability",
            installed: status == .installed,
            supported: status != .unsupported,
            deletable: status == .installed && reservedLocales.contains(where: {
                $0.identifier == locale.identifier
            })
        ))
        #else
        throw LocalAsrError.unsupported("Offline transcription is unavailable in this build")
        #endif
    }

    private func release(language: String?) async throws {
        #if compiler(>=6.2) && canImport(Speech)
        guard #available(macOS 26.0, *) else {
            throw LocalAsrError.unsupported("Offline transcription requires macOS 26 or later")
        }
        let requested = language == "auto" ? Locale.current : Locale(identifier: language ?? "en-US")
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
            throw LocalAsrError.unsupported("Offline transcription does not support \(requested.identifier)")
        }
        let released = await AssetInventory.release(reservedLocale: locale)
        writer.send(Event(type: "released", released: released))
        #else
        throw LocalAsrError.unsupported("Offline transcription is unavailable in this build")
        #endif
    }

    private func start(
        language: String?,
        adaptiveHintsEnabled: Bool,
        debugGlossary: Bool
    ) async throws {
        try await stop()
        #if compiler(>=6.2) && canImport(Speech)
        guard #available(macOS 26.0, *) else {
            throw LocalAsrError.unsupported("Offline transcription requires macOS 26 or later")
        }
        writer.send(Event(type: "status", detail: "Preparing Apple's on-device language model"))
        appleSession = try await AppleSession(
            language: language ?? "en-US",
            adaptiveHintsEnabled: adaptiveHintsEnabled,
            debugGlossary: debugGlossary,
            writer: writer
        )
        #else
        throw LocalAsrError.unsupported("Offline transcription is unavailable in this build")
        #endif
        writer.send(Event(type: "ready"))
    }

    private func append(_ command: Command) async throws {
        guard let encoded = command.pcm16 else { throw LocalAsrError.invalidAudio }
        let samples = try decodePcm16(encoded)
        #if compiler(>=6.2) && canImport(Speech)
        if let session = appleSession {
            try await session.append(samples)
            return
        }
        #endif
        throw LocalAsrError.invalidCommand
    }

    private func stop() async throws {
        #if compiler(>=6.2) && canImport(Speech)
        if let session = appleSession {
            try await session.stop()
            appleSession = nil
        }
        #endif
    }
}

#if compiler(>=6.2) && canImport(Speech)
@available(macOS 26.0, *)
private final class AppleSession: AppleAsrSession, @unchecked Sendable {
    private let analyzer: SpeechAnalyzer
    private let continuation: AsyncStream<AnalyzerInput>.Continuation
    private let analyzerFormat: AVAudioFormat
    private let adaptiveGlossary: AdaptiveGlossary?
    private let resultsTask: Task<Void, Error>

    init(
        language: String,
        adaptiveHintsEnabled: Bool,
        debugGlossary: Bool,
        writer: EventWriter
    ) async throws {
        guard SpeechTranscriber.isAvailable else {
            throw LocalAsrError.unsupported("Offline transcription is not available on this Mac")
        }
        let requested = language == "auto" ? Locale.current : Locale(identifier: language)
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
            throw LocalAsrError.unsupported("Offline transcription does not support \(requested.identifier)")
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            writer.send(Event(type: "status", detail: "Offline language download: 0% · \(locale.identifier)"))
            let progressTask = Task {
                var lastPercentage = -1
                while !Task.isCancelled {
                    let percentage = min(99, max(0, Int(request.progress.fractionCompleted * 100)))
                    if percentage != lastPercentage {
                        lastPercentage = percentage
                        writer.send(Event(
                            type: "status",
                            detail: "Offline language download: \(percentage)% · \(locale.identifier)"
                        ))
                    }
                    try? await Task.sleep(for: .milliseconds(500))
                }
            }
            try await request.downloadAndInstall()
            progressTask.cancel()
            writer.send(Event(type: "status", detail: "Offline language download: 100% · \(locale.identifier)"))
        } else {
            writer.send(Event(type: "status", detail: "Offline language is already installed; preparing transcription"))
        }
        _ = try await AssetInventory.reserve(locale: locale)

        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber],
            considering: AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: 16_000,
                channels: 1,
                interleaved: false
            )
        ) else {
            throw LocalAsrError.unsupported("Offline transcription could not select a compatible audio format")
        }
        analyzerFormat = format

        let stream = AsyncStream.makeStream(of: AnalyzerInput.self)
        continuation = stream.continuation
        analyzer = SpeechAnalyzer(modules: [transcriber])
        adaptiveGlossary = adaptiveHintsEnabled
            ? AdaptiveGlossary(
                analyzer: analyzer,
                locale: locale,
                logsTerms: debugGlossary
            )
            : nil
        let glossary = adaptiveGlossary
        resultsTask = Task {
            for try await result in transcriber.results {
                let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                writer.send(Event(
                    type: result.isFinal ? "final" : "partial",
                    text: text,
                    start_ms: result.range.start.seconds * 1_000,
                    end_ms: result.range.end.seconds * 1_000
                ))
                if result.isFinal, let glossary {
                    await glossary.observeFinalTranscript(text)
                }
            }
        }
        try await analyzer.prepareToAnalyze(in: format)
        try await analyzer.start(inputSequence: stream.stream)
    }

    func append(_ samples: [Float]) async throws {
        let source = try makeFloatBuffer(samples)
        continuation.yield(AnalyzerInput(buffer: try convert(source, to: analyzerFormat)))
    }

    func stop() async throws {
        await adaptiveGlossary?.stop()
        continuation.finish()
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        try await resultsTask.value
    }
}

@available(macOS 26.0, *)
private actor AdaptiveGlossary {
    private static let minimumTranscriptCount = 2
    private static let minimumCharacterCount = 80
    private static let extractionDelay = Duration.seconds(8)

    private let analyzer: SpeechAnalyzer
    private let locale: Locale
    private let logsTerms: Bool
    private var activeTerms: [String] = []
    private var pendingTranscripts: [String] = []
    private var scheduledTask: Task<Void, Never>?
    private var isExtracting = false
    private var isStopped = false

    init(analyzer: SpeechAnalyzer, locale: Locale, logsTerms: Bool) {
        self.analyzer = analyzer
        self.locale = locale
        self.logsTerms = logsTerms
    }

    func observeFinalTranscript(_ text: String) {
        guard !isStopped else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        pendingTranscripts.append(trimmed)
        scheduleExtractionIfNeeded()
    }

    func stop() {
        isStopped = true
        scheduledTask?.cancel()
        scheduledTask = nil
        pendingTranscripts.removeAll()
    }

    private func scheduleExtractionIfNeeded() {
        let characterCount = pendingTranscripts.reduce(0) { $0 + $1.count }
        let hasEnoughContext = pendingTranscripts.count >= Self.minimumTranscriptCount
            || characterCount >= Self.minimumCharacterCount
        guard
            !isStopped,
            !isExtracting,
            scheduledTask == nil,
            hasEnoughContext
        else { return }
        scheduledTask = Task { [weak self] in
            try? await Task.sleep(for: Self.extractionDelay)
            guard !Task.isCancelled else { return }
            await self?.extractPendingTerms()
        }
    }

    private func extractPendingTerms() async {
        scheduledTask = nil
        guard !isStopped, !isExtracting, !pendingTranscripts.isEmpty else { return }

        let transcript = pendingTranscripts.joined(separator: "\n")
        pendingTranscripts.removeAll()
        isExtracting = true

        let candidates = await extractTerms(from: transcript)
        if !isStopped, !candidates.isEmpty {
            let updatedTerms = AdaptiveGlossaryCandidateFilter.merge(
                existing: activeTerms,
                candidates: candidates
            )
            if updatedTerms != activeTerms {
                let context = AnalysisContext()
                context.contextualStrings[.general] = updatedTerms
                do {
                    try await analyzer.setContext(context)
                    let addedTerms = updatedTerms.filter { !activeTerms.contains($0) }
                    activeTerms = updatedTerms
                    FileHandle.standardError.write(Data(
                        "[adaptive-glossary] Active transcription hints: \(activeTerms.count)\n".utf8
                    ))
                    if logsTerms {
                        FileHandle.standardError.write(Data(
                            "[adaptive-glossary] Added: \(jsonDescription(addedTerms))\n".utf8
                        ))
                        FileHandle.standardError.write(Data(
                            "[adaptive-glossary] Active: \(jsonDescription(activeTerms))\n".utf8
                        ))
                    }
                } catch {
                    FileHandle.standardError.write(Data(
                        "[adaptive-glossary] Could not update transcription hints: \(error.localizedDescription)\n".utf8
                    ))
                }
            }
        }

        isExtracting = false
        scheduleExtractionIfNeeded()
    }

    private func extractTerms(from transcript: String) async -> [String] {
        #if compiler(>=6.2) && canImport(FoundationModels)
        guard SystemLanguageModel.default.isAvailable else { return [] }
        let language = locale.localizedString(forIdentifier: locale.identifier) ?? locale.identifier
        let prompt = """
        Predict a small set of specialized words or phrases that are likely to be spoken next in this live conversation in \(language), so a speech recognizer can receive them as advance vocabulary hints.

        Infer the domain only from clear evidence in the transcript. Include a prediction only when it is both strongly associated with that domain and likely harder for a general speech-recognition model: a proper name, organization, product, acronym, scientific or technical term, or specialized domain phrase. For example, a clearly established discussion of microservices could justify likely terms such as "Saga pattern", "Apache Kafka", "cloud-native", or "service mesh" even before the speaker says them.

        Do not repeat words or phrases already present in the transcript. Do not include ordinary vocabulary, broad topic labels, complete sentences, translations, explanations, or weakly related possibilities. Do not fill a quota. It is correct and preferred to return no predictions when the domain is unclear or no advance hint is genuinely useful.

        Return only a JSON array containing at most 8 strings. Return [] when no term is clearly useful.

        Transcript:
        <transcript>
        \(transcript)
        </transcript>
        """
        do {
            let response = try await LanguageModelSession().respond(to: prompt)
            return AdaptiveGlossaryCandidateFilter.parse(response.content, transcript: transcript)
        } catch {
            FileHandle.standardError.write(Data(
                "[adaptive-glossary] Local term extraction unavailable: \(error.localizedDescription)\n".utf8
            ))
            return []
        }
        #else
        return []
        #endif
    }

    private func jsonDescription(_ terms: [String]) -> String {
        guard
            let data = try? JSONEncoder().encode(terms),
            let value = String(data: data, encoding: .utf8)
        else { return "[]" }
        return value
    }
}
#endif

@main
private enum CaptionLocalAsr {
    static func main() async {
        let writer = EventWriter()
        let session = LocalAsrSession(writer: writer)
        while let line = readLine() {
            do {
                let command = try JSONDecoder().decode(Command.self, from: Data(line.utf8))
                if try await !session.handle(command) { break }
            } catch {
                writer.send(Event(type: "error", message: error.localizedDescription))
            }
        }
    }
}
