# Optional mentor read-aloud

School can read the latest saved mentor reply using an English voice that the browser reports as local to your device. Playback starts only when you choose **Listen to latest reply**. The visible transcript remains the source text and the lesson works when audio is unavailable.

## Use it

1. Open or resume a lesson and wait for its mentor reply to finish. The authored opening can also be read aloud.
2. Choose **Listen to latest reply** below the transcript. The control identifies the device voice and shows whether playback is starting or speaking.
3. Choose **Stop audio** to end playback. Choose **Listen to latest reply** again to replay that saved reply from the beginning.
4. Continue by typing a question or responding to the lesson. A new turn stops the previous audio; read-aloud is available again after the reply is saved.

Changing lessons, returning to the academy, hiding the page or leaving it stops playback. Audio never starts automatically when a reply arrives, a saved lesson opens, or a voice becomes available.

**Stop audio** stops speech synthesis. **Stop response** cancels a pending mentor response. These controls have different purposes: listening does not request another model answer, change the lesson step, record an experiment, or alter the saved reply.

## If the button is unavailable

Read the status beside the control. The browser may lack speech synthesis, may still be loading its voices, or may expose no local English voice. Keep using the transcript and typed conversation. If an installed voice becomes available, School refreshes its availability; you still choose when to play.

School explicitly chooses a voice with `localService === true` and an English language tag. Remote voices and an unspecified default voice are excluded. Voice availability and pronunciation depend on the browser and operating system. `localService` is the browser's declaration of a local synthesizer, as described in [MDN's voice property reference](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

The selected voice is a device voice reading an educational mentor's text. It does not reproduce Galileo's historical voice. This increment provides no microphone input, speech recognition, avatar animation, or audio recording. Authored and live-provider labels retain their existing meanings when their text is spoken.

## Integration boundary

`public/mentor-speech.js` is a replaceable browser adapter around `speechSynthesis` and `SpeechSynthesisUtterance`. The application supplies the latest persisted mentor message, identified by its session and message. Playback never reads the unsent composer or partial provider output. Speech state is transient; School's durable transcript remains the record.

The adapter refreshes voice availability through [`voiceschanged`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event). Stop uses [`speechSynthesis.cancel()`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/cancel), which stops the active utterance and clears queued speech. Context and playback-generation checks prevent callbacks from an old utterance from changing the current controls after stop, replay, or a lesson change.

The server continues to report `mentor.voice.v1` unavailable. That capability represents the planned full voice adapter, and the server cannot establish whether a particular browser has a usable local voice. Browser read-aloud reports its own availability separately. Prepared exhibits retain their text fallback.

## Validation

Adapter fixtures exercise missing APIs, local-only voice selection, voices arriving later, exact saved text, replay/stop, context changes and ignored late callbacks. Application fixtures separately exercise the controls and lesson transitions. They do not establish actual audible output or voice quality.

The actual Codex in-app browser detected local **Microsoft David, English (United States)** and exercised manual start, the real utterance `onstart` event, stop and replay of the current caption. Playback did not start automatically. This establishes the browser lifecycle; it does not establish audible sound or listening quality.

See [the validation record](Validation.md#optional-local-mentor-read-aloud) for the 119-test full-suite result and evidence limits. Human checks of audibility, intelligibility, pronunciation and comfort remain pending, along with accessibility alongside screen readers and broader browser/device coverage. No headset speech acceptance is implied by this browser adapter.
