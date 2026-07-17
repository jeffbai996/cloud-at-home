# Public media contract boundary

This media implementation is a durable public workspace, but it is not a donor
for another checkout. Do not copy its player or rating files into a different
repository. Treat fullscreen and classification behavior here as frozen unless
the user explicitly requests a change in this repository.

- British Columbia `14A` and `18A` triangle badges use `DM Sans`.
- iPad and desktop-class iPad user agents must not use native video fullscreen.
- Tests asserting these contracts must not be weakened or rewritten merely to
  make a broad UI/playback change pass.

Run the media unit tests, typecheck, build, and public-source safety check before
committing changes under this directory.
