# Optional speech input

School's canonical lesson remains text first. In supported browsers, **Dictate draft** asks the browser to recognize one spoken response and inserts its final transcript into the editable composer. Review or correct that text, choose **Ask a question** or **Respond to the lesson**, then submit normally. Dictation never calls the mentor, advances a step, records an experiment, or sends a Matrix request by itself.

**Stop dictation** abandons the current recording. Sending a turn, leaving the lesson, hiding the page, changing the active lesson, or starting mentor read-aloud stops recognition. Late browser callbacks cannot insert text into another lesson. An unsupported browser or microphone denial leaves typing available. Nothing records or saves raw audio in School.

This first adapter uses the browser's Web Speech recognition interface when available. Browser implementations differ and may process audio remotely; the browser's privacy settings and permission prompt govern that processing. The app labels this before listening and does not claim on-device STT. The interface is deliberately separate from the saved turn and from the mentor read-aloud adapter, so another STT provider can replace it.

The [Web Speech API reference](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) documents recognition events and limited browser availability. The [on-device property](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally) is experimental and is not assumed here. Fixture tests cover final-only insertion, unsupported/denied/failed recognition, correction before send, context cancellation and ignored stale results. Human microphone, accuracy and accessibility checks remain pending.
