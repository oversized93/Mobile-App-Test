# Golfer animations via Mixamo

Drop animation FBX files in this folder and the build loop will wire
them into the game as real skinned golfer animations (replacing the
current bob-and-glide movement).

## Steps (takes ~10 minutes, needs a free Adobe login)

1. Go to **mixamo.com** and sign in (any free Adobe ID works).
2. Click **UPLOAD CHARACTER** and upload
   `assets/meshy/golfer_for_mixamo.obj` from this repo.
3. Mixamo auto-rigs it — place the markers on chin, wrists, elbows,
   knees, groin when asked, then wait for the preview to animate.
4. Find and download each of these clips, one at a time:
   - **Idle** (any relaxed standing idle)
   - **Walking** (a normal walk cycle works best)
   - **Golf Drive** (search "golf" — the full swing)
   - **Golf Putt** (also under "golf")
   - optional: a celebration (search "cheering" or "victory")
5. Download settings for every clip:
   - Format: **FBX Binary (.fbx)**
   - Skin: **With Skin**
   - Frames per second: **30**
   - Keyframe reduction: none
6. Put the downloaded `.fbx` files in this folder (`assets/mixamo/`),
   commit, and push — or just add them however you normally get files
   into the repo.

The autonomous loop checks this folder every cycle. Once the files
appear it converts them (FBX → glTF), builds AnimationMixer states for
idle/walk/swing/putt, and swaps the instanced static golfers for
animated ones — with the static version kept as a fallback for
low-end devices.

Name the files anything recognizable (`Idle.fbx`, `Walking.fbx`,
`Golf Drive.fbx`, `Golf Putt.fbx` is perfect).
