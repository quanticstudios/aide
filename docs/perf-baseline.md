# Performance baseline

`scripts/perf-baseline.mjs` launches the built app against fake providers, opens
one project, adds five agent panes, sends each `perf-stream`, and measures for
two minutes. It prints a Markdown table and writes `perf-baseline.json`.

## Running it

Build first. The script runs `out/`, and Electron needs the native rebuild.

```bash
bun run build && bun run rebuild:native
```

In CI, or anywhere with `xvfb-run`:

```bash
env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 xvfb-run -a bun run perf:baseline
```

On a desktop, run it inside a private display so no window reaches your screen
(see the `agent-desktop` skill):

```bash
agent-ws run perf --wait -- bun run perf:baseline
agent-ws down perf
```

The `Perf budget` job in `.github/workflows/ci.yml` runs it on every push with
`PERF_SECONDS=60`, then `scripts/perf-budget.mjs` fails the job when a metric
goes over its ceiling in `scripts/perf-budget.json`. Each key there is a dotted
path into the JSON. The job uploads `perf-baseline.json` as the `perf-baseline`
artifact. When the run fails its final check, it also uploads
`perf-baseline.json.png`, a screenshot of the window.

## Options

| Variable                             | Default              | Meaning                                                      |
| ------------------------------------ | -------------------- | ------------------------------------------------------------ |
| `PERF_AGENTS`                        | 5                    | Agent panes, each streaming one reply                        |
| `PERF_SECONDS`                       | 120                  | Seconds from the first prompt to the memory reading          |
| `PERF_TRACE_SECONDS`                 | 20                   | Length of the DevTools trace for frame and long-task metrics |
| `PERF_OUT`                           | `perf-baseline.json` | Where the JSON goes                                          |
| `AIDE_FAKE_STREAM_TOKENS_PER_SECOND` | 50                   | Tokens each fake agent emits per second                      |
| `AIDE_FAKE_STREAM_TOOL_EVERY`        | 150                  | Tokens between tool calls; 0 turns tool calls off            |
| `AIDE_FAKE_STREAM_TOOL_MIX`          | `Bash,Edit,Read`     | Tool names, used in turn                                     |
| `AIDE_FAKE_STREAM_SECONDS`           | `PERF_SECONDS` + 60  | How long each reply lasts; the script sets it                |

A token is one whitespace-delimited word of a fixed Markdown passage with a
heading, bold text, a fenced code block and a list. Each tool call emits a
`running` and a `completed` event, then the reply continues in a new text item.
The fake backend reads these variables whenever `AIDE_FAKE_MANAGED_PROVIDERS=1`
and the prompt is exactly `perf-stream`, so e2e specs can use the same stream.

## What each metric means

The script resets its counters 10 seconds after the prompts go out, so the
rates below cover the steady stream, not pane setup.

