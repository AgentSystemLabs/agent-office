# reels-kokoro: reads a narration out with Kokoro, the free voice that runs on the office's own
# machine (src/server/reels/media.ts calls it). Takes JSON on stdin: {"text", "voice", "speed",
# "out", "model", "voices"}, writes a WAV to "out", and prints how long it plays, in seconds.
# Runs in the Python environment that has kokoro-onnx and soundfile (see docs/reels.md).

import json
import sys

import soundfile as sf
from kokoro_onnx import Kokoro


def main() -> None:
    ask = json.load(sys.stdin)
    kokoro = Kokoro(ask["model"], ask["voices"])
    samples, rate = kokoro.create(ask["text"], voice=ask.get("voice") or "am_michael", speed=float(ask.get("speed") or 1.0), lang="en-us")
    sf.write(ask["out"], samples, rate)
    print(json.dumps({"seconds": len(samples) / rate}))


if __name__ == "__main__":
    main()
