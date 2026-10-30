# Getting started (no technical background needed)

Vision.Forge is an add-on for Claude Code. You describe a short video in plain English, and Claude plans it, renders it on your own PC and hands you a finished MP4. Nothing is uploaded to a video service and no AI image or video generator is involved: the pictures are drawn by code, which is why the result is exact and repeatable.

This page gets you from an empty PC to your first video. Allow about 30 minutes the first time, most of it waiting for installs. Every command below is pasted into a PowerShell window: press the Windows key, type `PowerShell`, press Enter.

## What you need

- A Windows 11 PC with a graphics card (any NVIDIA, AMD or Intel GPU from the last few years) and about 2 GB of free disk space.
- [Claude Code](https://claude.com/claude-code) installed and signed in. Vision.Forge runs inside it.
- Microsoft Edge, which Windows 11 already has.

## Step 1: install the two programs it needs

Paste these one at a time. Each asks you to confirm and takes a minute or two.

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
```

```powershell
winget install --id Gyan.FFmpeg --exact
```

Node.js runs the program; ffmpeg joins the frames into a video. Blender is optional (it makes the most realistic product shots) and takes 350 MB; add it later if you want it:

```powershell
winget install --id BlenderFoundation.Blender --version 5.2.3 --exact
```

Close PowerShell and open it again after installing, so the new programs are found.

## Step 2: add Vision.Forge to Claude Code

```powershell
claude plugin marketplace add JackTelford/QuantumSolutions.Vision.Forge
```

```powershell
claude plugin install vision-forge@quantum-solutions
```

That is the whole install. Claude Code fetches the add-on and its small dependencies by itself.

## Step 3: make your first video

Make an empty folder for your videos, for example `C:\Videos\Forge`, open PowerShell there (in File Explorer, right-click inside the folder and choose "Open in Terminal"), and start Claude Code:

```powershell
claude
```

Then type this, exactly, and press Enter:

```
/vision-forge:cinematic-studio A 10-second title card that says "Hello from Vision Forge" on a dark background, with a soft light sweep across the title. 16:9.
```

What happens next, in order:

1. **Claude checks your PC.** The first time, it may say it needs to fetch a lighting file (a few MB) and will ask before downloading anything. Say yes.
2. **Claude shows you a one-page plan**: the mood, the look, the shots, and anything it cannot do literally and what it will do instead. Read it. Say yes, or tell it what to change.
3. **Claude renders one still picture per shot** and shows you where they are, with its own three criticisms of each. You can ask for changes here cheaply.
4. **Claude asks before the long part**, telling you how many frames and roughly how long. A 10-second piece renders in under a minute.
5. **Claude gives you the path of the finished MP4** and a list of the checks it passed. The file is inside your folder, under `out\`, in a folder named by eight letters and digits, for example `out\3fdbbee6\3fdbbee6.mp4`. Double-click it to play.

That is one complete run. Every later video works the same way.

## Prompts to try next

Each is one line after `/vision-forge:cinematic-studio`. Say the length, the shape (16:9 for landscape) and anything that must appear word for word.

- `A 15-second studio product film of a matte black water bottle on a dark backdrop. Slow hero reveal, the name "Northwind" on screen at the end. Loopable. 16:9.` (asks for Blender if you have it; otherwise a stylized 3D version)
- `A 30-second narrated explainer that teaches why backups should be tested, not just made. Clean, friendly. Captions on screen.` (the first time, Claude will ask before installing the voice, about 500 MB, and tell you the licences; you can also give it your own recording instead)
- `A 12-second cinematic title sequence for a documentary called "Deep Field". Dark, atmospheric, a light sweep revealing the title, a tagline, fade to black.`

## Using it from another AI app

Claude Code is not the only way in. Claude Desktop, Cursor and most other AI apps can connect to the same studio; the app then has the same tools, the same knowledge and the same step-by-step flow, and your videos come out the same way. It takes three pastes.

1. Get a copy of the add-on's folder. In PowerShell, paste `winget install --id Git.Git --exact` if you have never installed Git, then `git clone https://github.com/JackTelford/QuantumSolutions.Vision.Forge.git C:\Code\QuantumSolutions.Vision.Forge`, then `cd C:\Code\QuantumSolutions.Vision.Forge` and `.\Setup-VisionForge.cmd`. The setup checks the programs from Step 1 and prepares the folder.
2. Tell the app where it is. In Claude Desktop open Settings, then Developer, then Edit Config; a file called `claude_desktop_config.json` opens. Paste this into it (if the file already has text, ask the app to merge it for you), using your own folder for the videos:

```json
{
  "mcpServers": {
    "vision-forge": {
      "command": "node",
      "args": ["C:/Code/QuantumSolutions.Vision.Forge/scripts/mcp.ts", "--out", "C:/Videos/Forge"]
    }
  }
}
```

3. Close and reopen the app. A tools icon appears in the chat with "vision-forge" in it. Describe your video the way you would in Step 3, and the app checks the PC, shows you the plan, renders the stills, asks before the long part and tells you where the MP4 is, under the folder you named in `--out`.

Other apps use the same lines in their own settings file; the exact spot for each is in [docs/SETUP.md](SETUP.md#use-it-from-other-ai-apps-mcp). Everything still renders on your PC and nothing is uploaded.

## What it will say no to

It is honest about limits rather than guessing. It will not make people, faces or animals, anything that looks like filmed footage, or music from the internet (give it a music file of your own, or it stays silent). When a prompt asks for one of these, it says so in the plan and offers a stylized alternative. A "diagram" in an explainer is made of type on cards, not drawn illustrations.

## If something goes wrong

- Paste the error message back to Claude; the messages are written to say what to do next.
- If Claude says a program is missing, it prints the exact install line. Run it, close and reopen PowerShell, and try again.
- To check the PC on its own, open PowerShell in the add-on's folder and run the health check: Claude does this at the start of every session, and will show you the result if you ask "run doctor".

## Where things live

- Your videos: the `out\` folder inside the folder where you started Claude Code. The `.srt` beside a narrated video holds its captions.
- Everything downloaded (lighting files, the voice, rendered frames for reuse): under `%LOCALAPPDATA%` in a folder Claude Code owns. Deleting it costs nothing but a re-download.
- Nothing is sent anywhere. The only downloads are from GitHub, npm, Poly Haven (lighting) and Hugging Face (the voice), each checked against a known fingerprint.

For the technical side, how to steer the result, and how to run the commands yourself, read the [README](../README.md).