| Metric                                      | How it is measured                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coldStartMs`                               | From `electron.launch` to the first animation frame after the "Open project" button is visible                                                                                |
| `mainRssMb`, `rendererRssMb`                | `app.getAppMetrics()` working set of the Browser and Tab processes, read `PERF_SECONDS` after the prompts                                                                     |
| `frameTimeP50Ms`, `frameTimeP95Ms`          | Intervals between the renderer's `DrawFrame` trace events, while a 1px canary changes every animation frame so the compositor always has something to draw. 16.7 ms is 60 fps |
| `framesPerSecond`                           | `DrawFrame` events per traced second                                                                                                                                          |
| `longTasksOver100Ms`, `longestTaskMs`       | `RunTask` trace events on the renderer main thread                                                                                                                            |
| `ipcBytesPerSecond`, `ipcMessagesPerSecond` | Every `webContents.send` from main, sized as the JSON of its arguments. Replies to `invoke` calls are not counted                                                             |
| `reactCommitsPerSecond`                     | React commits across the window, counted through a stub `__REACT_DEVTOOLS_GLOBAL_HOOK__` installed before React loads                                                         |
| `chatPaneRendersPerSecond`                  | Commits that re-rendered a chat pane's `managed-session-content` element, summed over all panes                                                                               |

`reactCommitsByComponent` lists the 15 components that started the most
commits, with commits per second over the same window. On each commit the hook
walks the fiber tree the way React DevTools does, skipping subtrees that took no
work, and names the topmost component on each path that rendered; its
descendants rendered because it did and are not counted. A component whose
state update React threw away after rendering it shows as `Name (bailed out)`,
an anonymous one as `(anonymous in Owner)` after its nearest named ancestor, and
a commit with neither as `(no component)`. A commit counts once for every
component it names, so the rates can add up to more than
`reactCommitsPerSecond`. The CI job builds with `AIDE_KEEP_NAMES=1` so esbuild
keeps function names; a local build without it shows minified names.

The software renderer under Xvfb sets the frame numbers, so compare them only
with runs on the same kind of machine. A desktop GPU draws faster.

## JSON shape

ENG-2662 builds the CI perf budget on this file. Adding a field is fine; renaming
or removing one, or changing a unit, needs a new `schemaVersion`.

```json
{
  "schemaVersion": 1,
  "createdAt": "ISO 8601 time",
  "commit": "git SHA checked out; on a pull request, GitHub's merge commit",
  "machine": {
    "ci": false,
    "cpu": "CPU model",
    "cpuCount": 32,
    "electron": "43.0.0",
    "loadAverage": 0.0,
    "memoryGb": 60.5,
    "os": "Linux 7.2.8"
  },
  "config": {
    "agents": 5,
    "durationSeconds": 120,
    "traceSeconds": 20,
    "tokensPerSecond": 50,
    "toolEvery": 150,
    "toolMix": ["Bash", "Edit", "Read"]
  },
  "metrics": {
    "coldStartMs": 0,
    "mainRssMb": 0,
    "rendererRssMb": 0,
    "frameTimeP50Ms": 0,
    "frameTimeP95Ms": 0,
    "framesPerSecond": 0,
    "longTasksOver100Ms": 0,
    "longestTaskMs": 0,
    "ipcBytesPerSecond": 0,
    "ipcMessagesPerSecond": 0,
    "reactCommitsPerSecond": 0,
    "chatPaneRendersPerSecond": 0
  },
  "reactCommitsByComponent": [{ "component": "ManagedAgentPane", "commitsPerSecond": 0 }]
}
```

Frame metrics are `null` when the trace holds fewer than two frames. The script
exits non-zero, without writing the JSON, if fewer than `PERF_AGENTS` agents are
still streaming at the end.

## Results

Main at `b3a2d44`, measured 2026-10-23 with the defaults above: five agents at
50 tokens a second, a tool call every 150 tokens. The five agent panes are tabs
in one workspace, which is what "Add pane" gives you, so one transcript is on
screen and all five render.

The desktop column ran on an AMD Ryzen 9 9950X (32 threads, 60.5 GB RAM,
Linux 7.2.8, Electron 43.0.0) in a private Xwayland display through
`agent-ws`, while other fleet workers shared the machine (load average 8.1).
The CI column is the optional job on a GitHub `ubuntu-24.04` runner (AMD EPYC
9V45, 2 vCPUs, 7.8 GB RAM, Electron 43.8.0) at main `03834d9` plus this
branch. Both use software rendering.

| Metric | Desktop | CI runner |
| --- | --- | --- |
| Cold start to first interactive frame | 345 ms | 3,716 ms |
| Main process RSS after 2 minutes | 292.9 MB | 315.3 MB |
| Renderer RSS after 2 minutes | 561.3 MB | 549.9 MB |
| Frame time p50 / p95 | 16.9 / 19.5 ms | 16.7 / 25.6 ms |
| Frames per second | 59.9 | 60 |
| Long tasks over 100 ms (20 s trace) | 0, longest 11.7 ms | 0, longest 71.6 ms |
| IPC main to renderer | 3.73 MB/s, 249 messages/s | 3.52 MB/s, 229 messages/s |
| React commits | 184.7/s | 109.7/s |
| Chat pane renders, all five panes | 83.1/s | 76.2/s |

PR #63's 60 fps claim holds on both: frames arrive at the 16.7 ms display
rate and no renderer task reaches 100 ms. The 2-vCPU runner shows the margin
is thin there, with a 71.6 ms task and p95 frames at 25.6 ms.

IPC is the number to watch. Every snapshot carries the whole transcript, about
25 snapshots a second per agent, each followed by a `taskLibraryChanged` ping.
At 20 seconds into a trial run the rate was 1.13 MB/s; at two minutes it is
3.73 MB/s, so it grows with transcript length and a long session will cost more.
Renderer memory grew the same way, from 384 MB at 20 seconds to 561 MB.

## M1 before and after

Both columns are the `Perf budget` job: five agents, 60 s, an `ubuntu-24.04`
runner, three runs each, shown as the range across the runs. Before is main at
`b3a2d44` with the perf script. After is main at `0555441`, with every M1
ticket merged except ENG-2658 and ENG-2661.

| Metric | Before | After |
| --- | --- | --- |
| Frame time p95 | 25.7 to 29.1 ms | 20.8 to 25.7 ms |
| Frame time p50 | 16.7 to 16.8 ms | 16.7 to 16.8 ms |
| Longest renderer task | 39.9 to 119.7 ms | 21 to 49 ms |
| IPC main to renderer | 1.22 to 2.02 MB/s | 166 to 177 KB/s |
| React commits | 50.3 to 124/s | 129 to 139.6/s |
| Chat pane renders, all five panes | 49.2 to 73.1/s | 72 to 76.5/s |

Session deltas (ENG-2656) cut IPC about tenfold. Frame time p95 dropped but
stays over 20 ms on the 2-vCPU runner, which was already at 25.6 ms before M1.

React commits did not fall. At 60 frames a second, 129 to 140 commits is about
2.2 per frame. The frame flush from ENG-2657 makes one of them; the source of
the rest is not identified yet. `useManagedSessionState` sets an unchanged
state, which React skips, the task library listener is debounced to 200 ms,
and the fleet drawer subscribes only while open. Chat pane renders stayed flat.

`scripts/perf-budget.json` sets each ceiling at 1.5x the highest After run:
266,000 bytes/s for IPC and 210 commits/s. IPC and commits vary up to 2x
between identical runs, which is why the ceilings use the highest run, not one
run.
