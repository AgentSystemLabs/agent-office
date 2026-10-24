# The reels studio

Back to the [README](../README.md).

The reels studio runs a faceless short-video page on TikTok, Instagram Reels and YouTube Shorts, staffed by the office's own agents. Each reel is a narrated story over AI images, with big captions that follow the voice. The **crew** (four ordinary workers) decides what the reels say, and the **studio** (part of the office's server) makes the videos and posts them on a schedule.

| Who | What they do |
| --- | --- |
| 🔭 **Scout** | Keeps every series stocked with specific story ideas, and makes more of what the numbers say works. |
| ✍️ **Writer** | Turns ideas into scripts: 6–12 scenes, each a line of narration and an image prompt, plus the caption and hashtags. |
| 🎬 **Editor** | Reviews every finished video against the house rules and approves it or sends it back with a note. Nothing posts without an approval, and nobody approves their own script. |
| 📈 **Analyst** | Fetches every post's views, likes, comments and shares once a day, writes down what's working for the writer and scout, tunes the series, and watches the page against the payout thresholds. |
| 🏭 **The studio** | Voices each script, makes an image per scene, times the captions to the voice, renders a 1080×1920 MP4 with ffmpeg, posts approved reels when each series is due, and messages the crew when there's work for them. |

The crew are workers like any other: they sit at desks, you can open their terminals and talk to them, and everyone in the office sees what they do. Any worker can join the crew, or hire it, with the `office-reels` command the office puts on every worker's PATH.

## Getting started

