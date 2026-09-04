import XCTest
@testable import caption_local_asr

final class AdaptiveGlossaryCandidateFilterTests: XCTestCase {
    func testAcceptsPredictedTermsThatHaveNotAppearedYet() {
        let response = #"["Saga pattern", "Apache Kafka", "service mesh"]"#
        let transcript = "We are redesigning this as a set of microservices."

        XCTAssertEqual(
            AdaptiveGlossaryCandidateFilter.parse(response, transcript: transcript),
            ["Saga pattern", "Apache Kafka", "service mesh"]
        )
    }

    func testRejectsTermsAlreadyPresentInTranscript() {
        let response = #"["microservices", "Apache Kafka"]"#
        let transcript = "We are redesigning this as a set of microservices."

        XCTAssertEqual(
            AdaptiveGlossaryCandidateFilter.parse(response, transcript: transcript),
            ["Apache Kafka"]
        )
    }

    func testDoesNotMistakeAcronymInsideAnotherWordForAnObservedTerm() {
        XCTAssertEqual(
            AdaptiveGlossaryCandidateFilter.parse(#"["AI"]"#, transcript: "They said it was useful."),
            ["AI"]
        )
    }

    func testRejectsObservedLatinTermAdjacentToCJKText() {
        XCTAssertEqual(
            AdaptiveGlossaryCandidateFilter.parse(#"["AI", "LLM"]"#, transcript: "使用AI模型"),
            ["LLM"]
        )
    }

    func testEmptyModelResponseKeepsGlossaryEmpty() {
        XCTAssertEqual(
            AdaptiveGlossaryCandidateFilter.parse("[]", transcript: "This is an ordinary conversation."),
            []
        )
    }

    func testParsingToleratesAJsonCodeFence() {
        let response = """
        ```json
        ["EKS"]
        ```
        """

        XCTAssertEqual(
            AdaptiveGlossaryCandidateFilter.parse(response, transcript: "The cluster runs in AWS."),
            ["EKS"]
        )
    }

    func testDeduplicatesTermsCaseInsensitively() {
        let response = #"["OpenAI", "openai"]"#

        XCTAssertEqual(
            AdaptiveGlossaryCandidateFilter.parse(response, transcript: "We are discussing foundation models."),
            ["OpenAI"]
        )
    }

    func testLimitsEachPredictionBatchWithoutPaddingIt() {
        let response = String(data: try! JSONEncoder().encode(
            (0..<20).map { "PredictedTerm\($0)" }
        ), encoding: .utf8)!

        let result = AdaptiveGlossaryCandidateFilter.parse(
            response,
            transcript: "This is a clearly specialized discussion."
        )

        XCTAssertEqual(result.count, AdaptiveGlossaryCandidateFilter.maximumPredictionsPerBatch)
    }

    func testMergeDoesNotPadOrExceedMaximum() {
        let candidates = (0..<100).map { "Term\($0)" }
        let result = AdaptiveGlossaryCandidateFilter.merge(existing: [], candidates: candidates)

        XCTAssertEqual(result.count, AdaptiveGlossaryCandidateFilter.maximumTermCount)
        XCTAssertEqual(result.first, "Term0")
        XCTAssertEqual(result.last, "Term59")
    }
}
