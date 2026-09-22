# Your first School exploration

1. Open the locally running School at `http://127.0.0.1:8792/` (or its configured port) and read the provider label. **Authored demo** means scripted teaching. **AI configured · unverified** means a live response has not yet been confirmed. **Live AI** means the latest provider turn completed successfully; **AI needs attention** indicates a failed attempt.
2. Choose Galileo and the prepared scale lesson, then **Begin the exploration**. The opening explanation is authored lesson material in either mode.
3. Use **Ask a question** whenever something is unclear. Suggested questions fill the composer; submit to receive a response. Questions keep your current step.
4. Choose **Make a prediction**. Read the worked example. Switch to **Respond to the lesson**, describe your prediction, then submit. A successful response advances to guided practice; a failed or stopped response does not.
5. In the workbench choose **Double every side**, then **Apply experiment**. Previewing a slider or preset does not record a result until you apply it. Check the recorded dimensions: `2 × 2 × 2`, volume `8` cubic units. **Width only** illustrates `2 × 1 × 1 = 2`.
6. Record what happened through **Respond to the lesson**. Guided practice requires the requested `2 × 2 × 2` experiment. Explain the evidence, then reflect on what you would test next.
7. Return to **The academy** and resume the saved lesson under **Pick up the thread**, or use **Export** to keep its transcript and experiment record. Reloading opens the academy; select the saved lesson card to resume. Unsent composer text and unapplied slider previews are not saved.

**Stop response** cancels a pending reply. Your submitted text remains saved. A model failure keeps your input and current lesson step; correct the provider configuration, resume the lesson, and submit a new turn when ready. For a connection error, **Retry** checks the original request instead of submitting it twice. A service restart marks an unfinished turn interrupted instead of generating another answer automatically.

Saved work belongs to this PC's School data directory. This local candidate has no accounts or cloud sync. Do not treat it as a shared classroom deployment. Closing the browser does not stop the service; Ctrl+C in its terminal does.

## Listen to a mentor reply

Choose **Listen to latest reply** below the transcript to hear the latest saved mentor text. Playback uses a local English device voice when your browser exposes one; the control displays its availability and voice name. **Stop audio** stops playback, and the listen button replays the reply from the beginning.

Starting another turn, changing lessons, returning to the academy or hiding the page stops audio. Replies never play automatically. If audio is unavailable or fails, the transcript and typed lesson remain usable. **Stop response** still cancels a pending mentor answer; it is separate from **Stop audio**. See [mentor read-aloud](Mentor-Speech.md) for details.

## What the workbench means

The workbench is a mathematical illustration of a rectangular block. It calculates volume from three simulated dimensions. It does not observe gravity, mass, your physical room, or a Matrix object. The lesson records participation and reflection; an incorrect response is not automatically a mastery pass.

## Where Matrix fits

Matrix remains the separate AR/VR scene tool. This optional connection needs a Matrix build with the [paired client API](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/34); an older running service will not acquire it just by opening this page.

1. Start your updated Matrix service and runtime. In Matrix, select where the block should go. For AR, localize the room and confirm alignment first.
2. Open Matrix's **Client connections** page (`/clients`). Use the Operator token there and create a temporary pairing code for School. Keep the Operator token in Matrix.
3. In your School lesson, choose **Open Matrix connection**. Enter Matrix's local address and its temporary pairing code, then **Connect Matrix**. Read any preparation message; select a suitable surface in Matrix if requested.
4. Choose **Request a block in Matrix**. School displays **Waiting for Operator review**. Nothing is placed yet.
5. Follow **Review in Matrix**, inspect the exact proposed object and placement, then choose **Apply reviewed proposal** there. School cannot press Apply for you.
6. Wait for **Runtime confirmed**, or choose **Check result**. Only a matched command acknowledgment and observed object count as confirmed placement. The resulting lesson note is available to the mentor on your next message.

The browser's **Apply experiment** still changes only its mathematical illustration. It does not resize the Matrix block. This first connection demonstrates a prepared prop and reported placement; it does not yet run the whole scale experiment in AR.

**Cancel proposal** is available before Apply. After approval, **Disconnect** does not undo work that may already be running. An **Outcome unconfirmed** message means School cannot prove what happened: inspect Matrix and check the original result before creating another block. Do not infer that the block appeared or disappeared.

If School restarts, your successful demonstration history remains saved, but its temporary connection credentials are gone. Pending work becomes unconfirmed and is never automatically repeated. Inspect unresolved work in the original Operator before pairing again. You can always continue the browser lesson without Matrix. See [connection details and troubleshooting](Matrix-Bridge.md).

Voice input, live historical avatars, additional lessons, hosted student sessions and in-headset teaching are subsequent roadmap work. Optional browser read-aloud uses an ordinary device voice. The text lesson remains available independently.

## Scale the block in Matrix

After School confirms a block placement in Matrix’s desktop white room, open **Try scale in Matrix**. Choose a preset, review and Apply in the Matrix Operator, then inspect the confirmed ratio. **Reset Matrix block** is a separate reviewed proposal. This changes the Matrix block; the browser experiment and lesson step stay separate. See the [complete walkthrough](Matrix-Scale-Lesson.md). Quest AR scaling is not available in this version.

## Ask Galileo for a scene

Ask Galileo to suggest a Matrix demonstration. If the reply includes a suggestion card, read its title, learning goal and scene request, then choose **Build this demonstration**. Connect Matrix first if needed; pairing does not send the request automatically. Matrix prepares a proposal for your separate Operator review and Apply. Discuss the recorded outcome afterward. See the [mentor demonstration walkthrough](Mentor-Demonstrations.md).