1. **Install ffmpeg** on the machine that runs the office, so `ffmpeg` and `ffprobe` are on its PATH (`winget install Gyan.FFmpeg`, `brew install ffmpeg`, `apt install ffmpeg`), or point `REELS_FFMPEG` and `REELS_FFPROBE` at them.
2. **Set up the free voice** (see [Voice and images](#voice-and-images)): Kokoro, which reads the narration on the office's own machine. The images are free from the start, from Pollinations. Paying for a better voice or faster images later is one key in the office's environment, with nothing else to change.
3. **Start a series and hire the crew.** From any worker's terminal, or by asking a worker to:

   ```bash
   office-reels series add --name "Dark History" --niche "true, little-known dark stories from history, told as mysteries" --style "moody oil painting, candlelight, deep shadows" --platforms tiktok,youtube --postsPerDay 1 --cta "Follow for tomorrow's story"
   office-reels crew hire --series "Dark History"
   ```

   Four workers start at free desks with their briefs, and the studio keeps them busy from there.
4. **Connect the accounts** to post to (see [Connecting the platforms](#connecting-the-platforms)). Until then, approved reels wait, and the office says so once.

## The studio's page

**☰ → 🎬 Reels studio** opens the studio's own page, `/reels`, in a tab beside the office. It's for the people running the page, and lets you do everything there without an agent:

- **My series:** every series as a card, with its latest video, what it's doing next and an **Autopilot** switch to pause or resume it.
- **Create series:** three steps. Pick a niche (or describe your own), then an art style and a narrator, then where and how often it posts. Tick **Hire the AI crew** and four agents start at desks right away.
- **A series:** its videos as a grid you can filter (to review, scheduled, posted, in the making, ideas, failed), with ideas to add by hand, the crew's notes and every setting. Click a video for its script, caption and posts.
- **Review:** the new videos one at a time. Watch, then **Approve** (A) or **Send back** (S) with a note for the writer.
- **AI crew, Analytics and Accounts:** who's on the crew and hiring the rest, views by video and progress toward the payout bars, and which platforms are connected.

On a phone, the sidebar becomes a tab bar along the bottom.

## The pipeline

A reel goes **idea → scripted → rendering → rendered → approved → posted**. A rejected reel goes back to the writer with the editor's note, and one whose production broke is **failed** with the reason.

Every minute the studio:

- makes the oldest scripted reel into a video (one at a time), and tells the office when it's ready for review;
- posts the oldest approved reel of each series whose gap since its last post has passed (24 hours ÷ `postsPerDay`), to each of its platforms that's connected;
- asks the crew for work: the editor when reels wait for review, the writer when fewer than `backlog` reels are in the pipeline and there are ideas, the scout when fewer than three ideas are left, the analyst once a day. It only asks a worker that's sitting still, and no more often than every three hours.

Everything is kept in `.agent-office/reels/`: `reels.json` (the series, reels and crew), `out/` (the finished videos), `work/` (each reel's voice, images and captions until it's posted), `music/` (tracks for the series) and `accounts.json` (the platforms' sign-ins).

## Commands

Run `office-reels help` in a worker's terminal for the full list.

| Command | What it does |
| --- | --- |
| `office-reels status` | The series and their pipelines, the analyst's notes, every reel on the go, the crew, and what's set up |
| `office-reels show <reel>` | One reel in full: its script, caption, video file and posts |
| `office-reels series add …` / `series set <series> …` | Start or change a series: `--niche`, `--style`, `--voice`, `--tone`, `--music`, `--platforms`, `--postsPerDay`, `--backlog`, `--cta`, `--hashtags`, `--tiktokPrivacy`, `--youtubePrivacy`, `--pause`, `--resume` |
| `office-reels idea <series> --title … --hook …` | Add an idea |
| `office-reels script <reel>` | A script, as JSON on stdin: `{"title", "hook", "scenes": [{"narration", "visual"}], "caption", "hashtags"}` |
| `office-reels review <reel> --approve` / `--reject --note …` | Approve a video, or send it back |
| `office-reels remake <reel>` | Make its video again (after new music, say) |
| `office-reels post <reel>` | Post an approved reel now, outside its schedule |
| `office-reels stats` | Fetch every post's numbers |
| `office-reels note <series> "…"` | Write down a lesson for the crew |
| `office-reels crew hire [--series …] [--roles …]` | Hire a worker for each role nobody has |
| `office-reels crew join <role>` | Join the crew yourself |
| `office-reels brief <role>` | What a role is told |

`office-reels mcp` serves the same as MCP tools on stdio, for an agent you'd rather give tools than a shell command.

## Voice and images

A reel costs nothing by default. **Kokoro** reads the narration on the office's machine, and **Pollinations** draws the images. Once a paid service's key is in the office's environment, it takes over by itself. To pick one outright, set `REELS_VOICE` (`kokoro`, `elevenlabs`, `openai` or `placeholder`) or `REELS_IMAGES` (`pollinations`, `fal`, `openai` or `placeholder`). `office-reels status` says which ones are in use.

### Free: Kokoro and Pollinations

**Kokoro** is an open-source voice that runs on the CPU. It's set up once, in `~/.agent-office/kokoro/` (or wherever `REELS_KOKORO_DIR` says), as a Python environment and two model files:

```bash
mkdir -p ~/.agent-office/kokoro && cd ~/.agent-office/kokoro
python3 -m venv venv
venv/bin/pip install kokoro-onnx soundfile
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

On Windows, use `py -3.12 -m venv venv` and `venv\Scripts\pip`. The studio finds the setup by itself. Until it's there, the narration comes out silent. Kokoro is slower than real time on a laptop CPU (a minute of narration takes a few minutes), which is fine for a studio that makes reels in the background. A series' `--voice` can name a Kokoro voice (`am_michael`, the default, or `am_adam`, `af_heart`, `bm_george`…). `REELS_KOKORO_VOICE` sets the default, and `REELS_KOKORO_SPEED` reads faster or slower (1 is normal).

**Pollinations** draws the images with no account and no key. Its free tier draws one image every 45 seconds, so an eight-scene reel takes about six minutes of images. It also signs each image with a small mark in the corner. A free account's token at enter.pollinations.ai, put in `POLLINATIONS_TOKEN`, lifts both limits. The free service makes no promises: a reel whose images couldn't be made is **failed**, and `office-reels remake` tries it again.

### Paid

| Variable | What it's for |
| --- | --- |
| `ELEVENLABS_API_KEY` | The voice, from ElevenLabs, with word-exact caption timing. `ELEVENLABS_VOICE_ID` picks the default voice, and a series' `--voice` can be an ElevenLabs voice id. |
| `OPENAI_API_KEY` | The voice (`gpt-4o-mini-tts`, with the series' `--tone` as its reading instructions), when there's no ElevenLabs key, and the images (`gpt-image-1`), when there's no fal key. A series' `--voice` is an OpenAI voice name (`onyx`, `nova`, `sage`…). |
| `FAL_KEY` | The images, from Flux on fal (`fal-ai/flux/schnell`, about a third of a cent an image; `REELS_FAL_MODEL` picks another). |
| `REELS_MEDIA=placeholder` | Silence and plain colors, whatever keys there are, for trying the pipeline out. |
| `REELS_IMAGE_QUALITY` | OpenAI's image quality: `low` (the default), `medium` or `high`. |
| `REELS_CAPTION_FONT` | The captions' font (default Arial), which must be installed where ffmpeg runs. |

With paid services, a one-minute reel with eight scenes costs roughly $0.03–0.15 (OpenAI's voice and Flux images), and more with ElevenLabs.

Music goes in `.agent-office/reels/music/`. Give a series a track with `--music <file name>` and it plays quietly under the voice. Use only music you have the rights to post.

## Connecting the platforms

Put the sign-ins in `.agent-office/reels/accounts.json`, readable only by the office's user. The office refreshes the tokens and writes them back. No agent can read the file: the crew only sees which platforms are connected.

```json
{
  "tiktok": { "clientKey": "…", "clientSecret": "…", "refreshToken": "…" },
  "instagram": { "userId": "1784…", "accessToken": "…" },
  "youtube": { "clientId": "….apps.googleusercontent.com", "clientSecret": "…", "refreshToken": "…" }
}
```

- **TikTok.** Make an app at developers.tiktok.com with the **Content Posting API** (Direct Post) and the `video.publish` and `video.list` scopes, and sign the page's account in to it once to get a refresh token. Until TikTok audits the app, it only lets posts go out as private (`SELF_ONLY`). The studio checks what the account allows before each post, falls back to private, and says so. Set `--tiktokPrivacy PUBLIC_TO_EVERYONE` once the audit passes. Every post is marked as AI-generated content.
- **Instagram.** The page needs to be a professional (Business or Creator) account. Make a Meta app with `instagram_content_publish` and `instagram_manage_insights`, and get a long-lived token and the account's Instagram user id. A token from Instagram Login (rather than Facebook Login) also needs `"host": "graph.instagram.com"`. The video goes up by resumable upload, so the office doesn't need a public address.
- **YouTube.** Make an OAuth client in Google Cloud with the YouTube Data API v3 and the `youtube.upload` and `youtube.readonly` scopes, and get a refresh token for the channel. Uploads are marked as containing synthetic media. They go out as `private` until you set `--youtubePrivacy public`. Uploads take a large share of the API's default daily quota, so ask Google for more before posting several a day.

## Making money from it

The analyst tracks the page against the platforms' bars, and none of them come quickly:

- **TikTok Creator Rewards** pays for videos over a minute, once the account has 10,000 followers and 100,000 views in 30 days. That's why the writer aims for 150+ words.
- **The YouTube Partner Program** shares Shorts ad revenue once a channel has 1,000 subscribers and 10 million Shorts views in 90 days.
- **A call to action** (`--cta`) earns before either: a link in the bio to an affiliate product or something of your own, once the page has an audience.

The platforms push down accounts that look automated and spammy. Start with one post a day, and warm a new account up by using it by hand for a few days. Keep the editor strict: original writing, true history, nothing about real people that could be false. Never buy followers or views.
